/**
 * Portfolio Gallery Facade (#926/#950)
 *
 * Page-level composition seam for the portfolio-v2 gallery. Composes the
 * existing domain stores — PortfolioDashboardStore owns the live-position
 * pipeline (positions+PnL, quotes, orders, account summary, agentic flag),
 * SymbolListStore the symbol profiles and list membership, the allocation
 * services the bucket attributions — and derives PositionCard view-models
 * via the pure position-cards utils. Page-local facet state lives in
 * PortfolioGalleryUiStore.
 *
 * Live positions only: the card pipeline reads equity slices exclusively —
 * options and paper positions can never produce a card.
 */
import { computed, effect, inject, Injectable } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import { PortfolioDashboardStore } from '../../portfolio-dashboard.store';
import { computeAccountPnL } from '../../portfolio-dashboard.helpers';
import { SymbolListStore } from '../../../savant-trader/stores/symbol-list.store';
import { GalleryCardChartStore } from '../../../savant-trader/stores/gallery-card-chart.store';
import { PositionAttributionService } from '../../position-attribution.service';
import { AllocationBucketService } from '../../allocation-bucket.service';
import { PortfolioGalleryUiStore } from './portfolio-gallery-ui.store';
import { CardChartTimeframe, SymbolListFilter } from '../../../savant-trader/common/constants';
import type { AllocationBucket, PositionAttribution } from '@portfolio-allocation/contracts';
import {
  buildPositionCards,
  filterPositionCards,
  sortFlatPositionCards,
  PositionCard,
  PositionGroupDimension,
  PositionSide,
} from './utils/position-cards.util';

/** Account-level values for the header summary strip. */
export interface PortfolioGallerySummary {
  totalValue: number | null;
  equityValue: number | null;
  cash: number | null;
  buyingPower: number | null;
  /** Equity day P&L — Σ (mark − previousClose) × qty over held positions. */
  dayPnl: number | null;
  unrealizedPnl: number | null;
  unprotectedCount: number;
}

@Injectable({ providedIn: 'root' })
export class PortfolioGalleryFacade {
  private readonly dashboard = inject(PortfolioDashboardStore);
  private readonly symbolStore = inject(SymbolListStore);
  private readonly uiStore = inject(PortfolioGalleryUiStore);
  private readonly cardChartStore = inject(GalleryCardChartStore);
  private readonly attributionService = inject(PositionAttributionService);
  private readonly bucketService = inject(AllocationBucketService);

  // -- Account set -----------------------------------------------------------

  readonly accounts = computed(() => this.dashboard.accounts());
  /** Agentic-enabled accounts only — the page never renders manual accounts. */
  readonly agenticAccounts = computed(() => this.accounts().filter((a) => a.agenticAllowed));
  readonly agenticAccountIndex = computed(() => this.accounts().findIndex((a) => a.agenticAllowed));
  /** The account the page renders — the dashboard's selected account gated
   *  on agenticAllowed so a manual account never produces cards, even in
   *  the window before the correction effect repins the selection. */
  readonly account = computed(() => {
    const acct = this.dashboard.selectedAccount();
    return acct?.agenticAllowed ? acct : null;
  });
  /** Load finished with zero accounts or none agentic-enabled — a distinct
   *  error state, not an empty grid. */
  readonly noAgenticAccount = computed(
    () =>
      !this.dashboard.globalLoading() &&
      !this.dashboard.loadError() &&
      this.agenticAccountIndex() < 0,
  );

  // -- Allocation buckets ------------------------------------------------------

  /** Selected account's number — a primitive, so the computed only emits
   *  on a real account switch. Keying the watch streams on this (rather
   *  than the AccountState object, which is rebuilt by every patch) means
   *  one Firestore listener pair per account, not per patch. */
  private readonly accountNumber = computed(() => this.account()?.accountNumber ?? null);

  /** Position attributions for the selected account — resubscribed only
   *  when the account actually changes. */
  private readonly attributions = toSignal(
    toObservable(this.accountNumber).pipe(
      switchMap((num: string | null) =>
        num ? this.attributionService.watchAttributions$(num) : of([]),
      ),
    ),
    { initialValue: [] as PositionAttribution[] },
  );

