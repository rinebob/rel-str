/**
 * Run Progress Tracker
 *
 * Tracks per-symbol job progress and run-level counters. Extracted from the
 * worker so the orchestration logic stays thin and the progress tracking can be
 * tested independently.
 */
import { getFunctions } from 'firebase-admin/functions';
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
  StTriggeredBy,
} from '../common/st-runs';
import type { AutoPaperIngestPayload } from '../common/st-shared-types';

/** Minimal transaction surface so the completion decision is testable. */
export interface RunCompletionTx {
  get(ref: unknown): Promise<{ exists: boolean; data(): unknown }>;
  set(ref: unknown, data: unknown, opts: unknown): void;
}

export interface RunCompletionResult {
  finalStatus: StRunStatus;
  marketDate?: string;
  triggeredBy?: StTriggeredBy;
}

/**
 * Transaction body of run completion. Returns the completion result when
 * this transaction flipped the run to its final status — i.e. the caller
 * holds the single-writer ticket and should run post-commit work (logging,
 * auto-paper enqueue). Returns undefined on every no-op path: missing run,
 * jobs still in flight, or `completionProcessed` already claimed by a
 * concurrent finisher.
 */
export async function evalRunCompletion(
  t: RunCompletionTx,
  refs: { runRef: unknown; statusRef: unknown },
  runId: string,
): Promise<RunCompletionResult | undefined> {
  const runDoc = await t.get(refs.runRef);
  if (!runDoc.exists) return;

  const runData = runDoc.data() as Partial<StDailyRun> | undefined;
  const total = runData?.totalSymbols || 0;
  const processed = (runData?.successCount || 0) + (runData?.failureCount || 0);

  if (processed < total || runData?.completionProcessed) return;

  const finalStatus = runData?.failureCount ? StRunStatus.PARTIAL : StRunStatus.SUCCESS;

  t.set(
    refs.runRef,
    {
      status: finalStatus,
      completedAt: FieldValue.serverTimestamp(),
      completionProcessed: true,
    },
    { merge: true }
  );

  t.set(
    refs.statusRef,
    {
      lastRunAt: FieldValue.serverTimestamp(),
      lastRunId: runId,
      lastRunStatus: finalStatus,
      totalRuns: FieldValue.increment(1),
      totalSignalsGenerated: FieldValue.increment(runData?.signalsGenerated || 0),
      schedule: ST_SCHEDULE_CRON,
    },
    { merge: true }
  );

  return {
    finalStatus,
    marketDate: runData?.marketDate,
    triggeredBy: runData?.triggeredBy,
  };
}

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
      let completion: RunCompletionResult | undefined;

      await db.runTransaction(async (t) => {
        completion = await evalRunCompletion(t, { runRef, statusRef }, this.runId);
      });

      if (completion) {
        logger.info('st_run_complete', { runId: this.runId, status: completion.finalStatus });
        await this.enqueueAutoPaperIngest(completion.marketDate, completion.triggeredBy);
      }
    } catch (error: any) {
      logger.error('st_run_completion_error', { runId: this.runId, error: error?.message });
    }
  }

  /**
   * Enqueue the auto-paper ingest once per completed run (Thread #904).
   * Fires on both SUCCESS and PARTIAL — gating lives in the task. Post-
   * transaction, so a rolled-back completion never enqueues.
   *
   * Unlike createJobAndEnqueue, a prod enqueue failure is NOT rethrown:
   * the run is already committed complete, and propagating would retry
   * the symbol task and double-count run counters. The error log is the
   * recovery signal — a lost ingest can be re-run by re-enqueueing the
   * payload manually.
   */
  private async enqueueAutoPaperIngest(
    marketDate: string | undefined,
    triggeredBy: StTriggeredBy | undefined,
  ): Promise<void> {
    try {
      const payload: AutoPaperIngestPayload = {
        runId: this.runId,
        marketDate,
        triggeredBy,
      };
      await getFunctions().taskQueue('stAutoPaperIngest').enqueue(payload);
    } catch (error: any) {
      // Emulator: task queue may be unavailable — routine, so warn. Prod:
      // error — the run stays complete with no ingest; this is the only
      // recovery signal.
      const log = process.env.FUNCTIONS_EMULATOR === 'true' ? 'warn' : 'error';
      logger[log]('st_autopaper_enqueue_failed', {
        runId: this.runId,
        error: error?.message,
      });
    }
  }
}
