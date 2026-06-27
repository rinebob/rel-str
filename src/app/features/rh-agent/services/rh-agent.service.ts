/**
 * RH Agent Service
 *
 * Angular service for interacting with the Robinhood Trading Agent Cloud Functions.
 * Provides methods to trigger manual runs, view status, and query signal history.
 */
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, collection, collectionData, query, where, orderBy, limit, doc, getDocs } from '@angular/fire/firestore';
import { Observable, from, map } from 'rxjs';

/**
 * Cron expression for the RH Agent daily scheduler (UTC).
 * ⚠️ Must stay in sync with the `schedule` field in:
 *    functions/src/rh-agent-cloud-function/rh-agent-scheduler.ts → rhAgentDailyScheduler
 */
export const RH_AGENT_SCHEDULE_CRON = '0 20 * * 1-5'; // 8 PM UTC = 12 PM PT, Mon-Fri

/**
 * Maximum dollar amount per trade to prevent oversized positions.
 * Applies to both single trades and batch allocation calculations.
 */
export const RH_AGENT_MAX_TRADE_AMOUNT = 100;

export interface RhAgentStatus {
  isEnabled: boolean;
  lastRunAt?: string;
  lastRunStatus?: string;
  totalRuns: number;
  totalSignalsGenerated: number;
  symbolsMonitored: string[];  // Always defined, empty array if none
  schedule?: string;
}

export interface RhAgentRun {
  id: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  strategy?: string;
  marketDate?: string;
  symbolsProcessed?: number;
  totalSymbols?: number;
  processedCount?: number;
  signalsGenerated?: number;
  summary?: string;
  triggeredBy?: 'manual' | 'pdr' | 'nightly';
}

/** Market cap tiers derived from SA overview data. */
export type MarketCapTier = 'mega' | 'large' | 'mid' | 'small' | 'micro';

/** Direction of a signal entry. */
export type SignalDirection = 'LONG' | 'SHORT';

/**
 * Symbol profile returned by rhAgentGetSymbolsWithSignals.
 * Includes config fields and company overview (after Phase 1 sync).
 */
export interface RhAgentSymbolProfile {
  symbol: string;
  enabled: boolean;
  addedAt: string;
  lastAnalyzedAt?: string;
  lastDailySignalDate?: string;
  lastWeeklySignalDate?: string;
  lastDailySignalDirection?: string;
  lastWeeklySignalDirection?: string;
  // Company overview (populated by Phase 1 SA sync)
  name?: string;
  sector?: string;
  industry?: string;
  exchange?: string;
  marketCap?: number;
  marketCapTier?: MarketCapTier;
  beta?: number;
  peRatio?: number;
  week52High?: number;
  week52Low?: number;
  ma200?: number;
  ma50?: number;
  dividendYield?: number;
}

/**
 * A single signal entry returned by rhAgentGetSymbolSignalHistory.
 * Sourced from rh-agent-symbols/{symbol}/signal-dates/{barDate}.signals map.
 */
export interface RhAgentSignalItem {
  id: string;                            // barDate (doc ID)
  symbol: string;
  barDate: string;                       // YYYY-MM-DD — the bar that fired
  marketDate: string;                    // YYYY-MM-DD — the run date
  runId: string;
  timeframe: 'D' | 'W';
  direction: SignalDirection;
  signalType: string;
  status: 'INTERIM' | 'CONFIRMED';
  indicators: Record<string, number | string | null>;
}

export interface ManualRunRequest {
  symbols?: string[]; // Optional: specific symbols to run, or all enabled
  strategy?: string; // Optional: specific strategy to run
  date?: string;     // Optional: override market date (YYYY-MM-DD)
}

export interface ManualRunResponse {
  runId: string;
  status: string;
  totalSymbols: number;
  enqueued: number;
  failed: number;
  message: string;
}

@Injectable({
  providedIn: 'root',
})
export class RhAgentService {
  private functions = inject(Functions);
  private firestore = inject(Firestore);

  private readonly symbolsWithSignalsCallable = httpsCallable<
    { marketDate: string; timeframe: 'W' | 'D' },
    { symbols: RhAgentSymbolProfile[] }
  >(this.functions, 'rhAgentGetSymbolsWithSignals');

  private readonly symbolSignalHistoryCallable = httpsCallable<
    { symbol: string; timeframe: 'W' | 'D'; days: number },
    { symbol: string; timeframe: 'W' | 'D'; signals: RhAgentSignalItem[] }
  >(this.functions, 'rhAgentGetSymbolSignalHistory');

  // Collection references for realtime data
  private readonly runsCollection = 'rh-agent-runs';
  private readonly statusDoc = 'rh-agent-status/current';

  /**
   * Trigger rs-bars backfill via rsBarsSyncAdmin callable.
   */
  triggerBarsBackfill(symbols?: string[]): Observable<any> {
    const callable = httpsCallable<any, any>(this.functions, 'rsBarsSyncAdmin');
    return from(callable({ forceFullFetch: true, ...(symbols?.length ? { symbols } : {}) })).pipe(map(r => r.data));
  }

