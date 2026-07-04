/**
 * RH Agent Callable Functions
 *
 * HTTP callable functions for manual agent trigger and status queries.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { callPartnerIntradaySnapshotV2 } from '../partner-proxy';
import { logger } from 'firebase-functions';
import { db } from '../firebase-admin-init';
import {
  getMarketDate,
  getDeadlineISO,
  loadEnabledSymbols,
  createDailyRun,
  fetchIntradaySnapshots,
  enqueueSymbolJobs,
} from './rh-agent-shared';
import type { PartnerIntradaySnapshotResponse } from '../types/partner';
import {
  RH_AGENT_RUNS_COLLECTION,
  RH_AGENT_STATUS_COLLECTION,
  AGENT_STATUS_DOC,
  RhAgentDailyRun,
  RhAgentStatus,
} from './rh-agent-config';
import { RH_AGENT_ALLOWED_ORIGINS } from './rh-agent-cors';

/**
 * Request/response types for callables.
 */
interface ManualRunRequest {
  symbols?: string[]; // Optional: specific symbols to run, or all enabled
  date?: string;     // Optional: override market date (YYYY-MM-DD)
}

interface ManualRunResponse {
  runId: string;
  status: string;
  totalSymbols: number;
  enqueued: number;
  failed: number;
  message: string;
}

interface AgentStatusResponse {
  isEnabled: boolean;
  lastRunAt?: string;
  lastRunStatus?: string;
  totalRuns: number;
  totalSignalsGenerated: number;
  symbolsMonitored: string[];
  schedule: string;
}

interface IntradaySnapshotRequest {
  symbol: string;
}

interface IntradaySnapshotResponse {
  symbol: string;
  ip: number | null;
  marketDate: string;
}

interface RunHistoryResponse {
  runs: Array<{
    id: string;
    status: string;
    startedAt: string;
    completedAt?: string;
    marketDate?: string;
    totalSymbols?: number;
    processedCount?: number;
    signalsGenerated?: number;
    triggeredBy?: 'manual' | 'pdr' | 'nightly';
  }>;
}

/**
 * Manual trigger callable - enqueues Cloud Tasks for symbol analysis.
 * Identical processing to scheduled run, just triggered manually.
 */
export const rhAgentManualRun = onCall<ManualRunRequest, Promise<ManualRunResponse>>(
  {
    cors: RH_AGENT_ALLOWED_ORIGINS,
    memory: '1GiB',
    timeoutSeconds: 300,
  },
  async (request) => {
    const startTime = Date.now();
    logger.info('rh_agent_manual_run_called', { auth: request.auth?.uid });

    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in to trigger a manual run');
    }

    try {
      // 1. Get market date (allow override for holidays/weekends)
      const marketDate = request.data.date || getMarketDate();

      // 2. Load enabled symbols (filter if specific symbols requested)
      const symbols = await loadEnabledSymbols(request.data.symbols);
      logger.info('rh_agent_manual_symbols_loaded', {
        count: symbols.length,
        firstFew: symbols.slice(0, 5),
        requested: request.data.symbols,
      });

      if (symbols.length === 0) {
        throw new HttpsError('invalid-argument', 'No symbols to process');
      }

      // 3. Fetch intraday snapshot so Run Now also sees today's price
      const intradaySnapshots = await fetchIntradaySnapshots(symbols, marketDate);

      // 4. Create run document with 30-minute deadline
      const deadlineAt = getDeadlineISO(30);
      const runStartedAt = new Date().toISOString();
      const runId = await createDailyRun(marketDate, symbols.length, deadlineAt, 'manual');
      logger.info('rh_agent_manual_run_created', {
        runId,
        marketDate,
        symbolCount: symbols.length,
      });

      // 5. Enqueue Cloud Tasks for all symbols (intraday snapshot in each payload)
      const intradayBySymbol = new Map(intradaySnapshots.map(s => [s.symbol, s]));
      const { enqueued: enqueuedCount, failed: failedCount } = await enqueueSymbolJobs(
        runId,
        symbols,
        marketDate,
        runStartedAt,
        intradayBySymbol,
        'manual',
      );

      const duration = Date.now() - startTime;
      logger.info('rh_agent_manual_run_enqueued', {
        runId,
        marketDate,
        symbolsLoaded: symbols.length,
        enqueued: enqueuedCount,
        failed: failedCount,
        durationMs: duration,
      });

      return {
        runId,
        status: 'RUNNING',
        totalSymbols: symbols.length,
        enqueued: enqueuedCount,
        failed: failedCount,
        message: `Manual run started: ${enqueuedCount} symbols enqueued for analysis`,
      };
    } catch (error: any) {
      logger.error('rh_agent_manual_run_fatal_error', {
        error: error?.message,
        stack: error?.stack,
      });
      throw new HttpsError('internal', `Manual run failed: ${error?.message}`);
    }
  }
);