  private readonly buckets = toSignal(
    toObservable(this.accountNumber).pipe(
      switchMap((num: string | null) =>
        num ? this.bucketService.watchBuckets$(num) : of([]),
      ),
    ),
    { initialValue: [] as AllocationBucket[] },
  );

  /** symbol → bucket display name. Equity attributions key on
   *  `instrumentId === symbol`; a dangling bucketId resolves to nothing
   *  (the card shows unassigned, never a stale id). */
  private readonly bucketNameBySymbol = computed((): Map<string, string> => {
    const nameById = new Map(this.buckets().map((b) => [b.id, b.name]));
    const map = new Map<string, string>();
    for (const a of this.attributions()) {
      const name = nameById.get(a.bucketId);
      if (name) map.set(a.instrumentId, name);
    }
    return map;
  });

  // -- Cards -------------------------------------------------------------------

  /** All position cards for the selected account — one per live equity
   *  position held, no triage state. */
  readonly cards = computed((): PositionCard[] => {
    const acct = this.account();
    if (!acct) return [];
    return buildPositionCards(
      acct.accountNumber,
      this.dashboard.equityPositionsWithPnL(),
      acct.equityQuotes.data,
      this.dashboard.openOrders(),
      this.symbolStore.profilesBySymbol(),
      this.bucketNameBySymbol(),
    );
  });

  private readonly listContext = computed(() => ({
    symbolLists: this.symbolStore.symbolLists(),
    exclusiveListKeys: this.symbolStore.exclusiveListKeys(),
  }));

  private readonly activeFilter = computed(() => ({
    side: this.uiStore.side(),
    listFilter: this.uiStore.listFilter(),
  }));

  /** Filtered cards — side + list membership. */
  readonly visibleCards = computed(() =>
    filterPositionCards(this.cards(), this.activeFilter(), this.listContext()),
  );

  /** Flat mode ordering — company market cap desc. Grouped rendering lands
   *  in the card/grid task (#951); until then this is the render set. */
  readonly flatCards = computed(() => sortFlatPositionCards(this.visibleCards()));

  /** Cards exist but every one is filtered out — distinct empty state. */
  readonly allFilteredOut = computed(
    () => this.cards().length > 0 && this.visibleCards().length === 0,
  );

  readonly cardCount = computed(() => this.visibleCards().length);
  readonly totalCardCount = computed(() => this.cards().length);

  /** Unprotected positions — the morning headline. */
  readonly unprotectedCount = computed(
    () => this.cards().filter((c) => !c.protected).length,
  );

  // -- Summary strip -------------------------------------------------------------

  readonly summary = computed((): PortfolioGallerySummary => {
    const acct = this.account();
    const snap = acct?.portfolio.data ?? null;
    const dayPnl = this.cards().reduce<number | null>((acc, c) => {
      if (c.dayChange === null) return acc;
      // Signed qty: a short's day P&L is opposite its per-share day change.
      return (acc ?? 0) + c.dayChange * c.quantity;
    }, null);
    return {
      totalValue: snap?.totalValue ?? null,
      equityValue: snap?.equityValue ?? null,
      cash: snap?.cash ?? null,
      buyingPower: snap?.buyingPower ?? null,
      dayPnl,
      unrealizedPnl: acct ? computeAccountPnL(acct) : null,
      unprotectedCount: this.unprotectedCount(),
    };
  });

  // -- Page states -----------------------------------------------------------------

  /** True while the first account/position load is in flight — once cards
   *  exist the grid stays mounted through refreshes (same invariant as the
   *  signal gallery's pageInitializing). */
  readonly initialLoading = computed(
    () => this.dashboard.globalLoading() && this.cards().length === 0,
  );
  /** Positions section loaded and empty — "No live positions". */
  readonly noPositions = computed(() => {
    const acct = this.account();
    return (
      !this.noAgenticAccount() &&
      acct !== null &&
      acct.equityPositions.data !== null &&
      this.cards().length === 0 &&
      !this.initialLoading()
    );
  });
  readonly loadError = computed(() => this.dashboard.loadError());
  /** Per-slice failures that survived the load — one section erroring
   *  degrades the page (banner + whatever data did load), it doesn't
   *  blank it. */
  readonly partialErrors = computed((): string[] => {
    const acct = this.account();
    if (!acct) return [];
    const sections: [string, string | null][] = [
      ['Portfolio', acct.portfolio.error],
      ['Positions', acct.equityPositions.error],
      ['Quotes', acct.equityQuotes.error],
      ['Orders', acct.equityOrders.error],
    ];
    return sections.flatMap(([label, msg]) => (msg !== null ? [`${label}: ${msg}`] : []));
  });
  readonly refreshing = computed(() => this.dashboard.globalLoading());

