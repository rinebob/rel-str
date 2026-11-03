/**
 * `optionsReplayRetry` callable (Topic #1238, Thread #1266, task #1369).
 *
 * Re-runs the failed per-symbol list docs of an existing run in place:
 * each failed list doc resets to `pending` (rows/pickDocMeta/error/
 * generatedAt deleted), the run's `listOutcomes` entries for those
 * symbols are removed with `failedLists` decremented and status back to
 * `running` (stale `error`/`completedAt` cleared),
 * and one `OptionsReplayPermutationPayload` per failed symbol is
 * re-enqueued on the replay queue. Success docs are never touched — the
 * worker's terminal skip keeps them intact if a payload ever lands.
 *
 * No-ops: run `pending`/`running` (in-flight — PRD story 4) or
 * `cancelled` (don't resurrect a cancelled run), and a run with no
 * failed lists. Both return `{retriedSymbols: []}`.
 *
 * Ordering matters: resets land BEFORE enqueue — an early-dispatching
 * worker must never see a still-`failed` doc (its terminal skip would
 * record the failure again instead of re-running).
 *
 * Concurrency: `resetRunForRetry` is transactional — it re-reads the run
 * doc and only deletes outcome entries still `=== 'failed'`, decrementing
 * `failedLists` by the count actually removed. A concurrent second call
 * sees the entries already gone, resets nothing, and returns
 * `{retriedSymbols: []}` — no double-decrement, no double-enqueue.
 *
 * Partial fanout: enqueues run via allSettled; symbols whose enqueue
 * rejected get their `listOutcomes` entries restored to `'failed'` by
 * `failRun` (otherwise they'd sit `pending` with no recorded outcome —
 * invisible to a later retry). A stale pre-reset delivery that sneaks in
 * during the reset window can resolve a symbol without the new task —
 * convergent, just slightly over-reported in `retriedSymbols`.
 *
 * Residual: a process kill between `resetRunForRetry` commit and an
 * enqueue RPC never transmitting leaves that symbol outcome-deleted,
 * doc `pending`, no task — and retry no-ops on `running` (same accepted
 * posture as `optionsReplayStart`'s partial fanout; a stale-`running`
 * sweeper is the real fix, out of scope here).
 *
 * All Firestore + task-queue effects sit behind `ReplayRetryDeps`
 * (TEST-BE seam); the callable wires production deps below.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFunctions } from 'firebase-admin/functions';
import * as logger from 'firebase-functions/logger';

import { db, FieldValue } from '../firebase-admin-init';
import {
  ST_OPTIONS_CONTRACT_LISTS_ROOT,
  ST_OPTIONS_REPLAY_RUNS_ROOT,
  stOptionsContractListDocId,
} from '@st/collections';
import type {
  OptionsContractListStatus,
  OptionsReplayPermutationPayload,
  OptionsReplayRetryRequest,
  OptionsReplayRetryResponse,
  OptionsReplayRun,
  OptionsReplayRunStatus,
} from '@options-replay/contracts';
import { OPTIONS_REPLAY_TASK_QUEUE } from './start';

/** Slice of the run doc the retry decision needs. */
export type ReplayRetryRunView = Pick<
  OptionsReplayRun,
  'status' | 'templateId' | 'startDate' | 'listOutcomes'
>;

/** Injectable effects — tests substitute fakes; the callable uses the
 *  production wiring below. */
export interface ReplayRetryDeps {
  getRun: (runId: string) => Promise<ReplayRetryRunView | undefined>;
  /** Reset one failed list doc to `pending` — rows/pickDocMeta/error
   *  (and generatedAt) deleted so the worker rewrites a clean doc. */
  resetListDoc: (docId: string) => Promise<void>;
  /** One transactional run-doc update: remove `listOutcomes.{symbol}` for
   *  each symbol still `=== 'failed'` at read time, decrement
   *  `failedLists` by the count actually removed, status → 'running',
   *  stale `error`/`completedAt` cleared. Returns the symbols actually
   *  reset (empty when a concurrent retry already claimed them). */
  resetRunForRetry: (runId: string, symbols: string[]) => Promise<string[]>;
  /** Re-enqueue one per-symbol permutation payload. */
  enqueue: (payload: OptionsReplayPermutationPayload) => Promise<void>;
  /** Partial-fanout fallback — mark the run failed and restore
   *  `listOutcomes.{symbol}: 'failed'` (+ `failedLists` increment) for
   *  symbols whose enqueue never landed, or they'd sit `pending` with no
   *  outcome — invisible to a later retry. */
  failRun: (runId: string, error: string, unEnqueuedSymbols: string[]) => Promise<void>;
}

/** Run statuses where a retry is a no-op — in-flight runs must not
 *  double-enqueue, and a cancelled run must not be resurrected. */
const RETRY_NOOP_STATUSES: ReadonlySet<OptionsReplayRunStatus> = new Set([
  'pending',
  'running',
  'cancelled',
]);

/** Whether a list doc may still be reset by a retry — only `failed` /
 *  `pending` / missing. Exported for unit coverage of the safety-critical
 *  predicate inside the `resetListDoc` transaction (#1370 review). */
export function shouldResetForRetry(status: OptionsContractListStatus | undefined): boolean {
  return status !== 'success' && status !== 'running';
}

