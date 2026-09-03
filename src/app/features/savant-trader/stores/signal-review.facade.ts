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
import { Observable, of, firstValueFrom } from 'rxjs';
import { GroupStore } from './group.store';
import { TriageStore } from './triage.store';
import { OccurrenceDecisionStore } from './occurrence-decision.store';
import { SymbolListStore } from './symbol-list.store';
import { SymbolHistoryStore } from './symbol-history.store';
import { StStore } from './st.store';
import { SignalReviewUiStore } from './signal-review-ui.store';
import { OrderStagingStore } from './order-staging.store';
import { SignalService } from '../services/signal.service';
import { TradingConfigService } from '../services/trading-config.service';
import type { StSignalItem } from '../services/types';
import { UiStateService } from '../../../core/services/ui-state.service';
import { ScrollTargetService } from '../services/scroll-target.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  GroupDimension,
  SymbolListName,
  SignalTimeframe,
  SignalDirection,
  ReviewDecision,
  ALL_REVIEW_STATUSES,
  StatusCounts,
} from '../common/constants';
import type { StRun } from '../services/types';
import {
  OrderIntent,
  OrderIntentStatus,
  OrderSource,
  InstrumentType,
  EquityOrderIntent,
} from '../services/order-intent.types';

/** Context needed to turn a set of signals for one symbol into order intents. */
export interface SignalOrderStagingContext {
  runId: string;
  accountNumber: string;
  now: Date;
  buildId: (symbol: string, side: string, now: Date) => string;
  buildRefId: () => string;
}

