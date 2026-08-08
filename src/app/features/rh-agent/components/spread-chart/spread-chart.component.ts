/**
 * @topic #77 — Spread Time Series Viewer (opened 2026-08-02)
 *
 * Multi-series chart component using Syncfusion EJ2.
 * Renders one line series per plotted spread with a category X-axis
 * and an optional underlying overlay on a secondary Y-axis.
 */
import { Component, input, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ChartModule,
  LineSeriesService,
  CategoryService,
  ZoomService,
  ScrollBarService,
  LegendService,
  CrosshairService,
  TooltipService,
} from '@syncfusion/ej2-angular-charts';

import type { OHLCDatum } from '../../../shared/types/rs.interfaces';
import type { Spread } from '@spread/contracts';

interface SpreadChartPoint {
  date: string;
  value: number | null;
}

interface UnderlyingPoint {
  date: string;
  close: number;
}

const COLORS = [
  '#4285F4', '#EA4335', '#34A853', '#FBBC05', '#FF6D01',
  '#46BDC6', '#9C27B0', '#F06292', '#3F51B5', '#00BCD4',
];

@Component({
  selector: 'app-spread-chart',
  standalone: true,
  imports: [CommonModule, ChartModule],
  providers: [
    LineSeriesService,
    CategoryService,
    ZoomService,
    ScrollBarService,
    LegendService,
    CrosshairService,
    TooltipService,
  ],
  templateUrl: './spread-chart.component.html',
  styleUrl: './spread-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpreadChartComponent {
  /** Plotted spreads to render. */
  plottedSpreads = input<Spread[]>([]);
  /** Union of all dates across plotted spreads. */
  allDates = input<string[]>([]);
  /** Underlying OHLC bars for overlay. */
  underlyingBars = input<OHLCDatum[]>([]);
  /** Whether to show the underlying overlay. */
  showUnderlying = input(true);
  /** Chart mode: absolute prices or normalized to first value. */
  chartMode = input<'absolute' | 'normalized'>('absolute');

  /** Color palette for series. */
  readonly colors = COLORS;

  /** Underlying data mapped to chart points. */
  readonly underlyingData = computed<UnderlyingPoint[]>(() => {
    const bars = this.underlyingBars();
    return bars
      .filter((b) => b.date && Number.isFinite(b.close))
      .map((b) => ({ date: b.date!, close: b.close }));
  });

  /** Series data for each plotted spread. */
  readonly seriesData = computed<SpreadChartPoint[][]>(() => {
    const spreads = this.plottedSpreads();
    const dates = this.allDates();
    const mode = this.chartMode();

    console.log('[SpreadChart] seriesData computing — spreads:', spreads.length, 'dates:', dates.length, 'mode:', mode);
    if (spreads.length > 0) {
      console.log('[SpreadChart] first spread series:', spreads[0].series?.length, 'points', spreads[0].series?.slice(0, 3));
    }

    return spreads.map((spread) => {
      if (!spread.series || spread.series.length === 0) return [];

      // Build a date→price map for this spread
      const priceMap = new Map<string, number>();
      for (const obs of spread.series) {
        if (Number.isFinite(obs.price)) {
          priceMap.set(obs.date, obs.price);
        }
      }

      // Find the first non-null value for normalization
      let firstValue: number | null = null;
      if (mode === 'normalized') {
        for (const date of dates) {
          const val = priceMap.get(date);
          if (val != null && Number.isFinite(val)) {
            firstValue = val;
            break;
          }
        }
      }

      return dates.map((date) => {
        const raw = priceMap.get(date);
        if (raw == null || !Number.isFinite(raw)) {
          return { date, value: null };
        }
        const value = mode === 'normalized' && firstValue
          ? (raw / firstValue) * 100
          : raw;
        return { date, value };
      });
    });
  });

  /** Underlying series data aligned to allDates. */
  readonly underlyingSeries = computed<SpreadChartPoint[]>(() => {
    const dates = this.allDates();
    const underlying = this.underlyingData();
    const closeMap = new Map<string, number>();
    for (const pt of underlying) {
      closeMap.set(pt.date, pt.close);
    }
    return dates.map((date) => ({
      date,
      value: closeMap.get(date) ?? null,
    }));
  });

  /** Series label for a spread. */
  spreadLabel(spread: Spread, index: number): string {
    const parts: string[] = [spread.spreadType];
    if (spread.legs.length > 0) {
      const optionTypes = new Set(spread.legs.map((l) => l.optionType));
      if (optionTypes.size === 1) {
        parts.push(spread.legs[0].optionType);
      }
    }
    if (spread.debitOrCredit) {
      parts.push(spread.debitOrCredit);
    }
    if (spread.legs.length > 0) {
      parts.push(spread.legs[0].expiration);
      const longStrike = spread.legs.find((l) => l.direction === 'long')?.strike;
      const shortStrike = spread.legs.find((l) => l.direction === 'short')?.strike;
      if (longStrike != null && shortStrike != null) {
        parts.push(`${longStrike}/${shortStrike}`);
      } else if (longStrike != null) {
        parts.push(String(longStrike));
      }
    }
    return parts.join(' ');
  }

  /** Color for a series by index. */
  colorFor(index: number): string {
    return COLORS[index % COLORS.length];
  }

  /** Primary Y-axis range from all spread series data. */
  readonly primaryRange = computed(() => {
    const allSeries = this.seriesData();
    let min = Infinity;
    let max = -Infinity;
    for (const series of allSeries) {
      for (const point of series) {
        if (point.value != null && Number.isFinite(point.value)) {
          min = Math.min(min, point.value);
          max = Math.max(max, point.value);
        }
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
    if (min === max) {
      const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 0.5;
      return { min: min - pad, max: max + pad };
    }
    const pad = (max - min) * 0.05;
    return { min: min - pad, max: max + pad };
  });

  /** Secondary Y-axis range from underlying data. */
  readonly secondaryRange = computed(() => {
    const underlying = this.underlyingSeries();
    let min = Infinity;
    let max = -Infinity;
    for (const pt of underlying) {
      if (pt.value != null && Number.isFinite(pt.value)) {
        min = Math.min(min, pt.value);
        max = Math.max(max, pt.value);
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
    if (min === max) {
      const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 0.5;
      return { min: min - pad, max: max + pad };
    }
    const pad = (max - min) * 0.05;
    return { min: min - pad, max: max + pad };
  });

  /** Whether there are any spreads to render. */
  readonly hasSpreads = computed(() => {
    const has = this.plottedSpreads().length > 0;
    console.log('[SpreadChart] hasSpreads:', has, 'plottedSpreads:', this.plottedSpreads().length);
    return has;
  });

  // Chart configuration
  readonly primaryXAxis = { valueType: 'Category', labelRotation: -45, interval: 5 };
  readonly primaryYAxis = computed(() => ({
    rangePadding: 'None',
    minimum: this.primaryRange().min,
    maximum: this.primaryRange().max,
    labelFormat: this.chartMode() === 'normalized' ? '{value}%' : '{value}',
  }));
  readonly axes = computed(() => [
    {
      rowIndex: 0,
      name: 'underlyingYAxis',
      opposedPosition: true,
      rangePadding: 'None' as const,
      minimum: this.secondaryRange().min,
      maximum: this.secondaryRange().max,
      labelFormat: '${value}',
    },
  ]);
  readonly legendSettings = { visible: true, position: 'Bottom', width: '100%', height: '60', textStyle: { size: '11px' } };
  readonly tooltipSettings = { enable: true, shared: true, format: '${series.name}: ${point.y}' };
  readonly crosshairSettings = { enable: true, lineType: 'Both', line: { color: '#999', width: 0.5 } };
  readonly zoomSettings = { enableMouseWheelZooming: true, enablePinchZooming: true, enableSelectionZooming: false };
  readonly chartArea = { border: { width: 0 } };

  /** Build the series collection for Syncfusion. */
  readonly seriesCollection = computed(() => {
    const spreads = this.plottedSpreads();
    const data = this.seriesData();
    const showUnderlying = this.showUnderlying();
    const underlying = this.underlyingSeries();

    console.log('[SpreadChart] seriesCollection — plottedSpreads:', spreads.length, 'seriesData arrays:', data.length, 'underlying points:', underlying.length);
    if (data.length > 0) {
      console.log('[SpreadChart] first series data points:', data[0]?.length, 'sample:', data[0]?.slice(0, 3));
    }

    const series: unknown[] = [];

    spreads.forEach((spread, i) => {
      series.push({
        type: 'Line',
        name: this.spreadLabel(spread, i),
        dataSource: data[i] ?? [],
        xName: 'date',
        yName: 'value',
        width: 1.5,
        fill: this.colorFor(i),
        marker: { visible: false },
        animation: { enable: false },
      });
    });

    if (showUnderlying && underlying.length > 0) {
      series.push({
        type: 'Line',
        name: 'Underlying',
        dataSource: underlying,
        xName: 'date',
        yName: 'value',
        width: 1,
        fill: '#666',
        dashArray: '4,2',
        yAxisName: 'underlyingYAxis',
        marker: { visible: false },
        animation: { enable: false },
      });
    }

    console.log('[SpreadChart] seriesCollection final — series count:', series.length, 'series:', JSON.stringify(series).slice(0, 500));
    return series;
  });
}
