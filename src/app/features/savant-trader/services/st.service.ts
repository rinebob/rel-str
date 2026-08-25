/**
 * Savant Trader Agent Service
 *
 * Thin facade that re-exports shared types and delegates to the focused
 * services introduced in T10. Consumers may still inject StService for
 * convenience, or inject the focused services directly.
 */
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  type StStatus,
  type StRun,
  type StSymbolProfile,
  type StSignalItem,
  type ManualRunRequest,
  type ManualRunResponse,
  type MarketCapTier,
  type SignalDirection,
  ST_SCHEDULE_CRON,
  ST_MAX_TRADE_AMOUNT,
} from './types';
import { SignalTimeframe } from '../common/constants';

import { RunService } from './run.service';
import { SignalService } from './signal.service';
import { OverviewService } from './overview.service';

export {
  type StStatus,
  type StRun,
  type StSymbolProfile,
  type StSignalItem,
  type ManualRunRequest,
  type ManualRunResponse,
  type MarketCapTier,
  type SignalDirection,
  ST_SCHEDULE_CRON,
  ST_MAX_TRADE_AMOUNT,
};

@Injectable({
  providedIn: 'root',
})
export class StService {
  private runService = inject(RunService);
  private signalService = inject(SignalService);
  private overviewService = inject(OverviewService);

  triggerBarsBackfill(symbols?: string[]): Observable<{ total: number; enqueued: number; errors: number }> {
    return this.runService.triggerBarsBackfill(symbols);
  }

  triggerManualRun(request: ManualRunRequest = {}): Observable<ManualRunResponse> {
    return this.runService.triggerManualRun(request);
  }

  getStatus(): Observable<StStatus> {
    return this.runService.getStatus();
  }

  getRunHistory(limitCount = 20): Observable<StRun[]> {
    return this.runService.getRunHistory(limitCount);
  }

  watchRecentRunsRealtime(count = 20): Observable<StRun[]> {
    return this.runService.watchRecentRunsRealtime(count);
  }

  getSymbolsWithSignals(runId: string, timeframe: SignalTimeframe): Observable<StSymbolProfile[]> {
    return this.signalService.getSymbolsWithSignals(runId, timeframe);
  }

  getAllSymbols(): Observable<StSymbolProfile[]> {
    return this.signalService.getAllSymbols();
  }

  getSymbolSignalsForRun(symbol: string, runId: string): Observable<StSignalItem[]> {
    return this.signalService.getSymbolSignalsForRun(symbol, runId);
  }

  getSymbolSignalHistoryFromHistory(symbol: string): Observable<StSignalItem[]> {
    return this.signalService.getSymbolSignalHistoryFromHistory(symbol);
  }

  triggerOverviewSync(forceRefresh = true): Observable<{ enqueued: number; skipped: number; total: number }> {
    return this.overviewService.triggerOverviewSync(forceRefresh);
  }
}
