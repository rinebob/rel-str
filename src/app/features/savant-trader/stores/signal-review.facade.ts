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
import { MatDialog } from '@angular/material/dialog';
import { GroupStore } from './group.store';
import { TriageStore } from './triage.store';
import { SymbolListStore } from './symbol-list.store';
import { SymbolHistoryStore } from './symbol-history.store';
import { StStore } from './st.store';
import { SignalReviewUiStore } from './signal-review-ui.store';
import { OrderTicketStore } from './order-ticket.store';
import { ManualOrderService } from '../services/manual-order.service';
import { SignalService } from '../services/signal.service';
import { TradingConfigService } from '../services/trading-config.service';
import type { StSignalItem } from '../services/types';
import {
  buildSignalOrderTickets,
  buildTicketId,
  DEFAULT_DOLLAR_AMOUNT,
  NO_ACCOUNT_SNACKBAR,
} from '../utils/signal-order-staging.util';
import {
  GalleryTicketDialogComponent,
  GalleryTicketDialogData,
  OptionTabSeed,
} from '../components/gallery-ticket-dialog/gallery-ticket-dialog.component';
import { AppRoutes } from '../../../core/common/interfaces';
import { UiStateService } from '../../../core/services/ui-state.service';
import { ScrollTargetService } from '../services/scroll-target.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  GroupDimension,
  SymbolListFilter,
  NO_MEMBERSHIP,
  SignalTimeframe,
  SignalDirection,
} from '../common/constants';
import type { StRun } from '../services/types';
import { formatTradingViewWatchlist } from '../utils/utils';
import { EquityOrderTicket, EtfOrderTicket, InstrumentType, OrderSource, OrderTicketStatus, TERMINAL_TICKET_STATUSES, isLiveOrderTicket } from '../services/order-ticket.types';

@Injectable({ providedIn: 'root' })
export class SignalReviewFacade {
  private readonly groupStore = inject(GroupStore);
  private readonly triageStore = inject(TriageStore);
  private readonly symbolListStore = inject(SymbolListStore);
  private readonly historyStore = inject(SymbolHistoryStore);
  private readonly signalService = inject(SignalService);
  private readonly uiStore = inject(SignalReviewUiStore);
  private readonly agentStore = inject(StStore);
  private readonly uiState = inject(UiStateService);
  private readonly scrollTarget = inject(ScrollTargetService);
  private readonly router = inject(Router);
  private readonly stagingStore = inject(OrderTicketStore);
  private readonly manualOrderService = inject(ManualOrderService);
  private readonly tradingConfigService = inject(TradingConfigService);
  private readonly dialog = inject(MatDialog);
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
  readonly filterOptionGroups = computed(() => this.symbolListStore.filterOptionGroups());
  readonly symbolLists = computed(() => this.symbolListStore.symbolLists());
  readonly listCatalog = computed(() => this.symbolListStore.catalog());

  /** Triage state — review flags only (#1017 — the durable ACCEPT/REJECT
   *  and ephemeral CONSIDER/WATCH status counts are gone). */
  readonly reviewCount = computed(() => this.triageStore.reviewCount());

  /** Non-terminal tickets in the order queue — the header's Order count
   *  (#1017 — ticket existence is the decision). */
  readonly orderCount = computed(
    () =>
      Object.values(this.stagingStore.tickets()).filter(
        (t) => !TERMINAL_TICKET_STATUSES.has(t.status),
      ).length,
  );

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

  /**
   * Total signals represented by the currently visible rows. Loaded rows
   * contribute their real (filtered) signal count; rows whose history hasn't
   * loaded yet count 1 — visibility already implies at least one match.
   */
  readonly filteredSignalCount = computed(() => {
    let n = 0;
    for (const g of this.groupStore.groups()) {
      for (const r of g.rows) n += r.signals?.length ?? 1;
    }
    return n;
  });

  /**
   * True while the page is still acquiring its initial data — no active run
   * yet (auto-select pending), symbols loading, or the first list-catalog
   * emission pending. Gates the body so the empty state can't flash early.
   */
  readonly pageInitializing = computed(() =>
    (!this.groupStore.activeRunId() && !this.agentStore.runsReceived()) ||
    this.groupStore.symbolsLoading() ||
    this.symbolListStore.symbolListsLoading()
  );

  toggleFullscreen(): void {
    this.uiState.toggleFullscreen();
  }

