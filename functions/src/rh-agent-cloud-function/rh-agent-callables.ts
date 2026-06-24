/**
 * RH Agent Callable Functions
 *
 * HTTP callable functions for manual agent trigger and status queries.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { db } from '../firebase-admin-init';
import {
  getMarketDate,
  getDeadlineISO,
  loadEnabledSymbols,
  createDailyRun,
  createJobAndEnqueue,
} from './rh-agent-shared';
import {
  RH_AGENT_RUNS_COLLECTION,
  RH_AGENT_OPPORTUNITIES_COLLECTION,
  RH_AGENT_STATUS_COLLECTION,
  AGENT_STATUS_DOC,
  RhAgentRun,
  RhTradeOpportunity,
  RhAgentStatus,
} from './rh-agent-config';

/**
 * Request/response types for callables.
 */
interface ManualRunRequest {
  symbols?: string[]; // Optional: specific symbols to run, or all enabled
  strategy?: string; // Optional: specific strategy to run
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

interface RunHistoryResponse {
  runs: Array<{
    id: string;
    status: string;
    startedAt: string;
    completedAt?: string;
    strategy: string;
    symbolsProcessed: number;
    signalsGenerated: number;
    summary?: string;
  }>;
}

interface SignalHistoryResponse {
  signals: Array<{
    id: string;
    symbol: string;
    action: string;
    status: string;
    reason: string;
    createdAt: string;
    dryRun: boolean;
  }>;
}

const ALLOWED_ORIGINS = [
  'https://rel-str--rel-str.web.app',
  'https://rel-str--rel-str.us-central1.hosted.app',
  'https://rel-str.web.app',
  'https://savanttrader.com',
  'https://www.savanttrader.com',
  'http://localhost:4200',
  'http://localhost:4210',
  'http://localhost:5000',
];

/**
 * Manual trigger callable - enqueues Cloud Tasks for symbol analysis.
 * Identical processing to scheduled run, just triggered manually.
 */
export const rhAgentManualRun = onCall<ManualRunRequest, Promise<ManualRunResponse>>(
  {
    cors: ALLOWED_ORIGINS,
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

      // 3. Create run document with 30-minute deadline
      const deadlineAt = getDeadlineISO(30);
      const runId = await createDailyRun(marketDate, symbols.length, deadlineAt, 'manual');
      logger.info('rh_agent_manual_run_created', {
        runId,
        marketDate,
        symbolCount: symbols.length,
      });

      // 4. Create job documents and enqueue Cloud Tasks
      let enqueuedCount = 0;
      let failedCount = 0;

      for (const symbol of symbols) {
        try {
          await createJobAndEnqueue(runId, symbol, marketDate, 'manual');
          enqueuedCount++;
          if (enqueuedCount % 10 === 0) {
            logger.info('rh_agent_manual_enqueue_progress', {
              runId,
              enqueued: enqueuedCount,
              total: symbols.length,
            });
          }
        } catch (error: any) {
          failedCount++;
          logger.error('rh_agent_manual_enqueue_failed', {
            symbol,
            runId,
            error: error?.message,
          });
        }
      }

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
    cors: true,
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
    cors: true,
  },
  async (request) => {
    const limit = request.data.limit ?? 20;

    const snapshot = await db
      .collection(RH_AGENT_RUNS_COLLECTION)
      .orderBy('startedAt', 'desc')
      .limit(limit)
      .get();

    const runs = snapshot.docs.map((d) => d.data() as RhAgentRun);

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
        strategy: run.strategy,
        symbolsProcessed: run.symbolsProcessed,
        signalsGenerated: run.signalsGenerated,
        summary: run.summary,
      })),
    };
  }
);

/**
 * Get signal history callable (reads from rh-agent-opportunities).
 */
export const rhAgentGetSignalHistory = onCall<{ limit?: number; runId?: string }, Promise<SignalHistoryResponse>>(
  {
    cors: true,
  },
  async (request) => {
    const { limit, runId } = request.data;

    let query = db.collection(RH_AGENT_OPPORTUNITIES_COLLECTION).orderBy('createdAt', 'desc');

    if (runId) {
      query = query.where('runId', '==', runId);
    }

    const snapshot = await query.limit(limit ?? 50).get();
    const opportunities = snapshot.docs.map((d) => d.data() as RhTradeOpportunity);

    return {
      signals: opportunities.map((o) => ({
        id: o.id,
        symbol: o.symbol,
        action: o.action,
        status: o.status,
        reason: o.reason,
        createdAt: o.createdAt
          ? typeof o.createdAt === 'object' && 'toDate' in o.createdAt
            ? (o.createdAt as { toDate(): Date }).toDate().toISOString()
            : new Date().toISOString()
          : new Date().toISOString(),
        dryRun: false, // Opportunities are always live
      })),
    };
  }
);
