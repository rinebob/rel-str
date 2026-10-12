/**
 * Position Card Chart (#952)
 *
 * The portfolio-v2 card chart — the same quick-charts daily configuration
 * the signal gallery's card chart renders (trend bands, trend strength,
 * zone V1/V2 panes, weekly HTF window, callable signal/uptick dots), minus
 * the signal-entity layer: a position has no occurrences, so there are no
 * card signal dots and no GalleryCard input — the component binds a bare
 * `symbol`. That is the concrete "same chart, different entity" boundary.
 *
 * Mounted lazily by the card's @defer (on viewport). Bars come from
 * GalleryCardChartStore — shared per symbol, prefetched on idle by the
 * page — so mounting is render-only in the common path.
 *
 * KEPT IN SYNC WITH gallery-card-chart.component.ts — the interval lane,
 * leaf selectors, extras, config scaffold, and grant machinery mirror it
 * deliberately. A fix landing there (mount-queue protocol, new
 * per-interval data slot, selector perf) must be ported here by hand —
 * the two are expected to diverge (overlays land in a later thread), not
 * to drift silently.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';

import { GalleryCardChartStore } from '../../../../../savant-trader/stores/gallery-card-chart.store';
import { GalleryChartMountQueueService } from '../../../../../savant-trader/services/gallery-chart-mount-queue.service';
import { IndicatorSeriesStore } from '../../../../../savant-trader/stores/indicator-series.store';
import {
  DEFAULT_CHART_INDICATORS,
  DEFAULT_CHART_INTERVALS,
  DEFAULT_CHART_STRATEGIES,
} from '../../../../../savant-trader/stores/chart.store';
import {
  CARD_CHART_VISIBLE_BARS,
  CARD_CHART_MIN_VISIBLE_BARS,
  CARD_CHART_BAR_STEP,
} from '../../../../../savant-trader/components/gallery-card-chart/gallery-card-chart.component';
import { PortfolioGalleryUiStore } from '../../portfolio-gallery-ui.store';
import { FlexChartComponent } from '../../../../../shared/components/flex-chart/flex-chart.component';
import {
  ChartIntervalKey,
  StIndicator,
  type FlexChartConfig,
  type FlexChartDataset,
  type IndicatorConfig,
} from '../../../../../shared/components/flex-chart/flex-chart.types';
import { BarsInterval } from '../../../../../../core/models/partner.types';
import {
  addChartExtras,
  buildBaseIndicators,
  buildConfigForId,
  injectCallableIndicatorData,
  createExtrasSignals,
  ST_ZONE_WINDOW_MONTHLY_INDICATOR,
  ST_ZONE_WINDOW_WEEKLY_INDICATOR,
  type ChartExtras,
} from '../../../../../savant-trader/utils/chart-indicators';
import { CardChartTimeframe, SignalTimeframe } from '../../../../../savant-trader/common/constants';

/** Reserved chart-config name — 'Position Chart' maps to this same card
 *  chart in v1. Position-specific overlays (entry price, stop levels)
 *  land in a later thread; registering the name now pins the vocabulary
 *  so a future PositionChartConfig slot doesn't drift. */
export const POSITION_CHART_CONFIG_NAME = 'Position Chart';

@Component({
  selector: 'app-position-card-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FlexChartComponent],
  templateUrl: './position-card-chart.component.html',
  styleUrl: './position-card-chart.component.scss',
})
export class PositionCardChartComponent {
  private readonly chartStore = inject(GalleryCardChartStore);
  private readonly indicatorStore = inject(IndicatorSeriesStore);
  private readonly uiStore = inject(PortfolioGalleryUiStore);

  readonly symbol = input.required<string>();

  /** Effective chart interval: the header-driven page level, locally
   *  overridable by the per-card D/W chip. Read from the UI store
   *  directly — the value+seq pair needs no plumbing through passthrough
   *  inputs (#819 r2). `linkedSignal` resets the override whenever the
   *  header clicks: `chartTimeframeSeq` bumps on EVERY Chart click — a
   *  same-value click still re-syncs every card because same-value sets
   *  can't propagate through a plain signal. */
  readonly interval = linkedSignal<readonly [CardChartTimeframe, number], ChartIntervalKey>({
    source: () => [this.uiStore.chartTimeframe(), this.uiStore.chartTimeframeSeq()] as const,
    computation: ([tf]) =>
      tf === SignalTimeframe.WEEKLY ? ChartIntervalKey.WEEKLY : ChartIntervalKey.DAILY,
  });

  /** Per-card D/W chip — overrides the header-driven interval until the
   *  next header change. Narrowed to D|W — monthly isn't a card interval. */
  setChartInterval(interval: ChartIntervalKey.DAILY | ChartIntervalKey.WEEKLY): void {
    this.interval.set(interval);
  }

  readonly ChartIntervalKey = ChartIntervalKey;
  readonly BAR_STEP = CARD_CHART_BAR_STEP;

