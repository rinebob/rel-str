/**
 * Spread run Cloud Task worker.
 * Processes one spread definition per task invocation.
 * Mirrors backtest-worker.ts pattern.
 */

import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions/v2';

import { db, FieldValue } from './firebase-admin-init';
import { callPartnerSpreadTimeSeries } from './spread-proxy';
import {
  spreadRunDocPath,
  spreadRunJobDocPath,
  SpreadRunStatus,
  SpreadJobStatus,
} from './spread-run-model';
import type { SpreadDefinition } from '@spread/contracts';

export const SPREAD_RUN_WORKER_QUEUE = 'spreadRunWorker';
const MAX_ATTEMPTS = 3;

interface SpreadRunTaskPayload {
  runId: string;
  spreadIndex: number;
  definition: SpreadDefinition;
}

export const spreadRunWorker = onTaskDispatched<SpreadRunTaskPayload>(
  {
    retryConfig: {
      maxAttempts: MAX_ATTEMPTS,
      minBackoffSeconds: 10,
      maxBackoffSeconds: 60,
    },
    rateLimits: {
      maxConcurrentDispatches: 20,
      maxDispatchesPerSecond: 10,
    },
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (req) => {
    const { runId, spreadIndex, definition } = req.data;
    const retryCount = (req as { retryCount?: number }).retryCount ?? 0;
    const isFinalAttempt = retryCount >= MAX_ATTEMPTS - 1;

    logger.info('spread_worker_start', { runId, spreadIndex, retryCount });

    const runRef = db.doc(spreadRunDocPath(runId));
    const jobRef = db.doc(spreadRunJobDocPath(runId, spreadIndex));

    // Mark job as IN_PROGRESS
    await jobRef.set(
      {
        spreadIndex,
        status: SpreadJobStatus.IN_PROGRESS,
        definition,
        attempts: retryCount + 1,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    try {
      const result = await callPartnerSpreadTimeSeries(definition);

      await jobRef.set(
        {
          spreadIndex,
          status: SpreadJobStatus.SUCCESS,
          definition,
          result,
          attempts: retryCount + 1,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      // Increment success counter
      await runRef.set(
        {
          successJobs: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      logger.info('spread_worker_success', { runId, spreadIndex });
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      if (isFinalAttempt) {
        await jobRef.set(
          {
            spreadIndex,
            status: SpreadJobStatus.PERMANENT_FAILURE,
            definition,
            error: errorMsg,
            attempts: retryCount + 1,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        await runRef.set(
          {
            failedJobs: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        logger.error('spread_worker_permanent_failure', { runId, spreadIndex, error: errorMsg });
      } else {
        await jobRef.set(
          {
            spreadIndex,
            status: SpreadJobStatus.TRANSIENT_FAILURE,
            definition,
            error: errorMsg,
            attempts: retryCount + 1,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        logger.warn('spread_worker_transient_failure', { runId, spreadIndex, error: errorMsg });
        // Re-throw to trigger Cloud Tasks retry
        throw error;
      }
    }

    // Check if run is complete — use transaction to avoid race condition
    // where two workers simultaneously see the count as complete
    await db.runTransaction(async (txn) => {
      const runSnap = await txn.get(runRef);
      const runData = runSnap.data();
      if (!runData) return;

      const successJobs = runData.successJobs ?? 0;
      const failedJobs = runData.failedJobs ?? 0;
      const expectedJobs = runData.expectedJobs ?? 0;
      if (successJobs + failedJobs >= expectedJobs) {
        const status =
          successJobs === 0
            ? SpreadRunStatus.FAILED
            : failedJobs > 0
              ? SpreadRunStatus.PARTIAL
              : SpreadRunStatus.COMPLETE;
        txn.set(
          runRef,
          {
            status,
            completedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        logger.info('spread_run_complete', { runId, status, successJobs, failedJobs });
      }
    });
  },
);
