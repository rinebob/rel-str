import { getFunctions } from 'firebase-admin/functions';
import { db, FieldValue } from '../../firebase-admin-init';
import { Interval } from '../../types/signal.types';
import { RsPhase } from '../../types/partner';
import { FIXED_DAYS } from '../../webhooks/webhooks-config';
import {
  RsJobMode,
  RsJobStatus,
  RsJobType,
  rsBackfillJobDocPath,
  rsRealtimeRunJobDocPath,
} from './rs-time-series-jobs.model';

export interface ProcessRsJobPayload {
  jobType: RsJobType;
  runId?: string;
  marketDate?: string;
  pairId: string;
  baseline: string;
  target: string;
  interval: Interval;
  phase: RsPhase;
  from?: string;
  to?: string;
}

async function enqueueRsJobTask(payload: ProcessRsJobPayload): Promise<void> {
	  if (process.env.RS_TIME_SERIES_TASKS_ENABLED !== 'true') {
	    return;
	  }
	  const queue = getFunctions().taskQueue('processRsJobTask');
	  await queue.enqueue(payload);
}

export async function createOrUpdateBackfillJob(
  runId: string,
  payload: Omit<ProcessRsJobPayload, 'jobType' | 'runId' | 'marketDate'>,
): Promise<{ jobPath: string }> {
  const { pairId, interval, phase, baseline, target, from, to } = payload;
  const jobPath = rsBackfillJobDocPath(runId, pairId, interval, phase);
  const docRef = db.doc(jobPath);

  await docRef.set(
    {
      pairId,
      baseline,
      target,
      interval,
      phase,
      from,
      to,
      jobType: RsJobType.BACKFILL,
      mode: RsJobMode.FULL_BACKFILL,
      status: RsJobStatus.PENDING,
      attempts: 0,
      lastError: FieldValue.delete(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastAttemptAt: FieldValue.delete(),
    },
    { merge: true },
  );
  if (process.env.RS_TIME_SERIES_TASKS_ENABLED === 'true') {
    await enqueueRsJobTask({
      jobType: RsJobType.BACKFILL,
      runId,
      pairId,
      baseline,
      target,
      interval,
      phase,
      from,
      to,
    });
  }
  return { jobPath };
}

/**
 * Create or update a realtime RS job keyed by runId under
 * `system/rs-realtime-runs/{runId}/jobs/{jobId}` and optionally enqueue a
 * Cloud Task to process it.
 */
export async function createOrUpdateRealtimeJobForRun(
  runId: string,
  payload: Omit<ProcessRsJobPayload, 'jobType' | 'runId'>,
): Promise<{ jobPath: string }> {
  const { pairId, interval, phase, baseline, target, marketDate, from, to } = payload;
  const jobPath = rsRealtimeRunJobDocPath(runId, pairId, interval, phase);
  const docRef = db.doc(jobPath);

  // Derive a bounded [from,to] window for realtime jobs when not explicitly provided.
  // Anchor on marketDate when available; otherwise use today.
  const resolvedTo = (() => {
    if (to) return String(to).slice(0, 10);
    if (marketDate) return String(marketDate).slice(0, 10);
    const today = new Date();
    const y = today.getUTCFullYear();
    const m = String(today.getUTCMonth() + 1).padStart(2, '0');
    const d = String(today.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  })();

  const resolvedFrom = (() => {
    if (from) return String(from).slice(0, 10);
    const days = Number.isFinite(FIXED_DAYS) && FIXED_DAYS > 0 ? FIXED_DAYS : 30;
    const baseDate = new Date(`${resolvedTo}T00:00:00.000Z`);
    if (Number.isNaN(baseDate.getTime())) {
      return resolvedTo;
    }
    const msPerDay = 24 * 60 * 60 * 1000;
    const fromDate = new Date(baseDate.getTime() - (days - 1) * msPerDay);
    const y = fromDate.getUTCFullYear();
    const m = String(fromDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(fromDate.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  })();

  await docRef.set(
    {
      pairId,
      baseline,
      target,
      interval,
      phase,
      marketDate: marketDate ?? resolvedTo,
      from: resolvedFrom,
      to: resolvedTo,
      jobType: RsJobType.REALTIME,
      mode: RsJobMode.COMPACT,
      status: RsJobStatus.PENDING,
      attempts: 0,
      lastError: FieldValue.delete(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastAttemptAt: FieldValue.delete(),
    },
    { merge: true },
  );

  if (process.env.RS_TIME_SERIES_TASKS_ENABLED === 'true') {
    await enqueueRsJobTask({
      jobType: RsJobType.REALTIME,
      runId,
      pairId,
      baseline,
      target,
      interval,
      phase,
      marketDate: marketDate ?? resolvedTo,
      from: resolvedFrom,
      to: resolvedTo,
    });
  }

  return { jobPath };
}
