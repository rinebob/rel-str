/**
 * Gallery Facade
 *
 * Page-level composition seam for the gallery view (#743/#754). Composes the
 * existing domain stores — GroupStore owns the active run + signal symbols,
 * SymbolHistoryStore the per-symbol occurrences, SymbolListStore the list
 * catalog, OccurrenceDecisionStore the durable decisions, OrderTicketStore
 * the staged/live tickets — and derives symbol+side card view-models via the
 * pure gallery-cards utils. Page-local filter/group state lives in
 * GalleryUiStore.
 *
 * Card decision mutations live in GalleryCardActionsService — this facade
 * stays the read-only view-model seam.
 */
import { computed, effect, inject, Injectable, linkedSignal } from '@angular/core';

import { StStore } from './st.store';
import { GroupStore } from './group.store';
import { SymbolHistoryStore } from './symbol-history.store';
import { hasPendingRunHistory, signalsBySymbolForRun } from '../utils/utils';
import { OccurrenceDecisionStore } from './occurrence-decision.store';
import { SymbolListStore } from './symbol-list.store';
import { OrderTicketStore } from './order-ticket.store';
import { GalleryCardChartStore } from './gallery-card-chart.store';
import { GalleryUiStore } from './gallery-ui.store';
import { StSignalItem, StRun } from '../services/types';
import { CardChartTimeframe, GroupDimension, SignalDirection, SignalTimeframe, SymbolListFilter } from '../common/constants';
import { SYSTEM_LIST_KEYS } from '../common/symbol-list-defs';
import {
  buildGalleryCards,
  filterGalleryCards,
  groupGalleryCards,
  retainGalleryCards,
  sunkGalleryGroup,
  GalleryActionContext,
  GalleryCard,
  GalleryFilter,
  GalleryGroup,
  GalleryListContext,
} from '../utils/gallery-cards.util';
import { enrichGalleryCards, isSunkCard } from '../utils/gallery-card-actions.util';

@Injectable({ providedIn: 'root' })
export class GalleryFacade {
  private readonly agentStore = inject(StStore);
  private readonly groupStore = inject(GroupStore);
  private readonly historyStore = inject(SymbolHistoryStore);
  private readonly occurrenceStore = inject(OccurrenceDecisionStore);
  private readonly symbolListStore = inject(SymbolListStore);
  private readonly ticketStore = inject(OrderTicketStore);
  private readonly uiStore = inject(GalleryUiStore);
  private readonly cardChartStore = inject(GalleryCardChartStore);

  /** Active-run context for the header. */
  readonly viewedRun = computed((): StRun | null => this.groupStore.viewedRun());
  /** Viewed run's market date — falls back to the value captured at
   *  setActiveRun when the run has aged out of the realtime stream window. */
  readonly runMarketDate = computed(() => this.groupStore.activeRunMarketDate());

  /** Run-scoped occurrences keyed by symbol, from the shared history cache. */
  private readonly signalsBySymbol = computed((): Record<string, StSignalItem[]> => {
    const runId = this.groupStore.activeRunId();
    if (!runId) return {};
    return signalsBySymbolForRun(this.historyStore.signalHistoryCache(), runId);
  });

  /** All gallery cards for the active run — one per symbol+side. */
  readonly cards = computed((): GalleryCard[] =>
    buildGalleryCards(this.groupStore.signalSymbols(), this.signalsBySymbol()),
  );

  private readonly listContext = computed((): GalleryListContext => ({
    symbolLists: this.symbolListStore.symbolLists(),
    exclusiveListKeys: this.symbolListStore.exclusiveListKeys(),
  }));

  private readonly activeFilter = computed((): GalleryFilter => ({
    timeframe: this.uiStore.timeframe(),
    direction: this.uiStore.direction(),
    listFilter: this.uiStore.listFilter(),
  }));

  /** Decision/ticket/monitor context for reject-trim + status derivation (#755). */
  private readonly actionContext = computed((): GalleryActionContext => ({
    runId: this.groupStore.activeRunId() ?? '',
    decisions: this.occurrenceStore.occurrenceDecisions(),
    ticketsBySymbol: this.ticketStore.ticketsBySymbol(),
    monitorSymbols: new Set(this.symbolListStore.symbolLists()[SYSTEM_LIST_KEYS.MONITOR] ?? []),
  }));

