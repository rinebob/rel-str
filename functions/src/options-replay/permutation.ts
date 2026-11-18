/**
 * `optionsReplayPermutation` task handler (Topic #1238, task #1280;
 * single-symbol runs #1430; multi-leg worker #1499).
 *
 * Per-run pipeline mirroring `stBacktestPermutation`'s shape: mark the
 * list doc running → load the symbol's trading-day calendar → resolve
 * the run's `variantSnapshot` legs (self-describing — no registry call)
 * → fetch one SA pick doc per option leg (bounded parallel) → join into
 * position rows → write the v2 list doc with `legMetas[]` → close out
 * the RUN directly. Runs are single-symbol and the list doc's docId IS
 * the runId — the terminal list outcome writes the run's terminal
 * status ('success' → 'completed'); there are no counters or sibling
 * lists to aggregate.
 *
 * Error semantics (PRD / IMPL-BE §3): a missing pick doc (coded 404 —
 * NOT_FOUND across the window, OPTIONS_NOT_ENABLED) is a deterministic
 * miss — the list is marked `failed` naming the leg's coordinate and
 * the task does NOT retry; a bare 404 (infra/config miss, #1401) and
 * other transient errors rethrow for Cloud Tasks retry until the final
 * attempt. An already-`success`/`failed` list doc short-circuits
 * (idempotent retry). A missing or malformed `variantSnapshot` is a
 * permanent failure — the run predates the model or was hand-built;
 * retrying can't fix it.
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
import { forEachWithConcurrency } from '../common/async-utils';
import { PartnerHttpError } from '../partner-infrastructure';
import { fetchPickDoc } from './pick-doc-client';
import type { FetchPickDocInput } from './pick-doc-client';
import { mapLegsToPositionRows } from './pick-doc-mapper';
import type { MapperLegInput } from './pick-doc-mapper';
import { validateVariantLegs } from '@options-replay/templates';
import { legToPickDocCoordinate } from '@options-replay/contracts';
import {
  ST_OPTIONS_CONTRACT_LISTS_ROOT,
  ST_OPTIONS_REPLAY_RUNS_ROOT,
  stOptionsContractListDocId,
} from '@st/collections';
import type {
  OptionsContractListDoc,
  OptionsReplayPermutationPayload,
  OptionsReplayRun,
  OptionsReplayRunStatus,
  PickDocCoordinate,
  PickDocMeta,
  PickDocument,
} from '@options-replay/contracts';

const MAX_ATTEMPTS = 3;
const MAX_LEG_FETCH_CONCURRENCY = 4;

/** A field the writer may either set or clear — merge-writes never
 *  remove fields, so a stale value needs an explicit `FieldValue.delete()`. */
type Clearable<T> = T | FirebaseFirestore.FieldValue;

/** Merge-write payload for a v2 list doc — server timestamps and
 *  delete-sentinels allowed. Every write is self-sufficient about the
 *  fields it doesn't own: a redelivered attempt (at-least-once) can
 *  overwrite a prior attempt's terminal doc, and a retried run can
 *  rewrite a reset doc — neither may leave stale v1 `pickDocMeta` or a
 *  prior attempt's `rows`/`legMetas`/`error` beside its own write. */
export type ContractListWrite =
  Omit<Partial<OptionsContractListDoc>, 'generatedAt' | 'rows' | 'legMetas' | 'error'> & {
    generatedAt?: FirebaseFirestore.FieldValue | string;
    rows?: Clearable<OptionsContractListDoc['rows']>;
    legMetas?: Clearable<OptionsContractListDoc['legMetas']>;
    error?: Clearable<string>;
    pickDocMeta?: FirebaseFirestore.FieldValue;
  };

/** Slice of the run doc the worker needs — the permutation payload is
 *  only `{runId, symbol}`; selection inputs (symbol included) come off
 *  the run doc so a stale payload can't disagree with it (#1491). The
 *  legs themselves come off `variantSnapshot` — self-describing, stamped
 *  at start so later registry edits can't rewrite history (#1498/#1499).
 *  `payload.symbol` is used ONLY to label the failed stub when the run
 *  doc itself is missing — every data-path read uses `run.symbol`.
 *  Partial because Firestore docs aren't schema-enforced — the caller
 *  guards. */