export async function runReplayRetry(
  input: OptionsReplayRetryRequest | undefined,
  deps: ReplayRetryDeps = prodReplayRetryDeps,
): Promise<OptionsReplayRetryResponse> {
  const runId = typeof input?.runId === 'string' ? input.runId.trim() : '';
  if (!runId) {
    throw new HttpsError('invalid-argument', 'runId is required');
  }

  const run = await deps.getRun(runId);
  if (!run) {
    throw new HttpsError('not-found', `No replay run '${runId}'`);
  }
  if (RETRY_NOOP_STATUSES.has(run.status)) {
    return { retriedSymbols: [] };
  }

  const outcomes = run.listOutcomes ?? {};
  const failedSymbols = Object.keys(outcomes)
    .filter((s) => outcomes[s] === 'failed')
    .sort();
  if (failedSymbols.length === 0) {
    return { retriedSymbols: [] };
  }

  // Reset before enqueue — see header note on ordering.
  await Promise.all(
    failedSymbols.map((symbol) => deps.resetListDoc(stOptionsContractListDocId(runId, symbol))),
  );
  const resetSymbols = await deps.resetRunForRetry(runId, failedSymbols);
  if (resetSymbols.length === 0) {
    // A concurrent retry claimed the outcomes between our read and the
    // transaction — its own enqueue covers them.
    return { retriedSymbols: [] };
  }

  const results = await Promise.allSettled(
    resetSymbols.map((symbol) =>
      deps.enqueue({ runId, symbol, templateId: run.templateId, startDate: run.startDate }),
    ),
  );
  const unEnqueued = resetSymbols.filter((_, i) => results[i].status === 'rejected');
  if (unEnqueued.length > 0) {
    const first = (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason;
    const message = first instanceof Error ? first.message : String(first);
    await deps.failRun(runId, message, unEnqueued);
    throw new HttpsError('internal', `Failed to re-enqueue replay tasks: ${message}`);
  }

  logger.info('options_replay_retry', { runId, retried: resetSymbols.length });
  return { retriedSymbols: resetSymbols };
}

/** Production wiring — Firestore run/list docs + the replay task queue. */
const prodReplayRetryDeps: ReplayRetryDeps = {
  async getRun(runId) {
    const snap = await db.collection(ST_OPTIONS_REPLAY_RUNS_ROOT).doc(runId).get();
    return snap.exists ? (snap.data() as ReplayRetryRunView) : undefined;
  },

  async resetListDoc(docId) {
    // Transactional guard: a concurrent retry that read the run doc before
    // the winning claim can reach here AFTER the winning task already
    // re-succeeded — resetting a fresh 'success' doc back to 'pending'
    // would delete `rows` under a recorded success, and resetting under a
    // mid-flight 'running' worker is a pointless write (TN-M1, #1370
    // review). Only reset while the doc is still failed/pending (or
    // missing — set-merge creates a stub the worker fills).
    const docRef = db.collection(ST_OPTIONS_CONTRACT_LISTS_ROOT).doc(docId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      const status = snap.data()?.status as OptionsContractListStatus | undefined;
      if (!shouldResetForRetry(status)) return;
      tx.set(
        docRef,
        {
          status: 'pending' satisfies OptionsContractListStatus,
          rows: FieldValue.delete(),
          pickDocMeta: FieldValue.delete(),
          error: FieldValue.delete(),
          generatedAt: FieldValue.delete(),
        },
        { merge: true },
      );
    });
  },

  async resetRunForRetry(runId, symbols) {
    const runRef = db.collection(ST_OPTIONS_REPLAY_RUNS_ROOT).doc(runId);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(runRef);
      const d = (snap.data() ?? {}) as {
        status?: OptionsReplayRunStatus;
        listOutcomes?: Record<string, string>;
      };
      // Re-check inside the tx: a status flip to a no-op status between
      // getRun and here must not be resurrected back to 'running'.
      if (d.status && RETRY_NOOP_STATUSES.has(d.status)) return [];
      const stillFailed = symbols.filter((s) => d.listOutcomes?.[s] === 'failed');
      if (stillFailed.length === 0) return [];
      // Whole-map write (not `listOutcomes.{symbol}` dot-paths): dot in a
      // symbol like BRK.B would split into a nested path, while readers
      // treat listOutcomes as a flat map — see permutation.ts closeOutList.
      const listOutcomes = { ...(d.listOutcomes ?? {}) };
      for (const s of stillFailed) delete listOutcomes[s];
      tx.update(runRef, {
        listOutcomes,
        status: 'running' satisfies OptionsReplayRunStatus,
        failedLists: FieldValue.increment(-stillFailed.length),
        completedAt: FieldValue.delete(),
        error: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return stillFailed;
    });
  },

  async enqueue(payload) {
    await getFunctions().taskQueue(OPTIONS_REPLAY_TASK_QUEUE).enqueue(payload);
  },

  async failRun(runId, error, unEnqueuedSymbols) {
    const runRef = db.collection(ST_OPTIONS_REPLAY_RUNS_ROOT).doc(runId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(runRef);
      const d = (snap.data() ?? {}) as {
        status?: OptionsReplayRunStatus;
        listOutcomes?: Record<string, string>;
      };
      // Restore 'failed' only for symbols that haven't already re-resolved
      // (a task that did land may have closed out in the meantime).
      const listOutcomes = { ...(d.listOutcomes ?? {}) };
      const restored = unEnqueuedSymbols.filter((s) => listOutcomes[s] === undefined);
      // Nothing to restore means every un-enqueued symbol already has an
      // outcome — the run is converging on its own; stamping 'failed'
      // here would only lie about a healthy 'running' run.
      if (restored.length === 0) return;
      for (const s of restored) listOutcomes[s] = 'failed';
      tx.update(runRef, {
        listOutcomes,
        status: 'failed' satisfies OptionsReplayRunStatus,
        failedLists: FieldValue.increment(restored.length),
        error,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  },
};

export const optionsReplayRetry = onCall<OptionsReplayRetryRequest, Promise<OptionsReplayRetryResponse>>(
  { cors: true, memory: '256MiB', invoker: 'public', timeoutSeconds: 300 },
  async (request) => runReplayRetry(request.data),
);
