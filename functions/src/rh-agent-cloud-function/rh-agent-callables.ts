/**
 * RH Agent Callable Functions
 *
 * HTTP callable functions for manual agent trigger and status queries.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { db } from '../firebase-admin-init';
import { getMarketDate, getDeadlineISO, createDailyRun } from '../common/rh-agent-run-creation';
import { loadEnabledSymbols } from '../common/rh-agent-symbol-source';
import { enqueueSymbolJobs } from '../common/rh-agent-job-enqueueing';
import { normalizeMarketDate } from '../common/pt-date-utils';
import {
  RH_AGENT_RUNS_COLLECTION,
  RH_AGENT_STATUS_COLLECTION,
  AGENT_STATUS_DOC,
  RH_AGENT_SCHEDULE_CRON,
} from '../common/rh-agent-collections';
import { RhAgentDailyRun, RhAgentStatus, RhAgentTriggeredBy } from '../common/rh-agent-runs';
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
    triggeredBy?: RhAgentTriggeredBy;
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
      const marketDate = request.data.date ? normalizeMarketDate(request.data.date) : getMarketDate();

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
      const runStartedAt = new Date().toISOString();
      const runId = await createDailyRun(marketDate, symbols.length, deadlineAt, 'manual');
      logger.info('rh_agent_manual_run_created', {
        runId,
        marketDate,
        symbolCount: symbols.length,
      });

      // 4. Enqueue Cloud Tasks for all symbols
      const { enqueued: enqueuedCount, failed: failedCount } = await enqueueSymbolJobs(
        runId,
        symbols,
        marketDate,
        runStartedAt,
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
        schedule: RH_AGENT_SCHEDULE_CRON,
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
      schedule: status.schedule || RH_AGENT_SCHEDULE_CRON,
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

