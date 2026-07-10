/**
 * RH Agent Chart Service
 *
 * Reads OHLC bars for a symbol from the `symbol-data/{symbol}` Firestore subcollections.
 * SA writes full intraday OHLCV bars on every PDR run, so symbol-data always contains
 * today's bar after the first intraday run. No partial-bar synthesis needed.
 */
import { Injectable, inject } from '@angular/core';
import { Firestore, doc, getDoc, getDocs, collection } from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

import { BarsInterval } from '../../../core/models/partner.types';
import type { ChartDataset, PriceBar } from '../../heatmap-chart/heatmap-chart.types';
import { toDatePt } from '../utils/rh-agent.utils';

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

// ============================================================================
// Service
// ============================================================================

@Injectable({ providedIn: 'root' })
export class RhAgentChartService {
  private readonly firestore = inject(Firestore);

  private readonly SYMBOL_DATA_COLLECTION = 'symbol-data';

  /**
   * Load D/W/M ChartDatasets for a symbol from symbol-data subcollections.
   * Returns a version string so callers can key the indicator cache.
   */
  loadBars$(symbol: string): Observable<{ daily: ChartDataset; weekly: ChartDataset; monthly: ChartDataset; version: string }> {
    return from(this.fetchSymbolBars(symbol)).pipe(
      map(result => {
        if (!result) {
          return { ...this.emptyDatasets(symbol), version: '' };
        }
        return { ...this.buildDatasets(symbol, result.daily, result.weekly, result.monthly), version: result.version };
      }),
      catchError(() => of({ ...this.emptyDatasets(symbol), version: '' }))
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
