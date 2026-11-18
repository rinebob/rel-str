/**
 * `optionsReplayStart` callable (Topic #1238, Thread #1240, task #1281;
 * single-symbol runs #1430; two-form request + variant snapshot #1498).
 *
 * A submission of N symbols creates N INDEPENDENT run docs — the multi-
 * symbol input is convenience fanout, not a batch. Per symbol: create
 * `st-options-replay-runs/{runId}` already `running`
 * (`{runIdPT}_{rand}_{SYMBOL}` — the symbol is embedded so runIds are
 * self-describing in logs), then enqueue one
 * `OptionsReplayPermutationPayload`. There is no blind post-create write
 * to protect — the doc's only start-path transitions are `running`
 * (created so) and `failed` (enqueue error), so the doc is born running
 * rather than pending-then-marked. A failed enqueue fails THAT run's doc
 * and moves on — the remaining symbols are unaffected, and the failed
 * run is recoverable via `optionsReplayRetry`. A rerun is always fresh
 * runIds — no dedupe across calls.
 *
 * Per-symbol blocks are independent → fanned out in parallel; a create
 * failure is systemic (Firestore, not per-task) and fails the callable.
 * Residual: a process kill between `createRun` commit and the enqueue
 * RPC leaves the run `running` with no task — accepted posture shared
 * with `optionsReplayRetry` (a stale-`running` sweeper is the real fix,
 * out of scope).
 *
 * All Firestore + task-queue effects live behind `ReplayStartDeps` so the
 * orchestration core is unit-testable without emulators (TEST-BE seam).
 * The `optionsReplayPermutation` task handler is #1280 — the queue name
 * below is the contract between them.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { getFunctions } from 'firebase-admin/functions';
import * as logger from 'firebase-functions/logger';

import { db, FieldValue } from '../firebase-admin-init';
import { getRunDatePT, getRunIdPT, isValidMarketDate } from '../common/pt-date-utils';
import { getReplayTemplate, getReplayVariant, validateVariantLegs } from '@options-replay/templates';
import { ST_OPTIONS_REPLAY_RUNS_ROOT } from '@st/collections';
import { templateToOptionLeg } from '@options-replay/contracts';
import type {
  OptionsReplayPermutationPayload,
  OptionsReplayRun,
  OptionsReplayStartRequest,
  OptionsReplayStartResponse,
  VariantLeg,
  VariantSnapshot,
} from '@options-replay/contracts';

/** Task-queue name — must match the `onTaskDispatched` function #1280 exports. */
export const OPTIONS_REPLAY_TASK_QUEUE = 'optionsReplayPermutation';

/** Run doc as written — server timestamps in place of the wire ISO
 *  strings. `variantSnapshot` is required on WRITE (every post-#1498 run
 *  stamps it) while staying optional on the read model — pre-#1498 docs
 *  legitimately lack it. */
export type OptionsReplayRunWrite = Omit<OptionsReplayRun, 'createdAt' | 'updatedAt' | 'completedAt'> & {
  createdAt: FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.FieldValue;
  variantSnapshot: VariantSnapshot;
};

/** Injectable effects — tests substitute fakes; the callable uses the
 *  production wiring below. */
export interface ReplayStartDeps {
  /** Persist the new run doc (status 'running'). */
  createRun: (runId: string, doc: OptionsReplayRunWrite) => Promise<void>;
  /** Enqueue one per-symbol task payload. */
  enqueue: (payload: OptionsReplayPermutationPayload) => Promise<void>;
  /** Mark the run 'failed' with the enqueue error — the doc's only
   *  start-path transition (a successful run ends via the worker's
   *  close-out, not a start write). */
  markRunEnqueueFailed: (runId: string, error: string) => Promise<void>;
}

