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
 * Later tasks layer ordering/sink status (#755), chart cells (#756), actions
 * (#757-#758), and ticket staging (#759-#761) on top of this seam.
 */
import { computed, effect, inject, Injectable, signal } from '@angular/core';

import { StStore } from './st.store';
import { GroupStore } from './group.store';
import { SymbolHistoryStore } from './symbol-history.store';
import { hasPendingRunHistory, signalsBySymbolForRun } from '../utils/utils';
import { OccurrenceDecisionStore } from './occurrence-decision.store';
import { SymbolListStore } from './symbol-list.store';
import { OrderTicketStore } from './order-ticket.store';
import { GalleryUiStore } from './gallery-ui.store';
import { TradingConfigService } from '../services/trading-config.service';
import { TradingConfig } from '../services/order-ticket.types';
import { StSignalItem, StRun } from '../services/types';
import { MatSnackBar } from '@angular/material/snack-bar';
import { GroupDimension, SignalDirection, SignalTimeframe, SymbolListFilter } from '../common/constants';
import {
  buildGalleryCards,
  filterGalleryCards,
  groupGalleryCards,
  GalleryCard,
  GalleryFilter,
  GalleryGroup,
  GalleryListContext,
} from '../utils/gallery-cards.util';

@Injectable({ providedIn: 'root' })
export class GalleryFacade {
  private readonly agentStore = inject(StStore);
  private readonly groupStore = inject(GroupStore);
  private readonly historyStore = inject(SymbolHistoryStore);
  private readonly occurrenceStore = inject(OccurrenceDecisionStore);
  private readonly symbolListStore = inject(SymbolListStore);
  private readonly ticketStore = inject(OrderTicketStore);
  private readonly configService = inject(TradingConfigService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly uiStore = inject(GalleryUiStore);

  /** Trading config loaded on enter — needed later for ticket staging (#759). */
  readonly config = signal<TradingConfig | null>(null);

  /** Active-run context for the header. */
  readonly viewedRun = computed((): StRun | null => this.groupStore.viewedRun());

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

  /** Filtered cards feeding the grouped grid. */
  readonly visibleCards = computed((): GalleryCard[] =>
    filterGalleryCards(this.cards(), this.activeFilter(), this.listContext()),
  );

  /** Cards exist for the run but every one is filtered out. */
  readonly allFilteredOut = computed(() => this.cards().length > 0 && this.visibleCards().length === 0);

  /**
   * Visible cards bucketed by the active grouping dimension (#783) —
   * sector/industry/market-cap, mirroring signal-review. Filters apply
   * first (visibleCards), then grouping; within-group order is
   * marketCap desc.
   */
  readonly groups = computed((): GalleryGroup[] =>
    groupGalleryCards(this.visibleCards(), this.uiStore.groupDimension()),
  );

  /** True when every visible group is expanded (drives the expand-all icon). */
  readonly allGroupsExpanded = computed(() =>
    this.groups().length > 0 &&
    this.groups().every((g) => this.uiStore.expandedGroups()[g.key] ?? false),
  );

  /** Expansion overrides — read by the template as `map[key] ?? true`. */
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
    return (
      // No run yet: still initializing until the stream emits AND any latest
      // completed run has been claimed by the auto-select effect — otherwise
      // the grid flashes "No signals" for the frame between emission and the
      // effect's setActiveRun.
      (!runId && (!this.agentStore.runsReceived() || !!this.agentStore.latestCompletedRun())) ||
      this.groupStore.symbolsLoading() ||
      this.symbolListStore.symbolListsLoading() ||
      (!!runId && hasPendingRunHistory(this.historyStore.signalHistoryLoading(), runId))
    );
  });

  // -- Header bindings -------------------------------------------------------

  readonly timeframe = computed(() => this.uiStore.timeframe());
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
   * load signals, decisions, lists, tickets, and trading config.
   */
  enterGallery(): void {
    this.uiStore.resetForPage();
    if (this.groupStore.activeRunId()) {
      if (!this.groupStore.symbolsLoading()) {
        this.groupStore.loadSymbolsWithSignals();
      }
      if (!this.occurrenceStore.loading()) {
        this.occurrenceStore.loadRecentDecisions();
      }
    } else {
      this.agentStore.loadData();
    }
    this.ticketStore.loadTickets();
    this.configService.loadConfig().subscribe({
      next: (config) => this.config.set(config),
      error: (err: unknown) => {
        console.error('[GalleryFacade] Failed to load trading config:', err);
        this.snackBar.open('Failed to load trading config', 'Dismiss', { duration: 5000 });
      },
    });
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

  /** Expansion state for a group — absent key defaults to collapsed. */
  isGroupExpanded(key: string): boolean {
    return this.uiStore.expandedGroups()[key] ?? false;
  }

  setGroupExpanded(key: string, expanded: boolean): void {
    this.uiStore.setGroupExpanded(key, expanded);
  }

  /** Expand-all / collapse-all over the currently rendered groups. */
  toggleAllGroups(): void {
    this.uiStore.setAllGroupsExpanded(
      this.groups().map((g) => g.key),
      !this.allGroupsExpanded(),
    );
  }
}
