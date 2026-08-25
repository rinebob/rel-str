/**
 * Savant Trader Agent Service
 *
 * Thin facade that re-exports shared types and delegates to the focused
 * services introduced in T10. Consumers may still inject AgentService for
 * convenience, or inject the focused services directly.
 */
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  type AgentStatus,
  type AgentRun,
  type AgentSymbolProfile,
  type AgentSignalItem,
  type ManualRunRequest,
  type ManualRunResponse,
  type MarketCapTier,
  type SignalDirection,
  RH_AGENT_SCHEDULE_CRON,
  RH_AGENT_MAX_TRADE_AMOUNT,
} from './types';
import { SignalTimeframe } from '../common/constants';

import { RunService } from './run.service';
import { SignalService } from './signal.service';
import { OverviewService } from './overview.service';

export {
  type AgentStatus,
  type AgentRun,
  type AgentSymbolProfile,
  type AgentSignalItem,
  type ManualRunRequest,
  type ManualRunResponse,
  type MarketCapTier,
  type SignalDirection,
  RH_AGENT_SCHEDULE_CRON,
  RH_AGENT_MAX_TRADE_AMOUNT,
};

@Injectable({
  providedIn: 'root',
})
export class AgentService {
  private runService = inject(RunService);
  private signalService = inject(SignalService);
  private overviewService = inject(OverviewService);

  triggerBarsBackfill(symbols?: string[]): Observable<{ total: number; enqueued: number; errors: number }> {
    return this.runService.triggerBarsBackfill(symbols);
  }

  triggerManualRun(request: ManualRunRequest = {}): Observable<ManualRunResponse> {
    return this.runService.triggerManualRun(request);
  }

  getStatus(): Observable<AgentStatus> {
    return this.runService.getStatus();
  }

  getRunHistory(limitCount = 20): Observable<AgentRun[]> {
    return this.runService.getRunHistory(limitCount);
  }

  watchRecentRunsRealtime(count = 20): Observable<AgentRun[]> {
    return this.runService.watchRecentRunsRealtime(count);
  }

  getSymbolsWithSignals(runId: string, timeframe: SignalTimeframe): Observable<AgentSymbolProfile[]> {
    return this.signalService.getSymbolsWithSignals(runId, timeframe);
  }

  getAllSymbols(): Observable<AgentSymbolProfile[]> {
    return this.signalService.getAllSymbols();
  }

  getSymbolSignalsForRun(symbol: string, runId: string): Observable<AgentSignalItem[]> {
    return this.signalService.getSymbolSignalsForRun(symbol, runId);
  }

  getSymbolSignalHistoryFromHistory(symbol: string): Observable<AgentSignalItem[]> {
    return this.signalService.getSymbolSignalHistoryFromHistory(symbol);
  }

  triggerOverviewSync(forceRefresh = true): Observable<{ enqueued: number; skipped: number; total: number }> {
    return this.overviewService.triggerOverviewSync(forceRefresh);
  }
}