/**
 * Get agent status callable.
 */
export const rhAgentGetStatus = onCall<void, Promise<AgentStatusResponse>>(
  {
    cors: RH_AGENT_ALLOWED_ORIGINS,
  },
  async () => {
    // Get actual enabled symbols from rh-agent-symbols collection
    const symbolsSnapshot = await db
      .collection('rh-agent-symbols')
      .where('enabled', '==', true)
      .get();
    const symbolsMonitored = symbolsSnapshot.docs.map((d) => d.data().symbol as string);

    const doc = await db.collection(RH_AGENT_STATUS_COLLECTION).doc(AGENT_STATUS_DOC).get();

    if (!doc.exists) {
      return {
        isEnabled: true,
        totalRuns: 0,
        totalSignalsGenerated: 0,
        symbolsMonitored,
        schedule: '0 20 * * 1-5',
      };
    }

    const status = doc.data() as RhAgentStatus;

    // Convert timestamps to ISO strings for JSON serialization
    const lastRunAt = status.lastRunAt
      ? typeof status.lastRunAt === 'object' && 'toDate' in status.lastRunAt
        ? (status.lastRunAt as { toDate(): Date }).toDate().toISOString()
        : new Date().toISOString()
      : undefined;

    return {
      isEnabled: status.isEnabled,
      lastRunAt,
      lastRunStatus: status.lastRunStatus,
      totalRuns: status.totalRuns,
      totalSignalsGenerated: status.totalSignalsGenerated,
      symbolsMonitored,
      schedule: status.schedule || '0 20 * * 1-5',
    };
  }
);

/**
 * Get run history callable.
 */
export const rhAgentGetRunHistory = onCall<{ limit?: number }, Promise<RunHistoryResponse>>(
  {
    cors: RH_AGENT_ALLOWED_ORIGINS,
  },
  async (request) => {
    const limit = request.data.limit ?? 20;

    const snapshot = await db
      .collection(RH_AGENT_RUNS_COLLECTION)
      .orderBy('startedAt', 'desc')
      .limit(limit)
      .get();

    const runs = snapshot.docs.map((d) => d.data() as RhAgentDailyRun);

    return {
      runs: runs.map((run) => ({
        id: run.id,
        status: run.status,
        startedAt: run.startedAt
          ? typeof run.startedAt === 'object' && 'toDate' in run.startedAt
            ? (run.startedAt as { toDate(): Date }).toDate().toISOString()
            : new Date().toISOString()
          : new Date().toISOString(),
        completedAt: run.completedAt
          ? typeof run.completedAt === 'object' && 'toDate' in run.completedAt
            ? (run.completedAt as { toDate(): Date }).toDate().toISOString()
            : undefined
          : undefined,
        marketDate: run.marketDate,
        totalSymbols: run.totalSymbols,
        processedCount: run.processedCount,
        signalsGenerated: run.signalsGenerated,
        triggeredBy: run.triggeredBy,
      })),
    };
  }
);

/**
 * Fetch the current intraday price for a single symbol.
 * Used by the frontend chart service to synthesize today's partial bar when
 * rs-bars does not yet contain a bar for today (lastEodSyncAt < today).
 *
 * Passes a single-element array to callPartnerIntradaySnapshotV2 (the SA
 * endpoint accepts { symbols: string[] } so no separate endpoint is needed).
 * Returns ip: null if SA returns no data (outside market hours, unknown symbol,
 * endpoint error) — the caller renders rs-bars as-is without injecting a bar.
 */
export const rhAgentGetIntradaySnapshot = onCall<IntradaySnapshotRequest, Promise<IntradaySnapshotResponse>>(
  { cors: RH_AGENT_ALLOWED_ORIGINS },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const { symbol } = request.data;
    if (!symbol || typeof symbol !== 'string') {
      throw new HttpsError('invalid-argument', 'symbol is required');
    }

    const marketDate = getMarketDate();

    try {
      const response: PartnerIntradaySnapshotResponse = await callPartnerIntradaySnapshotV2([symbol]);
      const snapshot = response.snapshots?.find(s => s.symbol === symbol);
      const ip = snapshot?.ip != null && Number.isFinite(snapshot.ip) ? snapshot.ip : null;
      return { symbol, ip, marketDate };
    } catch (err: any) {
      logger.warn('rh_agent_get_intraday_snapshot_failed', { symbol, error: err?.message });
      return { symbol, ip: null, marketDate };
    }
  }
);
