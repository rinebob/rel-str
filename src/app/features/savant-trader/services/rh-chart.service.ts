/**
 * Robinhood Chart Service
 *
 * Ephemeral chart data for symbols OUTSIDE the tracked universe (#1259):
 * Robinhood `get_equity_historicals` equity bars at native day/week/month
 * intervals over a ~10y span, mapped into the same ChartDataset shape the
 * tracked `ChartService` produces — with `version: ''` so the store's
 * `if (version)` guard skips the indicator-series call that only exists
 * for tracked symbols.
 */
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin } from 'rxjs';
import { map } from 'rxjs/operators';

import { RobinhoodMcpClient } from '../../../core/robinhood-mcp/robinhood-mcp-client.service';
import { BarsInterval } from '../../../core/models/partner.types';
import type { OhlcBar } from '../../../core/models/market-data.types';
import type { ChartDataset } from '../../heatmap-chart/heatmap-chart.types';
import type { EquityHistoricalBar, EquityHistoricalsResult } from '@robinhood-mcp/contracts';
import { ohlcToPriceBar } from '../utils/utils';

/** Lookback for ephemeral charts — ~2,500 daily bars, under the tool's
 *  explicit-interval ~5,000-bar cap. */
const RH_CHART_YEARS = 10;

/** Wire bar → domain OhlcBar: ISO begins_at → 'YYYY-MM-DD', string prices →
 *  numbers. `interpolated` bars are kept — a synthesized bar beats a chart
 *  gap (one-line decision if they render badly). */
export function equityWireBarToOhlc(bar: EquityHistoricalBar): OhlcBar {
  return {
    d: bar.begins_at.slice(0, 10),
    o: Number(bar.open_price),
    h: Number(bar.high_price),
    l: Number(bar.low_price),
    c: Number(bar.close_price),
    v: bar.volume,
  };
}

@Injectable({ providedIn: 'root' })
export class RhChartService {
  private readonly client = inject(RobinhoodMcpClient);

  /**
   * Load D/W/M ChartDatasets for an untracked symbol from Robinhood
   * historicals. `version` is always '' — there is no symbol-data doc to key
   * the indicator cache, and the empty version is what tells the store not
   * to ask for indicator series.
   */
  loadBars$(symbol: string): Observable<{ daily: ChartDataset; weekly: ChartDataset; monthly: ChartDataset; version: string }> {
    const startTime = new Date(Date.now() - RH_CHART_YEARS * 365.25 * 24 * 3600 * 1000).toISOString();
    return forkJoin({
      daily: this.client.getEquityHistoricals([symbol], 'day', startTime),
      weekly: this.client.getEquityHistoricals([symbol], 'week', startTime),
      monthly: this.client.getEquityHistoricals([symbol], 'month', startTime),
    }).pipe(
      map((results) => ({
        daily: this.toDataset(symbol, BarsInterval.DAILY, results.daily),
        weekly: this.toDataset(symbol, BarsInterval.WEEKLY, results.weekly),
        monthly: this.toDataset(symbol, BarsInterval.MONTHLY, results.monthly),
        version: '',
      })),
    );
  }

  private toDataset(symbol: string, interval: BarsInterval, result: EquityHistoricalsResult): ChartDataset {
    const entry = result.data.results.find((r) => r.symbol === symbol);
    // A missing entry (bad/delisted ticker, echo mismatch) currently renders
    // as a blank chart with no error — at least leave a trail.
    if (!entry) {
      console.warn(
        `[RhChartService] no ${interval} result entry for ${symbol} — wire returned:`,
        result.data.results.map((r) => r.symbol),
      );
    }
    const bars = (entry?.bars ?? []).map(equityWireBarToOhlc);
    // Sibling sorts after merging year shards; the wire is captured ascending
    // but sorting is one line of insurance against server-side reordering.
    bars.sort((a, b) => a.d.localeCompare(b.d));
    const priceBars = bars.map(ohlcToPriceBar);
    return {
      baseline: 'SPY',
      symbol,
      interval,
      bars: priceBars,
      dateRange: {
        from: priceBars[0]?.date ?? '',
        to: priceBars[priceBars.length - 1]?.date ?? '',
      },
    };
  }
}