  /** Per-card visible-bar count — ±50 chips adjust it in-session (#819),
   *  floored at CARD_CHART_MIN_VISIBLE_BARS and capped at loaded bars. */
  readonly visibleBars = signal(CARD_CHART_VISIBLE_BARS);
  readonly canRemoveBars = computed(() => this.visibleBars() > CARD_CHART_MIN_VISIBLE_BARS);
  readonly canAddBars = computed(
    () => this.visibleBars() < (this.bars()?.length ?? 0),
  );
  adjustVisibleBars(delta: number): void {
    const ceiling = Math.max(this.bars()?.length ?? 0, CARD_CHART_MIN_VISIBLE_BARS);
    this.visibleBars.update((v) =>
      Math.max(CARD_CHART_MIN_VISIBLE_BARS, Math.min(v + delta, ceiling)),
    );
  }

  private readonly version = computed(() => this.chartStore.versionFor()(this.symbol()));

  /** Indicator callable response for this card's symbol — shares the
   *  IndicatorSeriesStore cache with quick-charts (same filter set). The
   *  store warms it after bars land; until then indicators render empty
   *  and fill in without a remount. */
  private readonly indicatorResponse = computed(() => {
    const symbol = this.symbol();
    const version = this.version();
    if (!symbol || !version) return undefined;
    return this.indicatorStore.responseFor()(
      symbol,
      version,
      DEFAULT_CHART_INTERVALS,
      DEFAULT_CHART_INDICATORS,
      DEFAULT_CHART_STRATEGIES,
    );
  });

  private readonly dailyIntervalData = computed(() => this.indicatorResponse()?.intervals?.daily);
  private readonly weeklyIntervalData = computed(() => this.indicatorResponse()?.intervals?.weekly);
  private readonly extrasSignals = createExtrasSignals(this.dailyIntervalData, this.weeklyIntervalData);

  /** Per-interval leaf selectors — one computed per slot. The store's
   *  bars/error maps are single signals, so ANY symbol's patch dirties
   *  every mounted card's reads; each leaf re-evaluates to the SAME value
   *  for an unrelated symbol and propagation stops. A single lane object
   *  returned a fresh {} on every patch and rebuilt every chart's
   *  config ×N symbols — the flat-page hang with 16+ cards. Errors stay
   *  interval-scoped via the store's separate daily/weekly slots. */
  private readonly weekly = computed(() => this.interval() === ChartIntervalKey.WEEKLY);
  private readonly laneInterval = computed(() =>
    this.weekly() ? ChartIntervalKey.WEEKLY : ChartIntervalKey.DAILY);
  private readonly laneBarsInterval = computed(() =>
    this.weekly() ? BarsInterval.WEEKLY : BarsInterval.DAILY);
  private readonly laneDataKey = computed<'daily' | 'weekly'>(() =>
    this.weekly() ? 'weekly' : 'daily');
  readonly bars = computed(() =>
    this.weekly()
      ? this.chartStore.weeklyBarsFor()(this.symbol())
      : this.chartStore.barsFor()(this.symbol()));
  private readonly loadError = computed(() =>
    this.weekly()
      ? this.chartStore.weeklyErrorFor()(this.symbol())
      : this.chartStore.errorFor()(this.symbol()));
  private readonly intervalData = computed(() =>
    this.weekly() ? this.weeklyIntervalData() : this.dailyIntervalData());
  private readonly extras = computed<ChartExtras>(() => ({
    htfWindow: {
      option: this.weekly() ? ST_ZONE_WINDOW_MONTHLY_INDICATOR : ST_ZONE_WINDOW_WEEKLY_INDICATOR,
      data: this.weekly() ? this.extrasSignals.windowDataMonthlyOnWeekly() : this.extrasSignals.windowDataWeeklyOnDaily(),
    },
    signalDots: this.weekly() ? this.extrasSignals.weeklySignalDots() : this.extrasSignals.dailySignalDots(),
    uptickDotsV1: this.weekly() ? this.extrasSignals.weeklyUptickDotsV1() : this.extrasSignals.dailyUptickDotsV1(),
    uptickDotsV2: this.weekly() ? this.extrasSignals.weeklyUptickDotsV2() : this.extrasSignals.dailyUptickDotsV2(),
  }));
  /** Pending = nothing cached yet and no error — covers the store's own
   *  loading flag implicitly (bars stay undefined until the read lands). */
  readonly loading = computed(() => this.bars() === undefined && this.loadError() === null);
  /** Empty bars mean the fetch resolved with nothing usable — the service
   *  swallows transport failures into [], so empty and error converge on
   *  the same 'unavailable' placeholder (AC: failure can't break the grid). */
  readonly unavailable = computed(
    () => this.loadError() !== null || this.bars()?.length === 0,
  );

  readonly dataset = computed<FlexChartDataset>(() => ({
    symbol: this.symbol(),
    interval: this.laneBarsInterval(),
    bars: this.bars() ?? [],
  }));

