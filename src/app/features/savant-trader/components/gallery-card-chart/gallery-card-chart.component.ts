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
  effect,
  inject,
  input,
} from '@angular/core';

import { GalleryCardChartStore } from '../../stores/gallery-card-chart.store';
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
  ST_ZONE_WINDOW_WEEKLY_INDICATOR,
  type ChartScatterPoint,
} from '../../utils/chart-indicators';
import { ST_SIGNAL_DOTS_INDICATOR } from '../../../shared/components/flex-chart/indicators/st-signal-dots.indicator';
import { ST_SIGNAL_DOT_COLORS } from '@flex-chart/indicator-visuals';
import { SignalDirection } from '../../common/constants';
import { toDatePt } from '../../utils/utils';
import type { StSignalItem } from '../../services/types';

/** Visible daily bars on the card chart — wider than the quick-charts 30
 *  so a signal that fired a few weeks back still lands in view. */
export const CARD_CHART_VISIBLE_BARS = 40;

/** Indicator id for the card's own occurrence dots — distinct from the
 *  registered signal-dots id used by the callable's lower-1 markers. */
export const CARD_SIGNAL_DOTS_ID = 'st-card-signal-dots';

/**
 * Signal dots for the card's own occurrences: one dot per firing bar at its
 * close price (falling back to the bar close when the signal is unpriced),
 * colored by direction. Weekly occurrences are dated to their weekly bar and
 * land between daily bars — acceptable at card scale.
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

  readonly card = input.required<GalleryCard>();

  readonly bars = computed(() => this.chartStore.barsFor()(this.card().symbol));
  private readonly version = computed(() => this.chartStore.versionFor()(this.card().symbol));
  /** Pending = nothing cached yet and no error — covers the store's own
   *  loading flag implicitly (bars stay undefined until the read lands). */
  readonly loading = computed(
    () => this.bars() === undefined && this.chartStore.errorFor()(this.card().symbol) === null,
  );
  /** Empty bars mean the fetch resolved with nothing usable — the service
   *  swallows transport failures into [], so empty and error converge on
   *  the same 'unavailable' placeholder (AC: failure can't break the grid). */
  readonly unavailable = computed(
    () => this.chartStore.errorFor()(this.card().symbol) !== null
      || (this.bars() !== undefined && this.bars()!.length === 0),
  );

  readonly dataset = computed<FlexChartDataset>(() => ({
    symbol: this.card().symbol,
    interval: BarsInterval.DAILY,
    bars: this.bars() ?? [],
  }));

  /** Indicator callable response for this card's symbol — shares the
   *  IndicatorSeriesStore cache with quick-charts (same filter set). The
   *  store warms it after bars land; until then indicators render empty
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
  private readonly extras = createExtrasSignals(this.dailyIntervalData, this.weeklyIntervalData);

  readonly config = computed<FlexChartConfig>(() => {
    // Same daily stack as quick-charts: base panes + callable series +
    // HTF window + strategy signal/uptick dots…
    const base = injectCallableIndicatorData(
      buildBaseIndicators(ChartIntervalKey.DAILY),
      this.dailyIntervalData(),
      this.bars() ?? [],
      'daily',
    );
    const withExtras = addChartExtras(base, {
      htfWindow: {
        option: ST_ZONE_WINDOW_WEEKLY_INDICATOR,
        data: this.extras.windowDataWeeklyOnDaily(),
      },
      signalDots: this.extras.dailySignalDots(),
      uptickDotsV1: this.extras.dailyUptickDotsV1(),
      uptickDotsV2: this.extras.dailyUptickDotsV2(),
    });
    // …plus the card's own occurrences as price-pane dots. Distinct id —
    // the callable's signal dots occupy the registered id on lower-1.
    const dotsCfg = buildConfigForId(ST_SIGNAL_DOTS_INDICATOR.id);
    const indicators: IndicatorConfig[] = dotsCfg
      ? [
          ...withExtras,
          {
            ...dotsCfg,
            id: CARD_SIGNAL_DOTS_ID,
            pane: 'overlay' as const,
            data: cardSignalDots(this.card().occurrences, this.bars() ?? []),
          },
        ]
      : withExtras;
    return {
      indicators,
      interval: ChartIntervalKey.DAILY,
      visibleBars: CARD_CHART_VISIBLE_BARS,
      logScale: true,
      showCrosshair: false,
      showZoomToolbar: false,
      enableScrollbar: false,
    };
  });

  constructor() {
    effect(() => this.chartStore.ensureBars(this.card().symbol));
  }
}
