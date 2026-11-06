/**
 * `optionsReplayRetry` callable (Topic #1238, Thread #1266, task #1369;
 * single-symbol runs #1430).
 *
 * Re-runs a failed run in place: the contract-list doc (docId = runId)
 * resets to `pending` (rows/pickDocMeta/error/generatedAt deleted), the
 * run flips back to `running` (stale `error`/`completedAt` cleared), and
 * one `OptionsReplayPermutationPayload` re-enqueues on the replay queue.
 *
 * Only a `failed` run may retry — every other status is a no-op returning
 * `{retriedSymbol: null}`: `pending`/`running` are in-flight (don't
 * double-enqueue), `cancelled` must not be resurrected, `completed` has
 * nothing to retry.
 *
 * Ordering matters: the list-doc reset lands BEFORE enqueue — an
 * early-dispatching worker must never see a still-`failed` doc (its
 * terminal skip would re-record the failure instead of re-running).
 *
 * Concurrency: `claimRetry` is ONE transaction over the 1:1 pair — it
 * re-reads the run doc, asserts `failed`, resets the list doc (guarded
 * — a `success`/`running` list is never regressed), and flips the run
 * `failed` → `running` atomically. A concurrent second call sees
 * `running`, claims nothing, and returns `{retriedSymbol: null}` — no
 * double-enqueue, and no window where a losing retry can touch the
 * list doc (the old split-transaction shape let a loser reset it).
 *
 * Enqueue failure: `failRun` restores `failed` (+ error) — but only while
 * the run is still `running` from the reset, so it can't regress a run
 * that resolved on its own.
 *
 * Residual: a process kill between `claimRetry` commit and an
 * enqueue RPC never transmitting leaves the run `running` with no task —
 * and retry no-ops on `running` (same accepted posture as
 * `optionsReplayStart`; a stale-`running` sweeper is the real fix, out
 * of scope here).
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
  'status' | 'templateId' | 'startDate' | 'symbol'
>;

/** Injectable effects — tests substitute fakes; the callable uses the
 *  production wiring below. */
export interface ReplayRetryDeps {
  getRun: (runId: string) => Promise<ReplayRetryRunView | undefined>;
  /** ONE transaction over the 1:1 pair — asserts the run is still
   *  `failed`, resets its list doc to `pending` (skipped for a
   *  `success`/`running` list), and flips the run `failed` → `running`
   *  with stale `error`/`completedAt` cleared. Returns false when the
   *  run is not currently `failed` (concurrent retry already claimed
   *  it, or a status flip landed between getRun and the tx). */
  claimRetry: (runId: string) => Promise<boolean>;
  /** Re-enqueue the permutation payload. */
  enqueue: (payload: OptionsReplayPermutationPayload) => Promise<void>;
  /** Enqueue-failure fallback — restore `failed` + error while the run
   *  is still `running` from the claim, or it sits `running` with no
   *  task and retry can't reach it. */
  failRun: (runId: string, error: string) => Promise<void>;
}

/** Whether a list doc may still be reset by a retry — only `failed` /
 *  `pending` / missing. Exported for unit coverage of the safety-critical
 *  predicate inside the `claimRetry` transaction (#1370 review). */
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
  // Only a failed run has something to retry.
  if (run.status !== 'failed') {
    return { retriedSymbol: null };
  }
  // A pre-migration legacy run (symbols[], no scalar `symbol`) can't
  // carry a single-symbol payload — no-op rather than enqueue
  // `symbol: undefined`. Migration deletes those docs.
  if (typeof run.symbol !== 'string' || run.symbol.length === 0) {
    return { retriedSymbol: null };
  }

  // One atomic claim: list reset + run flip land in the same tx —
  // a worker can never see a `failed` list after a claimed retry, and
  // a losing concurrent retry mutates nothing.
  const claimed = await deps.claimRetry(runId);
  if (!claimed) {
    // A concurrent retry claimed the run between our read and the
    // transaction — its own enqueue covers it.
    return { retriedSymbol: null };
  }

  try {
    await deps.enqueue({ runId, symbol: run.symbol, templateId: run.templateId, startDate: run.startDate });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    await deps.failRun(runId, message);
    throw new HttpsError('internal', `Failed to re-enqueue replay task: ${message}`);
  }

  logger.info('options_replay_retry', { runId, symbol: run.symbol });
  return { retriedSymbol: run.symbol };
}

