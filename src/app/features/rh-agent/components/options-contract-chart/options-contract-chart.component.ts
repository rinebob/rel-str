/**
 * Options Contract Chart Component
 *
 * Dedicated Syncfusion chart for options contract time-series data.
 * Uses a DateTimeCategory axis to avoid weekend/holiday gaps while still
 * rendering date-formatted labels.
 * Main pane: mark + underlying close (dual Y-axis, toggleable).
 * Lower panes: IV, Greeks (Delta on left, Gamma on right), Volume/OI.
 * Y-axes dynamically snap to the visible data range on zoom/pan/scroll.
 */
import { Component, input, computed, ChangeDetectionStrategy, viewChild, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ChartModule,
  ChartComponent as SfChartComponent,
  IZoomCompleteEventArgs,
  IAxisLabelRenderEventArgs,
  LineSeriesService,
  ColumnSeriesService,
  CategoryService,
  ZoomService,
  ScrollBarService,
  LegendService,
  CrosshairService,
  TooltipService,
  StripLineService,
} from '@syncfusion/ej2-angular-charts';

import type { OHLCDatum } from '../../../shared/types/rs.interfaces';
import type { ParsedObservation } from '../../stores/options-contract-viewer.store';
import { formatUtcDate } from '../../utils/rh-agent.utils';

interface UnderlyingPoint {
  date: string;
  close: number;
}

