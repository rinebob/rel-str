/**
 * RH Agent Dashboard Callables
 *
 * Simplified callable functions for the frontend dashboard.
 * No MCP/Robinhood dependencies - just Firestore queries.
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db } from '../firebase-admin-init';

import {
  RH_AGENT_RUNS_COLLECTION,
  RH_AGENT_STATUS_COLLECTION,
  RH_AGENT_OPPORTUNITIES_COLLECTION,
  RH_AGENT_SYMBOLS_COLLECTION,
  RH_AGENT_SIGNAL_DATES_SUBCOLLECTION,
  AGENT_STATUS_DOC,
  RhAgentRunStatus,
  RhAgentSignalDateDoc,
  RhAgentSignalEntry,
} from './rh-agent-config';

// Response types
interface AgentStatusResponse {
  isEnabled: boolean;
  lastRunAt?: string;
  lastRunStatus?: RhAgentRunStatus;
  totalRuns: number;
  totalSignalsGenerated: number;
  symbolsMonitored: string[];
  schedule: string;
}

interface RunHistoryResponse {
  runs: Array<{
    id: string;
    status: RhAgentRunStatus;
    startedAt: string;
    completedAt?: string;
    marketDate: string;
    totalSymbols: number;
    processedCount: number;
    successCount: number;
    failureCount: number;
    opportunitiesFound: number;
  }>;
}

interface SignalHistoryResponse {
  signals: Array<{
    id: string;
    runId: string;
    symbol: string;
    action: string;
    status: string;
    reason: string;
    createdAt: string;
  }>;
}

interface OpportunitiesResponse {
  opportunities: Array<{
    id: string;
    runId: string;
    symbol: string;
    strategy: string;
    action: string;
    confidence: number;
    indicators: Record<string, number>;
    createdAt: string;
  }>;
}

interface SymbolProfile {
  symbol: string;
  enabled: boolean;
  addedAt: string;
  lastAnalyzedAt?: string;
  lastDailySignalDate?: string;
  lastWeeklySignalDate?: string;
  // Company overview (populated by Phase 1)
  name?: string;
  sector?: string;
  industry?: string;
  exchange?: string;
  marketCap?: number;
  marketCapTier?: string;
  beta?: number;
  peRatio?: number;
  week52High?: number;
  week52Low?: number;
  ma200?: number;
  ma50?: number;
  dividendYield?: number;
}

interface SymbolsWithSignalsResponse {
  symbols: SymbolProfile[];
}

interface SignalItem {
  id: string;          // barDate
  symbol: string;
  barDate: string;
  marketDate: string;
  runId: string;
  timeframe: 'D' | 'W';
  direction: string;
  signalType: string;
  status: 'INTERIM' | 'CONFIRMED';
  indicators: Record<string, number | string | null>;
}

interface SymbolSignalHistoryResponse {
  symbol: string;
  timeframe: 'D' | 'W';
  signals: SignalItem[];
}

/**
 * Get agent status callable.
 */
export const rhAgentGetStatus = onCall<void, Promise<AgentStatusResponse>>(
  {
    cors: true,
    memory: '256MiB',
    invoker: 'public',
  },
  async () => {
    try {
      // Get status doc
      const doc = await db.collection(RH_AGENT_STATUS_COLLECTION).doc(AGENT_STATUS_DOC).get();

      // Get actual enabled symbols from rh-agent-symbols collection
      const symbolsSnapshot = await db
        .collection(RH_AGENT_SYMBOLS_COLLECTION)
        .where('enabled', '==', true)
        .get();
      const symbolsMonitored = symbolsSnapshot.docs.map((d) => d.data().symbol as string);

      if (!doc.exists) {
        return {
          isEnabled: true,
          totalRuns: 0,
          totalSignalsGenerated: 0,
          symbolsMonitored,
          schedule: '0 20 * * 1-5',
        };
      }

      const data = doc.data()!;

      // Convert timestamps to ISO strings
      const lastRunAt = data.lastRunAt?.toDate?.()?.toISOString();

      return {
        isEnabled: data.isEnabled ?? true,
        lastRunAt,
        lastRunStatus: data.lastRunStatus,
        totalRuns: data.totalRuns ?? 0,
        totalSignalsGenerated: data.totalSignalsGenerated ?? 0,
        symbolsMonitored,
        schedule: data.schedule || '0 20 * * 1-5',
      };
    } catch (error: any) {
      logger.error('rh_agent_get_status_error', { error: error?.message });
      throw new Error(`Failed to get status: ${error?.message}`);
    }
  }
);

