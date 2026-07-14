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
  RH_AGENT_SIGNAL_HISTORY_SUBCOLLECTION,
  RH_AGENT_RUN_IDS_SUBCOLLECTION,
  RhAgentSymbolProfile,
} from '../common/rh-agent-collections';
import {
  RhAgentSignalHistoryDoc,
  RhAgentRunIdDoc,
  RhAgentSignalEntry,
} from './rh-agent-signals';

// Response types

/** Response shape for the symbol-with-signals dashboard callable. */
interface SymbolsWithSignalsResponse {
  symbols: RhAgentSymbolProfile[];
}

/** Flat signal item returned by the symbol signal history callable. */
interface SignalItem {
  /** Document ID of the signal-date subcollection doc (barDate). */
  id: string;
  symbol: string;
  barDate: string;
  marketDate: string;
  runId: string;
  timeframe: 'D' | 'W' | 'M';
  direction: string;
  signalType: string;
  status: 'INTERIM' | 'CONFIRMED';
  indicators: Record<string, number | string | null>;
}

/** Response shape for the symbol signal history callable. */
interface SymbolSignalHistoryResponse {
  symbol: string;
  timeframe: 'D' | 'W' | 'M';
  signals: SignalItem[];
}

/**
 * Primary review page query — run-centric path.
 * Returns enabled rh-agent-symbols docs that have a signal doc under run-ids/{runId}.
 * Queries the run-ids subcollection via collection group filtered by runId.
 * Includes all company overview fields for grouping/sorting in the UI.
 */
export const rhAgentGetSymbolsWithSignals = onCall<
  { runId: string; timeframe: 'W' | 'D' },
  Promise<SymbolsWithSignalsResponse>
>(
  {
    cors: true,
    memory: '256MiB',
    invoker: 'public',
  },
  async (request) => {
    try {
      const { runId, timeframe } = request.data;
      if (!runId || !timeframe) {
        throw new Error('runId and timeframe are required');
      }

      // Query all run-ids/{runId} docs across all symbols via collection group.
      // Each doc that exists for this runId means that symbol had signals on this run.
      const runIdSnapshot = await db
        .collectionGroup(RH_AGENT_RUN_IDS_SUBCOLLECTION)
        .where('runId', '==', runId)
        .get();

      // Extract symbol names from the matched run-id docs
      const symbolsWithSignals = new Set(
        runIdSnapshot.docs
          .map((doc) => (doc.data() as RhAgentRunIdDoc).symbol)
          .filter(Boolean)
      );

      if (symbolsWithSignals.size === 0) {
        logger.info('rh_agent_get_symbols_with_signals', { runId, timeframe, count: 0 });
        return { symbols: [] };
      }

      // Fetch symbol profile docs for the matched symbols (in batches of 30 for Firestore 'in' limit)
      const symbolArray = Array.from(symbolsWithSignals);
      const batches: Promise<FirebaseFirestore.QuerySnapshot>[] = [];
      for (let i = 0; i < symbolArray.length; i += 30) {
        batches.push(
          db.collection(RH_AGENT_SYMBOLS_COLLECTION)
            .where('enabled', '==', true)
            .where('symbol', 'in', symbolArray.slice(i, i + 30))
            .get()
        );
      }
      const batchResults = await Promise.all(batches);
      const allDocs = batchResults.flatMap((snap) => snap.docs);

      const symbols: RhAgentSymbolProfile[] = allDocs.map((doc) => {
        const d = doc.data();
        return {
          symbol: d.symbol || doc.id,
          enabled: d.enabled ?? true,
          createdAt: d.createdAt?.toDate?.()?.toISOString() ?? d.createdAt ?? '',
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

      logger.info('rh_agent_get_symbols_with_signals', { runId, timeframe, count: symbols.length });

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
        .collection(RH_AGENT_SIGNAL_HISTORY_SUBCOLLECTION)
        .get();

      const signals: SignalItem[] = [];
      for (const doc of snapshot.docs) {
        const d = doc.data() as RhAgentSignalHistoryDoc;
        for (const entry of Object.values(d.signals ?? {}) as (RhAgentSignalEntry & { sourceRunId: string })[]) {
          signals.push({
            id: doc.id,
            symbol: d.symbol,
            barDate: entry.barDate,
            marketDate: entry.marketDate,
            runId: entry.sourceRunId,
            timeframe: entry.timeframe,
            direction: entry.direction as string,
            signalType: entry.signalType as string,
            status: entry.status,
            indicators: entry.indicators || {},
          });
        }
      }
      signals.sort((a, b) => b.barDate.localeCompare(a.barDate));

      // Limit to the most recent `days` bar dates
      const distinctBarDates = Array.from(new Set(signals.map((s) => s.barDate))).sort(
        (a, b) => b.localeCompare(a)
      );
      const keepDates = new Set(distinctBarDates.slice(0, days));
      const filteredSignals = signals.filter((s) => keepDates.has(s.barDate));

      logger.info('rh_agent_get_symbol_signal_history', {
        symbol, timeframe, days, count: filteredSignals.length,
      });

      return { symbol, timeframe, signals: filteredSignals };
    } catch (error: any) {
      logger.error('rh_agent_get_symbol_signal_history_error', { error: error?.message });
      throw new Error(`Failed to get signal history: ${error?.message}`);
    }
  }
);