  /** Download the currently selected symbol list in TradingView's TXT format. */
  async exportSelectedList(): Promise<void> {
    const listName = this.activeListFilter();
    if (listName === 'ALL') return;
    const label = listName === NO_MEMBERSHIP ? 'Not triaged' : listName;

    // Named lists short-circuit before the profiles fetch; NO_MEMBERSHIP
    // uses the canonical unlisted universe (tracked symbols in zero lists)
    // — the same set the nav and chart-view browse mode show.
    const named = listName === NO_MEMBERSHIP ? null : (this.symbolLists()[listName] ?? []);
    if (named && named.length === 0) {
      this.snackBar.open(`${label} is empty`, 'Dismiss', { duration: 3000 });
      return;
    }

    try {
      if (listName === NO_MEMBERSHIP) {
        await this.symbolListStore.loadTrackedSymbols();
      }
      const profiles = await firstValueFrom(this.signalService.getAllSymbols());
      const symbols = named ?? this.symbolListStore.unlistedSymbols();
      if (symbols.length === 0) {
        this.snackBar.open(`${label} is empty`, 'Dismiss', { duration: 3000 });
        return;
      }
      const { content, unresolved } = formatTradingViewWatchlist(symbols, profiles);
      if (!content) {
        this.snackBar.open(`No ${label} symbols have exchange metadata`, 'Dismiss', { duration: 5000 });
        return;
      }

      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `ST-${listName}.txt`;
      anchor.click();
      URL.revokeObjectURL(url);

      if (unresolved.length > 0) {
        this.snackBar.open(`Exported ${label}; skipped ${unresolved.length} symbol(s) without exchange metadata`, 'Dismiss', { duration: 6000 });
      }
    } catch (err) {
      console.error(`[SignalReviewFacade] Failed to export ${listName}:`, err);
      this.snackBar.open(`Failed to export ${label}`, 'Dismiss', { duration: 5000 });
    }
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

  /** Enter the signal-review page: active run, load symbols. */
  enterPage(): void {
    // Page-entry defaults — re-applied on every visit.
    this.uiStore.setTimeframeFilter(SignalTimeframe.DAILY);
    this.uiStore.setDirectionFilter(SignalDirection.LONG);
    const runId = this.groupStore.activeRunId();
    if (runId) {
      // Only load if not already loading (setActiveRun may have already triggered this).
      if (!this.groupStore.symbolsLoading()) {
        this.groupStore.loadSymbolsWithSignals();
      }
    } else {
      // Direct page reload — activeRunId not yet set. Start runs stream;
      // the constructor effect will auto-select the most recent run when it arrives.
      this.agentStore.loadData();
    }
    // Hydrate the ticket store — Trade's reopen/block probes read
    // ticketsBySymbol; a cold store would blind them (only gallery and
    // the order page hydrated before; #1017 r2).
    this.stagingStore.loadTickets();
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

  setActiveListFilter(filter: SymbolListFilter): void {
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

  toggleSymbolInList(symbol: string, listKey: string): void {
    this.symbolListStore.toggleSymbolInList(symbol, listKey);
  }

  /** Guard helper: mutation actions require the viewed run to be a completed run
   *  (any vintage — prior-run signals remain actionable). */
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

  // #1016 — session-local flags; the only UI entry points are disabled.
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

  /** Symbols with a Trade in flight — the guard the gallery gets from
   *  busyCardKeys: two rapid clicks must not both pass the ticket probe
   *  and stage twice (#1017 r1). Held through the dialog's lifetime —
   *  a click while the dialog is open would stack a second one on the
   *  same ticket (r2). Per-symbol — a Trade on a different symbol isn't
   *  blocked. */
  private readonly tradeInFlight = new Set<string>();

  /**
   * Trade (#1017 — replaced the ACR Accept path): stage the symbol's
   * signal-sourced equity ticket and open the ticket dialog so the
   * order can be reviewed and submitted. An existing STAGED equity ticket
   * is reopened rather than duplicated; a live (advanced) ticket blocks
   * with a snackbar. Tickets this click created are discarded when the
   * dialog closes still-STAGED — same cancel semantics as the gallery's
   * Trade flow (#759).
   */
  async tradeSymbol(symbol: string): Promise<void> {
    const sym = symbol.toUpperCase();
    if (this.tradeInFlight.has(sym)) return;
    this.tradeInFlight.add(sym);
    await this.tradeSymbolInner(sym);
  }

  private async tradeSymbolInner(sym: string): Promise<void> {
    let keepGuard = false;
    try {
      await this.runIfActionable(async () => {
      const runId = this.groupStore.activeRunId();
      if (!runId) return;

      // Equity ticket probe FIRST — reopen/block applies whether or not
      // the symbol has run signals: a live equity order must also block
      // the manual fallback (#1017 r1).
      const equity = () =>
        (this.stagingStore.ticketsBySymbol()[sym] ?? []).filter(
          (t): t is EquityOrderTicket | EtfOrderTicket =>
            t.instrumentType !== InstrumentType.OPTION,
        );
      // Live check BEFORE the STAGED reopen — a STAGED twin coexisting
      // with an advanced ticket must not reopen while the live order
      // sits alongside (#1017 r2). "Live" = non-terminal and not STAGED;
      // terminal-only tickets don't block re-staging.
      const live = () => equity().find(isLiveOrderTicket);
      const stagedExisting = () => equity().find((t) => t.status === OrderTicketStatus.STAGED);
      if (live()) {
        this.snackBar.open(`${sym}: a live order already exists for this symbol`, 'Dismiss', { duration: 5000 });
        return;
      }

      const signals = await firstValueFrom(this.currentRunSignals(sym));
      // Run switch or ticket mutation mid-flight — re-run the probe, the
      // snapshot is stale (a ticket submitted elsewhere during the await
      // must not get a parallel stage; #1017 r2).
      if (this.groupStore.activeRunId() !== runId || live()) {
        if (live()) this.snackBar.open(`${sym}: a live order already exists for this symbol`, 'Dismiss', { duration: 5000 });
        return;
      }

      // Single-direction partition — an unpartitioned mixed-direction set
      // would stage an invisible opposite-side ticket AND corrupt option
      // provenance: findCardTickets skips the side check for OPTION
      // tickets, so a mixed decisionIds set statuses both buy and sell
      // cards, and Reject on the opposite card deletes the staged option
      // ticket via decisionIds overlap (#1017 r1).
      const tradeSignals = this.pickTradeDirection(signals, sym, stagedExisting()?.side);

      const createdTicketIds = new Set<string>();
      let dialogTicketId: string;
      const staged = stagedExisting();
      // A MANUAL-sourced STAGED ticket may belong to the open manual
      // dialog — the manual dialog owns it; a Trade click here is a
      // no-op rather than stacking a second dialog or staging a
      // parallel ticket (#1017 r3).
      if (staged?.source === OrderSource.MANUAL && this.manualOrderService.dialogOpen) return;
      if (staged) {
        dialogTicketId = staged.id;
      } else {
        // No run signals → the manual ticket path, seeded with the symbol
        // (chart-view browse symbols have no signal provenance to stage
        // from; #1017).
        if (!tradeSignals.length) {
          await this.manualOrderService.open(sym);
          return;
        }
        const tickets = await this.stageTicketsForSymbol(sym, tradeSignals, runId);
        if (!tickets.length) return;
        // Final await passed — a live ticket that appeared during the
        // config/persist awaits vetoes the dialog; discard the staged
        // twins rather than park them beside a live order (#1017 r3).
        if (live()) {
          for (const t of tickets) this.stagingStore.discardIfStaged(t.id);
          this.snackBar.open(`${sym}: a live order already exists for this symbol`, 'Dismiss', { duration: 5000 });
          return;
        }
        for (const t of tickets) createdTicketIds.add(t.id);
        dialogTicketId = tickets[0].id;
      }

      const option: OptionTabSeed | undefined = tradeSignals.length
        ? {
            symbol: sym,
            runId,
            signals: tradeSignals,
            onStaged: (e) => {
              if (e.created) createdTicketIds.add(e.ticketId);
            },
          }
        : undefined;

      const data: GalleryTicketDialogData = {
        ticketId: dialogTicketId,
        tradingConfig: this.tradingConfigService.config,
        option,
      };
      const ref = this.dialog.open(GalleryTicketDialogComponent, {
        data,
        width: '640px',
        maxHeight: '92vh',
        autoFocus: false,
      });
      // Hold the in-flight guard until the dialog closes — a second
      // Trade click while it's open would stack a second dialog on the
      // same ticket (#1017 r2).
      ref.afterClosed().subscribe(() => {
        for (const id of createdTicketIds) this.stagingStore.discardIfStaged(id);
        this.tradeInFlight.delete(sym);
      });
      keepGuard = true;
      });
    } finally {
      if (!keepGuard) this.tradeInFlight.delete(sym);
    }
  }

  // -------------------------------------------------------------------------
  // Pipeline actions
  // -------------------------------------------------------------------------

  // #1016 — session-local flags; the only UI entry point is disabled.
  clearReviewFlags(): void {
    this.runIfActionable(() => this.triageStore.clearReviewFlags());
  }

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  goBack(): void {
    this.router.navigate(['/' + AppRoutes.RUN_DASHBOARD]);
  }

  goToChartView(): void {
    this.router.navigate(['/' + AppRoutes.CHART_VIEW]);
  }

  /** Navigate to the signal order page. */
  async goToSignalOrder(): Promise<void> {
    this.router.navigate(['/' + AppRoutes.SIGNAL_ORDER]);
  }

  /** Partition a run-signal set to one trade direction (#1017 r1): the
   *  active direction filter's side, or the reopened ticket's side when
   *  one is bound, else LONG (the default filter). A single-direction set
   *  passes through untouched; on a mixed set the skipped side is
   *  reported — its card stays tradable in the gallery. */
  private pickTradeDirection(
    signals: StSignalItem[],
    sym: string,
    preferSide?: 'buy' | 'sell',
  ): StSignalItem[] {
    const buys = signals.filter((s) => s.direction !== SignalDirection.SHORT);
    const sells = signals.filter((s) => s.direction === SignalDirection.SHORT);
    if (!buys.length || !sells.length) return signals;
    const preferBuy = preferSide
      ? preferSide === 'buy'
      : this.uiStore.signalFilter().direction !== SignalDirection.SHORT;
    const [chosen, skipped] = preferBuy ? [buys, sells] : [sells, buys];
    this.snackBar.open(
      `${sym}: trading ${preferBuy ? 'buy' : 'sell'} side — ${skipped.length} opposite-direction signal(s) untouched`,
      'Dismiss',
      { duration: 5000 },
    );
    return chosen;
  }

  /**
   * Stage the symbol's signal-sourced equity ticket(s) (#1017 — the Trade
   * path). Loads account config, dedupes by symbol+side inside the builder
   * (one ticket per direction present in the signals — callers pass a
   * single-direction set, so one ticket). Pessimistic persist: the dialog
   * may submit immediately, so the create must land before the callable
   * reads it — same contract as the gallery's stageCardTicket (#1017 r1).
   */
  private async stageTicketsForSymbol(symbol: string, signals: StSignalItem[], runId: string): Promise<EquityOrderTicket[]> {
    let accountNumber: string;
    let defaultDollarAmount: number;
    try {
      // ensureConfig — NOT loadConfig: the dialog binds the service's
      // `config` signal, which only ensureConfig/warmConfig populate.
      // loadConfig would leave it null and disable the Place Order
      // button on this page (#1017 r2).
      const config = await this.tradingConfigService.ensureConfig();
      accountNumber = config?.accountNumber ?? '';
      defaultDollarAmount = config?.defaultDollarAmount ?? DEFAULT_DOLLAR_AMOUNT;
      if (!accountNumber) {
        this.snackBar.open(NO_ACCOUNT_SNACKBAR, 'Dismiss', { duration: 4000 });
        return [];
      }
    } catch (err) {
      console.error('[SignalReviewFacade] Failed to load trading config for staging:', err);
      this.snackBar.open('Failed to stage order — check account config', 'Dismiss', { duration: 4000 });
      return [];
    }

    // Re-probe after the config await — a live equity ticket landing
    // mid-flight must veto the build (#1017 r3 — the caller's probe ran
    // before this await).
    const equity = (this.stagingStore.ticketsBySymbol()[symbol] ?? []).filter(
      (t) => t.instrumentType !== InstrumentType.OPTION,
    );
    if (equity.some(isLiveOrderTicket)) {
      this.snackBar.open(`${symbol}: a live order already exists for this symbol`, 'Dismiss', { duration: 5000 });
      return [];
    }

    const now = new Date();
    const tickets = buildSignalOrderTickets(symbol, signals, {
      runId,
      accountNumber,
      defaultDollarAmount,
      now,
      buildId: (ticketSymbol, side, createdAt) => buildTicketId(ticketSymbol, side, createdAt),
      buildRefId: () => crypto.randomUUID(),
    });
    const staged: EquityOrderTicket[] = [];
    for (const ticket of tickets) {
      if (await this.stagingStore.stageTicketAndWait(ticket)) staged.push(ticket);
    }
    return staged;
  }
}
