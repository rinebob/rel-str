/**
 * Gallery Card Chart (#756)
 *
 * The 'card chart' — the quick-charts daily configuration (trend bands,
 * trend strength, zone V1/V2 panes, weekly HTF window, signal + uptick
 * dots) plus the card's own occurrence dots on the price pane. Chrome is
 * trimmed for card size: no crosshair/toolbar/scrollbar. (Config shape is
 * provisional pending the card-chart grilling.)
 *
 * Mounted lazily by the card's @defer (on viewport). Bars come from
 * GalleryCardChartStore — shared per symbol, prefetched on idle by the
 * page — so mounting is render-only in the common path.
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

import { GalleryCardChartStore } from '../../stores/gallery-card-chart.store';
import { GalleryChartMountQueueService } from '../../services/gallery-chart-mount-queue.service';
import { GalleryUiStore } from '../../stores/gallery-ui.store';
import { IndicatorSeriesStore } from '../../stores/indicator-series.store';
import {
  DEFAULT_CHART_INDICATORS,
  DEFAULT_CHART_INTERVALS,
  DEFAULT_CHART_STRATEGIES,
} from '../../stores/chart.store';
import { GalleryCard } from '../../utils/gallery-cards.util';
import { FlexChartComponent } from '../../../shared/components/flex-chart/flex-chart.component';
import {
  ChartIntervalKey,
  StIndicator,
  type FlexChartConfig,
  type FlexChartDataset,
  type IndicatorConfig,
  type PriceBar,
} from '../../../shared/components/flex-chart/flex-chart.types';
import { BarsInterval } from '../../../../core/models/partner.types';
import {
  addChartExtras,
  buildBaseIndicators,
  buildConfigForId,
  injectCallableIndicatorData,
  createExtrasSignals,
  ST_ZONE_WINDOW_MONTHLY_INDICATOR,
  ST_ZONE_WINDOW_WEEKLY_INDICATOR,
  type ChartExtras,
  type ChartScatterPoint,
} from '../../utils/chart-indicators';
import { ST_SIGNAL_DOTS_INDICATOR } from '../../../shared/components/flex-chart/indicators/st-signal-dots.indicator';
import { ST_SIGNAL_DOT_COLORS } from '@flex-chart/indicator-visuals';
import { CardChartTimeframe, SignalDirection, SignalTimeframe } from '../../common/constants';
import { toDatePt } from '../../utils/utils';
import type { StSignalItem } from '../../services/types';

/** Visible bars on the card chart — wider than the quick-charts 30
 *  so a signal that fired a few weeks back still lands in view. Per-card
 *  ±50 chips adjust this in-session. */
export const CARD_CHART_VISIBLE_BARS = 40;

/** Floor for the per-card visible-bar adjust — matches quick-charts. */
export const CARD_CHART_MIN_VISIBLE_BARS = 30;

/** Step for the per-card ±bars chips — matches quick-charts. */
export const CARD_CHART_BAR_STEP = 50;

/** Indicator id for the card's own occurrence dots — distinct from the
 *  registered signal-dots id used by the callable's lower-1 markers. */
export const CARD_SIGNAL_DOTS_ID = 'st-card-signal-dots';

/**
 * Signal dots for the card's own occurrences: one dot per firing bar at its
 * close price (falling back to the bar close when the signal is unpriced),
 * colored by direction. The caller pre-filters occurrences to the chart's
 * timeframe — dots only ever land on real bars of the rendered interval.
 */
export function cardSignalDots(
  occurrences: StSignalItem[],
  bars: PriceBar[],
): ChartScatterPoint[] {
  const closeByDate = new Map(bars.map((b) => [b.date, b.close]));
  const dots: ChartScatterPoint[] = [];
  for (const occ of occurrences) {
    const y = occ.closePrice ?? closeByDate.get(occ.barDate);
    if (y === undefined) continue;
    dots.push({
      x: toDatePt(occ.barDate),
      y,
      color:
        occ.direction === SignalDirection.SHORT
          ? ST_SIGNAL_DOT_COLORS.short
          : ST_SIGNAL_DOT_COLORS.long,
    });
  }
  return dots;
}

@Component({
  selector: 'app-gallery-card-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FlexChartComponent],
  templateUrl: './gallery-card-chart.component.html',
  styleUrl: './gallery-card-chart.component.scss',
})
export class GalleryCardChartComponent {
  private readonly chartStore = inject(GalleryCardChartStore);
  private readonly indicatorStore = inject(IndicatorSeriesStore);
  private readonly uiStore = inject(GalleryUiStore);

  readonly card = input.required<GalleryCard>();

  /** Effective chart interval: the header-driven page level, locally
   *  overridable by the per-card D/W chip. Read from GalleryUiStore
   *  directly — the value+seq pair needs no plumbing through four layers
   *  of passthrough inputs (#819 r2). `linkedSignal` resets the override
   *  whenever the header clicks: `chartTimeframeSeq` bumps on EVERY Chart
   *  click — a same-value click still re-syncs every card because
   *  same-value sets can't propagate through a plain signal. */
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

  private readonly version = computed(() => this.chartStore.versionFor()(this.card().symbol));