export async function startReplay(
  request: CallableRequest<OptionsReplayStartRequest>,
  deps: ReplayStartDeps = prodReplayStartDeps,
): Promise<OptionsReplayStartResponse> {
  // Auth guard (#1437) — a public-invoker callable must reject anonymous
  // calls before any validation or deps; every effect of the call is
  // billed work.
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'unauthenticated');
  const input = request.data;
  // Runtime types aren't guaranteed at the callable boundary — a malformed
  // payload must surface invalid-argument, not a TypeError-as-internal.
  // Exactly one identity form per request (#1498): `variantId` resolves
  // through the registry, inline `legs[]` validate against the SHARED
  // validator, and legacy `templateId` resolves to its 1-leg variant.
  // Presence (`!== undefined`), not truthiness — legs:null still signals
  // the caller intended the legs form.
  const forms =
    (input?.variantId !== undefined ? 1 : 0) +
    (input?.legs !== undefined ? 1 : 0) +
    (input?.templateId !== undefined ? 1 : 0);
  if (forms !== 1) {
    throw new HttpsError(
      'invalid-argument',
      'Exactly one of variantId, legs, or templateId is required',
    );
  }
  const resolved = resolveRequestVariant(input);
  const templateId = resolved.templateId;
  const variantSnapshot = resolved.variantSnapshot;

  const rawSymbols = Array.isArray(input?.symbols) ? input.symbols : [];
  const symbols = [
    ...new Set(
      rawSymbols
        // Only real strings — `String(null)`→'NULL', `String(123)`→'123'
        // would otherwise pass the charset check as invented tickers.
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  if (symbols.length === 0) {
    throw new HttpsError('invalid-argument', 'At least one symbol is required');
  }
  // Symbols land in the runId → a doc PATH — '/' would make the id an
  // invalid path and fail createRun mid-fanout (poisoning the whole
  // submission). Ticker charset: letters/digits plus the . - ^ suffix
  // alphabet (BRK.B, BF-B, ^GSPC). Fail the request, don't drop silently.
  const illegal = symbols.filter((s) => !/^[A-Z0-9.\-^]{1,12}$/.test(s));
  if (illegal.length > 0) {
    throw new HttpsError('invalid-argument', `Illegal symbol(s): ${illegal.join(', ')}`);
  }

  const startDate = String(input?.startDate ?? '').trim();
  if (!isValidMarketDate(startDate)) {
    throw new HttpsError('invalid-argument', `startDate must be a valid YYYY-MM-DD date, got '${input?.startDate}'`);
  }

  // Independent per-symbol blocks — parallel fanout (guideline §6). An
  // enqueue failure fails that run only; a create failure is systemic
  // and lets the callable throw.
  const runIds = await Promise.all(
    symbols.map(async (symbol) => {
      // Each symbol gets its own runId — the symbol suffix makes runIds
      // self-describing in logs; the rand keeps same-second submissions unique.
      const runId = `${getRunIdPT(getRunDatePT(), 'manual')}_${Math.random().toString(36).slice(2, 8)}_${symbol}`;

      const runDoc: OptionsReplayRunWrite = {
        runId,
        templateId,
        symbol,
        startDate,
        status: 'running',
        // Stamped once at create — the worker reads this, never the
        // registry, so post-run registry edits can't rewrite history.
        // (The worker switch lands in #1499 — until then variant/legs
        // runs fail 'Unknown templateId' in the legacy worker.)
        variantSnapshot,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      await deps.createRun(runId, runDoc);

      try {
        await deps.enqueue({ runId, symbol });
      } catch (e: unknown) {
        // A failed enqueue fails THIS run only — the doc lands 'failed'
        // with the error, visible in the run list and recoverable via
        // optionsReplayRetry. Remaining symbols are unaffected.
        const message = e instanceof Error ? e.message : String(e);
        await deps.markRunEnqueueFailed(runId, message);
        logger.error('options_replay_enqueue_failed', { runId, symbol, error: message });
      }
      return runId;
    }),
  );

  logger.info('options_replay_start', { runIds, templateId });
  return { runIds };
}

/**
 * Resolve the request's single identity form to the run's registry id +
 * self-describing variant snapshot (IMPL-BE §1, #1498). The caller has
 * already counted forms — each branch keys off its `!== undefined`
 * discriminator, mirroring the count's presence semantics.
 */
function resolveRequestVariant(input: OptionsReplayStartRequest | undefined): {
  templateId: string;
  variantSnapshot: VariantSnapshot;
} {
  if (input?.variantId !== undefined) {
    const variantId = String(input.variantId ?? '').trim();
    const variant = variantId ? getReplayVariant(variantId) : undefined;
    if (!variant) {
      throw new HttpsError('invalid-argument', `Unknown variantId '${String(input.variantId)}'`);
    }
    return {
      templateId: variant.id,
      variantSnapshot: { variantId: variant.id, name: variant.name, legs: variant.legs },
    };
  }
  if (input?.legs !== undefined) {
    if (!Array.isArray(input.legs) || input.legs.length === 0) {
      throw new HttpsError('invalid-argument', 'legs must be a non-empty array');
    }
    // An unbounded leg array can exceed the 1MiB doc limit — a createRun
    // rejection mid-fanout surfaces `internal` with a partial run set.
    // 8 is 2× the largest registry shape (4-leg condors/butterflies).
    if (input.legs.length > 8) {
      throw new HttpsError('invalid-argument', 'legs exceeds the maximum of 8');
    }
    const errs = validateVariantLegs(input.legs);
    if (errs.length > 0) {
      throw new HttpsError('invalid-argument', errs.join('; '));
    }
    const requestedName = input.variantName;
    if (
      requestedName !== undefined &&
      (typeof requestedName !== 'string' || requestedName.trim().length > 200)
    ) {
      throw new HttpsError(
        'invalid-argument',
        'variantName must be a string of at most 200 characters',
      );
    }
    // Stamp only contract fields — a wire leg carrying extra keys must
    // not leak them into the immutable snapshot. targetDelta is stamped
    // in canonical grid form: the validator's round-then-check admits
    // e.g. -0.19999 as 20Δ, and consumers read the stamped value as the
    // canonical cell.
    const legs: VariantLeg[] = input.legs.map((l) =>
      l.kind === 'stock'
        ? { kind: 'stock', side: l.side }
        : {
            kind: 'option',
            type: l.type,
            targetDelta:
              Math.sign(l.targetDelta) * (Math.round(Math.abs(l.targetDelta) * 100) / 100),
            dte: l.dte,
            side: l.side,
          },
    );
    const name = typeof requestedName === 'string' ? requestedName.trim() : '';
    return {
      // Inline legs resolve to no registry entry — 'custom' mirrors the
      // variant `structure` convention for a non-registry composition.
      templateId: 'custom',
      variantSnapshot: { name: name || `custom ${legs.length}-leg`, legs },
    };
  }
  const templateId = String(input?.templateId ?? '').trim();
  const template = templateId ? getReplayTemplate(templateId) : undefined;
  if (!template) {
    throw new HttpsError('invalid-argument', `Unknown templateId '${input?.templateId}'`);
  }
  // A ReplayTemplate is a 1-leg variant projection (#1495) — template.id
  // IS the variant's registry id, so the snapshot stamps it for
  // provenance. `templateToOptionLeg` is the documented migration shim.
  return {
    templateId: template.id,
    variantSnapshot: {
      variantId: template.id,
      name: template.name,
      legs: [templateToOptionLeg(template)],
    },
  };
}

/** Production wiring — Firestore run doc + Cloud Tasks queue. Exported
 *  so verify scripts exercise the real deps rather than a drifted copy. */
export const prodReplayStartDeps: ReplayStartDeps = {
  async createRun(runId, doc) {
    await db.collection(ST_OPTIONS_REPLAY_RUNS_ROOT).doc(runId).set(doc);
  },
  async markRunEnqueueFailed(runId, error) {
    // Guarded like retry's failRun: only fail a run still 'running' — on a
    // lost-ack enqueue whose phantom task raced to close-out first, a
    // blind update would regress 'completed' back to 'failed'.
    const runRef = db.collection(ST_OPTIONS_REPLAY_RUNS_ROOT).doc(runId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(runRef);
      if (snap.data()?.status !== 'running') return;
      tx.update(runRef, {
        status: 'failed',
        error,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  },
  async enqueue(payload) {
    await getFunctions().taskQueue(OPTIONS_REPLAY_TASK_QUEUE).enqueue(payload);
  },
};

export const optionsReplayStart = onCall<OptionsReplayStartRequest, Promise<OptionsReplayStartResponse>>(
  { cors: true, memory: '256MiB', invoker: 'public' },
  async (request) => startReplay(request),
);
