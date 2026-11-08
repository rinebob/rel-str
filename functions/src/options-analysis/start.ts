/**
 * `optionsAnalysisStart` callable (Topic #1238, Thread #1266, task #1370).
 *
 * Validates that a contract list doc exists and is `status:'success'`,
 * then enqueues one `OptionsAnalysisTaskPayload` on the dedicated
 * analysis queue — the `optionsReplayAnalysis` worker evaluates every
 * registered exit strategy against the list's picked contracts and
 * overwrites the `{listDocId}_{exitId}` result docs.
 *
 * Missing doc OR non-success status → `failed-precondition` (IMPL-BE §2 —
 * a single status vocabulary for "can't analyze this yet").
 *
 * Idempotent by design: re-invocation enqueues a fresh task that
 * overwrites the same result docs for the current
 * `EXIT_REGISTRY_VERSION` — no run state is mutated, nothing to reset.
 *
 * Stale-task safety lives in the WORKER, not here: the success check →
 * enqueue gap is inherently non-transactional (Cloud Tasks can't join a
 * Firestore tx), so a doc enqueued while `success` could be reset
 * afterward — the worker must re-validate `status === 'success'` and
 * treat missing `rows` as retryable, never as a valid empty analysis
 * (#1370 review forward note for #1372).
 *
 * All Firestore + task-queue effects sit behind `AnalysisStartDeps`
 * (TEST-BE seam); the callable wires production deps below.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { getFunctions } from 'firebase-admin/functions';
import * as logger from 'firebase-functions/logger';

import { db } from '../firebase-admin-init';
import { ST_OPTIONS_CONTRACT_LISTS_ROOT } from '@st/collections';
import { EXIT_REGISTRY_VERSION } from '@options-analysis/registry';
import type {
  OptionsAnalysisStartRequest,
  OptionsAnalysisStartResponse,
  OptionsAnalysisTaskPayload,
} from '@options-analysis/contracts';
import type { OptionsContractListDoc } from '@options-replay/contracts';

/** Dedicated analysis queue — separate from the replay queue so a heavy
 *  analysis can't starve run fanout; independent retry config (IMPL-BE
 *  Decisions). Queue name = the task-function export it feeds. */
export const OPTIONS_ANALYSIS_TASK_QUEUE = 'optionsReplayAnalysis';

/** Slice of the contract list doc the enqueue decision needs — payload
 *  fields come from the doc, never parsed back out of the docId. */
export type AnalysisStartListView = Pick<
  OptionsContractListDoc,
  'status' | 'runId' | 'symbol' | 'templateId'
>;

/** Injectable effects — tests substitute fakes; the callable uses the
 *  production wiring below. */
export interface AnalysisStartDeps {
  /** Load the contract list doc — `undefined` when it doesn't exist. */
  getListDoc: (docId: string) => Promise<AnalysisStartListView | undefined>;
  /** Enqueue one analysis payload on the dedicated analysis queue. */
  enqueue: (payload: OptionsAnalysisTaskPayload) => Promise<void>;
}

export async function runAnalysisStart(
  request: CallableRequest<OptionsAnalysisStartRequest>,
  deps: AnalysisStartDeps = prodAnalysisStartDeps,
): Promise<OptionsAnalysisStartResponse> {
  // Auth guard (#1437) — a public-invoker callable must reject anonymous
  // calls before any validation or deps; every effect of the call is
  // billed work.
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'unauthenticated');
  const input = request.data;
  const contractListDocId =
    typeof input?.contractListDocId === 'string' ? input.contractListDocId.trim() : '';
  if (!contractListDocId) {
    throw new HttpsError('invalid-argument', 'contractListDocId is required');
  }

  const doc = await deps.getListDoc(contractListDocId);
  if (!doc || doc.status !== 'success') {
    throw new HttpsError(
      'failed-precondition',
      `Contract list '${contractListDocId}' is not analyzable (status: ${doc?.status ?? 'missing'})`,
    );
  }

  try {
    await deps.enqueue({
      contractListDocId,
      runId: doc.runId,
      symbol: doc.symbol,
      templateId: doc.templateId,
      registryVersion: EXIT_REGISTRY_VERSION,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new HttpsError('internal', `Failed to enqueue analysis task: ${message}`);
  }

  logger.info('options_analysis_start', { contractListDocId, registryVersion: EXIT_REGISTRY_VERSION });
  return { analysisId: contractListDocId };
}

/** Production wiring — Firestore list doc + the analysis task queue. */
const prodAnalysisStartDeps: AnalysisStartDeps = {
  async getListDoc(docId) {
    const snap = await db.collection(ST_OPTIONS_CONTRACT_LISTS_ROOT).doc(docId).get();
    return snap.exists ? (snap.data() as AnalysisStartListView) : undefined;
  },
  async enqueue(payload) {
    await getFunctions().taskQueue(OPTIONS_ANALYSIS_TASK_QUEUE).enqueue(payload);
  },
};

export const optionsAnalysisStart = onCall<OptionsAnalysisStartRequest, Promise<OptionsAnalysisStartResponse>>(
  { cors: true, memory: '256MiB', invoker: 'public', timeoutSeconds: 60 },
  async (request) => runAnalysisStart(request),
);