  /** Indicator callable response for this card's symbol — shares the
   *  IndicatorSeriesStore cache with quick-charts (same filter set). The
   *   store warms it after bars land; until then indicators render empty
   *  and fill in without a remount. */
  private readonly indicatorResponse = computed(() => {
    const symbol = this.card().symbol;
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
  private readonly laneTimeframe = computed(() =>
    this.weekly() ? SignalTimeframe.WEEKLY : SignalTimeframe.DAILY);
  readonly bars = computed(() =>
    this.weekly()
      ? this.chartStore.weeklyBarsFor()(this.card().symbol)
      : this.chartStore.barsFor()(this.card().symbol));
  private readonly loadError = computed(() =>
    this.weekly()
      ? this.chartStore.weeklyErrorFor()(this.card().symbol)
      : this.chartStore.errorFor()(this.card().symbol));
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
    symbol: this.card().symbol,
    interval: this.laneBarsInterval(),
    bars: this.bars() ?? [],
  }));

  readonly config = computed<FlexChartConfig>(() => {
    const bars = this.bars() ?? [];
    // Same stack as the matching quick-charts interval: base panes +
    // callable series + HTF window + strategy signal/uptick dots…
    const base = injectCallableIndicatorData(
      buildBaseIndicators(this.laneInterval()),
      this.intervalData(),
      bars,
      this.laneDataKey(),
    );
    const withExtras = addChartExtras(base, this.extras());
    // …plus the card's own occurrences as price-pane dots, filtered to the
    // chart's timeframe — weekly occurrences on a daily chart would land
    // between bars. Distinct id: the callable's signal dots occupy the
    // registered id on lower-1.
    const dotsCfg = buildConfigForId(ST_SIGNAL_DOTS_INDICATOR.id);
    // allOccurrences — the untrimmed set. `occurrences` is already trimmed
    // to the *signal* filter's timeframe upstream, so reading it here would
    // leave zero card dots whenever chart interval ≠ filter (#819 review).
    const occurrences = this.card().allOccurrences.filter((o) => o.timeframe === this.laneTimeframe());
    // ST StdDevLines — locally computed overlay (period-50 center +
    // deviation bands); signal-detail enables it on daily, cards get it
    // on both intervals so the D/W flip keeps the same context.
    const stdDevCfg = buildConfigForId(StIndicator.ST_STD_DEV_LINES);
    const indicators: IndicatorConfig[] = [
      ...withExtras,
      ...(stdDevCfg ? [stdDevCfg] : []),
      ...(dotsCfg
        ? [
            {
              ...dotsCfg,
              id: CARD_SIGNAL_DOTS_ID,
              pane: 'overlay' as const,
              data: cardSignalDots(occurrences, bars),
            },
          ]
        : []),
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
   * Perf: @defer mounts are permanent — scrolling the gallery accumulated
   * a live Syncfusion instance per visited card and never released them.
   * The observer drives `inWindow` — the flex-chart unmounts once the cell
   * is well past the fold; card state (interval, visibleBars) lives on this
   * component and survives remounts, and bars/indicator data are
   * store-cached so a remount renders straight from memory.
   *
   * The observer roots on the page's `.gallery-groups` scroll container —
   * with root=null the scrollport clips the target BEFORE the rootMargin
   * applies, so the 600px margin would be inert (838 review M3). The margin
   * widens the keep-mounted/remount zone — the card's own @defer still
   * controls when this component is created at all.
   *
   * `mounted = inWindow && granted` (#860): every Syncfusion mount — first
   * mount, scroll remount, AND the data-arrival mount — goes through the
   * mount queue's per-frame grant, so a viewport/refresh burst can't run N
   * synchronous mounts in one pass. Leaving the window unmounts immediately
   * via the computed — never queued. A grant queued before a later
   * transition is invalidated by `grantTicket` and skipped free by the
   * queue's stillValid check.
   */
  private readonly inWindow = signal(false);
  private readonly granted = signal(false);
  readonly mounted = computed(() => this.inWindow() && this.granted());

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
        root: host.closest('.gallery-groups'), // null → viewport fallback
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
    // bars patch (860 review). Leaving the window (or losing data) releases
    // the grant so the remount paces again.
    effect(() => {
      const want =
        this.inWindow() && (this.bars()?.length ?? 0) > 0 && this.loadError() === null;
      if (!want) {
        this.granted.set(false);
        this.grantTicket++;
        this.grantPending = false;
        return;
      }
      if (this.granted() || this.grantPending) return;
      this.grantPending = true;
      const ticket = ++this.grantTicket;
      this.mountQueue.request(
        () => {
          this.grantPending = false;
          if (this.grantTicket === ticket) this.granted.set(true);
        },
        // Re-check want's data legs too — the ticket only advances when the
        // effect runs, so a pre-flush store patch could otherwise grant a
        // mount that produces nothing. Self-contained > timing-dependent.
        () =>
          this.grantTicket === ticket &&
          this.inWindow() &&
          (this.bars()?.length ?? 0) > 0 &&
          this.loadError() === null,
      );
    });

    effect(() => {
      const symbol = this.card().symbol;
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