/**
 * Get run history callable.
 */
export const rhAgentGetRunHistory = onCall<{ limit?: number }, Promise<RunHistoryResponse>>(
  {
    cors: true,
    memory: '256MiB',
    invoker: 'public',
  },
  async (request) => {
    try {
      const limit = request.data.limit ?? 20;

      const snapshot = await db
        .collection(RH_AGENT_RUNS_COLLECTION)
        .orderBy('startedAt', 'desc')
        .limit(limit)
        .get();

      const runs = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          status: data.status || RhAgentRunStatus.PENDING,
          startedAt: data.startedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
          completedAt: data.completedAt?.toDate?.()?.toISOString(),
          marketDate: data.marketDate || '',
          totalSymbols: data.totalSymbols || 0,
          processedCount: data.processedCount || 0,
          successCount: data.successCount || 0,
          failureCount: data.failureCount || 0,
          opportunitiesFound: data.opportunitiesFound || 0,
        };
      });

      return { runs };
    } catch (error: any) {
      logger.error('rh_agent_get_run_history_error', { error: error?.message });
      throw new Error(`Failed to get run history: ${error?.message}`);
    }
  }
);

/**
 * Get signal history callable.
 */
export const rhAgentGetSignalHistory = onCall<{ limit?: number; runId?: string }, Promise<SignalHistoryResponse>>(
  {
    cors: true,
    memory: '256MiB',
    invoker: 'public',
  },
  async (request) => {
    try {
      const { limit = 50, runId } = request.data;

      let query = db.collection(RH_AGENT_OPPORTUNITIES_COLLECTION).orderBy('createdAt', 'desc');

      if (runId) {
        query = query.where('runId', '==', runId);
      }

      const snapshot = await query.limit(limit).get();

      const signals = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          runId: data.runId || '',
          symbol: data.symbol || '',
          action: data.action || 'OPEN_LONG',
          status: data.status || 'PENDING',
          reason: data.reason || data.signalType || 'Zone uptick signal',
          createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
          confidence: data.confidence || 0,
          signalType: data.signalType || 'D_ZONE_V1_UPTICK',
          indicators: data.indicators || {},
        };
      });

      return { signals };
    } catch (error: any) {
      logger.error('rh_agent_get_signal_history_error', { error: error?.message });
      throw new Error(`Failed to get signal history: ${error?.message}`);
    }
  }
);

/**
 * Primary review page query.
 * Returns enabled rh-agent-symbols docs filtered by lastWeeklySignalDate or
 * lastDailySignalDate matching the given marketDate.
 * Includes all company overview fields for grouping/sorting in the UI.
 */
export const rhAgentGetSymbolsWithSignals = onCall<
  { marketDate: string; timeframe: 'W' | 'D' },
  Promise<SymbolsWithSignalsResponse>
