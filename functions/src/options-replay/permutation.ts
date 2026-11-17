/**
 * `optionsReplayPermutation` task handler (Topic #1238, task #1280;
 * single-symbol runs #1430).
 *
 * Per-run pipeline mirroring `stBacktestPermutation`'s shape: mark the
 * list doc running → load the symbol's trading-day calendar → fetch the SA
 * pick doc over [startDate, latestBar] → map rows → write the list doc with
 * pickDocMeta → close out the RUN directly. Runs are single-symbol and
 * the list doc's docId IS the runId — the terminal list outcome writes
 * the run's terminal status ('success' → 'completed'); there are no
 * counters or sibling lists to aggregate.
 *
 * Error semantics (PRD / IMPL-BE §2): a missing pick doc (coded 404 —
 * NOT_FOUND across the window, OPTIONS_NOT_ENABLED) is a deterministic
 * miss — the list is marked `failed` naming the coordinate and the task
 * does NOT retry; a bare 404 (infra/config miss, #1401) and other
 * transient errors rethrow for Cloud Tasks retry until the final attempt.
 * An already-`success`/`failed` list doc short-circuits (idempotent
 * retry).
 *
 * All effects sit behind `ReplayPermutationDeps` (TEST-BE seam 3); the
 * `onTaskDispatched` wrapper injects production wiring. The queue name is
 * the function's own export name — `OPTIONS_REPLAY_TASK_QUEUE` in start.ts
 * is the enqueue-side contract.
 */

import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import * as logger from 'firebase-functions/logger';

import { db, FieldValue } from '../firebase-admin-init';
import { getMarketDatePT, isValidMarketDate } from '../common/pt-date-utils';
import { getCachedBarsFromSymbolData } from '../st-cloud-function/data-loader';
import { PartnerHttpError } from '../partner-infrastructure';
import { fetchPickDoc } from './pick-doc-client';
import type { FetchPickDocInput } from './pick-doc-client';
import { mapPickDocToRows } from './pick-doc-mapper';
import { getReplayTemplate } from '@options-replay/templates';
import {
  ST_OPTIONS_CONTRACT_LISTS_ROOT,
  ST_OPTIONS_REPLAY_RUNS_ROOT,
  stOptionsContractListDocId,
} from '@st/collections';
import type {
  OptionsContractListDocV1,
  OptionsReplayPermutationPayload,
  OptionsReplayRun,
  OptionsReplayRunStatus,
  PickDocument,
  ReplayTemplate,
} from '@options-replay/contracts';

const MAX_ATTEMPTS = 3;

/** Merge-write payload for a list doc — server timestamps allowed. */
export type ContractListWrite = Partial<Omit<OptionsContractListDocV1, 'generatedAt'>> & {
  generatedAt?: FirebaseFirestore.FieldValue | string;
};

/** Slice of the run doc the worker needs — the permutation payload is
 *  only `{runId, symbol}`; selection inputs (symbol included) come off
 *  the run doc so a stale payload can't disagree with it (#1491).
 *  `payload.symbol` is used ONLY to label the failed stub when the run
 *  doc itself is missing — every data-path read uses `run.symbol`.
 *  Partial because Firestore docs aren't schema-enforced — the caller
 *  guards. */
export type ReplayPermutationRunView = Partial<
  Pick<OptionsReplayRun, 'symbol' | 'templateId' | 'startDate'>
>;

/** Injectable effects — tests substitute fakes (TEST-BE seam 3). */
export interface ReplayPermutationDeps {
  resolveTemplate: (templateId: string) => ReplayTemplate | undefined;
  getRun: (runId: string) => Promise<ReplayPermutationRunView | undefined>;
  getListDoc: (docId: string) => Promise<Pick<OptionsContractListDocV1, 'status' | 'error'> | undefined>;
  writeListDoc: (docId: string, fields: ContractListWrite) => Promise<void>;
  /** Sorted trading days `>= startDate`, up to the latest cached bar. */
  loadTradingDays: (symbol: string, startDate: string) => Promise<string[]>;
  fetchPickDoc: (input: FetchPickDocInput) => Promise<PickDocument>;
  /** Record the run's terminal outcome — under single-symbol runs the
   *  list's outcome IS the run's status ('success' → 'completed'). The
   *  production write skips already-terminal runs, so it's safe to invoke
   *  on every terminal status sighting (convergent, not just on first).
   *  `error` stamps the run's failure reason — the FE reads `run.error`;
   *  without it a worker-failed run shows 'failed' with no cause. */
  closeOutRun: (runId: string, outcome: 'success' | 'failed', error?: string) => Promise<void>;
}

