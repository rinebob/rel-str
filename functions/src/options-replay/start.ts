/**
 * `optionsReplayStart` callable (Topic #1238, Thread #1240, task #1281;
 * single-symbol runs #1430).
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
import { getFunctions } from 'firebase-admin/functions';
import * as logger from 'firebase-functions/logger';

import { db, FieldValue } from '../firebase-admin-init';
import { getRunDatePT, getRunIdPT, isValidMarketDate } from '../common/pt-date-utils';
import { getReplayTemplate } from '@options-replay/templates';
import { ST_OPTIONS_REPLAY_RUNS_ROOT } from '@st/collections';
import type {
  OptionsReplayPermutationPayload,
  OptionsReplayRun,
  OptionsReplayStartRequest,
  OptionsReplayStartResponse,
} from '@options-replay/contracts';

/** Task-queue name — must match the `onTaskDispatched` function #1280 exports. */
export const OPTIONS_REPLAY_TASK_QUEUE = 'optionsReplayPermutation';

/** Run doc as written — server timestamps in place of the wire ISO strings. */
export type OptionsReplayRunWrite = Omit<OptionsReplayRun, 'createdAt' | 'updatedAt' | 'completedAt'> & {
  createdAt: FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.FieldValue;
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
  input: OptionsReplayStartRequest | undefined,
  deps: ReplayStartDeps = prodReplayStartDeps,
): Promise<OptionsReplayStartResponse> {
  // Runtime types aren't guaranteed at the callable boundary — a malformed
  // payload must surface invalid-argument, not a TypeError-as-internal.
  const templateId = String(input?.templateId ?? '').trim();
  const template = templateId ? getReplayTemplate(templateId) : undefined;
  if (!template) {
    throw new HttpsError('invalid-argument', `Unknown templateId '${input?.templateId}'`);
  }

  const rawSymbols = Array.isArray(input?.symbols) ? input.symbols : [];
  const symbols = [
    ...new Set(
      rawSymbols
        .map((s) => String(s).trim().toUpperCase())
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
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      await deps.createRun(runId, runDoc);

      try {
        await deps.enqueue({ runId, symbol, templateId, startDate });
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

/** Production wiring — Firestore run doc + Cloud Tasks queue. */
const prodReplayStartDeps: ReplayStartDeps = {
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
  async (request) => startReplay(request.data),
);
