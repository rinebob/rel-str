/**
 * ST Dashboard Callables
 *
 * Simplified callable functions for the frontend dashboard.
 * No MCP/Robinhood dependencies - just Firestore queries.
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db } from '../firebase-admin-init';

import {
  ST_SYMBOLS_ROOT,
  ST_SIGNALS_ROOT,
  StSymbolProfile,
} from '../common/st-collections';
import type { StSignal } from '@st/signals';

// Response types

/** Response shape for the symbol-with-signals dashboard callable. */
interface SymbolsWithSignalsResponse {
  symbols: StSymbolProfile[];
}

/** Flat signal item returned by the symbol signal history callable. */
interface SignalItem {
  /** st-signals occurrence doc id ({SYM}_{barDate}_{signalType}). */
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
 * Returns enabled symbol docs that have an st-signals occurrence carrying
 * runId in runIds[] (the set the legacy run-ids collection-group query
 * produced — #1019). Includes all company overview fields for
 * grouping/sorting in the UI.
 */
export const stGetSymbolsWithSignals = onCall<
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

      // Canonical run-centric lookup (#1019): every st-signals occurrence the
      // run (re)detected carries runId in runIds[] — the distinct symbols are
      // the set the legacy run-ids collection-group query produced.
      const runIdSnapshot = await db
        .collection(ST_SIGNALS_ROOT)
        .where('runIds', 'array-contains', runId)
        .get();

      const symbolsWithSignals = new Set(
        runIdSnapshot.docs
          .map((doc) => (doc.data() as StSignal).symbol)
          .filter(Boolean)
      );

      if (symbolsWithSignals.size === 0) {
        logger.info('st_get_symbols_with_signals', { runId, timeframe, count: 0 });
        return { symbols: [] };
      }

      // Fetch symbol profile docs for the matched symbols (in batches of 30 for Firestore 'in' limit)
      const symbolArray = Array.from(symbolsWithSignals);
      const batches: Promise<FirebaseFirestore.QuerySnapshot>[] = [];
      for (let i = 0; i < symbolArray.length; i += 30) {
        batches.push(
          db.collection(ST_SYMBOLS_ROOT)
            .where('enabled', '==', true)
            .where('symbol', 'in', symbolArray.slice(i, i + 30))
            .get()
        );
      }
      const batchResults = await Promise.all(batches);
      const allDocs = batchResults.flatMap((snap) => snap.docs);

      const symbols: StSymbolProfile[] = allDocs.map((doc) => {
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

      logger.info('st_get_symbols_with_signals', { runId, timeframe, count: symbols.length });

      return { symbols };
    } catch (error: any) {
      logger.error('st_get_symbols_with_signals_error', { error: error?.message });
      throw new Error(`Failed to get symbols with signals: ${error?.message}`);
    }
  }
);

/**
 * Returns signal history for a single symbol from st-signals (#1019 —
 * includes INTERIM occurrences the legacy signal-history path never
 * carried). Used by the detail panel when a symbol row is selected.
 * Returns signals from the last `days` trading days (default 14).
 */
export const stGetSymbolSignalHistory = onCall<
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

      // Canonical flat occurrences (#1019) — supersedes the nightly-only
      // signal-history subcollection read and adds INTERIM coverage.
      const snapshot = await db
        .collection(ST_SIGNALS_ROOT)
        .where('symbol', '==', symbol)
        .get();

      const signals: SignalItem[] = [];
      for (const doc of snapshot.docs) {
        const d = doc.data() as StSignal;
        signals.push({
          id: doc.id,
          symbol: d.symbol,
          barDate: d.barDate,
          marketDate: d.marketDate,
          runId: d.sourceRunId,
          timeframe: d.timeframe,
          direction: String(d.direction ?? '').toUpperCase(),
          signalType: d.signalType,
          status: d.status,
          indicators: d.indicators || {},
        });
      }
      signals.sort((a, b) => b.barDate.localeCompare(a.barDate));

      // Limit to the most recent `days` bar dates
      const distinctBarDates = Array.from(new Set(signals.map((s) => s.barDate))).sort(
        (a, b) => b.localeCompare(a)
      );
      const keepDates = new Set(distinctBarDates.slice(0, days));
      const filteredSignals = signals.filter((s) => keepDates.has(s.barDate));

      logger.info('st_get_symbol_signal_history', {
        symbol, timeframe, days, count: filteredSignals.length,
      });

      return { symbol, timeframe, signals: filteredSignals };
    } catch (error: any) {
      logger.error('st_get_symbol_signal_history_error', { error: error?.message });
      throw new Error(`Failed to get signal history: ${error?.message}`);
    }
  }
);