  // -- Header bindings ---------------------------------------------------------------

  readonly side = computed(() => this.uiStore.side());
  readonly listFilter = computed(() => this.uiStore.listFilter());
  readonly groupDimension = computed(() => this.uiStore.groupDimension());
  readonly chartTimeframe = computed(() => this.uiStore.chartTimeframe());
  readonly filterOptionGroups = computed(() => this.symbolStore.filterOptionGroups());
  readonly expandedGroups = computed(() => this.uiStore.expandedGroups());

  constructor() {
    /**
     * Keep the dashboard's selected account on an agentic-enabled one —
     * the dashboard's position/order/summary computeds key off
     * selectedAccountIndex, and the page must not render a manual
     * account's book. Covers the post-refresh re-sort too (loadAccounts
     * resets the index to 0).
     */
    effect(() => {
      const accounts = this.dashboard.accounts();
      const idx = this.agenticAccountIndex();
      if (idx < 0) return;
      const sel = accounts[this.dashboard.selectedAccountIndex()];
      if (sel && !sel.agenticAllowed) this.dashboard.selectAccount(idx);
    });

    /**
     * Profile-load retry: getAllSymbols fails soft ([] + profilesLoaded
     * stays false), so a transient miss would otherwise degrade the whole
     * session — no tier chips, no sector/industry, no cap sort. loadProfiles
     * self-guards (loaded or in-flight → no-op), so re-firing it on any
     * card/globalLoading transition is safe and gives every refresh cycle
     * a retry. On success profilesLoaded flips → the effect settles.
     */
    effect(() => {
      if (this.symbolStore.profilesLoaded()) return;
      if (this.dashboard.globalLoading()) return;
      if (this.cards().length === 0) return;
      void this.symbolStore.loadProfiles();
    });
  }

  /**
   * Enter the page: reset page-local facets, pin the account selection to
   * the first agentic account, warm the session-cached symbol profiles,
   * clear the session-permanent chart bar cache, and refresh the live
   * pipeline.
   */
  enterPage(): void {
    this.uiStore.resetForPage();
    const idx = this.agenticAccountIndex();
    const sel = this.dashboard.accounts()[this.dashboard.selectedAccountIndex()];
    if (idx >= 0 && sel && !sel.agenticAllowed) this.dashboard.selectAccount(idx);
    void this.symbolStore.loadProfiles();
    this.symbolStore.loadSymbolLists();
    this.cardChartStore.clearCache();
    void this.dashboard.refresh();
  }

  /** Manual refresh — reloads the live pipeline and drops the bar cache so
   *  a new trading day's bars aren't hidden by session-permanent entries.
   *  loadProfiles is guarded — a no-op once loaded, a retry after a failed
   *  first attempt. */
  refresh(): void {
    this.cardChartStore.clearCache();
    void this.symbolStore.loadProfiles();
    void this.dashboard.refresh();
  }

  // -- Facet events -----------------------------------------------------------------

  setSide(side: 'all' | PositionSide): void {
    this.uiStore.setSide(side);
  }

  setListFilter(listFilter: SymbolListFilter): void {
    this.uiStore.setListFilter(listFilter);
  }

  setGroupDimension(dimension: PositionGroupDimension): void {
    this.uiStore.setGroupDimension(dimension);
  }

  /** Header chart D/W toggle — re-syncs every card chart via the seq bump. */
  setChartTimeframe(timeframe: CardChartTimeframe): void {
    this.uiStore.setChartTimeframe(timeframe);
  }
}
