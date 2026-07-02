/**
 * RH Agent Chart Service
 *
 * Reads OHLC bars for a symbol directly from the `rs-bars/{symbol}` Firestore doc
 * instead of calling the SA API via HeatmapChartStore. Eliminates the 1–3s SA
 * round-trip on every chart open.
 *
 * When the nightly EOD sync has not yet run today (lastEodSyncAt date < today),
 * fetches the current intraday price and synthesizes partial bars:
 *   - Daily: single bar { d:today, o:ip, h:ip, l:ip, c:ip }
 *   - Weekly: aggregated from all daily bars in the current ISO week, close = ip
 *   - Monthly: aggregated from all daily bars in the current calendar month, close = ip
 *
 * If the intraday callable returns ip: null (market closed, unknown symbol, etc.),
 * the bars are returned as-is from Firestore — no partial bar injected.
 */
import { Injectable, inject } from '@angular/core';
import { Firestore, doc, getDoc, Timestamp } from '@angular/fire/firestore';
import { Observable, from, of, switchMap } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

import { BarsInterval } from '../../../core/models/partner.types';
import type { ChartDataset, PriceBar } from '../../heatmap-chart/heatmap-chart.types';
import { RhAgentService } from './rh-agent.service';

// ============================================================================
// Types (mirrors backend OhlcBar in rs-bars-sync.ts)
// ============================================================================

interface OhlcBar {
  d: string;   // YYYY-MM-DD
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

interface RsBarsDoc {
  symbol: string;
  daily: OhlcBar[];
  weekly: OhlcBar[];
  monthly: OhlcBar[];
  lastEodSyncAt?: Timestamp | null;
  lastDailyBarDate?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** ISO week number (Mon = start of week) for a YYYY-MM-DD string. */
function isoWeekKey(d: string): string {
  const date = new Date(`${d}T00:00:00.000Z`);
  const dayOfWeek = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - dayOfWeek);
  return monday.toISOString().slice(0, 10);
}

/** YYYY-MM month key for a YYYY-MM-DD string. */
function monthKey(d: string): string {
  return d.slice(0, 7);
}

/** Convert an OhlcBar to a PriceBar for chart rendering. */
function toPrice(b: OhlcBar): PriceBar {
  return {
    date: b.d,
    x: new Date(`${b.d}T00:00:00.000Z`),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
  };
}

/**
 * Synthesize an OHLC bar for an incomplete period (week or month) from
 * the constituent daily bars plus the current intraday price.
 *
 *   open  = open of the first daily bar in the period
 *   high  = max of all daily highs, raised to ip if ip exceeds them
 *   low   = min of all daily lows, lowered to ip if ip falls below them
 *   close = ip (live intraday price)
 *   d     = date of the first daily bar in the period
 */
function synthesizePeriodBar(dailyBarsInPeriod: OhlcBar[], ip: number): OhlcBar {
  const first = dailyBarsInPeriod[0];
  const high  = Math.max(...dailyBarsInPeriod.map(b => b.h), ip);
  const low   = Math.min(...dailyBarsInPeriod.map(b => b.l), ip);
  return { d: first.d, o: first.o, h: high, l: low, c: ip };
}

/**
 * Replace the last bar if its date matches `bar.d`, otherwise append.
 */
function replaceOrAppend(bars: OhlcBar[], bar: OhlcBar): OhlcBar[] {
  const last = bars[bars.length - 1];
  return last?.d === bar.d ? [...bars.slice(0, -1), bar] : [...bars, bar];
}

// ============================================================================
// Service
// ============================================================================

@Injectable({ providedIn: 'root' })
export class RhAgentChartService {
  private readonly firestore = inject(Firestore);
  private readonly rhAgentService = inject(RhAgentService);

  private readonly RS_BARS_COLLECTION = 'rs-bars';