export function buildSignalOrderIntents(
  symbol: string,
  signals: StSignalItem[],
  context: SignalOrderStagingContext,
): EquityOrderIntent[] {
  const { runId, accountNumber, now, buildId, buildRefId } = context;
  const seen = new Set<string>();
  const intents: EquityOrderIntent[] = [];
  for (const signal of signals) {
    const side = signal.direction === SignalDirection.SHORT ? 'sell' : 'buy';
    const dedupKey = `${symbol}-${side}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    const id = buildId(symbol, side, now);
    const decisionId = `${runId}-${symbol}-${signal.timeframe}-${signal.signalType}`;
    intents.push({
      id,
      refId: buildRefId(),
      source: OrderSource.SIGNAL_PIPELINE,
      sourceRef: { type: 'occurrence_decision', id: decisionId },
      status: OrderIntentStatus.STAGED,
      accountNumber,
      side,
      orderType: 'market',
      timeInForce: 'gfd',
      marketHours: 'regular_hours',
      instrumentType: InstrumentType.EQUITY,
      symbol,
      signalContext: {
        signalType: signal.signalType,
        barDate: signal.barDate,
        timeframe: signal.timeframe,
        direction: signal.direction,
        decisionId,
      },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  }
  return intents;
}

@Injectable({ providedIn: 'root' })
export class SignalReviewFacade {
  private readonly groupStore = inject(GroupStore);
  private readonly triageStore = inject(TriageStore);
  private readonly occurrenceStore = inject(OccurrenceDecisionStore);
  private readonly symbolListStore = inject(SymbolListStore);
  private readonly historyStore = inject(SymbolHistoryStore);
  private readonly signalService = inject(SignalService);
  private readonly uiStore = inject(SignalReviewUiStore);
  private readonly agentStore = inject(StStore);
  private readonly uiState = inject(UiStateService);
  private readonly scrollTarget = inject(ScrollTargetService);
  private readonly router = inject(Router);
  private readonly stagingStore = inject(OrderStagingStore);
  private readonly tradingConfigService = inject(TradingConfigService);
  private readonly snackBar = inject(MatSnackBar);

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
  readonly statusCounts = computed((): StatusCounts => {
    const durable = this.occurrenceStore.durableStatusCounts();
    const screening = this.triageStore.screeningStatuses();
    const counts = Object.fromEntries(
      ALL_REVIEW_STATUSES.map((s) => [s, 0])
    ) as StatusCounts;
    // Copy durable counts (ACCEPT/REJECT)
    counts.ACCEPT = durable.ACCEPT;
    counts.REJECT = durable.REJECT;
    // Count screening statuses (CONSIDER/WATCH)
    for (const status of Object.values(screening)) {
      if (status === ReviewDecision.CONSIDER) counts.CONSIDER++;
      else if (status === ReviewDecision.WATCH) counts.WATCH++;
    }
    // Review count from flags
    counts.REVIEW = this.triageStore.reviewCount();
    return counts;
  });
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

  /** Profile for the currently selected quick-chart symbol, for the meta header. */
  readonly quickChartProfile = computed(() => {
    const sym = this.groupStore.quickChartSymbol();
    if (!sym) return null;
    return this.groupStore.filteredProfiles().find((p) => p.symbol === sym) ?? null;
  });

  /** Active-run context for header / eligibility. */
  readonly viewedRun = computed((): StRun | null => this.groupStore.viewedRun());
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

  /** Enter the signal-review page: fullscreen, active run, load symbols and decisions. */
  enterPage(): void {
    this.uiState.setFullscreen(true);
    const runId = this.groupStore.activeRunId();
    if (runId) {
      // Only load if not already loading (setActiveRun may have already triggered this).
      if (!this.groupStore.symbolsLoading()) {
        this.groupStore.loadSymbolsWithSignals();
      }
      if (!this.occurrenceStore.loading()) {
        this.occurrenceStore.loadRecentDecisions();
      }
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

  setActiveListFilter(filter: SymbolListName | 'ALL'): void {
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
  groupExpandChanged(group: { key: string; rows: { profile: { symbol: string }; signals?: StSignalItem[] }[] }, expand: boolean): void {
    this.uiStore.setGroupExpanded(group.key, expand);
    if (expand) {
      this._preloadHistoryForGroup(group);
    }
  }

  private _preloadHistoryForGroup(group: { rows: { profile: { symbol: string }; signals?: StSignalItem[] }[] }): void {
    const runId = this.groupStore.activeRunId();
    if (!runId) return;
    for (const row of group.rows) {
      if (!row.signals) {
        this.historyStore.loadSignalHistoryForRun(row.profile.symbol, runId);
      }
    }
  }

  preloadHistoryForGroups(groups: { key: string; rows: { profile: { symbol: string }; signals?: StSignalItem[] }[] }[]): void {
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

  toggleSymbolInList(symbol: string, listName: SymbolListName): void {
    this.symbolListStore.toggleSymbolInList(symbol, listName);
  }

  /** Guard helper: mutation actions are only allowed for the latest completed run. */
  private runIfActionable<T>(fn: () => T): T | undefined {
    if (!this.groupStore.isActionableRun()) return;
    return fn();
  }

  /** Return the current-run signal occurrences for a symbol, using the cache if available. */
  private currentRunSignals(symbol: string): Observable<StSignalItem[]> {
    const runId = this.groupStore.activeRunId();
    if (!runId) return of([]);
    return this.signalService.getCurrentRunSignalsForSymbol(symbol, runId, this.historyStore.signalHistoryCache());
  }

  markForReview(symbol: string): void {
    this.runIfActionable(() => {
      const isReviewed = this.triageStore.reviewFlags()[symbol.toUpperCase()] === true;
      if (isReviewed) {
        this.triageStore.unmarkFromReview(symbol);
      } else {
        this.triageStore.markForReview(symbol);
      }
    });
  }

  acceptSymbol(symbol: string): void {
    this.runIfActionable(() => {
      const runId = this.groupStore.activeRunId();
      const marketDate = this.groupStore.activeRunMarketDate();
      if (!runId || !marketDate) return;

      // Toggle: if already accepted, de-accept and remove the staged intent.
      const isAccepted = this.occurrenceStore.acceptedSymbols().includes(symbol.toUpperCase());
      if (isAccepted) {
        this.occurrenceStore.resetSymbol(symbol, runId);
        this.removeStagedIntentForSymbol(symbol);
        return;
      }

      this.currentRunSignals(symbol).subscribe((signals) => {
        if (signals.length === 0) return;
        this.occurrenceStore.acceptSignals(signals, runId, marketDate);
        this.stageIntentForSymbol(symbol, signals, runId);
      });
    });
  }

  considerSymbol(symbol: string): void {
    this.runIfActionable(() => this.triageStore.setScreeningStatus(symbol, ReviewDecision.CONSIDER));
  }

  watchSymbol(symbol: string): void {
    this.runIfActionable(() => this.triageStore.setScreeningStatus(symbol, ReviewDecision.WATCH));
  }

  rejectSymbol(symbol: string): void {
    this.runIfActionable(() => {
      const runId = this.groupStore.activeRunId();
      const marketDate = this.groupStore.activeRunMarketDate();
      if (!runId || !marketDate) return;
      this.currentRunSignals(symbol).subscribe((signals) => {
        if (signals.length === 0) return;
        this.occurrenceStore.rejectSignals(signals, runId, marketDate);
        this.removeStagedIntentForSymbol(symbol);
      });
    });
  }

  resetSymbol(symbol: string): void {
    this.runIfActionable(() => {
      const runId = this.groupStore.activeRunId();
      if (!runId) return;
      this.occurrenceStore.resetSymbol(symbol, runId);
    });
  }

  /** Clear all decision history for a symbol across all runs. */
  clearSymbolHistory(symbol: string): void {
    this.runIfActionable(() => {
      this.occurrenceStore.clearSymbolHistory(symbol);
      this.removeStagedIntentForSymbol(symbol);
    });
  }

  toggleMonitor(symbol: string): void {
    if (this.symbolListStore.activeListFilter() === SymbolListName.PAST_SIGNALS) {
      this.symbolListStore.removeSymbolFromList(symbol, SymbolListName.PAST_SIGNALS);
    } else {
      this.symbolListStore.addSymbolToList(symbol, SymbolListName.PAST_SIGNALS);
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

  /** Navigate to the signal order page. */
  async goToSignalOrder(): Promise<void> {
    this.router.navigate(['/signal-order']);
  }

  /**
   * Stage a single equity order intent for the given symbol immediately
   * after accept. Loads account config, deduplicates by symbol+side.
   */
  private async stageIntentForSymbol(symbol: string, signals: StSignalItem[], runId: string): Promise<void> {
    let accountNumber: string;
    try {
      const config = await firstValueFrom(this.tradingConfigService.loadConfig());
      accountNumber = config?.accountNumber ?? '';
      if (!accountNumber) {
        this.snackBar.open('Failed to auto-stage order — configure the agentic account first', 'Dismiss', { duration: 4000 });
        return;
      }
    } catch (err) {
      console.error('[SignalReviewFacade] Failed to load trading config for auto-staging:', err);
      this.snackBar.open('Failed to auto-stage order — check account config', 'Dismiss', { duration: 4000 });
      return;
    }

    const now = new Date();
    const intents = buildSignalOrderIntents(symbol, signals, {
      runId,
      accountNumber,
      now,
      buildId: (intentSymbol, side, createdAt) => this.buildIntentId(intentSymbol, side, createdAt),
      buildRefId: () => crypto.randomUUID(),
    });
    for (const intent of intents) {
      this.stagingStore.stageIntent(intent);
    }
  }

  /** Remove any staged intents for the given symbol (used on de-accept/reject). */
  private removeStagedIntentForSymbol(symbol: string): void {
    const normalized = symbol.toUpperCase();
    const bySymbol = this.stagingStore.intentsBySymbol();
    const intents = bySymbol[normalized] ?? [];
    for (const intent of intents) {
      if (intent.status === OrderIntentStatus.STAGED || intent.status === OrderIntentStatus.READY) {
        this.stagingStore.removeIntent(intent.id);
      }
    }
  }

  /**
   * Build a human-readable intent id: {SYMBOL}-{SIDE}-{YYMMDD}-{DOW}-{HHMM}PT
   * e.g., AAPL-BUY-260825-MON-1430PT
   */
  private buildIntentId(symbol: string, side: string, now: Date): string {
    const pt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = pt.formatToParts(now);
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
    const yy = get('year');
    const mm = get('month');
    const dd = get('day');
    const dow = get('weekday').toUpperCase();
    const hh = get('hour') === '24' ? '00' : get('hour');
    const min = get('minute');
    return `${symbol.toUpperCase()}-${side.toUpperCase()}-${yy}${mm}${dd}-${dow}-${hh}${min}PT`;
  }

  goToTriageReport(): void {
    this.router.navigate(['/signal-action-report']);
  }
}