/** Pure close-out decision — the run's next status for a terminal list
 *  outcome, or null when the run is already terminal (a redelivery or a
 *  late close-out after a lost ack must not regress it). Exported for
 *  unit coverage — the mapping was previously inline in the untested
 *  prod transaction body (#1430 review). */
export function resolveCloseOutStatus(
  existing: OptionsReplayRunStatus | undefined,
  outcome: 'success' | 'failed',
): OptionsReplayRunStatus | null {
  // Terminal + missing-doc skip: 'completed'/'failed' must not regress;
  // 'cancelled' is unreachable today but the guard belongs here (a late
  // worker must never resurrect it); undefined means the run doc is gone
  // (e.g. migration deleted it mid-flight) — tx.update would reject
  // NOT_FOUND and burn task retries, so skip quietly.
  if (existing !== 'pending' && existing !== 'running') return null;
  return outcome === 'success' ? 'completed' : 'failed';
}

// ==========================
// Core (deps-seamed)
// ==========================

export async function runReplayPermutation(
  payload: OptionsReplayPermutationPayload,
  deps: ReplayPermutationDeps,
  isFinalAttempt: boolean,
): Promise<void> {
  const { runId, symbol: payloadSymbol } = payload;
  const docId = stOptionsContractListDocId(runId);
  const startTime = Date.now();

  const existing = await deps.getListDoc(docId);
  if (existing?.status === 'success' || existing?.status === 'failed') {
    // Terminal doc — ensure the run recorded this outcome. A previous
    // attempt may have written the doc but died before/during close-out
    // (or the transaction's ack was lost); closeOutRun skips terminal runs.
    logger.info('options_replay_worker_skip_terminal', {
      runId, symbol: payloadSymbol, status: existing.status,
    });
    await deps.closeOutRun(runId, existing.status, existing.error);
    return;
  }

  // Selection inputs live on the run doc — the payload is just identity
  // (#1491). A missing run doc is unrecoverable: nothing to select on.
  const run = await deps.getRun(runId);
  if (!run) {
    await failPermanently(deps, docId, runId, `Missing run doc '${runId}'`, {
      runId, symbol: payloadSymbol,
    });
    return;
  }
  const { symbol, templateId, startDate } = run;
  if (
    typeof symbol !== 'string' || !symbol ||
    typeof templateId !== 'string' || !templateId ||
    typeof startDate !== 'string' || !isValidMarketDate(startDate)
  ) {
    // Unrecoverable without well-formed selection inputs — a retriable
    // throw would just burn the task's retry budget to land in the same
    // place. Shape-checked, not just presence: a corrupt-but-truthy
    // startDate (hand-edited doc) is equally unfillable.
    await failPermanently(deps, docId, runId, `Run doc '${runId}' has missing/malformed selection inputs (symbol/templateId/startDate)`, {
      runId, symbol: symbol ?? payloadSymbol, templateId,
    });
    return;
  }

  const template = deps.resolveTemplate(templateId);
  if (!template) {
    await failPermanently(deps, docId, runId, `Unknown templateId '${templateId}'`, {
      runId, symbol, templateId,
    });
    return;
  }

  // List-doc writes are merge last-writer-wins — a duplicate in-flight
  // delivery could regress `status`/rows until its own terminal write
  // lands (at-least-once posture; the RUN's close-out is tx-guarded and
  // never regresses, and a later delivery terminal-skips). Bounded and
  // self-consistent; a status-conditional list-doc tx is the deeper fix.
  await deps.writeListDoc(docId, { runId, symbol, templateId, status: 'running', rows: [] });

  try {
    const tradingDays = await deps.loadTradingDays(symbol, startDate);
    if (tradingDays.length === 0) {
      throw new Error(`No symbol-data daily bars for ${symbol} >= ${startDate}`);
    }

    const doc = await deps.fetchPickDoc({
      symbol,
      coordinate: template.coordinate,
      startDate,
      endDate: tradingDays[tradingDays.length - 1],
    });

    const rows = mapPickDocToRows(doc, tradingDays, template.side);

    await deps.writeListDoc(docId, {
      status: 'success',
      rows,
      pickDocMeta: {
        // The SA-served coordinate — what actually matched, echoed back
        // for provenance (may differ from the request on tie-breaks).
        coordinate: { type: doc.type, targetDelta: doc.targetDelta, expiry: doc.expiry },
        gridVersion: doc.gridVersion,
        pickCount: doc.pickCount,
        missCount: doc.missCount,
        firstDate: doc.firstDate,
        lastDate: doc.lastDate,
      },
      generatedAt: FieldValue.serverTimestamp(),
    });
    await deps.closeOutRun(runId, 'success');

    logger.info('options_replay_worker_complete', {
      runId, symbol, templateId,
      rows: rows.length,
      pickCount: doc.pickCount,
      missCount: doc.missCount,
      durationMs: Date.now() - startTime,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    // A coded 404 names a pick doc that doesn't exist (NOT_FOUND across the
    // window, OPTIONS_NOT_ENABLED) — retrying can't materialize it within
    // backoff. A bare 404 has no partner code — an infra/config miss that a
    // retry may legitimately heal (endpoint deploys mid-run), so it takes
    // the transient path (#1401).
    const permanent =
      e instanceof PartnerHttpError && e.status === 404 && e.partnerCode !== undefined;

    if (permanent || isFinalAttempt) {
      await failPermanently(deps, docId, runId, message, { runId, symbol, templateId });
    }
    if (permanent) {
      // Recorded + logged by failPermanently — no retry can materialize
      // a coded-404 pick doc, so return instead of rethrowing.
      return;
    }

    logger.error('options_replay_worker_error', {
      runId, symbol, templateId,
      error: message,
      isFinalAttempt,
    });
    throw e; // rethrow → Cloud Tasks retry (or recorded final failure)
  }
}

/** Deterministic failure — failed list doc + failed close-out, no throw.
 *  Always logs: a run that dies here leaves a failed doc, and the only
 *  other record of WHY would be a grep for this error string. */
async function failPermanently(
  deps: ReplayPermutationDeps,
  docId: string,
  runId: string,
  error: string,
  fields: Pick<OptionsContractListDocV1, 'runId' | 'symbol'> &
    Partial<Pick<OptionsContractListDocV1, 'templateId'>>,
): Promise<void> {
  logger.warn('options_replay_worker_permanent', { ...fields, error });
  await deps.writeListDoc(docId, {
    ...fields,
    status: 'failed',
    error,
    generatedAt: FieldValue.serverTimestamp(),
  });
  await deps.closeOutRun(runId, 'failed', error);
}

// ==========================
// Production wiring
// ==========================

const prodReplayPermutationDeps: ReplayPermutationDeps = {
  // #1498: resolves via the legacy single-coordinate surface — a run whose
  // templateId names a multi-leg variant has no ReplayTemplate form and will
  // fail "Unknown templateId" here; legs-form runs must resolve off
  // variantSnapshot instead.
  resolveTemplate: getReplayTemplate,

  async getRun(runId) {
    const snap = await db.collection(ST_OPTIONS_REPLAY_RUNS_ROOT).doc(runId).get();
    return snap.exists ? (snap.data() as ReplayPermutationRunView) : undefined;
  },

  async getListDoc(docId) {
    const snap = await db.collection(ST_OPTIONS_CONTRACT_LISTS_ROOT).doc(docId).get();
    return snap.exists ? (snap.data() as OptionsContractListDocV1) : undefined;
  },

  async writeListDoc(docId, fields) {
    await db.collection(ST_OPTIONS_CONTRACT_LISTS_ROOT).doc(docId).set(fields, { merge: true });
  },

  async loadTradingDays(symbol, startDate) {
    const { dailyBars } = await getCachedBarsFromSymbolData(symbol, getMarketDatePT());
    return dailyBars.map((b) => b.d).filter((d) => d >= startDate);
  },

  async fetchPickDoc(input) {
    return fetchPickDoc(input);
  },

  async closeOutRun(runId, outcome, error) {
    const runRef = db.collection(ST_OPTIONS_REPLAY_RUNS_ROOT).doc(runId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(runRef);
      const status = snap.data()?.status as OptionsReplayRunStatus | undefined;
      // Already terminal — a redelivery or a late close-out after a lost
      // ack must not regress the run.
      const next = resolveCloseOutStatus(status, outcome);
      if (!next) return;
      tx.update(runRef, {
        status: next,
        error,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  },
};

export const optionsReplayPermutation = onTaskDispatched<OptionsReplayPermutationPayload>(
  {
    retryConfig: {
      maxAttempts: MAX_ATTEMPTS,
      minBackoffSeconds: 10,
      maxBackoffSeconds: 120,
    },
    rateLimits: {
      maxConcurrentDispatches: 10,
      maxDispatchesPerSecond: 5,
    },
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  async (req) => {
    const retryCount = (req as { retryCount?: number }).retryCount ?? 0;
    await runReplayPermutation(req.data, prodReplayPermutationDeps, retryCount >= MAX_ATTEMPTS - 1);
  },
);