  readonly config = computed<FlexChartConfig>(() => {
    const bars = this.bars() ?? [];
    // Same stack as the matching quick-charts interval: base panes +
    // callable series + HTF window + callable signal/uptick dots. The
    // card's own occurrence dots are the signal-only layer — a position
    // has none, so no overlay indicator is added here.
    const base = injectCallableIndicatorData(
      buildBaseIndicators(this.laneInterval()),
      this.intervalData(),
      bars,
      this.laneDataKey(),
    );
    const withExtras = addChartExtras(base, this.extras());
    // ST StdDevLines — locally computed overlay (period-50 center +
    // deviation bands); cards get it on both intervals so the D/W flip
    // keeps the same context.
    const stdDevCfg = buildConfigForId(StIndicator.ST_STD_DEV_LINES);
    const indicators: IndicatorConfig[] = [
      ...withExtras,
      ...(stdDevCfg ? [stdDevCfg] : []),
    ];
    return {
      indicators,
      interval: this.laneInterval(),
      visibleBars: this.visibleBars(),
      logScale: true,
      showCrosshair: false,
      showZoomToolbar: false,
      enableScrollbar: false,
    };
  });

  /**
   * Mount-once latch (#952): positions are a bounded card set, so unlike
   * the signal gallery — where an unbounded scroll accumulated Syncfusion
   * instances and viewport-unmounting was the right tradeoff — a mounted
   * chart here stays mounted. Scroll-out never destroys it: the
   * destroy/remount cycle flashed and reflowed the page on re-entry.
   *
   * The observer gates the FIRST mount — the card's @defer already creates
   * this component near the viewport, so the observer is effectively a
   * has-ever-intersected signal; the 600px rootMargin on `.pg-body` only
   * matters for a remount after data loss. After that first mount the
   * latch holds until the bars disappear (cache clear/refresh), which
   * releases it so the refetched mount re-paces through the queue instead
   * of rendering stale.
   *
   * Assumed bound: the latch trades memory for stability — every mounted
   * Syncfusion instance stays live for the session. That bound is the
   * user's live position count (realistically tens of cards); the signal
   * gallery's unbounded scroll is what forced the viewport-unmount there.
   *
   * `mounted = granted` (#860): every Syncfusion mount goes through the
   * mount queue's per-frame grant, so a viewport/refresh burst can't run
   * N synchronous mounts in one pass.
   */
  private readonly inWindow = signal(false);
  private readonly granted = signal(false);
  readonly mounted = this.granted.asReadonly();

  private readonly el = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly mountQueue = inject(GalleryChartMountQueueService);
  private grantTicket = 0;
  private grantPending = false;

  constructor() {
    const host = this.el.nativeElement as HTMLElement;
    const observer = new IntersectionObserver(
      // Last entry is freshest — batched out→in transitions deliver both.
      // Empty batch fails closed (off-window); the IO contract delivers ≥1.
      (entries) => this.inWindow.set(entries[entries.length - 1]?.isIntersecting ?? false),
      {
        root: host.closest('.pg-body'), // null → viewport fallback
        rootMargin: '600px 0px',
      },
    );
    observer.observe(host);
    this.destroyRef.onDestroy(() => {
      observer.disconnect();
      this.grantTicket++; // invalidate a grant queued before destroy
    });

    // Request a mount grant only when there's something worth mounting:
    // requesting while `loading` would flip `mounted` without creating the
    // chart, letting the real Syncfusion mount slip past the queue on the
    // bars patch (860 review). Scroll-out does NOT release the grant —
    // the latch keeps the chart alive; only losing the bars (cache clear)
    // releases it so the remount paces again.
    effect(() => {
      const hasData = (this.bars()?.length ?? 0) > 0 && this.loadError() === null;
      if (!hasData) {
        this.granted.set(false);
        this.grantTicket++;
        this.grantPending = false;
        return;
      }
      if (this.granted() || this.grantPending || !this.inWindow()) return;
      this.grantPending = true;
      const ticket = ++this.grantTicket;
      this.mountQueue.request(
        () => {
          this.grantPending = false;
          if (this.grantTicket === ticket) this.granted.set(true);
        },
        // Re-check the data legs too — the ticket only advances when the
        // effect runs, so a pre-flush store patch could otherwise grant a
        // mount that produces nothing. `inWindow` is deliberately absent:
        // a grant queued before a scroll-out still lands — mount-once is
        // the whole point. Self-contained > timing-dependent.
        () =>
          this.grantTicket === ticket &&
          (this.bars()?.length ?? 0) > 0 &&
          this.loadError() === null,
      );
    });

    effect(() => {
      const symbol = this.symbol();
      const weekly = this.interval() === ChartIntervalKey.WEEKLY;
      // Tracked epoch read (#819 r2): clearCache bumps it, so a refresh
      // re-fires this effect and mounted cards re-ensure both intervals —
      // without it a cleared cache strands mounted charts on the loading
      // placeholder (bars → undefined, ensure never re-runs).
      this.chartStore.epoch();
      // untracked: the store's internal state reads inside ensure* are not
      // real dependencies — without it every store patch (any symbol)
      // re-fires this effect in every mounted card.
      untracked(() => {
        this.chartStore.ensureBars(symbol);
        if (weekly) this.chartStore.ensureWeeklyBars(symbol);
      });
    });
  }
}
