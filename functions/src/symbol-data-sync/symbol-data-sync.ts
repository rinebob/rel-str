/**
 * Symbol-Data Sync (legacy admin/worker — SDS Pub/Sub subscriber is the canonical path)
 *
 * Provides the HTTP admin trigger and task worker for on-demand symbol-data backfill.
 * The nightly scheduled function (symbolDataSyncNightly) has been deleted — canonical
 * D/W/M sync is now handled by the SDS Pub/Sub subscriber (sds.ts) triggered by
 * partner-data-ready messages.
 *
 * Architecture:
 *   - symbolDataSyncAdminHttp (HTTP request)
 *       → loads all symbols, enqueues one Cloud Task per symbol, returns immediately
 *   - symbolDataSyncSymbol (task worker)
 *       → fetches D/W/M bars from SA for one symbol, writes to symbol-data subcollections
 *   - processSymbolAdded (Pub/Sub consumer on partner-symbol-added)
 *       → backfills a single newly-added symbol as soon as the partner notifies RS
 *
 * Firebase Cloud Function identifiers: symbolDataSyncAdminHttp,
 * symbolDataSyncSymbol, processSymbolAdded.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { getFunctions } from 'firebase-admin/functions';
import { logger } from 'firebase-functions';
import { FieldValue } from 'firebase-admin/firestore';
import { OAuth2Client } from 'google-auth-library';
import { db } from '../firebase-admin-init';
import { callPartnerTrackedSymbols } from '../partner-proxy';
import { startStRun } from '../common/st-orchestration';
import {
  getRunDatePT,
  getRunIdPT,
} from '../common/pt-date-utils';
import { syncSymbolToSymbolData, todayIso } from './symbol-data-backfill';
import { runSettlementForAllInstances } from '../options-strategy-engine/options-strategy-pass-orchestrators';
import { getMarketDatePT } from '../common/pt-date-utils';
import { createRobinhoodMcpSessionManagerFromEnv } from '../options-strategy-engine/mcp/robinhood-mcp-session-manager';

// ============================================================================
// Constants
// ============================================================================

const SYMBOL_DATA_SYNC_RUNS_COLLECTION = 'symbol-data-sync-runs';

// ============================================================================
// Task payload
// ============================================================================

interface SymbolDataSyncPayload {
  symbol: string;
  forceFullFetch: boolean;
  syncRunId?: string;   // Tracking doc ID for completion callback
  totalSymbols?: number;
  marketDate?: string;
}

// ============================================================================
// Enqueue all symbols as Cloud Tasks
// ============================================================================

export async function enqueueAllSymbols(
  forceFullFetch: boolean,
  symbols?: string[],
  triggerAgentOnComplete?: boolean
): Promise<{ total: number; enqueued: number; errors: number }> {
  let allSymbols: string[] = [];

  if (symbols && symbols.length > 0) {
    allSymbols = symbols;
  } else {
    const upstream = await callPartnerTrackedSymbols().catch(() => null);
    const raw: any[] = (upstream as any)?.symbols ?? [];
    allSymbols = raw.map(s => (typeof s === 'string' ? s : s?.symbol)).filter(Boolean);
  }

  if (allSymbols.length === 0) {
    logger.error('symbol_data_sync_no_symbols');
    return { total: 0, enqueued: 0, errors: 0 };
  }

  // Create a sync run tracking doc when triggering agent on completion
  let syncRunId: string | undefined;
  const marketDate = todayIso();
  if (triggerAgentOnComplete) {
    const runDate = getRunDatePT();
    syncRunId = getRunIdPT(runDate, 'nightly');
    await db.collection(SYMBOL_DATA_SYNC_RUNS_COLLECTION).doc(syncRunId).set({
      syncRunId,
      marketDate,
      runDate,
      totalSymbols: allSymbols.length,
      processedCount: 0,
      startedAt: FieldValue.serverTimestamp(),
      triggerAgentOnComplete: true,
    });
    logger.info('symbol_data_sync_run_created', { syncRunId, marketDate, runDate, total: allSymbols.length });
  }

  logger.info('symbol_data_sync_enqueue_start', { total: allSymbols.length, forceFullFetch });

  const queue = getFunctions().taskQueue('symbolDataSyncSymbol');
  let enqueued = 0;
  let errors = 0;

  await Promise.allSettled(
    allSymbols.map(async (symbol) => {
      try {
        const payload: SymbolDataSyncPayload = { symbol, forceFullFetch, syncRunId, totalSymbols: allSymbols.length, marketDate };
        await queue.enqueue(payload);
        enqueued++;
      } catch (err: any) {
        errors++;
        logger.warn('symbol_data_sync_enqueue_failed', { symbol, error: err?.message });
      }
    })
  );

  logger.info('symbol_data_sync_enqueue_complete', { total: allSymbols.length, enqueued, errors });
  return { total: allSymbols.length, enqueued, errors };
}

// ============================================================================
// Task worker — processes one symbol per invocation
// ============================================================================

export const symbolDataSyncSymbol = onTaskDispatched<SymbolDataSyncPayload>(
  {
    retryConfig: { maxAttempts: 3, minBackoffSeconds: 5, maxBackoffSeconds: 60 },
    rateLimits: { maxConcurrentDispatches: 50, maxDispatchesPerSecond: 20 },
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (req) => {
    const { symbol, forceFullFetch, syncRunId, totalSymbols, marketDate } = req.data;
    const result = await syncSymbolToSymbolData(symbol, forceFullFetch);
    logger.info('symbol_data_sync_symbol_done', result);

    // If this sync has a tracking doc, increment counter and check for completion
    if (syncRunId && totalSymbols && marketDate) {
      await checkSyncRunCompletion(syncRunId, totalSymbols, marketDate);
    }
  }
);

// ============================================================================
// Admin HTTP request — manual trigger for backfill or re-sync, returns immediately
// ============================================================================

interface SymbolDataSyncAdminRequest {
  forceFullFetch?: boolean;
  symbols?: string[];
}

const adminFunctionUrl = 'https://us-central1-rel-str.cloudfunctions.net/symbolDataSyncAdminHttp';
const oauth2Client = new OAuth2Client();

async function verifyAdminToken(authHeader?: string): Promise<boolean> {
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.split(' ')[1];
  try {
    const ticket = await oauth2Client.verifyIdToken({ idToken: token, audience: adminFunctionUrl });
    return !!ticket.getPayload();
  } catch (err: any) {
    logger.error('symbol_data_sync_admin_token_error', { error: err?.message });
    return false;
  }
}

export const symbolDataSyncAdminHttp = onRequest(
  { timeoutSeconds: 60, memory: '512MiB' },
  async (request, response) => {
    if (!(await verifyAdminToken(request.headers.authorization))) {
      response.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    const { forceFullFetch = false, symbols } = (request.body ?? {}) as SymbolDataSyncAdminRequest;
    logger.info('symbol_data_sync_admin_called', { forceFullFetch, symbolCount: symbols?.length ?? 'all' });
    const result = await enqueueAllSymbols(forceFullFetch, symbols); // Admin runs don't trigger agent
    response.status(200).json({ ...result, message: `Enqueued ${result.enqueued} symbols for processing` });
  }
);

/**
 * Increment the processed counter for a sync run and trigger the RH Agent run
 * once all symbols have been synced.
 */