  /** Filtered, status-enriched cards feeding the grouped grid.
   *  linkedSignal carries the previous result so retainGalleryCards can
   *  keep unchanged cards' object identity across upstream patches
   *  (tickets, decisions, history) — without it each patch churns every
   *  card input and re-renders every mounted card chart (#838, #819 r2).
   *  A custom `equal` couldn't retain per-element identity — it would
   *  keep/drop the whole array. */
  private readonly _visibleCards = linkedSignal({
    source: (): GalleryCard[] =>
      enrichGalleryCards(
        filterGalleryCards(this.cards(), this.activeFilter(), this.listContext(), this.actionContext()),
        this.actionContext(),
      ),
    computation: (next: GalleryCard[], prev?: { value: GalleryCard[] }) =>
      retainGalleryCards(prev?.value ?? [], next),
  });
  readonly visibleCards = this._visibleCards.asReadonly();

  /** Cards exist for the run but every one is filtered out. */
  readonly allFilteredOut = computed(() => this.cards().length > 0 && this.visibleCards().length === 0);

  /**
   * Visible cards bucketed by the active grouping dimension (#783) —
   * sector/industry/market-cap, mirroring signal-review. Filters apply
   * first (visibleCards), then grouping; within-group order is
   * marketCap desc. Sunk cards (#755 — watched/settled/failed) leave the
   * dimension groups entirely and collect in a pinned "Sunk" panel at the
   * bottom, ordered by action time desc. GroupDimension.NONE (#820) skips
   * dimension grouping entirely — only the Sunk panel remains (it's a
   * lifecycle bucket, not a dimension group) and the page renders
   * `flatCards` above it.
   */
  readonly groups = computed((): GalleryGroup[] => {
    const cards = this.visibleCards();
    const dim = this.uiStore.groupDimension();
    const groups =
      dim === GroupDimension.NONE
        ? []
        : groupGalleryCards(
            cards.filter((c) => !isSunkCard(c)),
            dim,
          );
    const sunk = cards.filter(isSunkCard);
    if (sunk.length) groups.push(sunkGalleryGroup(sunk));
    return groups;
  });

  /** Flat gallery mode (#820) — true when the Group dropdown selects
   *  "None"; the page renders `flatCards` with no expandos. */
  readonly ungrouped = computed(() => this.uiStore.groupDimension() === GroupDimension.NONE);

  /** Non-sunk visible cards in flat mode, ordered by market cap desc —
   *  the same comparator groups use within each bucket. */
  readonly flatCards = computed((): GalleryCard[] =>
    this.visibleCards()
      .filter((c) => !isSunkCard(c))
      .sort((a, b) => (b.profile.marketCap ?? 0) - (a.profile.marketCap ?? 0)),
  );

  /** True when every visible group is expanded (drives the expand-all icon). */
  readonly allGroupsExpanded = computed(() =>
    this.groups().length > 0 &&
    this.groups().every((g) => this.uiStore.expandedGroups()[g.key] ?? false),
  );

  /** Expansion overrides — read by the template as `map[key] ?? false`. */
  readonly expandedGroups = computed(() => this.uiStore.expandedGroups());

  /** Error from the signal-symbols load, surfaced as an empty-state message. */
  readonly loadError = computed(() => this.groupStore.symbolsError());

  /**
   * True while the page is still acquiring its initial data — covers the run
   * resolution, the symbol-list load, and the per-symbol history fan-out that
   * `loadSymbolsWithSignals` kicks off. Without the history leg the grid would
   * flash "No signals for this run" while occurrences are still arriving.
   */
  readonly pageInitializing = computed(() => {
    const runId = this.groupStore.activeRunId();
    // No run yet: still initializing until the stream emits AND any latest
    // completed run has been claimed by the auto-select effect — otherwise
    // the grid flashes "No signals" for the frame between emission and the
    // effect's setActiveRun.
    if (!runId) {
      return !this.agentStore.runsReceived() || !!this.agentStore.latestCompletedRun();
    }
    // Once cards exist the grid stays mounted through reloads — refresh
    // patches state in place (retainGalleryCards). Tearing down here would
    // reset scroll position, per-card chart overrides, and every mounted
    // chart on every refresh click (#838 review M2).
    if (this.cards().length > 0) return false;
    return (
      this.groupStore.symbolsLoading() ||
      this.symbolListStore.symbolListsLoading() ||
      hasPendingRunHistory(this.historyStore.signalHistoryLoading(), runId)
    );
  });

  // -- Header bindings -------------------------------------------------------