/** Production wiring — Firestore run/list docs + the replay task queue. */
const prodReplayRetryDeps: ReplayRetryDeps = {
  async getRun(runId) {
    const snap = await db.collection(ST_OPTIONS_REPLAY_RUNS_ROOT).doc(runId).get();
    return snap.exists ? (snap.data() as ReplayRetryRunView) : undefined;
  },

  async claimRetry(runId) {
    // One transaction over the 1:1 pair — the old split (reset list,
    // then claim run) let a losing concurrent retry reset a doc the
    // winner's worker had already re-succeeded (TN-3, #1430 review).
    // Asserting the run's `failed` inside the same tx that mutates both
    // docs removes the interleaving entirely.
    const runRef = db.collection(ST_OPTIONS_REPLAY_RUNS_ROOT).doc(runId);
    const listRef = db
      .collection(ST_OPTIONS_CONTRACT_LISTS_ROOT)
      .doc(stOptionsContractListDocId(runId));
    return db.runTransaction(async (tx) => {
      const [runSnap, listSnap] = await Promise.all([tx.get(runRef), tx.get(listRef)]);
      const status = runSnap.data()?.status as OptionsReplayRunStatus | undefined;
      // Re-check inside the tx: anything but 'failed' means a concurrent
      // claim or status flip already resolved it.
      if (status !== 'failed') return false;

      // List-doc guard (TN-M1, #1370 review): only reset while the doc
      // is still failed/pending (or missing — set-merge creates a stub
      // the worker fills). A 'success'/'running' list must not be
      // regressed — resetting 'success' would delete `rows` under a
      // recorded success.
      const listStatus = listSnap.data()?.status as OptionsContractListStatus | undefined;
      if (shouldResetForRetry(listStatus)) {
        // Stamp the identity fields off the run doc — a MISSING list doc
        // (the enqueue-died-at-start case) otherwise persists as a bare
        // {status:'pending'} stub if the re-enqueue then fails, which the
        // live audit correctly FAILs as a field disagreement.
        const run = runSnap.data() as ReplayRetryRunView;
        tx.set(
          listRef,
          {
            runId,
            symbol: run.symbol,
            templateId: run.templateId,
            status: 'pending' satisfies OptionsContractListStatus,
            rows: FieldValue.delete(),
            pickDocMeta: FieldValue.delete(),
            error: FieldValue.delete(),
            generatedAt: FieldValue.delete(),
          },
          { merge: true },
        );
      }
      tx.update(runRef, {
        status: 'running' satisfies OptionsReplayRunStatus,
        completedAt: FieldValue.delete(),
        error: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
  },

  async enqueue(payload) {
    await getFunctions().taskQueue(OPTIONS_REPLAY_TASK_QUEUE).enqueue(payload);
  },

  async failRun(runId, error) {
    const runRef = db.collection(ST_OPTIONS_REPLAY_RUNS_ROOT).doc(runId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(runRef);
      // Restore 'failed' only while the post-reset 'running' state is still
      // there — a terminal status means the run already resolved (a stale
      // delivery could have closed it out) and must not be regressed.
      if (snap.data()?.status !== 'running') return;
      tx.update(runRef, {
        status: 'failed' satisfies OptionsReplayRunStatus,
        error,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  },
};

export const optionsReplayRetry = onCall<OptionsReplayRetryRequest, Promise<OptionsReplayRetryResponse>>(
  { cors: true, memory: '256MiB', invoker: 'public', timeoutSeconds: 300 },
  async (request) => runReplayRetry(request.data),
);
