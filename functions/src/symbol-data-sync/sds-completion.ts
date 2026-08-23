/**
 * SDS completion core — per-interval completion, sequence fan-in, and
 * downstream consumer dispatch.
 *
 * - checkSyncRunCompletion: transaction-wrapped per-interval check.
 *   When processedSymbols.length >= symbols.length, marks the interval run
 *   complete and updates the parent sequence doc's completedIntervals.
 *
 * - fireSequenceCompletion: when all 3 intervals (DAILY, WEEKLY, MONTHLY)
 *   in a POST sequence complete, enqueues downstream consumers
 *   (selection, settlement, RH Agent) as separate Cloud Tasks.
 *   Uses a conditional transaction to guarantee only one caller fires.
 *
 * - checkIntradayRunCompletion: intraday runs have no fan-in — completion
 *   fires directly on the run doc and dispatches RH Agent intraday.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

const SDS_RUNS_COLLECTION = 'symbol-data-sync-runs';
const SDS_SEQUENCES_COLLECTION = 'symbol-data-sync-sequences';

const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'completed_with_errors', 'forced_complete', 'completed_but_not_dispatched'] as const;
const TERMINAL_SEQ_STATUSES = ['completed', 'completed_but_not_dispatched', 'forced_complete'] as const;
const REQUIRED_INTERVALS = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;

// ── Types ────────────────────────────────────────────────────────────

export interface RunContext {
  runId: string;
  sequenceRunId: string | undefined;
  interval: string;
  sequence: string | undefined;
  marketDate: string;
  phase: string;
}

export interface SequenceContext {
  sequenceRunId: string;
  sequence: string;
  marketDate: string;
}

/** Downstream consumer names dispatched by sequence completion. */
export type ConsumerName =
  | 'selection'
  | 'settlement'
  | 'settlement-scoped'
  | 'rh-agent-nightly'
  | 'rh-agent-nightly-scoped'
  | 'rh-agent-intraday';

/**
 * RS extension point — defined per acceptance criterion #10 but not wired.
 * Future topic plugs PDRv2 in here. Intentionally retained as dead code
 * per the spec; do not remove until the wiring task implements it.
 */
export interface RsExtensionPoint {
  enqueueRsConsumer(runContext: RunContext): Promise<void>;
}

export interface SdsCompletionDeps {
  db: FirebaseFirestore.Firestore;
  /** Enqueue a downstream consumer as a Cloud Task. */
  enqueueConsumer(name: ConsumerName, payload: Record<string, unknown>): Promise<void>;
  /** Direct call to selection pass (for consumers that run inline). */
  runSelectionPass(marketDate: string): Promise<void>;
  /** Direct call to settlement pass. */
  runSettlementPass(marketDate: string, symbols?: string[]): Promise<void>;
  /** Start RH Agent run. */
  startRhAgentRun(marketDate: string, triggeredBy: 'manual' | 'pdr' | 'nightly' | 'symbol-added'): Promise<void>;
  /** Optional RS extension — not wired (AC #10). */
  rsExtension?: RsExtensionPoint;
}

export const SDS_RUNS = SDS_RUNS_COLLECTION;
export const SDS_SEQUENCES = SDS_SEQUENCES_COLLECTION;
export const TERMINAL_RUN = TERMINAL_RUN_STATUSES;
export const TERMINAL_SEQ = TERMINAL_SEQ_STATUSES;
export const REQUIRED_IV = REQUIRED_INTERVALS;

// ── Per-interval completion ──────────────────────────────────────────

/**
 * Transaction-wrapped per-interval completion check.
 * Called by the worker after each symbol is processed.
 *
 * When processedSymbols.length >= symbols.length:
 * 1. Marks the interval run as 'completed'
 * 2. Adds the interval to the parent sequence's completedIntervals
 * 3. Checks if all 3 intervals are done → fires sequence completion
 */