export type ReplayPermutationRunView = Partial<
  Pick<OptionsReplayRun, 'symbol' | 'templateId' | 'startDate' | 'variantSnapshot'>
>;

/** Injectable effects — tests substitute fakes (TEST-BE seam 3). */
export interface ReplayPermutationDeps {
  getRun: (runId: string) => Promise<ReplayPermutationRunView | undefined>;
  getListDoc: (docId: string) => Promise<Pick<OptionsContractListDoc, 'status' | 'error'> | undefined>;
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

  // Legs come off the stamped snapshot — self-describing (IMPL-BE §3).
  // Missing/malformed = pre-model or hand-built run; retry can't fix it.
  const snapshot = run.variantSnapshot;
  const legs = snapshot?.legs;
  if (!snapshot || !Array.isArray(legs) || legs.length === 0) {
    await failPermanently(deps, docId, runId, `Run doc '${runId}' has missing/malformed variantSnapshot (no legs array)`, {
      runId, symbol, templateId,
    });
    return;
  }
  const legErrors = validateVariantLegs(legs, 'variantSnapshot');
  if (legErrors.length > 0) {
    await failPermanently(deps, docId, runId, `Run doc '${runId}' variantSnapshot legs invalid — ${legErrors.join('; ')}`, {
      runId, symbol, templateId,
    });
    return;
  }
  // One job per option leg — carries its request coordinate and
  // collects its fetched doc, so leg inputs and legMetas derive without
  // index bookkeeping. Stock legs have no job — they resolve off the
  // picks.
  const optionJobs = legs.flatMap((leg, index) =>
    leg.kind === 'option'
      ? [{ index, coordinate: legToPickDocCoordinate(leg), doc: undefined as PickDocument | undefined }]
      : []);
  if (optionJobs.length === 0) {
    await failPermanently(deps, docId, runId, `Run doc '${runId}' variantSnapshot has no option legs — nothing to select`, {
      runId, symbol, templateId,
    });
    return;
  }

  // List-doc writes are merge last-writer-wins — a duplicate in-flight
  // delivery could regress `status`/rows until its own terminal write
  // lands (at-least-once posture; the RUN's close-out is tx-guarded and
  // never regresses, and a later delivery terminal-skips). Bounded and
  // self-consistent; a status-conditional list-doc tx is the deeper fix.
  await deps.writeListDoc(docId, {
    runId, symbol, templateId, status: 'running', schemaVersion: 2, rows: [],
    pickDocMeta: FieldValue.delete(),
    legMetas: FieldValue.delete(),
    error: FieldValue.delete(),
  });

