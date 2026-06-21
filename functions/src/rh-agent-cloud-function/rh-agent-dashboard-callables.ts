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
  AGENT_STATUS_DOC,
  RhAgentRunStatus,
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
        .orderBy('priority', 'asc')
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
