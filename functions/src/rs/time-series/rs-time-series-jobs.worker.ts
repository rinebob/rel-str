import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions/v2';
import type { UpdateData } from 'firebase-admin/firestore';
import { db, FieldValue } from '../../firebase-admin-init';
import {
  RsBackfillRunStatus,
  type RsBackfillRunDoc,
  RsJobStatus,
  RsJobType,
  rsBackfillJobDocPath,
  rsBackfillRunDocPath,
  rsRealtimeJobDocPath,
} from './rs-time-series-jobs.model';
import type { ProcessRsJobPayload } from './rs-time-series-jobs.helper';

export const processRsJobTask = onTaskDispatched<ProcessRsJobPayload>(
  {
    retryConfig: {
      maxAttempts: 5,
      minBackoffSeconds: 10,
      maxBackoffSeconds: 300,
    },
    rateLimits: {
      maxConcurrentDispatches: 20,
      maxDispatchesPerSecond: 1.0,
    },
    memory: '512MiB',
  },
  async (req) => {
    try {
      const payload = req.data as ProcessRsJobPayload;
      await processRsJobInternal(payload);
    } catch (e: any) {
      logger.error('processRsJobTask_failed', { message: e?.message || String(e) });
      throw e;
    }
  },
);

async function runRsPairIntervalJob(payload: ProcessRsJobPayload): Promise<void> {
  // TODO(RS-BE-FEAT-FRBARR-2601-02): implement RS compute for a single pair/interval/phase
  logger.info('runRsPairIntervalJob_stub', { payload });
}

async function updateBackfillRunForJobTerminal(
  runId: string,
  isSuccess: boolean,
  isPermanentFailure: boolean,
): Promise<void> {
  const runRef = db.doc(rsBackfillRunDocPath(runId));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(runRef);
    if (!snap.exists) {
      return;
    }
    const updates: UpdateData<RsBackfillRunDoc> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (isSuccess) {
      updates['successJobs'] = FieldValue.increment(1);
    }
    if (isPermanentFailure) {
      updates['permanentFailureJobs'] = FieldValue.increment(1);
    }
    tx.update(runRef, updates);
  });

  const latestSnap = await runRef.get();
  if (!latestSnap.exists) {
    return;
  }
  const data = latestSnap.data() as RsBackfillRunDoc;
  const expected = data.expectedJobs ?? 0;
  const success = data.successJobs ?? 0;
  const failure = data.permanentFailureJobs ?? 0;
  if (success + failure >= expected && data.status !== RsBackfillRunStatus.COMPLETE) {
    await runRef.update({
      status: RsBackfillRunStatus.COMPLETE,
      runCompletedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

export async function processRsJobInternal(payload: ProcessRsJobPayload): Promise<void> {
  const { jobType, runId, marketDate, pairId, interval, phase } = payload;

  let jobPath: string;
  if (jobType === RsJobType.BACKFILL) {
    if (!runId) {
      logger.warn('processRsJobInternal_missing_runId', { payload });
      return;
    }
    jobPath = rsBackfillJobDocPath(runId, pairId, interval, phase);
  } else {
    if (!marketDate) {
      logger.warn('processRsJobInternal_missing_marketDate', { payload });
      return;
    }
    jobPath = rsRealtimeJobDocPath(marketDate, pairId, interval, phase);
  }

  const docRef = db.doc(jobPath);
  const snap = await docRef.get();
  if (!snap.exists) {
    logger.warn('processRsJobInternal_missing_job_doc', { jobPath });
    return;
  }

  await docRef.set(
    {
      status: RsJobStatus.IN_PROGRESS,
      attempts: FieldValue.increment(1),
      lastAttemptAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  let finalStatus: RsJobStatus = RsJobStatus.SUCCESS;
  let lastError: string | undefined;
  try {
    await runRsPairIntervalJob(payload);
    finalStatus = RsJobStatus.SUCCESS;
  } catch (e: any) {
    const message = e?.message ? String(e.message) : String(e);
    lastError = message;
    // For now, treat all worker errors as permanent; we can refine this later.
    finalStatus = RsJobStatus.PERMANENT_FAILURE;
    logger.error('processRsJobInternal_error', { jobPath, jobType, message });
  }

  const update: Record<string, unknown> = {
    status: finalStatus,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (lastError) {
    update['lastError'] = lastError;
  }
  await docRef.set(update, { merge: true });

  if (jobType === RsJobType.BACKFILL && runId) {
    await updateBackfillRunForJobTerminal(
      runId,
      finalStatus === RsJobStatus.SUCCESS,
      finalStatus === RsJobStatus.PERMANENT_FAILURE,
    );
  }

  logger.info('processRsJobInternal_done', { jobPath, jobType, status: finalStatus });
}
