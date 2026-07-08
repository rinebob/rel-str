/**
 * RH Agent Chart Service
 *
 * Reads OHLC bars for a symbol from the `symbol-data/{symbol}` Firestore subcollections.
 * Eliminates the 1–3s SA round-trip on every chart open.
 *
 * When the nightly EOD sync has not yet run today (last daily bar date < today),
 * fetches the current intraday price and synthesizes partial bars:
 *   - Daily: single bar { d:today, o:ip, h:ip, l:ip, c:ip }
 *   - Weekly: aggregated from all daily bars in the current ISO week, close = ip
 *   - Monthly: aggregated from all daily bars in the current calendar month, close = ip
 *
 * If the intraday callable returns ip: null (market closed, unknown symbol, etc.),
 * bars are returned as-is from Firestore with no partial bar injected.
 */
import { Injectable, inject } from '@angular/core';
import { Firestore, doc, getDoc, getDocs, collection } from '@angular/fire/firestore';
import { Observable, from, of, switchMap } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

import { BarsInterval } from '../../../core/models/partner.types';
import type { ChartDataset, PriceBar } from '../../heatmap-chart/heatmap-chart.types';
import { RhAgentRunService } from './rh-agent-run.service';
import { todayDate, toDatePt } from '../utils/rh-agent.utils';

// ============================================================================
// Types (mirrors canonical backend OhlcBar in functions/src/rh-agent-cloud-function/rh-agent-types.ts)
// ============================================================================

interface OhlcBar {
  d: string;   // YYYY-MM-DD
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

interface SymbolBarsResult {
  daily: OhlcBar[];
  weekly: OhlcBar[];
  monthly: OhlcBar[];
  version: string;
  lastDailyBarDate?: string;
}

interface SymbolBarsFlatDoc {
  bars: OhlcBar[];
}

interface SymbolBarsYearDoc {
  bars: OhlcBar[];
}

interface SymbolDataRootDoc {
  lastDailyBarDate?: string;
  lastBarSyncedAt?: unknown;
}

// ============================================================================
// Helpers
// ============================================================================

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
    x: toDatePt(b.d),
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
  private readonly runService = inject(RhAgentRunService);

  private readonly SYMBOL_DATA_COLLECTION = 'symbol-data';

  /**
   * Load D/W/M ChartDatasets for a symbol from symbol-data subcollections.
   * Injects today's partial bars if the nightly EOD sync has not yet run.
   * Returns a version string so callers can key the indicator cache.
   */
  loadBars$(symbol: string): Observable<{ daily: ChartDataset; weekly: ChartDataset; monthly: ChartDataset; version: string }> {
    return from(this.fetchSymbolBars(symbol)).pipe(
      switchMap(result => {
        if (!result) {
          return of({ ...this.emptyDatasets(symbol), version: '' });
        }

        const today = todayDate();
        const needsIntraday = this.needsIntradayFetchFromResult(result, today);
        const version = result.version || result.lastDailyBarDate || today;

        if (!needsIntraday) {
          return of({ ...this.buildDatasets(symbol, result.daily, result.weekly, result.monthly), version });
        }

        return this.runService.getIntradaySnapshot$(symbol).pipe(
          map(snapshot => {
            const ip = snapshot.ip;
            if (ip === null) {
              return { ...this.buildDatasets(symbol, result.daily, result.weekly, result.monthly), version };
            }
            return { ...this.buildDatasetsWithIntraday(symbol, result.daily, result.weekly, result.monthly, ip, today), version };
          }),
          catchError(() => {
            return of({ ...this.buildDatasets(symbol, result.daily, result.weekly, result.monthly), version });
          })
        );
      }),
      catchError(() => {
        return of({ ...this.emptyDatasets(symbol), version: '' });
      })
    );
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private async fetchSymbolBars(symbol: string): Promise<SymbolBarsResult | null> {
    const rootRef = doc(this.firestore, this.SYMBOL_DATA_COLLECTION, symbol);
    const [rootSnap, weeklySnap, monthlySnap, yearShards] = await Promise.all([
      getDoc(rootRef),
      getDoc(doc(this.firestore, this.SYMBOL_DATA_COLLECTION, symbol, 'weekly', 'all')),
      getDoc(doc(this.firestore, this.SYMBOL_DATA_COLLECTION, symbol, 'monthly', 'all')),
      getDocs(collection(this.firestore, this.SYMBOL_DATA_COLLECTION, symbol, 'daily')),
    ]);

    if (yearShards.empty) return null;

    const allDaily: OhlcBar[] = [];
    for (const shardDoc of yearShards.docs) {
      const shardData = shardDoc.data() as SymbolBarsYearDoc;
      allDaily.push(...(shardData.bars ?? []));
    }
    allDaily.sort((a, b) => a.d.localeCompare(b.d));

    const weekly: OhlcBar[] = (weeklySnap.data() as SymbolBarsFlatDoc | undefined)?.bars ?? [];
    const monthly: OhlcBar[] = (monthlySnap.data() as SymbolBarsFlatDoc | undefined)?.bars ?? [];
    const rootData = rootSnap.exists() ? (rootSnap.data() as SymbolDataRootDoc) : {};

    return {
      daily: allDaily,
      weekly,
      monthly,
      version: rootData.lastDailyBarDate ?? allDaily[allDaily.length - 1]?.d ?? '',
      lastDailyBarDate: rootData.lastDailyBarDate,
    };
  }

  /**
   * Returns true if the nightly EOD sync has not yet run today.
   * Infers from last bar date: if the most recent daily bar predates today
   * the EOD write hasn't landed yet and we should fetch intraday.
   */
  private needsIntradayFetchFromResult(result: SymbolBarsResult, today: string): boolean {
    const lastBar = result.daily[result.daily.length - 1]?.d;
    return !lastBar || lastBar < today;
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
