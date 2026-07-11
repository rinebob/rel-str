import { Injectable, Signal, computed, signal } from '@angular/core';
import type {
  FlexChartConfig,
  FlexChartDataset,
  ComputedIndicatorSeries,
  IndicatorPane,
} from '../flex-chart.types';
import { StIndicator } from '../flex-chart.types';
import { computeIndicators, groupIndicatorsByPane } from '../flex-chart-calculations';
import { computeAllBands, type BandSeriesData } from '../indicators/st-trend-bands.indicator';

export interface LowerPaneView {
  id: IndicatorPane;
  axisName: string;
  series: ComputedIndicatorSeries[];
  useFixedScale: boolean;
  axisMin: number | undefined;
  axisMax: number | undefined;
}

export interface ChartAxisView {
  name: string;
  valueType: 'Double';
  opposedPosition: boolean;
  rowIndex: number;
  minimum: number | undefined;
  maximum: number | undefined;
  labelFormat: string;
  majorGridLines: { width: number; color: string };
  lineStyle: { width: number; color: string };
  crosshairTooltip: { enable: boolean };
  rangePadding: 'None';
  stripLines: {
    start: number;
    size: number;
    sizeType: 'Pixel';
    color: string;
    dashArray: string;
    visible: boolean;
    opacity: number;
    zIndex: 'Over';
    text: string;
    textStyle: { color: string; size: string };
    horizontalAlignment: 'End';
    verticalAlignment: 'Middle';
  }[];
}

/**
 * Transforms `FlexChartDataset` into chart-ready series, panes, axes, and row
 * definitions. Keeps all X-axis index mapping in one place so the shell
 * component does not own data-transformation logic.
 */
@Injectable()
export class ChartDataAdapter {
  // References to the component's input signals. Defaults are only used if any
  // computed is read before connect() is called.
  private chartData: Signal<FlexChartDataset | null> = signal(null);
  private config: Signal<FlexChartConfig> = signal({ indicators: [] });

  /** Bind the adapter to the component's input signals once. */
  connect(
    chartData: Signal<FlexChartDataset | null>,
    config: Signal<FlexChartConfig>,
  ): void {
    this.chartData = chartData;
    this.config = config;
  }

  /** Bars mapped to Category-axis index values with display labels. */
  categoryBars = computed(() => {
    const data = this.chartData();
    if (!data) return [];

    return data.bars.map((bar, index) => {
      const d = bar.x;
      const label = d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
      return {
        index,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        date: bar.x,
        label,
      };
    });
  });

  /** Indicator series with index-based x values for the Category axis. */
  computedSeries = computed<ComputedIndicatorSeries[]>(() => {
    const data = this.chartData();
    const cfg = this.config();
    if (!data || data.bars.length === 0 || cfg.indicators.length === 0) {
      return [];
    }

    const originalSeries = computeIndicators(data.bars, cfg.indicators);

    const dateToIndex = new Map<number, number>();
    data.bars.forEach((bar, idx) => {
      dateToIndex.set(bar.x.getTime(), idx);
    });

    return originalSeries.map((series) => ({
      ...series,
      data: series.data
        .map((point) => {
          if (!point.x) return { ...point, index: -1 };
          const index = dateToIndex.get(point.x.getTime());
          return { ...point, index: index ?? -1 };
        })
        .filter((p) => p.index >= 0),
    }));
  });

  private groupedSeries = computed(() => groupIndicatorsByPane(this.computedSeries()));

  mainPaneSeries = computed(() => this.groupedSeries()['main'] || []);

  /** ST Trend Band candle series — pre-computed bandData when available, otherwise computed from bars. */
  trendBandSeries = computed<BandSeriesData[]>(() => {
    const mainSeries = this.mainPaneSeries();
    const trendBands = mainSeries.find((s) => s.config.type === StIndicator.TREND_BANDS);
    if (!trendBands) return [];

    if (trendBands.config.bandData && trendBands.config.bandData.length > 0) {
      return trendBands.config.bandData;
    }

    const data = this.chartData();
    if (!data || data.bars.length < 30) return [];

    return computeAllBands(data.bars);
  });

  /** Active lower panes derived from current indicators, sorted by pane ID. */
  lowerPanes = computed<LowerPaneView[]>(() => {
    const grouped = this.groupedSeries();
    const paneIds = Object.keys(grouped)
      .filter((id) => id.startsWith('lower-'))
      .sort((a, b) => Number(a.replace('lower-', '')) - Number(b.replace('lower-', ''))) as IndicatorPane[];

    return paneIds.map((paneId) => {
      const series = grouped[paneId];
      const axisName = `lowerYAxis${paneId.replace('lower-', '')}`;
      const useFixedScale = series.some((s) => s.config.options.axisScale === 'fixed-0-100');
      const fixedIndicator = series.find((s) => s.config.options.axisScale === 'fixed');
      const axisMin = fixedIndicator?.config.options.axisMin;
      const axisMax = fixedIndicator?.config.options.axisMax;
      return {
        id: paneId,
        axisName,
        series,
        useFixedScale,
        axisMin,
        axisMax,
      };
    });
  });

  /** Dynamic Y-axes for lower panes. All series share the primary X-axis for zoom sync. */
  chartAxes = computed<ChartAxisView[]>(() => {
    return this.lowerPanes().map((pane, index) => {
      const stripLines = pane.series
        .flatMap((s) => s.config.options.referenceLines || [])
        .map((ref) => ({
          start: ref.value,
          size: 1,
          sizeType: 'Pixel' as const,
          color: ref.color,
          dashArray: ref.dashArray || '',
          visible: true,
          opacity: 1,
          zIndex: 'Over' as const,
          text: ref.label || '',
          textStyle: { color: ref.color, size: '10px' },
          horizontalAlignment: 'End' as const,
          verticalAlignment: 'Middle' as const,
        }));

      return {
        name: pane.axisName,
        valueType: 'Double' as const,
        opposedPosition: true,
        rowIndex: index,
        minimum: pane.useFixedScale ? 0 : (pane.axisMin ?? undefined),
        maximum: pane.useFixedScale ? 100 : (pane.axisMax ?? undefined),
        labelFormat: '{value}',
        majorGridLines: { width: 0.5, color: 'rgba(158,158,158,0.3)' },
        lineStyle: { width: 1, color: '#9e9e9e' },
        crosshairTooltip: { enable: false },
        rangePadding: 'None',
        stripLines,
      };
    });
  });

  /** Dynamic row definitions: bottom-to-top (index 0 = bottom row). */
  chartRows = computed(() => {
    const lowerCount = this.lowerPanes().length;
    if (lowerCount === 0) return [{ height: '100%' }];

    const lowerPct = Math.floor(55 / lowerCount);
    const rows: { height: string }[] = [];
    for (let i = 0; i < lowerCount; i++) {
      rows.push({ height: `${lowerPct}%` });
    }
    rows.push({ height: `${100 - lowerCount * lowerPct}%` });
    return rows;
  });
}