>(
  {
    cors: true,
    memory: '256MiB',
    invoker: 'public',
  },
  async (request) => {
    try {
      const { marketDate, timeframe } = request.data;
      if (!marketDate || !timeframe) {
        throw new Error('marketDate and timeframe are required');
      }

      const dateField = timeframe === 'W' ? 'lastWeeklySignalDate' : 'lastDailySignalDate';

      // Exact match on the requested marketDate.
      // Frontend passes yesterday until intraday bars are wired; then switches to today.
      const snapshot = await db
        .collection(RH_AGENT_SYMBOLS_COLLECTION)
        .where('enabled', '==', true)
        .where(dateField, '==', marketDate)
        .get();

      const symbols: SymbolProfile[] = snapshot.docs.map((doc) => {
        const d = doc.data();
        return {
          symbol: d.symbol || doc.id,
          enabled: d.enabled ?? true,
          addedAt: d.addedAt?.toDate?.()?.toISOString() || '',
          lastAnalyzedAt: d.lastAnalyzedAt?.toDate?.()?.toISOString(),
          lastDailySignalDate: d.lastDailySignalDate,
          lastWeeklySignalDate: d.lastWeeklySignalDate,
          lastDailySignalDirection: d.lastDailySignalDirection,
          lastWeeklySignalDirection: d.lastWeeklySignalDirection,
          name: d.name,
          sector: d.sector,
          industry: d.industry,
          exchange: d.exchange,
          marketCap: d.marketCap,
          marketCapTier: d.marketCapTier,
          beta: d.beta,
          peRatio: d.peRatio,
          week52High: d.week52High,
          week52Low: d.week52Low,
          ma200: d.ma200,
          ma50: d.ma50,
          dividendYield: d.dividendYield,
        };
      });

      logger.info('rh_agent_get_symbols_with_signals', {
        marketDate, timeframe, count: symbols.length,
      });

      return { symbols };
    } catch (error: any) {
      logger.error('rh_agent_get_symbols_with_signals_error', { error: error?.message });
      throw new Error(`Failed to get symbols with signals: ${error?.message}`);
    }
  }
);

/**
 * Returns signal history for a single symbol, filtered by timeframe.
 * Used by the detail panel when a symbol row is selected.
 * Returns signals from the last `days` trading days (default 5).
 */
export const rhAgentGetSymbolSignalHistory = onCall<
  { symbol: string; timeframe: 'W' | 'D'; days?: number },
  Promise<SymbolSignalHistoryResponse>
>(
  {
    cors: true,
    memory: '256MiB',
    invoker: 'public',
  },
  async (request) => {
    try {
      const { symbol, timeframe, days = 14 } = request.data;
      if (!symbol || !timeframe) {
        throw new Error('symbol and timeframe are required');
      }

      const snapshot = await db
        .collection(RH_AGENT_SYMBOLS_COLLECTION)
        .doc(symbol)
        .collection(RH_AGENT_SIGNAL_DATES_SUBCOLLECTION)
        .get();

      const signals: SignalItem[] = [];
      for (const doc of snapshot.docs) {
        const d = doc.data() as RhAgentSignalDateDoc;
        for (const entry of Object.values(d.signals ?? {}) as RhAgentSignalEntry[]) {
          signals.push({
            id: doc.id,
            symbol: d.symbol,
            barDate: entry.barDate,
            marketDate: entry.marketDate,
            runId: d.runId,
            timeframe: entry.timeframe,
            direction: entry.direction as string,
            signalType: entry.signalType as string,
            status: entry.status,
            indicators: entry.indicators || {},
          });
        }
      }
      signals.sort((a, b) => b.barDate.localeCompare(a.barDate));

      logger.info('rh_agent_get_symbol_signal_history', {
        symbol, timeframe, days, count: signals.length,
      });

      return { symbol, timeframe, signals };
    } catch (error: any) {
      logger.error('rh_agent_get_symbol_signal_history_error', { error: error?.message });
      throw new Error(`Failed to get signal history: ${error?.message}`);
    }
  }
);

/**
 * Get opportunities callable.
 */
export const rhAgentGetOpportunities = onCall<{ limit?: number; status?: string }, Promise<OpportunitiesResponse>>(
  {
    cors: true,
    memory: '256MiB',
    invoker: 'public',
  },
  async (request) => {
    try {
      const { limit = 50, status } = request.data;

      let query = db.collection(RH_AGENT_OPPORTUNITIES_COLLECTION).orderBy('createdAt', 'desc');

      if (status) {
        query = query.where('status', '==', status);
      }

      const snapshot = await query.limit(limit).get();

      const opportunities = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          runId: data.runId || '',
          symbol: data.symbol || '',
          strategy: data.strategy || '',
          action: data.action || '',
          confidence: data.confidence || 0,
          indicators: data.indicators || {},
          createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        };
      });

      return { opportunities };
    } catch (error: any) {
      logger.error('rh_agent_get_opportunities_error', { error: error?.message });
      throw new Error(`Failed to get opportunities: ${error?.message}`);
    }
  }
);