  readonly timeframe = computed(() => this.uiStore.timeframe());
  /** Interval every card chart renders on (DAILY|WEEKLY) — decoupled from
   *  the `timeframe` signal filter. */
  readonly chartTimeframe = computed(() => this.uiStore.chartTimeframe());
  readonly direction = computed(() => this.uiStore.direction());
  readonly listFilter = computed(() => this.uiStore.listFilter());
  readonly groupDimension = computed(() => this.uiStore.groupDimension());
  readonly filterOptionGroups = computed(() => this.symbolListStore.filterOptionGroups());
  readonly cardCount = computed(() => this.visibleCards().length);

  constructor() {
    /**
     * Auto-select the latest completed run on direct page load — same
     * pattern as SignalReviewFacade. setActiveRun cascades symbol +
     * occurrence + decision loads.
     */
    effect(() => {
      const latest = this.agentStore.latestCompletedRun();
      if (!latest) return;
      if (this.groupStore.activeRunId()) return;
      this.groupStore.setActiveRun(latest.id, latest.marketDate ?? '');
    });
  }

  /**
   * Enter the gallery page: reset page-local filters, resolve the latest
   * completed run (via the runs stream when not yet selected), and eagerly
   * load signals, decisions, lists, and tickets.
   */
  enterGallery(): void {
    this.uiStore.resetForPage();
    // Clear the bar cache on entry, not just refresh — a run can change
    // while the user is on another page (shared GroupStore), and the
    // cache is session-permanent otherwise (#819 r2 review).
    this.cardChartStore.clearCache();
    if (this.groupStore.activeRunId()) {
      this.reloadRunData();
    } else {
      this.agentStore.loadData();
    }
  }

  /** Reload the current run's symbols (which fans out per-symbol history),
   *  decisions, and tickets — the shared enter/refresh reload path. */
  private reloadRunData(): void {
    if (!this.groupStore.symbolsLoading()) {
      this.groupStore.loadSymbolsWithSignals();
    }
    if (!this.occurrenceStore.loading()) {
      this.occurrenceStore.loadRecentDecisions();
    }
    this.ticketStore.loadTickets();
  }

  /** True while the current run's symbols are (re)loading — disables the
   *  header refresh button so a double-click can't fan out duplicate reads. */
  readonly refreshing = computed(() => this.groupStore.symbolsLoading());

  /**
   * Header refresh (#838): if a newer completed run has landed in the
   * realtime stream, switch to it — setActiveRun cascades triage reset +
   * decisions + symbols + per-symbol history fan-out. Otherwise reload the
   * current run's data. Page filters/group expansion are preserved —
   * unlike enterGallery this does NOT resetForPage. The card-chart bar
   * cache is cleared either way so a new trading day's bars (or a promoted
   * run) aren't hidden by session-permanent entries.
   */
  refresh(): void {
    this.cardChartStore.clearCache();
    const latest = this.agentStore.latestCompletedRun();
    const activeId = this.groupStore.activeRunId();
    if (latest && latest.id !== activeId) {
      // Promote path — setActiveRun cascades symbols+decisions but not the
      // global ticket list (838 review: tickets staged elsewhere would stay
      // stale until next page entry).
      this.ticketStore.loadTickets();
      this.groupStore.setActiveRun(latest.id, latest.marketDate ?? '');
      return;
    }
    if (!activeId) {
      this.agentStore.loadData();
      return;
    }
    this.reloadRunData();
  }

  // -- Filter/group events ---------------------------------------------------

  setTimeframe(timeframe: SignalTimeframe): void {
    this.uiStore.setTimeframe(timeframe);
  }

  setDirection(direction: SignalDirection): void {
    this.uiStore.setDirection(direction);
  }

  setListFilter(listFilter: SymbolListFilter): void {
    this.uiStore.setListFilter(listFilter);
  }

  setGroupDimension(dimension: GroupDimension): void {
    this.uiStore.setGroupDimension(dimension);
  }

  /** Header chart D/W toggle — re-syncs every card chart (per-card chip
   *  overrides reset via the chart's linkedSignal). Does NOT touch the
   *  signal-timeframe filter. */
  setChartTimeframe(timeframe: CardChartTimeframe): void {
    this.uiStore.setChartTimeframe(timeframe);
  }

  setGroupExpanded(key: string, expanded: boolean): void {
    this.uiStore.setGroupExpanded(key, expanded);
  }

  /** Expand-all / collapse-all over the currently rendered groups. */
  toggleAllGroups(): void {
    const keys = this.groups().map((g) => g.key);
    if (!keys.length) return; // flat mode with no Sunk panel — nothing to toggle
    this.uiStore.setAllGroupsExpanded(keys, !this.allGroupsExpanded());
  }

}