export async function checkSyncRunCompletion(
  ctx: RunContext,
  deps: SdsCompletionDeps,
): Promise<void> {
  const runRef = deps.db.collection(SDS_RUNS_COLLECTION).doc(ctx.runId);

  await deps.db.runTransaction(async (t) => {
    const runSnap = await t.get(runRef);
    const runData = runSnap.data();
    if (!runData) {
      logger.warn('sds_completion_run_not_found', { runId: ctx.runId });
      return;
    }

    // Idempotency: skip if already terminal
    const status = runData.status as string;
    if (TERMINAL_RUN_STATUSES.includes(status as typeof TERMINAL_RUN_STATUSES[number])) {
      return;
    }

    const processedSymbols: string[] = (runData.processedSymbols as string[]) ?? [];
    const symbols: string[] = (runData.symbols as string[]) ?? [];

    // Guard: empty symbol set — vacuously complete, but warn and skip
    // sequence fan-in so downstream consumers don't fire with no data.
    if (symbols.length === 0) {
      logger.warn('sds_completion_empty_symbols', { runId: ctx.runId });
      t.set(runRef, {
        status: 'completed',
        completedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    if (processedSymbols.length < symbols.length) {
      return;
    }

    // Mark interval run complete
    t.set(runRef, {
      status: 'completed',
      completedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // Update sequence doc if this is a POST run
    if (ctx.sequenceRunId) {
      const seqRef = deps.db.collection(SDS_SEQUENCES_COLLECTION).doc(ctx.sequenceRunId);
      const seqSnap = await t.get(seqRef);
      const seqData = seqSnap.data();
      if (!seqData) {
        logger.warn('sds_completion_seq_not_found', { sequenceRunId: ctx.sequenceRunId });
        return;
      }

      const completedIntervals: string[] = (seqData.completedIntervals as string[]) ?? [];
      if (!completedIntervals.includes(ctx.interval)) {
        completedIntervals.push(ctx.interval);
      }

      t.set(seqRef, {
        completedIntervals,
      }, { merge: true });
    }
  });

  // After the transaction, check if the sequence is ready to complete.
  // We do this outside the transaction to avoid holding it open during enqueue.
  if (ctx.sequenceRunId) {
    await maybeFireSequenceCompletion(ctx.sequenceRunId, ctx.marketDate, ctx.sequence ?? '', deps);
  }
}

/**
 * Check if all required intervals are complete, and if so, fire sequence completion.
 * Called after each interval completion.
 */
export async function maybeFireSequenceCompletion(
  sequenceRunId: string,
  marketDate: string,
  sequence: string,
  deps: SdsCompletionDeps,
): Promise<void> {
  const seqRef = deps.db.collection(SDS_SEQUENCES_COLLECTION).doc(sequenceRunId);
  const seqSnap = await seqRef.get();
  const seqData = seqSnap.data();
  if (!seqData) return;

  const status = seqData.status as string;
  if (TERMINAL_SEQ_STATUSES.includes(status as typeof TERMINAL_SEQ_STATUSES[number])) {
    return;
  }

  const completedIntervals: string[] = seqData.completedIntervals ?? [];
  const allDone = REQUIRED_INTERVALS.every((iv) => completedIntervals.includes(iv));
  if (!allDone) return;

  await fireSequenceCompletion({ sequenceRunId, sequence, marketDate }, deps);
}

/**
 * Fire sequence completion: enqueue downstream consumers as separate Cloud Tasks.
 *
 * Uses a conditional transaction: only the caller that successfully transitions
 * the sequence from 'processing' to 'completed' proceeds with enqueue. This
 * prevents duplicate consumer dispatch when two intervals complete simultaneously.
 *
 * Sets completionEnqueued=true only after all enqueues succeed.
 * If any enqueue fails, leaves sequence in 'completed_but_not_dispatched' status.
 */
export async function fireSequenceCompletion(
  ctx: SequenceContext,
  deps: SdsCompletionDeps,
): Promise<void> {
  const seqRef = deps.db.collection(SDS_SEQUENCES_COLLECTION).doc(ctx.sequenceRunId);

  // Conditional transaction: atomically claim the sequence for completion.
  // Only one caller can transition status from 'processing' → 'completed'.
  let claimed = false;
  let seqData: Record<string, unknown> | undefined;

  await deps.db.runTransaction(async (t) => {
    const seqSnap = await t.get(seqRef);
    seqData = seqSnap.data();
    if (!seqData) {
      logger.warn('sds_seq_completion_not_found', { sequenceRunId: ctx.sequenceRunId });
      return;
    }

    const status = seqData.status as string;
    if (TERMINAL_SEQ_STATUSES.includes(status as typeof TERMINAL_SEQ_STATUSES[number])) {
      return; // Already terminal — another caller won the race
    }

    // Guard: only fire if all required intervals are complete
    const completedIntervals: string[] = (seqData.completedIntervals as string[]) ?? [];
    const allDone = REQUIRED_INTERVALS.every((iv) => completedIntervals.includes(iv));
    if (!allDone) {
      logger.info('sds_seq_not_all_intervals_complete', {
        sequenceRunId: ctx.sequenceRunId,
        completedIntervals,
      });
      return;
    }

    // Claim the sequence by marking it as completed atomically
    t.set(seqRef, {
      status: 'completed',
      completedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    claimed = true;
  });

  if (!claimed || !seqData) return;

  // Enqueue consumers outside the transaction to avoid holding it open.
  const consumerPayload = {
    marketDate: ctx.marketDate,
  };

  // Determine which consumers to dispatch based on sequence
  const consumers: Array<{ name: ConsumerName; payload: Record<string, unknown> }> = [];
  if (ctx.sequence === 'A') {
    consumers.push({ name: 'selection', payload: consumerPayload });
    consumers.push({ name: 'settlement', payload: consumerPayload });
    consumers.push({ name: 'rh-agent-nightly', payload: consumerPayload });
  } else {
    consumers.push({ name: 'settlement-scoped', payload: consumerPayload });
    consumers.push({ name: 'rh-agent-nightly-scoped', payload: consumerPayload });
  }

  // Enqueue all consumers — if any fails, mark as completed_but_not_dispatched
  let enqueueFailed = false;
  for (const consumer of consumers) {
    try {
      await deps.enqueueConsumer(consumer.name, consumer.payload);
      logger.info('sds_consumer_enqueued', {
        sequenceRunId: ctx.sequenceRunId,
        consumer: consumer.name,
      });
    } catch (err: any) {
      logger.error('sds_consumer_enqueue_failed', {
        sequenceRunId: ctx.sequenceRunId,
        consumer: consumer.name,
        error: err?.message,
      });
      enqueueFailed = true;
    }
  }

  // Update sequence doc with final dispatch status
  if (enqueueFailed) {
    await seqRef.set({
      status: 'completed_but_not_dispatched',
      completionEnqueued: false,
    }, { merge: true });
    logger.warn('sds_seq_completed_but_not_dispatched', {
      sequenceRunId: ctx.sequenceRunId,
    });
  } else {
    await seqRef.set({
      completionEnqueued: true,
    }, { merge: true });
    logger.info('sds_seq_completed', {
      sequenceRunId: ctx.sequenceRunId,
      consumerCount: consumers.length,
    });
  }
}

// ── Intraday completion ──────────────────────────────────────────────

/**
 * Intraday runs have no fan-in — completion fires directly on the run doc.
 * Dispatches RH Agent intraday consumer.
 */
export async function checkIntradayRunCompletion(
  ctx: RunContext,
  deps: SdsCompletionDeps,
): Promise<void> {
  const runRef = deps.db.collection(SDS_RUNS_COLLECTION).doc(ctx.runId);
  const runSnap = await runRef.get();
  const runData = runSnap.data();
  if (!runData) return;

  const status = runData.status as string;
  if (TERMINAL_RUN_STATUSES.includes(status as typeof TERMINAL_RUN_STATUSES[number])) {
    return;
  }

  const processedSymbols: string[] = (runData.processedSymbols as string[]) ?? [];
  const symbols: string[] = (runData.symbols as string[]) ?? [];

  // Guard: empty symbol set — vacuously complete, but skip dispatch
  if (symbols.length === 0) {
    logger.warn('sds_intraday_empty_symbols', { runId: ctx.runId });
    await runRef.set({
      status: 'completed',
      completedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return;
  }

  if (processedSymbols.length < symbols.length) return;

  // Mark run complete
  await runRef.set({
    status: 'completed',
    completedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  // Dispatch RH Agent intraday
  try {
    await deps.enqueueConsumer('rh-agent-intraday', {
      runId: ctx.runId,
      marketDate: ctx.marketDate,
    });
    await runRef.set({ completionEnqueued: true }, { merge: true });
    logger.info('sds_intraday_consumer_enqueued', { runId: ctx.runId });
  } catch (err: any) {
    logger.error('sds_intraday_consumer_enqueue_failed', {
      runId: ctx.runId,
      error: err?.message,
    });
    await runRef.set({
      status: 'completed_but_not_dispatched',
      completionEnqueued: false,
    }, { merge: true });
  }
}
