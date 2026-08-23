/**
 * SDS core logic — handles a PDR message by creating run docs, sequence docs,
 * and enqueuing per-symbol Cloud Tasks.
 *
 * This module is separated from the Cloud Function entry point so the core
 * logic is testable with injected dependencies (mock Firestore, mock task
 * queue, mock tracked-symbols fetch).
 */

import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import {
  resolvePdrContext,
  resolveSymbolSet,
  computeSequenceRunId,
  type PdrContext,
} from './sds-pdr-parser';
import { SYMBOL_DATA_COLLECTION } from '../webhooks/webhooks-config';
import { checkIntradayRunCompletion, type SdsCompletionDeps, type RunContext } from './sds-completion';

const SDS_RUNS_COLLECTION = 'symbol-data-sync-runs';
const SDS_SEQUENCES_COLLECTION = 'symbol-data-sync-sequences';

export { SDS_RUNS_COLLECTION, SDS_SEQUENCES_COLLECTION };

const TERMINAL_STATUSES = ['completed', 'failed', 'completed_with_errors', 'forced_complete'] as const;

export interface SdsTaskPayload {
  symbol: string;
  interval: string;
  runId: string;
  sequenceRunId: string | undefined;
  sequence: string | undefined;
  marketDate: string;
}

export interface SdsDeps {
  db: FirebaseFirestore.Firestore;
  enqueueTask: (payload: SdsTaskPayload) => Promise<void>;
  getTrackedSymbols: () => Promise<string[]>;
  fetchIntradaySnapshot: (symbols: string[]) => Promise<Array<{ symbol: string; ip: number; ipc: number; io: number; it: string; ic: number }>>;
  /** Completion deps — used for intraday run completion dispatch. */
  completionDeps?: SdsCompletionDeps;
}

export interface SdsResult {
  skipped: boolean;
  enqueued: number;
  errors: number;
}

type AttrMap = Record<string, string | undefined>;

export async function handlePdrMessage(
  attributes: AttrMap,
  payload: Record<string, unknown>,
  deps: SdsDeps,
): Promise<SdsResult> {
  const ctx = resolvePdrContext(attributes, payload);
  logger.info('sds_pdr_received', { runId: ctx.runId, phase: ctx.phase, interval: ctx.interval, sequence: ctx.sequence });

  // Idempotency: skip if run doc already exists with terminal status
  const runRef = deps.db.collection(SDS_RUNS_COLLECTION).doc(ctx.runId);
  const existing = await runRef.get();
  const existingStatus = existing.exists ? (existing.data()?.status as string | undefined) : undefined;
  if (existingStatus && TERMINAL_STATUSES.includes(existingStatus as typeof TERMINAL_STATUSES[number])) {
    logger.info('sds_skip_terminal_run', { runId: ctx.runId, status: existingStatus });
    return { skipped: true, enqueued: 0, errors: 0 };
  }

  // Resolve symbol set
  const trackedSymbols = await deps.getTrackedSymbols();
  const symbols = resolveSymbolSet(ctx, trackedSymbols);

  // Create run doc
  const sequenceRunId = computeSequenceRunId(ctx.runId, ctx.marketDate);
  await runRef.set({
    runId: ctx.runId,
    marketDate: ctx.marketDate,
    runType: ctx.runType,
    phase: ctx.phase,
    interval: ctx.interval,
    sequence: ctx.sequence ?? null,
    sequenceRunId: sequenceRunId ?? null,
    symbols,
    processedSymbols: [],
    status: 'processing',
    completionEnqueued: false,
    startedAt: FieldValue.serverTimestamp(),
  });

  // Intraday PRE: bulk fetch in subscriber, no per-symbol tasks
  if (ctx.phase === 'pre') {
    return await handleIntradayRun(ctx, symbols, deps, runRef);
  }

  // POST runs: create/update sequence doc, enqueue per-symbol tasks
  return await createPostRun(ctx, symbols, sequenceRunId, deps, runRef);
}

/**
 * Create a POST run: sequence doc + per-symbol task enqueue.
 *
 * Shared between the PDR subscriber (handlePdrMessage) and the fallback timer
 * (sds-fallback.ts). Both callers need the same sequence-doc transaction and
 * per-symbol enqueue loop — extracting this avoids fabricating synthetic PDR
 * attributes in the fallback.
 */
