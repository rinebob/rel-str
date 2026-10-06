/**
 * Savant Trader Chart Service
 *
 * Reads OHLC bars for a symbol from the `symbol-data/{symbol}` Firestore subcollections.
 * SA writes full intraday OHLCV bars on every PDR run, so symbol-data always contains
 * today's bar after the first intraday run. No partial-bar synthesis needed.
 */
import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Firestore, doc, getDoc, getDocs, collection } from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

import { BarsInterval } from '../../../core/models/partner.types';
import type { OhlcBar, OhlcBarsDoc } from '../../../core/models/market-data.types';
import type { ChartDataset } from '../../heatmap-chart/heatmap-chart.types';
import { ohlcToPriceBar } from '../utils/utils';

// ============================================================================
// Types
// ============================================================================

interface SymbolBarsResult {
  daily: OhlcBar[];
  weekly: OhlcBar[];
  monthly: OhlcBar[];
  version: string;
}

interface SymbolDataRootDoc {
  lastDailyBarDate?: string;
  lastBarSyncedAt?: unknown;
}

// ============================================================================
// Service
// ============================================================================

@Injectable({ providedIn: 'root' })
export class ChartService {
  private readonly firestore = inject(Firestore);
  private readonly injector = inject(EnvironmentInjector);

  private readonly SYMBOL_DATA_COLLECTION = 'symbol-data';

  /**
   * Load D/W/M ChartDatasets for a symbol from symbol-data subcollections.
   * Returns a version string so callers can key the indicator cache.
   */
  loadBars$(symbol: string): Observable<{ daily: ChartDataset; weekly: ChartDataset; monthly: ChartDataset; version: string }> {
    return from(runInInjectionContext(this.injector, () => this.fetchSymbolBars(symbol))).pipe(
      map(result => {
        if (!result) {
          return { ...this.emptyDatasets(symbol), version: '' };
        }
        return { ...this.buildDatasets(symbol, result.daily, result.weekly, result.monthly), version: result.version };
      }),
      catchError((err: unknown) => {
        console.error(`[chart-service] ${symbol} bar load failed; returning empty datasets`, err);
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
      const shardData = shardDoc.data() as OhlcBarsDoc;
      allDaily.push(...(shardData.bars ?? []));
    }
    allDaily.sort((a, b) => a.d.localeCompare(b.d));

    const weekly: OhlcBar[] = (weeklySnap.data() as OhlcBarsDoc | undefined)?.bars ?? [];
    const monthly: OhlcBar[] = (monthlySnap.data() as OhlcBarsDoc | undefined)?.bars ?? [];
    const rootData = rootSnap.exists() ? (rootSnap.data() as SymbolDataRootDoc) : {};

    const lastDailyDate = allDaily[allDaily.length - 1]?.d ?? '';
    if (rootData.lastDailyBarDate && lastDailyDate && rootData.lastDailyBarDate !== lastDailyDate) {
      console.warn(
        `[chart-service] ${symbol} symbol-data mismatch: root lastDailyBarDate=${rootData.lastDailyBarDate}, but daily shards end ${lastDailyDate}`
      );
    }

    return {
      daily: allDaily,
      weekly,
      monthly,
      version: rootData.lastDailyBarDate ?? lastDailyDate,
    };
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
    const priceBars = bars.map(ohlcToPriceBar);
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