function computeRangeMinMax(
  range: { min: number; max: number },
  count: number,
  accessor: (index: number) => number | null,
): { min: number; max: number } {
  const start = Math.max(0, Math.floor(range.min));
  const end = Math.min(count - 1, Math.ceil(range.max));
  if (start > end || count === 0) return { min: 0, max: 1 };

  let min = Infinity;
  let max = -Infinity;
  for (let i = start; i <= end; i++) {
    const val = accessor(i);
    if (val != null && Number.isFinite(val)) {
      min = Math.min(min, val);
      max = Math.max(max, val);
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 0.5;
    return { min: min - pad, max: max + pad };
  }
  return { min, max };
}

function computeMinMax(
  obs: ParsedObservation[],
  range: { min: number; max: number },
  fields: (keyof ParsedObservation)[],
): { min: number; max: number } {
  return computeRangeMinMax(range, obs.length, (i) => {
    const point = obs[i];
    let result: number | null = null;
    for (const field of fields) {
      const val = point[field] as number | null;
      if (val != null && Number.isFinite(val)) {
        result = result == null ? val : Math.min(result, val);
      }
    }
    return result;
  });
}

function computeUnderlyingMinMax(
  obs: ParsedObservation[],
  range: { min: number; max: number },
  underlying: UnderlyingPoint[],
): { min: number; max: number } {
  const start = Math.max(0, Math.floor(range.min));
  const end = Math.min(obs.length - 1, Math.ceil(range.max));
  if (start > end || !obs.length || !underlying.length) return { min: 0, max: 1 };

  const startDate = obs[start]?.date;
  const endDate = obs[end]?.date;
  if (!startDate || !endDate) return { min: 0, max: 1 };

  return computeRangeMinMax(range, obs.length, (i) => {
    const obsDate = obs[i]?.date;
    if (!obsDate) return null;
    let result: number | null = null;
    for (const pt of underlying) {
      if (pt.date === obsDate && Number.isFinite(pt.close)) {
        result = result == null ? pt.close : Math.min(result, pt.close);
      }
    }
    return result;
  });
}

@Component({
  selector: 'app-options-contract-chart',
  standalone: true,
  imports: [CommonModule, ChartModule],
  providers: [
    LineSeriesService,
    ColumnSeriesService,
    CategoryService,
    ZoomService,
    ScrollBarService,
    LegendService,
    CrosshairService,
    TooltipService,
    StripLineService,
  ],
  templateUrl: './options-contract-chart.component.html',
  styleUrl: './options-contract-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptionsContractChartComponent {
  observations = input<ParsedObservation[]>([]);
  xLabels = input.required<string[]>();
  underlyingBars = input<OHLCDatum[]>([]);
  showUnderlying = input(true);
  showGreeks = input(true);
  showVolumeOI = input(false);
  padDays = input(0);

  private readonly chart = viewChild<SfChartComponent>('chart');
  private readonly visibleRange = signal<{ min: number; max: number } | null>(null);

  /** Visible-range min/max for every Y-axis. */
  readonly axisRanges = computed(() => {
    const range = this.visibleRange();
    const obs = this.observations();
    const labels = this.xLabels();
    const underlying = this.underlyingData();
    if (!range || (!obs.length && !labels.length)) return null;
    if (obs.length === 0) {
      const undRange = computeRangeMinMax(range, labels.length, (i) => {
        const date = labels[i];
        if (!date) return null;
        let result: number | null = null;
        for (const pt of underlying) {
          if (pt.date === date && Number.isFinite(pt.close)) {
            result = result == null ? pt.close : Math.min(result, pt.close);
          }
        }
        return result;
      });
      return {
        mark: undRange,
        underlying: undRange,
        iv: { min: 0, max: 1 },
        delta: { min: 0, max: 1 },
        gamma: { min: 0, max: 1 },
        volume: { min: 0, max: 1 },
        openInterest: { min: 0, max: 1 },
      };
    }
    return {
      mark: computeMinMax(obs, range, ['mark']),
      underlying: computeUnderlyingMinMax(obs, range, underlying),
      iv: computeMinMax(obs, range, ['iv']),
      delta: computeMinMax(obs, range, ['delta']),
      gamma: computeMinMax(obs, range, ['gamma']),
      volume: computeMinMax(obs, range, ['volume']),
      openInterest: computeMinMax(obs, range, ['openInterest']),
    };
  });

  /** Visible chart extents: date range and underlying price range. */
  readonly visibleExtents = computed(() => {
    const range = this.visibleRange();
    const obs = this.observations();
    const labels = this.xLabels();
    const underlying = this.underlyingData();
    if (!range || !labels.length) return null;

    const startIdx = Math.max(0, Math.floor(range.min));
    const endIdx = Math.min(labels.length - 1, Math.ceil(range.max));
    const startDate = labels[startIdx] ?? null;
    const endDate = labels[endIdx] ?? null;

    const undRange = obs.length > 0
      ? computeUnderlyingMinMax(obs, range, underlying)
      : computeRangeMinMax(range, labels.length, (i) => {
          const date = labels[i];
          if (!date) return null;
          let result: number | null = null;
          for (const pt of underlying) {
            if (pt.date === date && Number.isFinite(pt.close)) {
              result = result == null ? pt.close : Math.min(result, pt.close);
            }
          }
          return result;
        });
    return { startDate, endDate, priceLow: undRange.min, priceHigh: undRange.max };
  });

  // Reset visible range when the dataset or padding changes.
  readonly initVisibleRange = effect(() => {
    const obs = this.observations();
    const labels = this.xLabels();
    const pad = this.padDays();
    if (obs.length > 0) {
      this.visibleRange.set({ min: -pad, max: obs.length - 1 + pad });
    } else if (labels.length > 0) {
      this.visibleRange.set({ min: 0, max: labels.length - 1 });
    } else {
      this.visibleRange.set(null);
    }

    // Reset the chart's internal zoom/scroll state so the X-axis
    // redraws fully instead of retaining the previous zoom position.
    const chart = this.chart();
    if (chart) {
      const xAxis = chart.primaryXAxis;
      if (xAxis) {
        xAxis.zoomFactor = 1;
        xAxis.zoomPosition = 0;
      }
      const axisCol = chart.axisCollections;
      if (axisCol?.length) {
        axisCol[0].zoomFactor = 1;
        axisCol[0].zoomPosition = 0;
      }
      chart.animateSeries = false;
      chart.refresh();
    }
  });

  // Apply min/max to every Y-axis whenever the visible range or data changes.
  readonly applyYAxisViewport = effect(() => {
    const ranges = this.axisRanges();
    const chart = this.chart();
    if (!chart || !ranges) return;

    if (chart.primaryYAxis) {
      chart.primaryYAxis.minimum = ranges.mark.min;
      chart.primaryYAxis.maximum = ranges.mark.max;
    }

    const findAxis = (name: string) => chart.axisCollections?.find((a) => a.name === name);
    const AXIS_MAP: Record<string, { min: number; max: number }> = {
      underlyingAxis: ranges.underlying,
      ivAxis: ranges.iv,
      greeksAxis: ranges.delta,
      gammaAxis: ranges.gamma,
      volumeAxis: ranges.volume,
      oiAxis: ranges.openInterest,
    };
    for (const [name, range] of Object.entries(AXIS_MAP)) {
      const axis = findAxis(name);
      if (axis) {
        axis.minimum = range.min;
        axis.maximum = range.max;
      }
    }

    chart.animateSeries = false;
    chart.dataBind();
  });

  // Chart palette colors
  readonly markColor = '#1976d2';
  readonly underlyingColor = '#ff9800';
  readonly ivColor = '#9c27b0';
  readonly deltaColor = '#00bcd4';
  readonly gammaColor = '#ff5722';
  readonly thetaColor = '#795548';
  readonly vegaColor = '#607d8b';
  readonly volumeColor = '#42a5f5';
  readonly oiColor = '#66bb6a';

  /** Underlying bars aligned to x-axis labels by date (includes padded dates). */
  underlyingData = computed<UnderlyingPoint[]>(() => {
    const bars = this.underlyingBars();
    const labels = this.xLabels();
    if (!bars.length || !labels.length) return [];
    const labelSet = new Set<string>(labels);
    return bars
      .filter((b) => b.date && labelSet.has(b.date) && Number.isFinite(b.close))
      .map((b) => ({ date: b.date!, close: b.close }));
  });

  // Axis configurations
  readonly primaryXAxis = computed(() => {
    const count = Math.max(this.observations().length, this.xLabels().length);
    const interval = count > 0 ? Math.max(1, Math.floor(count / 6)) : 1;
    return {
      valueType: 'Category' as const,
      labelIntersectAction: 'Rotate45' as const,
      interval,
      majorGridLines: { width: 0.5, color: '#e0e0e0' },
      labelStyle: { size: '10px' },
    };
  });

  readonly primaryYAxis = computed(() => ({
    labelFormat: '${value}',
    lineStyle: { color: '#e0e0e0' },
    majorTickLines: { width: 0 },
    labelStyle: { size: '11px' },
    rangePadding: 'None' as const,
    rowIndex: this.observations().length > 0 ? 3 : 0,
  }));

  readonly underlyingAxis = computed(() => ({
    name: 'underlyingAxis',
    opposedPosition: true,
    labelFormat: '${value}',
    lineStyle: { color: '#ff9800', width: 1 },
    majorTickLines: { width: 0 },
    labelStyle: { size: '11px', color: '#ff9800' },
    rangePadding: 'None' as const,
    rowIndex: this.observations().length > 0 ? 3 : 0,
  }));

  readonly ivAxis = {
    name: 'ivAxis',
    labelFormat: '{value}',
    lineStyle: { color: '#e0e0e0' },
    majorTickLines: { width: 0 },
    labelStyle: { size: '10px' },
    rangePadding: 'None' as const,
    rowIndex: 2, // second pane: IV
  };

  readonly greeksAxis = {
    name: 'greeksAxis',
    labelFormat: '{value}',
    lineStyle: { color: '#e0e0e0' },
    majorTickLines: { width: 0 },
    labelStyle: { size: '10px' },
    rangePadding: 'None' as const,
    rowIndex: 1, // third pane: Greeks (Delta)
  };

  readonly gammaAxis = {
    name: 'gammaAxis',
    opposedPosition: true,
    labelFormat: '{value}',
    lineStyle: { color: '#ff5722', width: 1 },
    majorTickLines: { width: 0 },
    labelStyle: { size: '10px', color: '#ff5722' },
    rangePadding: 'None' as const,
    rowIndex: 1, // third pane: Greeks (Gamma)
  };

  readonly volumeAxis = {
    name: 'volumeAxis',
    labelFormat: '{value}',
    lineStyle: { color: '#e0e0e0' },
    majorTickLines: { width: 0 },
    labelStyle: { size: '10px' },
    rangePadding: 'None' as const,
    rowIndex: 0, // bottom pane: Volume/OI
  };

  readonly oiAxis = {
    name: 'oiAxis',
    opposedPosition: true,
    labelFormat: '{value}',
    lineStyle: { color: '#66bb6a', width: 1 },
    majorTickLines: { width: 0 },
    labelStyle: { size: '10px', color: '#66bb6a' },
    rangePadding: 'None' as const,
    rowIndex: 0, // bottom pane: Volume/OI (opposed)
  };

  readonly axes = computed(() => [this.underlyingAxis(), this.ivAxis, this.greeksAxis, this.gammaAxis, this.volumeAxis, this.oiAxis]);

  /** Row layout — single pane when underlying-only, 4 panes when observations exist. */
  readonly rows = computed(() => {
    if (this.observations().length === 0) {
      return [{ height: '100%' }];
    }
    return [
      { height: '15%' }, // bottom: Volume/OI
      { height: '15%' }, //        Greeks
      { height: '15%' }, //        IV
      { height: '55%' }, // top:    Price
    ];
  });

  readonly palettes = [
    this.markColor, this.underlyingColor,
    this.ivColor, this.deltaColor, this.gammaColor,
    this.volumeColor, this.oiColor,
  ];

  // Zoom settings
  readonly zoomSettings = {
    enablePinchZooming: true,
    enableSelectionZooming: false,
    enableMouseWheelZooming: true,
    enablePan: true,
    enableScrollbar: true,
    mode: 'X' as const,
    toolbarItems: ['Zoom', 'ZoomIn', 'ZoomOut', 'Pan', 'Reset'] as const,
  };

  readonly crosshair = { enable: true, lineType: 'Both' as const, lineColor: '#ccc', snapToData: true };
  readonly tooltip = { enable: true, shared: true, format: '${point.x}: ${point.y}' };
  readonly legend = { visible: true, position: 'Bottom' as const, toggleVisibility: true };
  readonly chartBorder = { width: 0 };
  readonly chartArea = { border: { width: 0 } };
  readonly markerNone = { visible: false };
  readonly animationNone = { enable: false };
  readonly dashArrayDotted = '3,3';
  readonly dashArrayDashed = '5,3';

  // Chart height fills the parent container.
  readonly chartHeight = '100%';

  onAxisLabelRender(args: IAxisLabelRenderEventArgs): void {
    if (args.axis?.name === 'primaryXAxis' && args.text) {
      args.text = formatUtcDate(args.text, { month: 'short', day: '2-digit' });
    }
  }

  onZoomComplete(event: IZoomCompleteEventArgs): void {
    const range = event.currentVisibleRange;
    if (range?.min != null && range?.max != null) {
      this.visibleRange.set({ min: range.min, max: range.max });
    }
  }

  onScrollEnd(): void {
    const visibleRange = this.chart()?.axisCollections?.[0]?.visibleRange;
    if (visibleRange?.min != null && visibleRange?.max != null) {
      this.visibleRange.set({ min: visibleRange.min, max: visibleRange.max });
    }
  }

}
