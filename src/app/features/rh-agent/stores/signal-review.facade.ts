/**
 * Signal Review Facade
 *
 * Page-level orchestrator for the grouped signal review. Hides the store
 * boundary from the component so the page only injects this facade plus
 * generic services.
 *
 * The facade owns:
 * - Page enter/leave orchestration (fullscreen, active run selection, load).
 * - Syncing the UI store filter into the domain group store.
 * - Expansion preloading of signal history.
 * - Navigation actions used by the header.
 */
import { computed, effect, inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { RhAgentGroupStore } from './rh-agent-group.store';
import { RhAgentTriageStore } from './rh-agent-triage.store';
import { RhAgentSymbolListStore } from './rh-agent-symbol-list.store';
import { RhAgentSymbolHistoryStore } from './rh-agent-symbol-history.store';
import { RhAgentStore } from './rh-agent.store';
import { SignalReviewUiStore } from './signal-review-ui.store';
import type { RhAgentSignalItem } from '../services/rh-agent.types';
import { UiStateService } from '../../../core/services/ui-state.service';
import { ScrollTargetService } from '../services/scroll-target.service';
import {
  GroupDimension,
  RhSymbolListName,
  SignalTimeframe,
  SignalDirection,
} from '../common/rh-agent.constants';

@Injectable({ providedIn: 'root' })
export class SignalReviewFacade {
  private readonly groupStore = inject(RhAgentGroupStore);
  private readonly triageStore = inject(RhAgentTriageStore);
  private readonly symbolListStore = inject(RhAgentSymbolListStore);
  private readonly historyStore = inject(RhAgentSymbolHistoryStore);
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
  readonly acceptedCount = computed(() => this.triageStore.acceptedCount());

  /** UI filter / expansion. */
  readonly signalFilter = computed(() => this.uiStore.signalFilter());
  readonly timeframe = computed(() => this.uiStore.signalFilter().timeframe);
  readonly direction = computed(() => this.uiStore.signalFilter().direction);
  readonly expandedGroups = computed(() => this.uiStore.expandedGroups());
  readonly allExpanded = computed(() => this.uiStore.allExpanded());

  /** Symbol selection / quick chart. */
  readonly selectedSymbol = computed(() => this.groupStore.selectedSymbol());
  readonly quickChartSymbol = computed(() => this.groupStore.quickChartSymbol());

  /** Fullscreen state for the header. */
  readonly fullscreen = computed(() => this.uiState.fullscreen());

  toggleFullscreen(): void {
    this.uiState.toggleFullscreen();
  }

  /** Stable flat list of visible symbols for prev/next navigation. */
  readonly flatSymbols = computed(() => this.groupStore.flatFilteredSymbols());

  constructor() {
    /** Keep the domain group store filter in sync with the page UI filter. */
    effect(() => {
      this.groupStore.setSignalFilter(this.uiStore.signalFilter());
    });

    /**
     * Auto-select the latest run on direct page reload.
     * Registered once in the constructor so multiple enterPage() calls cannot
     * create duplicate effects.
     */
    effect(() => {
      const latest = this.agentStore.latestRun();
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
      // Direct page reload — activeRunId not yet set. Start runs stream;
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

  preloadHistoryForGroups(groups: { key: string; rows: { profile: { symbol: string }; signals?: RhAgentSignalItem[] }[] }[]): void {
    const runId = this.groupStore.activeRunId();
    if (!runId) return;
    for (const g of groups) {
      for (const row of g.rows) {
        if (!row.signals) {
          this.historyStore.loadSignalHistoryForRun(row.profile.symbol, runId);
        }
      }
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

  markForReview(symbol: string): void {
    const date = this.groupStore.activeRunMarketDate();
    if (!date) return;
    this.triageStore.markForReview(symbol, date);
  }

  acceptSymbol(symbol: string): void {
    const date = this.groupStore.activeRunMarketDate();
    if (!date) return;
    this.triageStore.acceptSymbol(symbol, date);
  }

  considerSymbol(symbol: string): void {
    const date = this.groupStore.activeRunMarketDate();
    if (!date) return;
    this.triageStore.considerSymbol(symbol, date);
  }

  rejectSymbol(symbol: string): void {
    const date = this.groupStore.activeRunMarketDate();
    if (!date) return;
    this.triageStore.rejectSymbol(symbol, date);
  }

  resetSymbol(symbol: string): void {
    const date = this.groupStore.activeRunMarketDate();
    if (!date) return;
    this.triageStore.resetSymbol(symbol, date);
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

  clearTriage(): void {
    this.triageStore.clear();
  }

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  goBack(): void {
    this.router.navigate(['/rh-agent']);
  }

  goToReview(): void {
    if (this.triageStore.reviewCount() === 0) return;
    this.router.navigate(['/chart-review']);
  }

  goToOrder(): void {
    if (this.triageStore.acceptedCount() === 0) return;
    this.router.navigate(['/rh-agent-order']);
  }

  goToTriageReport(): void {
    this.router.navigate(['/rh-agent-triage-report']);
  }
}
