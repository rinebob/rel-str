/**
 * `optionsReplayDelete` callable (Topic #1238, task #1439).
 *
 * Cascade-deletes a Selection Replay run: the run doc, its 1:1
 * contract-list doc (docId = runId), and every analysis-result doc
 * whose `contractListDocId` matches the runId (`{runId}_{exitId}` ids).
 *
 * Idempotent: any piece already missing counts as deleted — a failed
 * run that never produced a list or results still deletes cleanly.
 * Unlike retry, there is no status gate: any run (including an
 * in-flight `pending`/`running` one) may be deleted. Residual races:
 * a replay worker mid-flight writes the contract-list doc
 * unconditionally before its close-out transaction checks the run doc,
 * and an analysis worker writes result docs unconditionally — so
 * deleting a run while either is in-flight can leave orphaned list or
 * result docs (no run parent; invisible in the UI; surfaces as a WARN
 * in the single-symbol audit, and a re-delete cleans them). The run
 * doc itself is never resurrected — `resolveCloseOutStatus` skips
 * missing runs. Accepted: the alternative is a run-existence read
 * ahead of every worker write for a rare user-driven race.
 *
 * All Firestore effects sit behind `ReplayDeleteDeps` (TEST-BE seam);
 * the callable wires production deps below.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';

import { db } from '../firebase-admin-init';
import {
  ST_OPTIONS_ANALYSIS_RESULTS_ROOT,
  ST_OPTIONS_CONTRACT_LISTS_ROOT,
  ST_OPTIONS_REPLAY_RUNS_ROOT,
  stOptionsContractListDocId,
} from '@st/collections';
import type {
  OptionsReplayDeleteRequest,
  OptionsReplayDeleteResponse,
} from '@options-replay/contracts';

export interface ReplayDeleteDeps {
  /** True when the run doc exists. */
  runExists: (runId: string) => Promise<boolean>;
  /** True when the contract-list doc (docId = runId) exists. */
  listExists: (runId: string) => Promise<boolean>;
  /** Doc ids of every analysis-result row keyed off this run. */
  resultDocIds: (runId: string) => Promise<string[]>;
  /** Delete the run/list doc and the result doc ids in one commit. */
  deleteAll: (runId: string, resultDocIds: string[]) => Promise<void>;
}

export async function handleOptionsReplayDelete(
  request: CallableRequest<OptionsReplayDeleteRequest>,
  deps: ReplayDeleteDeps,
): Promise<OptionsReplayDeleteResponse> {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'unauthenticated');
  const runId = typeof request.data?.runId === 'string' ? request.data.runId.trim() : '';
  if (!runId) throw new HttpsError('invalid-argument', 'runId is required');

  const [deletedRun, listExisted, resultIds] = await Promise.all([
    deps.runExists(runId),
    deps.listExists(runId),
    deps.resultDocIds(runId),
  ]);

  if (deletedRun || listExisted || resultIds.length > 0) {
    await deps.deleteAll(runId, resultIds);
  }

  const response: OptionsReplayDeleteResponse = {
    deletedRun,
    deletedLists: listExisted ? 1 : 0,
    deletedResults: resultIds.length,
  };
  logger.info('options_replay_delete', { runId, ...response });
  return response;
}

const productionDeps: ReplayDeleteDeps = {
  runExists: async (runId) =>
    (await db.collection(ST_OPTIONS_REPLAY_RUNS_ROOT).doc(runId).get()).exists,
  listExists: async (runId) =>
    (await db
      .collection(ST_OPTIONS_CONTRACT_LISTS_ROOT)
      .doc(stOptionsContractListDocId(runId))
      .get()).exists,
  resultDocIds: async (runId) => {
    const snap = await db
      .collection(ST_OPTIONS_ANALYSIS_RESULTS_ROOT)
      .where('contractListDocId', '==', stOptionsContractListDocId(runId))
      .get();
    return snap.docs.map((d) => d.id);
  },
  deleteAll: async (runId, resultDocIds) => {
    const batch = db.batch();
    batch.delete(db.collection(ST_OPTIONS_REPLAY_RUNS_ROOT).doc(runId));
    batch.delete(
      db.collection(ST_OPTIONS_CONTRACT_LISTS_ROOT).doc(stOptionsContractListDocId(runId)),
    );
    for (const id of resultDocIds) {
      batch.delete(db.collection(ST_OPTIONS_ANALYSIS_RESULTS_ROOT).doc(id));
    }
    await batch.commit();
  },
};

export const optionsReplayDelete = onCall<
  OptionsReplayDeleteRequest,
  Promise<OptionsReplayDeleteResponse>
>(
  { cors: true, memory: '256MiB', invoker: 'public', timeoutSeconds: 60 },
  async (request) => handleOptionsReplayDelete(request, productionDeps),
);
