/**
 * Run Progress Tracker
 *
 * Tracks per-symbol job progress and run-level counters. Extracted from the
 * worker so the orchestration logic stays thin and the progress tracking can be
 * tested independently.
 */
import { logger } from 'firebase-functions/v2';
import { db, FieldValue } from '../firebase-admin-init';
import {
  ST_RUNS_COLLECTION,
  ST_STATUS_COLLECTION,
  ST_JOBS_SUBCOLLECTION,
  AGENT_STATUS_DOC,
  ST_SCHEDULE_CRON,
} from '../common/st-collections';
import {
  StDailyRun,
  StJobStatus,
  StRunStatus,
} from '../common/st-runs';

export class RunProgressTracker {
  constructor(
    private readonly runId: string,
    private readonly symbol: string,
  ) {}

  /**
   * Mark the symbol job as in-progress.
   */
  async markInProgress(): Promise<void> {
    const jobRef = db
      .collection(ST_RUNS_COLLECTION)
      .doc(this.runId)
      .collection(ST_JOBS_SUBCOLLECTION)
      .doc(this.symbol);

    await jobRef.set(
      {
        status: StJobStatus.IN_PROGRESS,
        startedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  /**
   * Mark the symbol job as complete (success or failed) and update run-level
   * counters.
   */
  async markComplete(
    status: 'SUCCESS' | 'FAILED',
    createdOpportunity: boolean,
    errorMessage?: string,
    signalsGenerated = 0
  ): Promise<void> {
    const jobRef = db
      .collection(ST_RUNS_COLLECTION)
      .doc(this.runId)
      .collection(ST_JOBS_SUBCOLLECTION)
      .doc(this.symbol);

    const updates: any = {
      status: status === 'SUCCESS' ? StJobStatus.SUCCESS : StJobStatus.FAILED,
      completedAt: FieldValue.serverTimestamp(),
      createdOpportunity,
    };

    if (errorMessage) {
      updates.lastError = errorMessage;
    }

    await jobRef.set(updates, { merge: true });
    await this.updateRunCounters(status, signalsGenerated);
  }

  /**
   * Update run-level counters. When signalsGenerated is provided, it is
   * incremented in the same write as processed/success/failure counts.
   */
  private async updateRunCounters(
    jobStatus: 'SUCCESS' | 'FAILED',
    signalsGenerated = 0
  ): Promise<void> {
    const runRef = db.collection(ST_RUNS_COLLECTION).doc(this.runId);

    const updates: any = {
      processedCount: FieldValue.increment(1),
    };

    if (jobStatus === 'SUCCESS') {
      updates.successCount = FieldValue.increment(1);
    } else {
      updates.failureCount = FieldValue.increment(1);
    }

    if (signalsGenerated > 0) {
      updates.signalsGenerated = FieldValue.increment(signalsGenerated);
    }

    await runRef.set(updates, { merge: true });
    await this.checkRunCompletion();
  }

  /**
   * Check if all jobs are complete and update run and agent status.
   */
  private async checkRunCompletion(): Promise<void> {
    const runRef = db.collection(ST_RUNS_COLLECTION).doc(this.runId);
    const statusRef = db.collection(ST_STATUS_COLLECTION).doc(AGENT_STATUS_DOC);

    try {
      let finalStatus: StRunStatus | undefined;

      await db.runTransaction(async (t) => {
        const runDoc = await t.get(runRef);
        if (!runDoc.exists) return;

        const runData = runDoc.data() as Partial<StDailyRun> | undefined;
        const total = runData?.totalSymbols || 0;
        const processed = (runData?.successCount || 0) + (runData?.failureCount || 0);

        if (processed < total || runData?.completionProcessed) return;

        finalStatus = runData?.failureCount ? StRunStatus.PARTIAL : StRunStatus.SUCCESS;

        t.set(
          runRef,
          {
            status: finalStatus,
            completedAt: FieldValue.serverTimestamp(),
            completionProcessed: true,
          },
          { merge: true }
        );

        t.set(
          statusRef,
          {
            lastRunAt: FieldValue.serverTimestamp(),
            lastRunId: this.runId,
            lastRunStatus: finalStatus,
            totalRuns: FieldValue.increment(1),
            totalSignalsGenerated: FieldValue.increment(runData?.signalsGenerated || 0),
            schedule: ST_SCHEDULE_CRON,
          },
          { merge: true }
        );
      });

      if (finalStatus) {
        logger.info('st_run_complete', { runId: this.runId, status: finalStatus });
      }
    } catch (error: any) {
      logger.error('st_run_completion_error', { runId: this.runId, error: error?.message });
    }
  }
}
