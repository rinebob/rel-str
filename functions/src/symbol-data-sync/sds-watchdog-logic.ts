/**
 * SDS watchdog logic — forces completion for stale runs and sequences,
 * and retries failed dispatches.
 *
 * Extracted from sds-completion.ts to keep file sizes under 300 lines.
 * Called by the scheduled function in sds-watchdog.ts.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import {
  type SdsCompletionDeps,
  type RunContext,
  SDS_RUNS,
  SDS_SEQUENCES,
  REQUIRED_IV,
  fireSequenceCompletion,
  checkIntradayRunCompletion,
} from './sds-completion';

// Runs process ~100 symbols at 50 concurrent / 20 per second — total runtime
// is 1-2 minutes. 5 min is a generous backstop for stuck runs.
const STALE_RUN_THRESHOLD_MS = 5 * 60 * 1000;

// Sequences have 3 interval runs (~2 min each + buffer). 8 min backstop.
const STALE_SEQUENCE_THRESHOLD_MS = 8 * 60 * 1000;

/** Extract milliseconds from a Firestore Timestamp, Date, or ISO string. */
function toMs(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === 'object' && value !== null && '_seconds' in value) {
    return (value as { _seconds: number })._seconds * 1000;
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return new Date(value).getTime();
  return null;
}

/**
 * Watchdog logic — forces completion for stale runs and sequences.
 * Called by the scheduled function every 5 minutes.
 *
 * @param deps Completion dependencies
 * @param now Current time in ms (injectable for testing)
 */
export async function runWatchdog(deps: SdsCompletionDeps, now: number = Date.now()): Promise<void> {
  // 1. Force-complete stale interval runs
  const runsRef = deps.db.collection(SDS_RUNS);
  const staleRunsSnap = await runsRef.where('status', '==', 'processing').get();

  for (const doc of staleRunsSnap.docs) {
    const data = doc.data();
    // Check lastActivityAt (set by worker on each symbol) — if recent, the
    // run is still actively processing, not stale. This prevents force-completing
    // a large run that legitimately takes more than 5 minutes.
    const lastActivity = toMs(data.lastActivityAt);
    const startedAt = toMs(data.startedAt);
    const referenceTime = lastActivity ?? startedAt;

    if (referenceTime === null) continue;

    if (now - referenceTime > STALE_RUN_THRESHOLD_MS) {
      logger.warn('sds_watchdog_stale_run', {
        runId: data.runId,
        ageMs: now - referenceTime,
        lastActivityAt: data.lastActivityAt,
        startedAt: data.startedAt,
      });
      const ctx: RunContext = {
        runId: data.runId,
        sequenceRunId: data.sequenceRunId ?? undefined,
        interval: data.interval,
        sequence: data.sequence ?? undefined,
        marketDate: data.marketDate,
        phase: data.phase ?? 'post',
      };

      // Force mark as complete
      await deps.db.collection(SDS_RUNS).doc(data.runId).set({
        status: 'forced_complete',
        completedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      // Update sequence if applicable
      if (ctx.sequenceRunId) {
        await updateSequenceAfterForce(ctx.sequenceRunId, ctx.interval, ctx.marketDate, ctx.sequence ?? '', deps);
      }
    }
  }

  // 2. Force-complete stale sequences
  const seqsRef = deps.db.collection(SDS_SEQUENCES);
  const staleSeqsSnap = await seqsRef.where('status', '==', 'processing').get();

  for (const doc of staleSeqsSnap.docs) {
    const data = doc.data();
    const startedAt = toMs(data.startedAt);
    if (startedAt === null) continue;

    if (now - startedAt > STALE_SEQUENCE_THRESHOLD_MS) {
      logger.warn('sds_watchdog_stale_sequence', {
        sequenceRunId: data.sequenceRunId,
        ageMs: now - startedAt,
      });
      await fireSequenceCompletion(
        { sequenceRunId: data.sequenceRunId, sequence: data.sequence, marketDate: data.marketDate },
        deps,
      );
    }
  }

  // 3. Retry completed_but_not_dispatched sequences
  await retryFailedDispatches(deps);
}

/**
 * Retry dispatch for sequences and runs stuck in completed_but_not_dispatched.
 * For sequences: resets to 'processing' so fireSequenceCompletion can re-claim.
 * For runs (intraday): retries the intraday consumer dispatch directly.
 */
async function retryFailedDispatches(deps: SdsCompletionDeps): Promise<void> {
  // Retry sequences
  const seqsRef = deps.db.collection(SDS_SEQUENCES);
  const retrySeqsSnap = await seqsRef.where('status', '==', 'completed_but_not_dispatched').get();
  for (const doc of retrySeqsSnap.docs) {
    const data = doc.data();
    logger.info('sds_watchdog_retry_dispatch_seq', { sequenceRunId: data.sequenceRunId });
    // Reset status to processing so fireSequenceCompletion will process it.
    // fireSequenceCompletion uses a conditional transaction, so if a concurrent
    // retry is also running, only one will claim it.
    await deps.db.collection(SDS_SEQUENCES).doc(data.sequenceRunId).set({
      status: 'processing',
    }, { merge: true });
    await fireSequenceCompletion(
      { sequenceRunId: data.sequenceRunId, sequence: data.sequence, marketDate: data.marketDate },
      deps,
    );
  }

  // Retry runs (intraday runs can be in completed_but_not_dispatched)
  const runsRef = deps.db.collection(SDS_RUNS);
  const retryRunsSnap = await runsRef.where('status', '==', 'completed_but_not_dispatched').get();
  for (const doc of retryRunsSnap.docs) {
    const data = doc.data();
    logger.info('sds_watchdog_retry_dispatch_run', { runId: data.runId });
    // Reset to 'processing' so checkIntradayRunCompletion will re-dispatch.
    // (Setting to 'completed' would be terminal and skip the dispatch.)
    await deps.db.collection(SDS_RUNS).doc(data.runId).set({
      status: 'processing',
      completionEnqueued: false,
    }, { merge: true });
    const ctx: RunContext = {
      runId: data.runId,
      sequenceRunId: data.sequenceRunId ?? undefined,
      interval: data.interval ?? 'INTRADAY',
      sequence: data.sequence ?? undefined,
      marketDate: data.marketDate,
      phase: data.phase ?? 'pre',
    };
    await checkIntradayRunCompletion(ctx, deps);
  }
}

/** Update sequence doc after a forced interval completion. */
async function updateSequenceAfterForce(
  sequenceRunId: string,
  interval: string,
  marketDate: string,
  sequence: string,
  deps: SdsCompletionDeps,
): Promise<void> {
  const seqRef = deps.db.collection(SDS_SEQUENCES).doc(sequenceRunId);

  // Use arrayUnion for atomic add — avoids read-modify-write race
  await seqRef.set({
    completedIntervals: FieldValue.arrayUnion(interval),
  }, { merge: true });

  // Re-read to check if all intervals are now complete
  const seqSnap = await seqRef.get();
  const seqData = seqSnap.data();
  if (!seqData) return;

  const completedIntervals: string[] = (seqData.completedIntervals as string[]) ?? [];
  const allDone = REQUIRED_IV.every((iv) => completedIntervals.includes(iv));
  if (allDone) {
    await fireSequenceCompletion({ sequenceRunId, sequence, marketDate }, deps);
  }
}
