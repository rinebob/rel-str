import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, of, forkJoin } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';

import { BarsInterval } from '../../core/models/partner.types';
import { RelStrDbV2Service } from '../services/rel-str-db-v2.service';
import { RsBarsService } from '../services/rs-bars.service';
import type { RsSeriesPoint } from '../shared/types/rs.interfaces';
import { Timeframe } from '../shared/types/rs.interfaces';
import type { ChartDataset, HeatmapDataset, HeatmapRow, HeatmapCell, PriceBar } from './heatmap-chart.types';
import { aggregateDailyToWeekly, aggregateDailyToMonthly } from './heatmap-chart-aggregation.util';

@Injectable({ providedIn: 'root' })
export class HeatmapChartDataService {
  private readonly dbService = inject(RelStrDbV2Service);
  private readonly barsService = inject(RsBarsService);

  /**
   * Fetch chart data (OHLC bars) for a given symbol and interval.
   * Uses RsBarsService to fetch from SavantAPI.
   */
  fetchChartData$(
    baseline: string,
    symbol: string,
    interval: BarsInterval,
    dateRange?: { from: string; to: string }
  ): Observable<ChartDataset> {
    const from = dateRange?.from;
    const to = dateRange?.to;

    console.log('[HeatmapChartDataService] fetchChartData$', { symbol, interval, from, to });

    // Always fetch Daily adjusted data, then aggregate to Weekly/Monthly if needed
    // This ensures split-adjusted data for all intervals
    return this.barsService.getDailyBars$(symbol, { from, to, interval: BarsInterval.DAILY }).pipe(
      map((bars) => {
        let priceBars: PriceBar[] = bars.map((b) => ({
          date: b.date!,
          x: new Date(`${b.date}T00:00:00.000Z`),
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
        }));

        // Aggregate to Weekly or Monthly if needed
        if (interval === BarsInterval.WEEKLY) {
          priceBars = aggregateDailyToWeekly(priceBars);
        } else if (interval === BarsInterval.MONTHLY) {
          priceBars = aggregateDailyToMonthly(priceBars);
        }

        const actualFrom = priceBars.length > 0 ? priceBars[0].date : from || '';
        const actualTo = priceBars.length > 0 ? priceBars[priceBars.length - 1].date : to || '';

        return {
          baseline,
          symbol,
          interval,
          bars: priceBars,
          dateRange: { from: actualFrom, to: actualTo },
        };
      }),
      catchError((err) => {
        console.error('fetchChartData$ error', { baseline, symbol, interval, err });
        return of({
          baseline,
          symbol,
          interval,
          bars: [],
          dateRange: { from: from || '', to: to || '' },
        });
      })
    );
  }

  /**
   * Fetch heatmap data (RS series) for all three intervals (DAILY, WEEKLY, MONTHLY).
   * Attempts to use heatmap-snapshots collection first, falls back to pairs-data archives.
   */
  fetchHeatmapData$(
    baseline: string,
    symbol: string,
    dateRange?: { from: string; to: string }
  ): Observable<HeatmapDataset> {
    const pairId = `${baseline}-${symbol}`;

    const daily$ = this.fetchRsSeriesForInterval$(pairId, BarsInterval.DAILY, dateRange);
    const weekly$ = this.fetchRsSeriesForInterval$(pairId, BarsInterval.WEEKLY, dateRange);
    const monthly$ = this.fetchRsSeriesForInterval$(pairId, BarsInterval.MONTHLY, dateRange);

    return combineLatest([daily$, weekly$, monthly$]).pipe(
      map(([dailySeries, weeklySeries, monthlySeries]) => {
        const dailyRow = this.buildHeatmapRow(dailySeries, BarsInterval.DAILY);
        const weeklyRow = this.buildHeatmapRow(weeklySeries, BarsInterval.WEEKLY);
        const monthlyRow = this.buildHeatmapRow(monthlySeries, BarsInterval.MONTHLY);

        const allDates = [
          ...dailySeries.map((p) => p.date),
          ...weeklySeries.map((p) => p.date),
          ...monthlySeries.map((p) => p.date),
        ];
        const from = allDates.length > 0 ? allDates[0] : dateRange?.from || '';
        const to = allDates.length > 0 ? allDates[allDates.length - 1] : dateRange?.to || '';

        return {
          baseline,
          symbol,
          daily: dailyRow,
          weekly: weeklyRow,
          monthly: monthlyRow,
          dateRange: { from, to },
        };
      }),
      catchError((err) => {
        console.error('fetchHeatmapData$ error', { baseline, symbol, err });
        return of({
          baseline,
          symbol,
          daily: null,
          weekly: null,
          monthly: null,
          dateRange: { from: dateRange?.from || '', to: dateRange?.to || '' },
        });
      })
    );
  }

  /**
   * Fetch RS series for a specific interval.
   * Uses pairs-data archive collections (archive-YYYY, archive-weekly-YYYY, archive-monthly-YYYY).
   */
  private fetchRsSeriesForInterval$(
    pairId: string,
    interval: BarsInterval,
    dateRange?: { from: string; to: string }
  ): Observable<RsSeriesPoint[]> {
    const timeframe = this.barsIntervalToTimeframe(interval);
    return this.dbService.getPairSeriesFromArchiveWindowByInterval$(pairId, 10000, timeframe).pipe(
      map((series) => this.filterSeriesByDateRange(series, dateRange)),
      catchError(() => of([]))
    );
  }

  private barsIntervalToTimeframe(interval: BarsInterval): Timeframe {
    switch (interval) {
      case BarsInterval.DAILY:
        return Timeframe.DAILY;
      case BarsInterval.WEEKLY:
        return Timeframe.WEEKLY;
      case BarsInterval.MONTHLY:
        return Timeframe.MONTHLY;
      default:
        return Timeframe.DAILY;
    }
  }

  /**
   * Filter RS series by date range.
   */
  private filterSeriesByDateRange(
    series: RsSeriesPoint[],
    dateRange?: { from: string; to: string }
  ): RsSeriesPoint[] {
    if (!dateRange) return series;

    const { from, to } = dateRange;
    return series.filter((p) => {
      if (from && p.date < from) return false;
      if (to && p.date > to) return false;
      return true;
    });
  }

  /**
   * Build a HeatmapRow from RS series points.
   * Determines phase based on whether the date is today (pre) or historical (post).
   */
  private buildHeatmapRow(series: RsSeriesPoint[], interval: BarsInterval): HeatmapRow | null {
    if (series.length === 0) return null;

    const today = new Date();
    const todayYMD = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;

    const cells: HeatmapCell[] = series.map((point) => ({
      date: point.date,
      rsValue: point.value,
      color: this.getColorForRsValue(point.value),
      phase: point.date === todayYMD ? 'pre' : 'post',
    }));

    return { interval, cells };
  }

  /**
   * Get color for RS value using a simple threshold-based approach.
   * This will be replaced with dashboard-v3 dynamic coloring in the component.
   */
  private getColorForRsValue(rsValue: number): string {
    if (rsValue >= 2.0) return '#00ff00';
    if (rsValue >= 1.0) return '#7fff00';
    if (rsValue >= 0.0) return '#ffff00';
    if (rsValue >= -1.0) return '#ff7f00';
    return '#ff0000';
  }
}
