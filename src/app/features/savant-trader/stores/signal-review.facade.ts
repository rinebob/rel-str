/**
 * Signal Review Facade
 *
 * Page-level orchestrator for the grouped signal review. Hides the store
 * boundary from the component so the page only injects this facade plus
 * generic services.
 *
 * The facade owns:
 * - Page enter/leave orchestration (fullscreen, active run selection, load).
 * - Expansion preloading of signal history.
 * - Navigation actions used by the header.
 */
import { computed, effect, inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { RhAgentGroupStore } from './rh-agent-group.store';
import { RhAgentTriageStore } from './rh-agent-triage.store';
import { RhAgentOccurrenceDecisionStore } from './rh-agent-occurrence-decision.store';
import { RhAgentSymbolListStore } from './rh-agent-symbol-list.store';
import { RhAgentSymbolHistoryStore } from './rh-agent-symbol-history.store';
import { RhAgentStore } from './rh-agent.store';
import { SignalReviewUiStore } from './signal-review-ui.store';
import { SignalService } from '../services/signal.service';
import type { AgentSignalItem } from '../services/types';
import { UiStateService } from '../../../core/services/ui-state.service';
import { ScrollTargetService } from '../services/scroll-target.service';
import {
  GroupDimension,
  RhSymbolListName,
  SignalTimeframe,
  SignalDirection,
  ReviewDecision,
} from '../common/constants';
import type { AgentRun } from '../services/types';

@Injectable({ providedIn: 'root' })
export class SignalReviewFacade {
  private readonly groupStore = inject(RhAgentGroupStore);
  private readonly triageStore = inject(RhAgentTriageStore);
  private readonly occurrenceStore = inject(RhAgentOccurrenceDecisionStore);
  private readonly symbolListStore = inject(RhAgentSymbolListStore);
  private readonly historyStore = inject(RhAgentSymbolHistoryStore);
  private readonly signalService = inject(SignalService);
  private readonly uiStore = inject(SignalReviewUiStore);
  private readonly agentStore = inject(RhAgentStore);
  private readonly uiState = inject(UiStateService);
  private readonly scrollTarget = inject(ScrollTargetService);
  private readonly router = inject(Router);

  /** Grouped, filtered rows. */
  readonly groups = computed(() => this.groupStore.groups());

  /** Loading and error state for the main symbol list. */
  readonly symbolsLoading = computed(() => this.groupStore.symbolsLoading());
  readonly symbolsError = computed(() => this.groupStore.symbolsError());

  /** Header counts. */
  readonly totalSignalCount = computed(() => this.groupStore.totalSignalCount());
  readonly weeklySignalCount = computed(() => this.groupStore.weeklySignalCount());
  readonly dailySignalCount = computed(() => this.groupStore.dailySignalCount());
  readonly longCount = computed(() => this.groupStore.longCount());
  readonly shortCount = computed(() => this.groupStore.shortCount());

  /** Group/list selection. */
  readonly groupDimension = computed(() => this.groupStore.groupDimension());
  readonly showAllSymbols = computed(() => this.groupStore.showAllSymbols());
  readonly activeListFilter = computed(() => this.symbolListStore.activeListFilter());
  readonly symbolLists = computed(() => this.symbolListStore.symbolLists());

  /** Triage state. */
  readonly statusCounts = computed(() => this.triageStore.statusCounts());
  readonly reviewCount = computed(() => this.triageStore.reviewCount());
  readonly acceptedCount = computed(() => this.occurrenceStore.acceptedCount());

  /** UI filter / expansion. */
  readonly signalFilter = computed(() => this.uiStore.signalFilter());
  readonly timeframe = computed(() => this.uiStore.signalFilter().timeframe);
  readonly direction = computed(() => this.uiStore.signalFilter().direction);
  readonly expandedGroups = computed(() => this.uiStore.expandedGroups());
  readonly allExpanded = computed(() => this.uiStore.allExpanded());

  /** Symbol selection / quick chart. */
  readonly selectedSymbol = computed(() => this.groupStore.selectedSymbol());
  readonly quickChartSymbol = computed(() => this.groupStore.quickChartSymbol());

  /** Active-run context for header / eligibility. */
  readonly viewedRun = computed((): AgentRun | null => this.groupStore.viewedRun());
  readonly isActionableRun = computed(() => this.groupStore.isActionableRun());

  /** Fullscreen state for the header. */
  readonly fullscreen = computed(() => this.uiState.fullscreen());

  toggleFullscreen(): void {
    this.uiState.toggleFullscreen();
  }

  /** Stable flat list of visible symbols for prev/next navigation. */
  readonly flatSymbols = computed(() => this.groupStore.flatFilteredSymbols());

  constructor() {
    /**
     * Auto-select the latest completed run on direct page reload.
     * Registered once in the constructor so multiple enterPage() calls cannot
     * create duplicate effects.
     */
    effect(() => {
      const latest = this.agentStore.latestCompletedRun();
      if (!latest) return;
      if (this.groupStore.activeRunId()) return;
      this.groupStore.setActiveRun(latest.id, latest.marketDate ?? '');
    });
  }

  /** Enter the signal-review page: fullscreen, active run, load symbols. */
  enterPage(): void {
    this.uiState.setFullscreen(true);
    const runId = this.groupStore.activeRunId();
    if (runId) {
      this.groupStore.loadSymbolsWithSignals();
    } else {
      // Direct page reload â€” activeRunId not yet set. Start runs stream;
      // the constructor effect will auto-select the most recent run when it arrives.
      this.agentStore.loadData();
    }
  }

  /** Leave the signal-review page. */
  leavePage(): void {
    this.uiState.setFullscreen(false);
  }

  // -------------------------------------------------------------------------
  // Header actions
  // -------------------------------------------------------------------------

  setGroupDimension(dim: GroupDimension): void {
    this.groupStore.setGroupDimension(dim);
  }

  setActiveListFilter(filter: RhSymbolListName | 'ALL'): void {
    this.symbolListStore.setActiveListFilter(filter);
  }

  setTimeframeFilter(timeframe: SignalTimeframe): void {
    this.uiStore.setTimeframeFilter(timeframe);
  }

  setDirectionFilter(direction: SignalDirection): void {
    this.uiStore.setDirectionFilter(direction);
  }

  toggleShowAllSymbols(): void {
    this.groupStore.toggleShowAllSymbols();
  }

  refreshSymbols(): void {
    this.groupStore.loadSymbolsWithSignals();
  }

  // -------------------------------------------------------------------------
  // Expansion
  // -------------------------------------------------------------------------

  toggleExpandAll(): void {
    const groups = this.groupStore.groups();
    const wasExpanded = this.uiStore.allExpanded();
    const groupKeys = groups.map((g) => g.key);
    this.uiStore.toggleExpandAll(groupKeys);
    if (!wasExpanded) {
      this.preloadHistoryForGroups(groups);
    }
  }

  setGroupExpanded(groupKey: string, expand: boolean): void {
    this.uiStore.setGroupExpanded(groupKey, expand);
  }

  /** Expand/collapse a group and preload signal history when expanding. */
  groupExpandChanged(group: { key: string; rows: { profile: { symbol: string }; signals?: AgentSignalItem[] }[] }, expand: boolean): void {
    this.uiStore.setGroupExpanded(group.key, expand);
    if (expand) {
      this._preloadHistoryForGroup(group);
    }
  }

  private _preloadHistoryForGroup(group: { rows: { profile: { symbol: string }; signals?: AgentSignalItem[] }[] }): void {
    const runId = this.groupStore.activeRunId();
    if (!runId) return;
    for (const row of group.rows) {
      if (!row.signals) {
        this.historyStore.loadSignalHistoryForRun(row.profile.symbol, runId);
      }
    }
  }

  preloadHistoryForGroups(groups: { key: string; rows: { profile: { symbol: string }; signals?: AgentSignalItem[] }[] }[]): void {
    for (const g of groups) {
      this._preloadHistoryForGroup(g);
    }
  }

  // -------------------------------------------------------------------------
  // Symbol row actions
  // -------------------------------------------------------------------------

  selectSymbol(symbol: string): void {
    this.groupStore.selectSymbol(symbol);
  }

  setQuickChartSymbol(symbol: string | null): void {
    this.groupStore.setQuickChartSymbol(symbol);
  }

  scrollToSymbol(symbol: string): void {
    this.scrollTarget.scrollTo(symbol);
  }

  toggleQuickChart(symbol: string): void {
    const current = this.groupStore.quickChartSymbol();
    this.groupStore.setQuickChartSymbol(current === symbol ? null : symbol);
  }

  toggleSymbolInList(symbol: string, listName: RhSymbolListName): void {
    this.symbolListStore.toggleSymbolInList(symbol, listName);
  }

  /** Guard helper: mutation actions are only allowed for the latest completed run. */
  private runIfActionable<T>(fn: () => T): T | undefined {
    if (!this.groupStore.isActionableRun()) return;
    return fn();
  }

  /** Return the current-run signal occurrences for a symbol, using the cache if available. */
  private currentRunSignals(symbol: string): Observable<AgentSignalItem[]> {
    const runId = this.groupStore.activeRunId();
    if (!runId) return of([]);
    return this.signalService.getCurrentRunSignalsForSymbol(symbol, runId, this.historyStore.signalHistoryCache());
  }

  markForReview(symbol: string): void {
    this.runIfActionable(() => this.triageStore.markForReview(symbol));
  }

  acceptSymbol(symbol: string): void {
    this.runIfActionable(() => {
      const runId = this.groupStore.activeRunId();
      const marketDate = this.groupStore.activeRunMarketDate();
      if (!runId || !marketDate) return;
      this.currentRunSignals(symbol).subscribe((signals) => {
        if (signals.length === 0) return;
        this.occurrenceStore.acceptSignals(signals, runId, marketDate);
        this.triageStore.setStatus(symbol, ReviewDecision.ACCEPT);
      });
    });
  }

  considerSymbol(symbol: string): void {
    this.runIfActionable(() => this.triageStore.considerSymbol(symbol));
  }

  rejectSymbol(symbol: string): void {
    this.runIfActionable(() => {
      const runId = this.groupStore.activeRunId();
      const marketDate = this.groupStore.activeRunMarketDate();
      if (!runId || !marketDate) return;
      this.currentRunSignals(symbol).subscribe((signals) => {
        if (signals.length === 0) return;
        this.occurrenceStore.rejectSignals(signals, runId, marketDate);
        this.triageStore.setStatus(symbol, ReviewDecision.REJECT);
      });
    });
  }

  resetSymbol(symbol: string): void {
    this.runIfActionable(() => {
      const runId = this.groupStore.activeRunId();
      if (!runId) return;
      this.occurrenceStore.resetSymbol(symbol, runId);
      this.triageStore.setStatus(symbol, ReviewDecision.PENDING);
    });
  }

  toggleMonitor(symbol: string): void {
    if (this.symbolListStore.activeListFilter() === RhSymbolListName.PAST_SIGNALS) {
      this.symbolListStore.removeSymbolFromList(symbol, RhSymbolListName.PAST_SIGNALS);
    } else {
      this.symbolListStore.addSymbolToList(symbol, RhSymbolListName.PAST_SIGNALS);
    }
  }

  // -------------------------------------------------------------------------
  // Pipeline actions
  // -------------------------------------------------------------------------

  clearReviewFlags(): void {
    this.runIfActionable(() => this.triageStore.clearReviewFlags());
  }

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  goBack(): void {
    this.router.navigate(['/run-dashboard']);
  }

  goToReview(): void {
    this.router.navigate(['/chart-review']);
  }

  goToOrder(): void {
    if (this.occurrenceStore.acceptedCount() === 0) return;
    this.router.navigate(['/signal-order']);
  }

  goToTriageReport(): void {
    this.router.navigate(['/signal-action-report']);
  }
}
