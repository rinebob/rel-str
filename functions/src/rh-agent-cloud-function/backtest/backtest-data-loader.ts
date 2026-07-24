/**
 * Backtest data loader.
 *
 * Loads all available daily bars for a symbol from Firestore and provides a
 * per-task cache for historical options chains fetched from the partner proxy.
 */

import { logger } from 'firebase-functions/v2';
import { getCachedBarsFromSymbolData } from '../rh-agent-data-loader';
import { callPartnerHistoricalOptions } from '../../options-contract-proxy';
import type { OhlcBar } from '../../common/market-data-types';
import type { OHLCV } from '../strategies/base-strategy';
import type { HistoricalOptionContract } from '../../types/partner';

/**
 * Convert symbol-data OhlcBar shape to the strategy OHLCV shape.
 */
function toOhlcv(bar: OhlcBar): OHLCV {
  return {
    date: bar.d,
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v ?? 0,
  };
}

export interface AllLoadedBars {
  dailyBars: OHLCV[];
  weeklyBars: OHLCV[];
  monthlyBars: OHLCV[];
}

function sortAndUniqueBars(bars: OhlcBar[]): OhlcBar[] {
  const sorted = [...bars].sort((a, b) => a.d.localeCompare(b.d));
  return sorted.filter((bar, i) => i === 0 || bar.d !== sorted[i - 1].d);
}

/**
 * Load every available daily, weekly, and monthly bar for the symbol.
 * All arrays are sorted oldest to newest and de-duplicated by date.
 */
export async function loadAllBars(symbol: string): Promise<AllLoadedBars> {
  logger.info('backtest_loader_start', { symbol });

  // Pass a far-future date so nothing is trimmed.
  const { dailyBars, weeklyBars, monthlyBars } = await getCachedBarsFromSymbolData(symbol, '2999-12-31');

  const result = {
    dailyBars: sortAndUniqueBars(dailyBars ?? []).map(toOhlcv),
    weeklyBars: sortAndUniqueBars(weeklyBars ?? []).map(toOhlcv),
    monthlyBars: sortAndUniqueBars(monthlyBars ?? []).map(toOhlcv),
  };

  logger.info('backtest_loader_complete', {
    symbol,
    dailyBars: result.dailyBars.length,
    weeklyBars: result.weeklyBars.length,
    monthlyBars: result.monthlyBars.length,
  });

  return result;
}

/**
 * Load every available daily bar for the symbol, sorted oldest to newest.
 */
export async function loadAllDailyBars(symbol: string): Promise<OHLCV[]> {
  return (await loadAllBars(symbol)).dailyBars;
}

/**
 * Cache for historical option chains. Fetches from the partner proxy once per
 * market date and reuses the result for every open position on that date.
 */
export class OptionsChainCache {
  private cache = new Map<string, HistoricalOptionContract[]>();

  constructor(private readonly symbol: string) {}

  /**
   * Get the option chain for a market date. Caches after the first fetch.
   * Returns an empty array on 404 or parse failures, leaving a gap for the
   * simulator to report.
   */
  async getChain(date: string): Promise<HistoricalOptionContract[]> {
    const key = `${this.symbol}:${date}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    logger.info('backtest_options_fetch', { symbol: this.symbol, date });
    try {
      const response = await callPartnerHistoricalOptions({ symbol: this.symbol, date });
      const contracts = response?.data?.data ?? [];
      const normalized = Array.isArray(contracts) ? contracts : [];
      this.cache.set(key, normalized);
      logger.info('backtest_options_fetched', { symbol: this.symbol, date, count: normalized.length });
      return normalized;
    } catch (error: unknown) {
      logger.warn('backtest_options_fetch_failed', {
        symbol: this.symbol,
        date,
        error: error instanceof Error ? error.message : String(error),
      });
      // Cache an empty result so we do not hammer the partner endpoint.
      this.cache.set(key, []);
      return [];
    }
  }

  /** Number of unique market dates fetched. */
  get fetchedDates(): number {
    return this.cache.size;
  }
}
