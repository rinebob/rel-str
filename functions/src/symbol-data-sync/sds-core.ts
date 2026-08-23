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

const SDS_RUNS_COLLECTION = 'symbol-data-sync-runs';
const SDS_SEQUENCES_COLLECTION = 'symbol-data-sync-sequences';

const TERMINAL_STATUSES = ['completed', 'failed', 'completed_with_errors', 'forced_complete'] as const;

export interface SdsTaskPayload {
  symbol: string;
  interval: string;
  runId: string;
  sequenceRunId: string | undefined;
  marketDate: string;
  totalSymbols: number;
}

export interface SdsDeps {
  db: FirebaseFirestore.Firestore;
  enqueueTask: (payload: SdsTaskPayload) => Promise<void>;
  getTrackedSymbols: () => Promise<string[]>;
  fetchIntradaySnapshot: (symbols: string[]) => Promise<Array<{ symbol: string; ip: number; ipc: number; io: number; it: string; ic: number }>>;
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
    totalSymbols: symbols.length,
    processedCount: 0,
    successCount: 0,
    failedCount: 0,
    failedSymbols: [],
    status: 'processing',
    completionEnqueued: false,
    startedAt: FieldValue.serverTimestamp(),
  });

  // Intraday PRE: bulk fetch in subscriber, no per-symbol tasks
  if (ctx.phase === 'pre') {
    return await handleIntradayRun(ctx, symbols, deps, runRef);
  }

  // POST runs: create/update sequence doc atomically, enqueue per-symbol tasks
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
          failedSymbols: [],
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
        marketDate: ctx.marketDate,
        totalSymbols: symbols.length,
      });
      enqueued++;
    } catch (err: any) {
      errors++;
      failedEnqueueSymbols.push(symbol);
      logger.warn('sds_enqueue_failed', { symbol, runId: ctx.runId, error: err?.message });
    }
  }

  // If some tasks failed to enqueue, update totalSymbols to match actual enqueued
  // count so the run can reach completion. Record failed symbols.
  if (errors > 0) {
    await runRef.set({
      totalSymbols: enqueued,
      failedSymbols: FieldValue.arrayUnion(...failedEnqueueSymbols),
      failedCount: errors,
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
  const failedSymbols: string[] = [];

  let snapshots: Array<{ symbol: string; ip: number; ipc: number; io: number; it: string; ic: number }> = [];
  try {
    snapshots = await deps.fetchIntradaySnapshot(symbols);
  } catch (err: any) {
    logger.error('sds_intraday_fetch_failed', { runId: ctx.runId, error: err?.message });
    // Fetch failed entirely — all symbols failed
    failed = symbols.length;
    failedSymbols.push(...symbols);
    await markIntradayRunComplete(runRef, symbols.length, success, failed, failedSymbols);
    return { skipped: false, enqueued: 0, errors: failed };
  }

  // Track which symbols we got snapshots for
  const snapshotSymbols = new Set(snapshots.map((s) => s.symbol));
  for (const sym of symbols) {
    if (!snapshotSymbols.has(sym)) {
      failedSymbols.push(sym);
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
    // Batch failed — none of the writes landed
    failed += snapshots.length;
    failedSymbols.push(...snapshots.map((s) => s.symbol));
    success = 0;
  }

  await markIntradayRunComplete(runRef, symbols.length, success, failed, failedSymbols);
  logger.info('sds_intraday_complete', { runId: ctx.runId, success, failed });
  return { skipped: false, enqueued: success, errors: failed };
}

async function markIntradayRunComplete(
  runRef: FirebaseFirestore.DocumentReference,
  total: number,
  success: number,
  failed: number,
  failedSymbols: string[],
): Promise<void> {
  await runRef.set({
    processedCount: total,
    successCount: success,
    failedCount: failed,
    failedSymbols,
    status: 'completed',
    completionEnqueued: false,
    completedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}
