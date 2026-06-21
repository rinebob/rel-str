/**
 * RH Agent Service
 *
 * Angular service for interacting with the Robinhood Trading Agent Cloud Functions.
 * Provides methods to trigger manual runs, view status, and query signal history.
 */
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, collection, collectionData, query, orderBy, limit } from '@angular/fire/firestore';
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
  opportunitiesFound?: number;
  summary?: string;
  triggeredBy?: 'manual' | 'schedule';
}

export interface RhTradeSignal {
  id: string;
  runId: string;
  symbol: string;
  action: string;
  status: string;
  reason: string;
  createdAt: string;
  dryRun?: boolean;
  confidence?: number;
  signalType?: string;
  tradeDirection?: 'LONG' | 'SHORT';
  indicators?: {
    rsi?: number;
    priceChange?: number;
    currentPrice?: number;
  };
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

  // Collection references for realtime data
  private readonly runsCollection = 'rh-agent-runs';
  private readonly opportunitiesCollection = 'rh-agent-opportunities';
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
   * Normalize signals from the backend, deriving tradeDirection from action.
   */
  private normalizeSignals(signals: RhTradeSignal[]): RhTradeSignal[] {
    return signals.map(signal => ({
      ...signal,
      tradeDirection: signal.action === 'OPEN_SHORT' ? 'SHORT' : 'LONG',
    }));
  }

  /**
   * Get recent signal history.
   */
  getSignalHistory(limitCount = 50): Observable<RhTradeSignal[]> {
    const callable = httpsCallable<{ limit: number }, { signals: RhTradeSignal[] }>(
      this.functions,
      'rhAgentGetSignalHistory'
    );
    return from(callable({ limit: limitCount })).pipe(
      map((result) => this.normalizeSignals(result.data.signals))
    );
  }

  /**
   * Get signals for a specific run.
   */
  getSignalsForRun(runId: string): Observable<RhTradeSignal[]> {
    const callable = httpsCallable<{ runId: string }, { signals: RhTradeSignal[] }>(
      this.functions,
      'rhAgentGetSignalHistory'
    );
    return from(callable({ runId })).pipe(map((result) => this.normalizeSignals(result.data.signals)));
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
   * Subscribe to recent opportunities from Firestore (realtime updates).
   */
  watchRecentOpportunitiesRealtime(count = 50): Observable<RhTradeSignal[]> {
    const opportunitiesRef = collection(this.firestore, this.opportunitiesCollection);
    const opportunitiesQuery = query(
      opportunitiesRef,
      orderBy('createdAt', 'desc'),
      limit(count)
    );
    return (collectionData(opportunitiesQuery, { idField: 'id' }) as Observable<
      RhTradeSignal[]
    >).pipe(map(signals => this.normalizeSignals(signals)));
  }
}