  /**
   * Load D/W/M ChartDatasets for a symbol from Firestore rs-bars.
   * Injects today's partial bars if the nightly EOD sync has not yet run.
   */
  loadBars$(symbol: string): Observable<{ daily: ChartDataset; weekly: ChartDataset; monthly: ChartDataset }> {
    return from(this.fetchRsBarsDoc(symbol)).pipe(
      switchMap(rsBarsDoc => {
        if (!rsBarsDoc) {
          return of(this.emptyDatasets(symbol));
        }

        const today = todayIso();
        const needsIntraday = this.needsIntradayFetch(rsBarsDoc, today);

        if (!needsIntraday) {
          return of(this.buildDatasets(symbol, rsBarsDoc.daily, rsBarsDoc.weekly, rsBarsDoc.monthly));
        }

        return this.rhAgentService.getIntradaySnapshot$(symbol).pipe(
          map(snapshot => {
            const ip = snapshot.ip;
            if (ip === null) {
              return this.buildDatasets(symbol, rsBarsDoc.daily, rsBarsDoc.weekly, rsBarsDoc.monthly);
            }
            return this.buildDatasetsWithIntraday(symbol, rsBarsDoc.daily, rsBarsDoc.weekly, rsBarsDoc.monthly, ip, today);
          }),
          catchError(() => of(this.buildDatasets(symbol, rsBarsDoc.daily, rsBarsDoc.weekly, rsBarsDoc.monthly)))
        );
      }),
      catchError(() => of(this.emptyDatasets(symbol)))
    );
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private async fetchRsBarsDoc(symbol: string): Promise<RsBarsDoc | null> {
    const ref = doc(this.firestore, this.RS_BARS_COLLECTION, symbol);
    const snap = await getDoc(ref);
    return snap.exists() ? (snap.data() as RsBarsDoc) : null;
  }

  /**
   * Returns true if the nightly EOD sync has not yet run today.
   * Uses lastEodSyncAt (written only by rsBarsSyncNightly/rsBarsSyncAdmin).
   * Requires a real Firestore Timestamp — if absent or not yet a Timestamp
   * (e.g. doc predates Phase 0 deploy), treat as needing intraday.
   */
  private needsIntradayFetch(rsBarsDoc: RsBarsDoc, today: string): boolean {
    const ts = rsBarsDoc.lastEodSyncAt;
    if (!ts || !(ts instanceof Timestamp)) return true;
    return ts.toDate().toISOString().slice(0, 10) < today;
  }

  private buildDatasetsWithIntraday(
    symbol: string,
    daily: OhlcBar[],
    weekly: OhlcBar[],
    monthly: OhlcBar[],
    ip: number,
    today: string
  ): { daily: ChartDataset; weekly: ChartDataset; monthly: ChartDataset } {
    // Daily: simple partial bar (replace today's EOD bar if already present, else append)
    const partialDaily: OhlcBar = { d: today, o: ip, h: ip, l: ip, c: ip };
    const updatedDaily = replaceOrAppend(daily, partialDaily);

    // Weekly: aggregate from the *original* confirmed daily bars in the current ISO week + ip
    // Using `daily` (not updatedDaily) avoids mixing the synthetic o=h=l=c=ip bar into the aggregation.
    const currentWeek = isoWeekKey(today);
    const weekBars = daily.filter(b => isoWeekKey(b.d) === currentWeek);
    const updatedWeekly = weekBars.length > 0
      ? replaceOrAppend(weekly, synthesizePeriodBar(weekBars, ip))
      : replaceOrAppend(weekly, partialDaily);

    // Monthly: aggregate from the *original* confirmed daily bars in the current month + ip
    const currentMonth = monthKey(today);
    const monthBars = daily.filter(b => monthKey(b.d) === currentMonth);
    const updatedMonthly = monthBars.length > 0
      ? replaceOrAppend(monthly, synthesizePeriodBar(monthBars, ip))
      : replaceOrAppend(monthly, partialDaily);

    return this.buildDatasets(symbol, updatedDaily, updatedWeekly, updatedMonthly);
  }

  private buildDatasets(
    symbol: string,
    daily: OhlcBar[],
    weekly: OhlcBar[],
    monthly: OhlcBar[]
  ): { daily: ChartDataset; weekly: ChartDataset; monthly: ChartDataset } {
    return {
      daily:   this.toDataset(symbol, BarsInterval.DAILY,   daily),
      weekly:  this.toDataset(symbol, BarsInterval.WEEKLY,  weekly),
      monthly: this.toDataset(symbol, BarsInterval.MONTHLY, monthly),
    };
  }

  private toDataset(symbol: string, interval: BarsInterval, bars: OhlcBar[]): ChartDataset {
    const priceBars = bars.map(toPrice);
    return {
      baseline: 'SPY',
      symbol,
      interval,
      bars: priceBars,
      dateRange: {
        from: priceBars[0]?.date ?? '',
        to:   priceBars[priceBars.length - 1]?.date ?? '',
      },
    };
  }

  private emptyDatasets(symbol: string): { daily: ChartDataset; weekly: ChartDataset; monthly: ChartDataset } {
    const empty = (interval: BarsInterval): ChartDataset => ({
      baseline: 'SPY', symbol, interval, bars: [], dateRange: { from: '', to: '' },
    });
    return { daily: empty(BarsInterval.DAILY), weekly: empty(BarsInterval.WEEKLY), monthly: empty(BarsInterval.MONTHLY) };
  }
}
