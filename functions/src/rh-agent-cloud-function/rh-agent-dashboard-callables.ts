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
  RH_AGENT_SYMBOLS_COLLECTION,
  RH_AGENT_SIGNAL_DATES_SUBCOLLECTION,
  RhAgentSignalDateDoc,
  RhAgentSignalEntry,
} from './rh-agent-config';

// Response types

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

