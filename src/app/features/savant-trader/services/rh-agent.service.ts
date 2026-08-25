/**
 * RH Agent Service
 *
 * Thin facade that re-exports shared types and delegates to the focused
 * services introduced in T10. Consumers may still inject RhAgentService for
 * convenience, or inject the focused services directly.
 */
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  type RhAgentStatus,
  type RhAgentRun,
  type RhAgentSymbolProfile,
  type RhAgentSignalItem,
  type ManualRunRequest,
  type ManualRunResponse,
  type MarketCapTier,
  type SignalDirection,
  RH_AGENT_SCHEDULE_CRON,
  RH_AGENT_MAX_TRADE_AMOUNT,
} from './rh-agent.types';
import { SignalTimeframe } from '../common/rh-agent.constants';

import { RhAgentRunService } from './rh-agent-run.service';
import { RhAgentSignalService } from './rh-agent-signal.service';
import { RhAgentOverviewService } from './rh-agent-overview.service';

export {
  type RhAgentStatus,
  type RhAgentRun,
  type RhAgentSymbolProfile,
  type RhAgentSignalItem,
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
export class RhAgentService {
  private runService = inject(RhAgentRunService);
  private signalService = inject(RhAgentSignalService);
  private overviewService = inject(RhAgentOverviewService);

  triggerBarsBackfill(symbols?: string[]): Observable<{ total: number; enqueued: number; errors: number }> {
    return this.runService.triggerBarsBackfill(symbols);
  }

  triggerManualRun(request: ManualRunRequest = {}): Observable<ManualRunResponse> {
    return this.runService.triggerManualRun(request);
  }

  getStatus(): Observable<RhAgentStatus> {
    return this.runService.getStatus();
  }

  getRunHistory(limitCount = 20): Observable<RhAgentRun[]> {
    return this.runService.getRunHistory(limitCount);
  }

  watchRecentRunsRealtime(count = 20): Observable<RhAgentRun[]> {
    return this.runService.watchRecentRunsRealtime(count);
  }

  getSymbolsWithSignals(runId: string, timeframe: SignalTimeframe): Observable<RhAgentSymbolProfile[]> {
    return this.signalService.getSymbolsWithSignals(runId, timeframe);
  }

  getAllSymbols(): Observable<RhAgentSymbolProfile[]> {
    return this.signalService.getAllSymbols();
  }

  getSymbolSignalsForRun(symbol: string, runId: string): Observable<RhAgentSignalItem[]> {
    return this.signalService.getSymbolSignalsForRun(symbol, runId);
  }

  getSymbolSignalHistoryFromHistory(symbol: string): Observable<RhAgentSignalItem[]> {
    return this.signalService.getSymbolSignalHistoryFromHistory(symbol);
  }

  triggerOverviewSync(forceRefresh = true): Observable<{ enqueued: number; skipped: number; total: number }> {
    return this.overviewService.triggerOverviewSync(forceRefresh);
  }
}