async function checkSyncRunCompletion(
  syncRunId: string,
  totalSymbols: number,
  marketDate: string
): Promise<void> {
  const runRef = db.collection(SYMBOL_DATA_SYNC_RUNS_COLLECTION).doc(syncRunId);
  await runRef.set(
    { processedCount: FieldValue.increment(1) },
    { merge: true }
  );

  const snap = await runRef.get();
  const processed = (snap.data() as any)?.processedCount ?? 0;

  logger.info('symbol_data_sync_run_progress', { syncRunId, processed, totalSymbols });

  if (processed >= totalSymbols) {
    logger.info('symbol_data_sync_run_complete', { syncRunId, marketDate });
    await runRef.set({ completedAt: FieldValue.serverTimestamp() }, { merge: true });
    try {
      await startStRun(marketDate, 'nightly');
      logger.info('symbol_data_sync_agent_run_triggered', { syncRunId, marketDate });
    } catch (err: any) {
      logger.error('symbol_data_sync_agent_run_failed', { syncRunId, marketDate, error: err?.message });
    }

    // Run the options settlement pass now that all closing bars are available.
    try {
      const settlementDate = getMarketDatePT();
      const manager = await createRobinhoodMcpSessionManagerFromEnv();
      try {
        await runSettlementForAllInstances(settlementDate);
        logger.info('symbol_data_sync_settlement_pass_complete', { syncRunId, settlementDate });
      } finally {
        await manager.close();
      }
    } catch (err: any) {
      logger.error('symbol_data_sync_settlement_pass_failed', { syncRunId, error: err?.message });
    }
  }
}