  try {
    const tradingDays = await deps.loadTradingDays(symbol, startDate);
    if (tradingDays.length === 0) {
      throw new Error(`No symbol-data daily bars for ${symbol} >= ${startDate}`);
    }
    const endDate = tradingDays[tradingDays.length - 1];

    // One pick doc per option leg, bounded parallel (IMPL-BE §3).
    const fetchFailures: { job: (typeof optionJobs)[number]; error: unknown }[] = [];
    await forEachWithConcurrency(optionJobs, MAX_LEG_FETCH_CONCURRENCY, async (job) => {
      try {
        job.doc = await deps.fetchPickDoc({ symbol, coordinate: job.coordinate, startDate, endDate });
      } catch (e) {
        fetchFailures.push({ job, error: e });
      }
    });
    if (fetchFailures.length > 0) {
      // Report the earliest declared leg — deterministic failure
      // ordering regardless of which fetch settled first.
      fetchFailures.sort((a, b) => a.job.index - b.job.index);
      const { job, error } = fetchFailures[0];
      const label = `leg ${job.index} pick doc ${coordLabel(job.coordinate)}`;
      if (error instanceof Error) {
        error.message = `${label}: ${error.message}`;
        throw error;
      }
      throw new Error(`${label}: ${String(error)}`);
    }

    const docByLegIndex = new Map(optionJobs.map((j) => [j.index, j]));
    const resolvedInputs: MapperLegInput[] = legs.map((leg, i) => {
      if (leg.kind === 'stock') return { kind: 'stock', side: leg.side };
      // Defined: a missing doc pushed a fetchFailure and threw above.
      const job = docByLegIndex.get(i)!;
      return { kind: 'option', side: leg.side, coordinate: job.coordinate, doc: job.doc! };
    });

    const rows = mapLegsToPositionRows(resolvedInputs, tradingDays);

    // Pick-doc provenance per option leg, in declared order — the SA-
    // served coordinate is echoed back (it can differ from the request
    // on tie-breaks).
    const legMetas: PickDocMeta[] = optionJobs.map(({ doc }) => ({
      coordinate: { type: doc!.type, targetDelta: doc!.targetDelta, expiry: doc!.expiry },
      gridVersion: doc!.gridVersion,
      pickCount: doc!.pickCount,
      missCount: doc!.missCount,
      firstDate: doc!.firstDate,
      lastDate: doc!.lastDate,
    }));

    await deps.writeListDoc(docId, {
      status: 'success',
      schemaVersion: 2,
      rows,
      legMetas,
      // Self-sufficient merge hygiene — a v1 doc or a prior attempt's
      // failure can't leave these beside the fresh rows/legMetas.
      pickDocMeta: FieldValue.delete(),
      error: FieldValue.delete(),
      generatedAt: FieldValue.serverTimestamp(),
    });
    await deps.closeOutRun(runId, 'success');

    logger.info('options_replay_worker_complete', {
      runId, symbol, templateId,
      legs: legs.length,
      rows: rows.length,
      pickCount: legMetas.reduce((n, m) => n + m.pickCount, 0),
      missCount: legMetas.reduce((n, m) => n + m.missCount, 0),
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

/** `(put Δ-0.2 45dte)` — compact leg label for failure messages. */
function coordLabel(c: PickDocCoordinate): string {
  return `(${c.type} Δ${c.targetDelta} ${c.expiry.dte}dte)`;
}

/** Deterministic failure — failed list doc + failed close-out, no throw.
 *  Always logs: a run that dies here leaves a failed doc, and the only
 *  other record of WHY would be a grep for this error string. */
async function failPermanently(
  deps: ReplayPermutationDeps,
  docId: string,
  runId: string,
  error: string,
  fields: Pick<OptionsContractListDoc, 'runId' | 'symbol'> &
    Partial<Pick<OptionsContractListDoc, 'templateId'>>,
): Promise<void> {
  logger.warn('options_replay_worker_permanent', { ...fields, error });
  await deps.writeListDoc(docId, {
    ...fields,
    status: 'failed',
    schemaVersion: 2,
    error,
    // A redelivered attempt could land this failure over a prior
    // attempt's success — merge never removes fields, so clear the
    // provenance/rows this write doesn't own.
    rows: FieldValue.delete(),
    legMetas: FieldValue.delete(),
    pickDocMeta: FieldValue.delete(),
    generatedAt: FieldValue.serverTimestamp(),
  });
  await deps.closeOutRun(runId, 'failed', error);
}

// ==========================
// Production wiring
// ==========================

/** Exported so verify scripts can drive the real wiring without the
 *  Cloud Tasks hop — the queue path itself is proven by #1498's
 *  live stage (real enqueue → deployed worker dequeue). */
export const prodReplayPermutationDeps: ReplayPermutationDeps = {
  async getRun(runId) {
    const snap = await db.collection(ST_OPTIONS_REPLAY_RUNS_ROOT).doc(runId).get();
    return snap.exists ? (snap.data() as ReplayPermutationRunView) : undefined;
  },

  async getListDoc(docId) {
    const snap = await db.collection(ST_OPTIONS_CONTRACT_LISTS_ROOT).doc(docId).get();
    return snap.exists ? (snap.data() as OptionsContractListDoc) : undefined;
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
