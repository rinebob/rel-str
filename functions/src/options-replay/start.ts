/**
 * `optionsReplayStart` callable (Topic #1238, Thread #1240, task #1281).
 *
 * Mirrors `stBacktestStart`'s create+enqueue skeleton: validate the request,
 * create `st-options-replay-runs/{runId}` pending, fan out one Cloud Task
 * per symbol carrying `OptionsReplayPermutationPayload`, mark the run
 * running, return `{ runId }`. A rerun is always a fresh runId — no dedupe
 * across calls (backtest semantics).
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
  OptionsReplayRunStatus,
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
  /** Persist the new run doc (status 'pending'). */
  createRun: (runId: string, doc: OptionsReplayRunWrite) => Promise<void>;
  /** Transition the run status — 'running' ahead of fanout, or 'failed'
   *  with the enqueue error message. */
  markRunStatus: (runId: string, status: OptionsReplayRunStatus, error?: string) => Promise<void>;
  /** Enqueue one per-symbol task payload. */
  enqueue: (payload: OptionsReplayPermutationPayload) => Promise<void>;
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

  const startDate = String(input?.startDate ?? '').trim();
  if (!isValidMarketDate(startDate)) {
    throw new HttpsError('invalid-argument', `startDate must be a valid YYYY-MM-DD date, got '${input?.startDate}'`);
  }

  const runId = `${getRunIdPT(getRunDatePT(), 'manual')}_${Math.random().toString(36).slice(2, 8)}`;

  const runDoc: OptionsReplayRunWrite = {
    runId,
    templateId,
    symbols,
    startDate,
    status: 'pending',
    totalLists: symbols.length,
    completedLists: 0,
    failedLists: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await deps.createRun(runId, runDoc);

  // Mark 'running' BEFORE enqueuing: a blind status write after fanout could
  // land behind a fast worker's 'completed' update and regress the run.
  await deps.markRunStatus(runId, 'running');

  // A partial fanout leaves the run permanently short of totalLists — the
  // worker counters would never reach 'completed'. Fail the run outright so
  // the caller sees an error instead of a run that hangs in 'running'.
  try {
    for (const symbol of symbols) {
      await deps.enqueue({ runId, symbol, templateId, startDate });
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    await deps.markRunStatus(runId, 'failed', message);
    throw new HttpsError('internal', `Failed to enqueue replay tasks: ${message}`);
  }

  logger.info('options_replay_start', { runId, templateId, totalLists: symbols.length });
  return { runId };
}

/** Production wiring — Firestore run doc + Cloud Tasks queue. */
const prodReplayStartDeps: ReplayStartDeps = {
  async createRun(runId, doc) {
    await db.collection(ST_OPTIONS_REPLAY_RUNS_ROOT).doc(runId).set(doc);
  },
  async markRunStatus(runId, status, error) {
    await db
      .collection(ST_OPTIONS_REPLAY_RUNS_ROOT)
      .doc(runId)
      .update({
        status,
        updatedAt: FieldValue.serverTimestamp(),
        ...(error ? { error } : {}),
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