  /**
   * Trigger a manual agent run.
   */
  triggerManualRun(request: ManualRunRequest = {}): Observable<ManualRunResponse> {
    const callable = httpsCallable<ManualRunRequest, ManualRunResponse>(
      this.functions,
      'rhAgentManualRun'
    );
    return from(callable(request)).pipe(map((result) => result.data));
  }

  /**
   * Get the current agent status.
   */
  getStatus(): Observable<RhAgentStatus> {
    const callable = httpsCallable<void, RhAgentStatus>(
      this.functions,
      'rhAgentGetStatus'
    );
    return from(callable()).pipe(map((result) => result.data));
  }

  /**
   * Get recent run history.
   */
  getRunHistory(limitCount = 20): Observable<RhAgentRun[]> {
    const callable = httpsCallable<{ limit: number }, { runs: RhAgentRun[] }>(
      this.functions,
      'rhAgentGetRunHistory'
    );
    return from(callable({ limit: limitCount })).pipe(map((result) => result.data.runs));
  }

  /**
   * Subscribe to recent runs from Firestore (realtime updates).
   */
  watchRecentRunsRealtime(count = 20): Observable<RhAgentRun[]> {
    const runsRef = collection(this.firestore, this.runsCollection);
    const runsQuery = query(runsRef, orderBy('startedAt', 'desc'), limit(count));
    return collectionData(runsQuery, { idField: 'id' }) as Observable<RhAgentRun[]>;
  }

  /**
   * Primary grouped review query.
   * Returns symbol profiles with a signal on the given marketDate for the given timeframe.
   */
  getSymbolsWithSignals(marketDate: string, timeframe: 'W' | 'D'): Observable<RhAgentSymbolProfile[]> {
    return from(this.symbolsWithSignalsCallable({ marketDate, timeframe })).pipe(map((r) => r.data.symbols));
  }

  /**
   * All enabled tracked symbols — direct Firestore read, no callable.
   * Used for the "Show all symbols" toggle in grouped review.
   */
  getAllSymbols(): Observable<RhAgentSymbolProfile[]> {
    const ref = collection(this.firestore, 'rh-agent-symbols');
    const q = query(ref, where('enabled', '==', true));
    return (collectionData(q, { idField: 'symbol' }) as Observable<any[]>).pipe(
      map(docs => docs.map(d => ({
        symbol: d.symbol,
        enabled: d.enabled ?? true,
        addedAt: d.addedAt?.toDate?.()?.toISOString() ?? '',
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
      } as RhAgentSymbolProfile)))
    );
  }

  /**
   * Per-symbol signal history for the detail panel.
   * Reads directly from Firestore: rh-agent-symbols/{symbol}/signal-dates/*
   * Returns all signals across all bar dates, sorted by barDate desc.
   */
  getSymbolSignalHistory(
    symbol: string,
    _timeframe?: 'W' | 'D',
    _days?: number
  ): Observable<RhAgentSignalItem[]> {
    const symbolDocRef = doc(this.firestore, 'rh-agent-symbols', symbol);
    const signalDatesRef = collection(symbolDocRef, 'signal-dates');

    return from(getDocs(signalDatesRef)).pipe(
      map((snapshot) => {
        const signals: RhAgentSignalItem[] = [];
        for (const docSnap of snapshot.docs) {
          const d = docSnap.data();

          // Extract signal entries. Firestore may return:
          // (a) Nested map: d['signals'] = { W_ZONE_V1_UPTICK: {...} }
          // (b) Dot-notation keys: d['signals.W_ZONE_V1_UPTICK'] = {...}
          const entries: any[] = [];

          // Case (a): nested signals map
          if (d['signals'] && typeof d['signals'] === 'object') {
            entries.push(...Object.values(d['signals']));
          }

          // Case (b): dot-notation keys (signals.SIGNAL_TYPE as top-level keys)
          for (const key of Object.keys(d)) {
            if (key.startsWith('signals.') && typeof d[key] === 'object') {
              entries.push(d[key]);
            }
          }

          for (const entry of entries) {
            if (!entry || !entry.signalType) continue;
            signals.push({
              id: docSnap.id,
              symbol: d['symbol'] ?? symbol,
              barDate: entry.barDate ?? docSnap.id,
              marketDate: entry.marketDate ?? '',
              runId: d['runId'] ?? '',
              timeframe: entry.timeframe,
              direction: entry.direction,
              signalType: entry.signalType,
              status: entry.status ?? 'CONFIRMED',
              indicators: entry.indicators ?? {},
            });
          }
        }
        signals.sort((a, b) => b.barDate.localeCompare(a.barDate));
        return signals;
      })
    );
  }

  /**
   * Trigger the company overview backfill (Phase 1).
   * Enqueues one Cloud Task per enabled symbol to fetch SA overview data.
   */
  triggerOverviewSync(forceRefresh = true): Observable<{ enqueued: number; skipped: number; total: number }> {
    const callable = httpsCallable<
      { forceRefresh: boolean },
      { enqueued: number; skipped: number; total: number }
    >(this.functions, 'rhAgentOverviewSyncAdmin');
    return from(callable({ forceRefresh })).pipe(map((r) => r.data));
  }

}