export async function createPostRun(
  ctx: PdrContext,
  symbols: string[],
  sequenceRunId: string | undefined,
  deps: SdsDeps,
  runRef: FirebaseFirestore.DocumentReference,
): Promise<SdsResult> {
  // Create/update sequence doc atomically
  if (sequenceRunId) {
    const seqRef = deps.db.collection(SDS_SEQUENCES_COLLECTION).doc(sequenceRunId);
    await deps.db.runTransaction(async (t) => {
      const seqSnap = await t.get(seqRef);
      if (!seqSnap.exists) {
        t.set(seqRef, {
          sequenceRunId,
          marketDate: ctx.marketDate,
          sequence: ctx.sequence,
          intervalRunIds: { [ctx.interval]: ctx.runId },
          completedIntervals: [],
          status: 'processing',
          completionEnqueued: false,
          startedAt: FieldValue.serverTimestamp(),
          completedAt: null,
        });
      } else {
        t.set(seqRef, {
          intervalRunIds: { [ctx.interval]: ctx.runId },
        }, { merge: true });
      }
    });
  }

  // Enqueue tasks
  let enqueued = 0;
  let errors = 0;
  const failedEnqueueSymbols: string[] = [];
  for (const symbol of symbols) {
    try {
      await deps.enqueueTask({
        symbol,
        interval: ctx.interval,
        runId: ctx.runId,
        sequenceRunId: sequenceRunId ?? undefined,
        sequence: ctx.sequence,
        marketDate: ctx.marketDate,
      });
      enqueued++;
    } catch (err: any) {
      errors++;
      failedEnqueueSymbols.push(symbol);
      logger.warn('sds_enqueue_failed', { symbol, runId: ctx.runId, error: err?.message });
    }
  }

  // If some tasks failed to enqueue, mark them as processed so the run can
  // reach completion. They won't have data, but downstream consumers handle gaps.
  if (errors > 0) {
    await runRef.set({
      processedSymbols: FieldValue.arrayUnion(...failedEnqueueSymbols),
    }, { merge: true });
  }

  logger.info('sds_enqueue_complete', { runId: ctx.runId, enqueued, errors, total: symbols.length });
  return { skipped: false, enqueued, errors };
}

async function handleIntradayRun(
  ctx: PdrContext,
  symbols: string[],
  deps: SdsDeps,
  runRef: FirebaseFirestore.DocumentReference,
): Promise<SdsResult> {
  let success = 0;
  let failed = 0;

  let snapshots: Array<{ symbol: string; ip: number; ipc: number; io: number; it: string; ic: number }> = [];
  try {
    snapshots = await deps.fetchIntradaySnapshot(symbols);
  } catch (err: any) {
    logger.error('sds_intraday_fetch_failed', { runId: ctx.runId, error: err?.message });
    failed = symbols.length;
    await markIntradayRunComplete(runRef, symbols);
    return { skipped: false, enqueued: 0, errors: failed };
  }

  // Track which symbols we got snapshots for
  const snapshotSymbols = new Set(snapshots.map((s) => s.symbol));
  for (const sym of symbols) {
    if (!snapshotSymbols.has(sym)) {
      failed++;
    }
  }

  // Write each symbol's intraday doc + currentPrice in a batch
  try {
    const batch = deps.db.batch();
    for (const snap of snapshots) {
      const rootRef = deps.db.collection(SYMBOL_DATA_COLLECTION).doc(snap.symbol);
      const intradayRef = rootRef.collection('intraday').doc('latest');
      batch.set(intradayRef, {
        ip: snap.ip,
        ipc: snap.ipc,
        io: snap.io,
        it: snap.it,
        ic: snap.ic,
        marketDate: ctx.marketDate,
        updatedAt: FieldValue.serverTimestamp(),
      });
      batch.set(rootRef, {
        currentPrice: { price: snap.ip, date: ctx.marketDate, time: snap.it },
      }, { merge: true });
      success++;
    }
    await batch.commit();
  } catch (err: any) {
    logger.error('sds_intraday_batch_commit_failed', { runId: ctx.runId, error: err?.message });
    failed += snapshots.length;
    success = 0;
  }

  await markIntradayRunComplete(runRef, symbols);
  logger.info('sds_intraday_complete', { runId: ctx.runId, success, failed });

  // Fire intraday completion dispatch (RH Agent intraday)
  if (deps.completionDeps) {
    const runCtx: RunContext = {
      runId: ctx.runId,
      sequenceRunId: undefined,
      interval: 'INTRADAY',
      sequence: undefined,
      marketDate: ctx.marketDate,
      phase: 'pre',
    };
    await checkIntradayRunCompletion(runCtx, deps.completionDeps);
  }

  return { skipped: false, enqueued: success, errors: failed };
}

async function markIntradayRunComplete(
  runRef: FirebaseFirestore.DocumentReference,
  symbols: string[],
): Promise<void> {
  await runRef.set({
    processedSymbols: symbols,
    status: 'completed',
    completionEnqueued: false,
    completedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}
