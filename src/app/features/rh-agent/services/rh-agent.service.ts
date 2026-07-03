/**
 * RH Agent Service
 *
 * Angular service for interacting with the Robinhood Trading Agent Cloud Functions.
 * Provides methods to trigger manual runs, view status, and query signal history.
 */
import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, collection, collectionData, query, where, orderBy, limit, doc, getDocs, getDoc } from '@angular/fire/firestore';
import { Observable, from, map } from 'rxjs';

/**
 * Cron expression for the RH Agent daily scheduler (UTC).
 * ⚠️ Must stay in sync with the scheduled run logic in:
 *    functions/src/rh-agent-cloud-function/rh-agent-trigger.ts → rhAgentPdrTrigger
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
  private injector = inject(EnvironmentInjector);

  private readonly symbolsWithSignalsCallable = httpsCallable<
    { runId: string; timeframe: 'W' | 'D' },
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
  triggerBarsBackfill(symbols?: string[]): Observable<{ total: number; enqueued: number; errors: number }> {
    const callable = httpsCallable<
      { forceFullFetch: true; symbols?: string[] },
      { total: number; enqueued: number; errors: number }
    >(this.functions, 'rsBarsSyncAdmin');
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
   * Fetch the current intraday price for a single symbol.
   * Returns ip: null if SA has no data (outside market hours, unknown symbol, etc.).
   */
  getIntradaySnapshot$(symbol: string): Observable<{ symbol: string; ip: number | null; marketDate: string }> {
    const callable = httpsCallable<{ symbol: string }, { symbol: string; ip: number | null; marketDate: string }>(
      this.functions,
      'rhAgentGetIntradaySnapshot'
    );
    return from(callable({ symbol })).pipe(map(result => result.data));
  }

  /**
   * Subscribe to recent runs from Firestore (realtime updates).
   * Maps Firestore Timestamps to ISO strings so consumers receive plain RhAgentRun objects.
   */
  watchRecentRunsRealtime(count = 20): Observable<RhAgentRun[]> {
    const runsRef = collection(this.firestore, this.runsCollection);
    const runsQuery = query(runsRef, orderBy('startedAt', 'desc'), limit(count));
    return (collectionData(runsQuery, { idField: 'id' }) as Observable<any[]>).pipe(
      map(docs => docs.map(d => ({
        id: d['id'],
        status: d['status'] ?? '',
        startedAt: d['startedAt']?.toDate?.()?.toISOString?.() ?? d['startedAt'] ?? '',
        completedAt: d['completedAt']?.toDate?.()?.toISOString?.() ?? d['completedAt'],
        marketDate: d['marketDate'],
        triggeredBy: d['triggeredBy'],
        totalSymbols: d['totalSymbols'],
        processedCount: d['processedCount'] ?? d['symbolsProcessed'],
        symbolsProcessed: d['symbolsProcessed'],
        signalsGenerated: d['signalsGenerated'],
        summary: d['summary'],
        strategy: d['strategy'],
      } as RhAgentRun)))
    );
  }

  /**
   * Primary grouped review query — run-centric.
   * Returns symbol profiles with a signal produced by the given runId for the given timeframe.
   */
  getSymbolsWithSignals(runId: string, timeframe: 'W' | 'D'): Observable<RhAgentSymbolProfile[]> {
    return from(this.symbolsWithSignalsCallable({ runId, timeframe })).pipe(map((r) => r.data.symbols));
  }

  /**
   * All enabled tracked symbols — direct Firestore read, no callable.
   * Used for the "Show all symbols" toggle in grouped review.
   */
  getAllSymbols(): Observable<RhAgentSymbolProfile[]> {
    const ref = collection(this.firestore, 'rh-agent-symbols');
    const q = query(ref, where('enabled', '==', true));
    // Raw Firestore docs contain Timestamp fields; we map them to strings below.
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
   *
   * @param symbol Symbol to query.
   * @param _timeframe Reserved for future filtering (currently ignored).
   * @param _days Reserved for future filtering (currently ignored).
   */
  getSymbolSignalHistory(
    symbol: string,
    _timeframe?: 'W' | 'D',
    _days?: number
  ): Observable<RhAgentSignalItem[]> {
    const symbolDocRef = doc(this.firestore, 'rh-agent-symbols', symbol);
    const signalDatesRef = collection(symbolDocRef, 'signal-dates');

    return from(runInInjectionContext(this.injector, () => getDocs(signalDatesRef))).pipe(
      map((snapshot) => {
        const signals: RhAgentSignalItem[] = [];
        for (const docSnap of snapshot.docs) {
          const d = docSnap.data();

          // Extract signal entries. Firestore may return:
          // (a) Nested map: d['signals'] = { W_ZONE_V1_UPTICK: {...} }
          // (b) Dot-notation keys: d['signals.W_ZONE_V1_UPTICK'] = {...}
          const rawSignalEntry = (entry: unknown): Partial<RhAgentSignalItem> | null => {
            if (!entry || typeof entry !== 'object') return null;
            const e = entry as Record<string, unknown>;
            if (!e['signalType'] || typeof e['signalType'] !== 'string') return null;
            return e as Partial<RhAgentSignalItem>;
          };

          const entries: Partial<RhAgentSignalItem>[] = [];

          // Case (a): nested signals map
          if (d['signals'] && typeof d['signals'] === 'object') {
            for (const entry of Object.values(d['signals'])) {
              const parsed = rawSignalEntry(entry);
              if (parsed) entries.push(parsed);
            }
          }

          // Case (b): dot-notation keys (signals.SIGNAL_TYPE as top-level keys)
          for (const key of Object.keys(d)) {
            if (key.startsWith('signals.') && typeof d[key] === 'object') {
              const parsed = rawSignalEntry(d[key]);
              if (parsed) entries.push(parsed);
            }
          }

          for (const entry of entries) {
            signals.push({
              id: docSnap.id,
              symbol: d['symbol'] ?? symbol,
              barDate: entry.barDate ?? docSnap.id,
              marketDate: entry.marketDate ?? '',
              runId: d['runId'] ?? '',
              timeframe: entry.timeframe ?? 'D',
              direction: entry.direction ?? 'LONG',
              signalType: entry.signalType!,
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
   * Signals for a specific run from rh-agent-symbols/{symbol}/run-ids/{runId}.
   * Used by grouped review to show only the signals produced by the active run.
   */
  getSymbolSignalsForRun(symbol: string, runId: string): Observable<RhAgentSignalItem[]> {
    const runDocRef = doc(this.firestore, 'rh-agent-symbols', symbol, 'run-ids', runId);
    return from(runInInjectionContext(this.injector, () => getDoc(runDocRef))).pipe(
      map((snap: any) => {
        if (!snap.exists()) return [];
        const d = snap.data();
        const signals: RhAgentSignalItem[] = [];

        // Signals are stored as dot-notation top-level fields: signals.D_ZONE_V1, signals.W_ZONE_V2 etc.
        for (const key of Object.keys(d)) {
          if (!key.startsWith('signals.')) continue;
          const entry = d[key];
          if (!entry || typeof entry !== 'object') continue;
          if (!entry['signalType']) continue;
          signals.push({
            id:         entry['barDate']    ?? runId,
            symbol,
            barDate:    entry['barDate']    ?? '',
            marketDate: entry['marketDate'] ?? d['marketDate'] ?? '',
            runId,
            timeframe:  entry['timeframe']  ?? 'D',
            direction:  entry['direction']  ?? 'LONG',
            signalType: entry['signalType'],
            status:     entry['status']     ?? 'INTERIM',
            indicators: entry['indicators'] ?? {},
          });
        }
        signals.sort((a, b) => b.barDate.localeCompare(a.barDate));
        return signals;
      })
    );
  }

  /**
   * Per-symbol signal history from the canonical signal-history subcollection.
   * Reads directly from Firestore: rh-agent-symbols/{symbol}/signal-history/*
   * Returns all signals sorted by barDate desc.
   */
  getSymbolSignalHistoryFromHistory(symbol: string): Observable<RhAgentSignalItem[]> {
    const symbolDocRef = doc(this.firestore, 'rh-agent-symbols', symbol);
    const signalHistoryRef = collection(symbolDocRef, 'signal-history');

    const recentQuery = query(signalHistoryRef, orderBy('date', 'desc'));
    return from(runInInjectionContext(this.injector, () => getDocs(recentQuery))).pipe(
      map((snapshot) => {
        const signals: RhAgentSignalItem[] = [];
        for (const docSnap of snapshot.docs) {
          const d = docSnap.data();

          const rawSignalEntry = (entry: unknown): Partial<RhAgentSignalItem> | null => {
            if (!entry || typeof entry !== 'object') return null;
            const e = entry as Record<string, unknown>;
            if (!e['signalType'] || typeof e['signalType'] !== 'string') return null;
            return e as Partial<RhAgentSignalItem>;
          };

          const entries: Partial<RhAgentSignalItem>[] = [];

          if (d['signals'] && typeof d['signals'] === 'object') {
            for (const entry of Object.values(d['signals'])) {
              const parsed = rawSignalEntry(entry);
              if (parsed) entries.push(parsed);
            }
          }

          for (const key of Object.keys(d)) {
            if (key.startsWith('signals.') && typeof d[key] === 'object') {
              const parsed = rawSignalEntry(d[key]);
              if (parsed) entries.push(parsed);
            }
          }

          for (const entry of entries) {
            signals.push({
              id: docSnap.id,
              symbol: d['symbol'] ?? symbol,
              barDate: entry.barDate ?? docSnap.id,
              marketDate: entry.marketDate ?? '',
              runId: d['sourceRunId'] ?? d['runId'] ?? '',
              timeframe: entry.timeframe ?? (String(entry.signalType ?? '').startsWith('W_') ? 'W' : 'D'),
              direction: (entry as any).action ?? entry.direction ?? 'LONG',
              signalType: entry.signalType!,
              status: 'CONFIRMED',
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
