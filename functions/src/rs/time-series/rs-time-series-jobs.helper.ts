import { getFunctions } from 'firebase-admin/functions';
import { db, FieldValue } from '../../firebase-admin-init';
import { Interval } from '../../types/signal.types';
import { RsPhase } from '../../types/partner';
import {
  RsJobMode,
  RsJobStatus,
  RsJobType,
  rsBackfillJobDocPath,
  rsRealtimeJobDocPath,
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
  from: string;
  to: string;
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

export async function createOrUpdateRealtimeJob(
  marketDate: string,
  payload: Omit<ProcessRsJobPayload, 'jobType' | 'runId' | 'marketDate'>,
): Promise<{ jobPath: string }> {
  const { pairId, interval, phase, baseline, target, from, to } = payload;
  const jobPath = rsRealtimeJobDocPath(marketDate, pairId, interval, phase);
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
      marketDate,
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
