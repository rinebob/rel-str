/**
 * Local Bar Read Service
 *
 * Reads D/W/M OHLC bars from `symbol-data/{SYMBOL}` Firestore subcollections
 * via the Firestore client SDK. Follows the pattern in `rel-str-db-v2.service.ts`
 * — `doc()`, `getDoc()` with Angular zone wrapper.
 *
 * Firestore structure (written by SDS pipeline):
 *   symbol-data/{SYMBOL}/daily/{year}   — doc with { bars: OhlcBar[] }
 *   symbol-data/{SYMBOL}/weekly/all     — doc with { bars: OhlcBar[] }
 *   symbol-data/{SYMBOL}/monthly/all    — doc with { bars: OhlcBar[] }
 */
import { Injectable, inject, EnvironmentInjector, runInInjectionContext, NgZone } from '@angular/core';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { Observable, from, of, defer } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

import { Collection } from '../common/constants';
import { getMarketDatePT, getPtYear, daysAgoPT } from '../common/pt-date-utils';
import type { OhlcBar, OhlcBarsDoc } from '../models/market-data.types';

export type { OhlcBar };

/** Safely extract bars array from a Firestore doc, guarding against malformed data. */
function extractBars(data: unknown): OhlcBar[] {
  if (!data || typeof data !== 'object') return [];
  const bars = (data as OhlcBarsDoc).bars;
  return Array.isArray(bars) ? bars : [];
}

@Injectable({ providedIn: 'root' })
export class LocalBarReadService {
  private readonly firestore = inject(Firestore);
  private readonly injector = inject(EnvironmentInjector);
  private readonly zone = inject(NgZone);

  /**
   * Read daily bars for a specific year shard.
   * @param symbol Stock symbol (e.g., 'SPY')
   * @param year Calendar year (e.g., 2026)
   * @returns Observable of bars sorted ascending by date
   */
  getDailyBars$(symbol: string, year: number): Observable<OhlcBar[]> {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym || !Number.isFinite(year)) return of([]);

    return defer(() => from(this.inCtx(async () => {
      const ref = doc(this.firestore, Collection.SYMBOL_DATA, sym, 'daily', String(year));
      const snap = await this.zone.run(() => getDoc(ref));
      if (!snap.exists()) return [];
      const bars = extractBars(snap.data());
      return bars.slice().sort((a, b) => a.d.localeCompare(b.d));
    }))).pipe(
      catchError(err => {
        console.error('[LocalBarReadService] getDailyBars$ error', { symbol: sym, year, err });
        return of([] as OhlcBar[]);
      }),
    );
  }

  /**
   * Read all weekly bars from `symbol-data/{SYMBOL}/weekly/all`.
   * @returns Observable of bars sorted ascending by date
   */
  getWeeklyBars$(symbol: string): Observable<OhlcBar[]> {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return of([]);

    return defer(() => from(this.inCtx(async () => {
      const ref = doc(this.firestore, Collection.SYMBOL_DATA, sym, 'weekly', 'all');
      const snap = await this.zone.run(() => getDoc(ref));
      if (!snap.exists()) return [];
      const bars = extractBars(snap.data());
      return bars.slice().sort((a, b) => a.d.localeCompare(b.d));
    }))).pipe(
      catchError(err => {
        console.error('[LocalBarReadService] getWeeklyBars$ error', { symbol: sym, err });
        return of([] as OhlcBar[]);
      }),
    );
  }

  /**
   * Read all monthly bars from `symbol-data/{SYMBOL}/monthly/all`.
   * @returns Observable of bars sorted ascending by date
   */
  getMonthlyBars$(symbol: string): Observable<OhlcBar[]> {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return of([]);

    return defer(() => from(this.inCtx(async () => {
      const ref = doc(this.firestore, Collection.SYMBOL_DATA, sym, 'monthly', 'all');
      const snap = await this.zone.run(() => getDoc(ref));
      if (!snap.exists()) return [];
      const bars = extractBars(snap.data());
      return bars.slice().sort((a, b) => a.d.localeCompare(b.d));
    }))).pipe(
      catchError(err => {
        console.error('[LocalBarReadService] getMonthlyBars$ error', { symbol: sym, err });
        return of([] as OhlcBar[]);
      }),
    );
  }

  /**
   * Read recent daily bars, filtering to the last N calendar days.
   * Handles year boundaries by reading both the current and previous year shards
   * when the window spans Dec→Jan.
   *
   * @param symbol Stock symbol
   * @param days Number of calendar days to include (default 30)
   * @returns Observable of bars from the last N days, sorted ascending by date
   */
  getRecentDailyBars$(symbol: string, days = 30): Observable<OhlcBar[]> {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym || !Number.isFinite(days) || days <= 0) return of([]);

    return defer(() => from(this.inCtx(async () => {
      // Backend writes bar dates and year shards in Pacific Time.
      // Use PT date math to match — UTC would cause off-by-one errors.
      const now = new Date();
      const cutoffStr = daysAgoPT(days, now);
      const currentYear = getPtYear(now);
      const cutoffYear = Number(cutoffStr.slice(0, 4));

      const yearsToRead = cutoffYear === currentYear
        ? [currentYear]
        : [currentYear, cutoffYear];

      const yearPromises = yearsToRead.map(y => {
        const ref = doc(this.firestore, Collection.SYMBOL_DATA, sym, 'daily', String(y));
        return this.zone.run(() => getDoc(ref));
      });
      const results = await Promise.allSettled(yearPromises);

      const allBars: OhlcBar[] = [];
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const snap = result.value;
        if (!snap.exists()) continue;
        allBars.push(...extractBars(snap.data()));
      }

      const filtered = allBars
        .filter(b => b.d >= cutoffStr)
        .sort((a, b) => a.d.localeCompare(b.d));

      return filtered;
    }))).pipe(
      catchError(err => {
        console.error('[LocalBarReadService] getRecentDailyBars$ error', { symbol: sym, days, err });
        return of([] as OhlcBar[]);
      }),
    );
  }

  private inCtx<T>(fn: () => T): T {
    return runInInjectionContext(this.injector, fn);
  }
}
