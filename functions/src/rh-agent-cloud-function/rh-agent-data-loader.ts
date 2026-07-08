/**
 * Symbol Data Loader
 *
 * Reads cached D/W/M bars from symbol-data/{symbol} subcollections and injects
 * an intraday partial bar when needed. This is a pure data-loading concern
 * extracted from the worker so it can be tested independently.
 */
import { logger } from 'firebase-functions/v2';
import { db } from '../firebase-admin-init';
import type { OhlcBar } from '../common/market-data-types';
import {
  SYMBOL_DATA_COLLECTION,
  SYMBOL_BARS_DAILY_SUBCOL,
  SYMBOL_BARS_WEEKLY_SUBCOL,
  SYMBOL_BARS_MONTHLY_SUBCOL,
  SYMBOL_BARS_FLAT_DOC_ID,
} from '../webhooks/webhooks-config';

export interface SymbolBars {
  dailyBars: OhlcBar[];
  weeklyBars: OhlcBar[];
  monthlyBars: OhlcBar[];
  lastDailyBarStatus?: -1 | 0 | 1;
  lastWeeklyBarStatus?: -1 | 0 | 1;
  lastMonthlyBarStatus?: -1 | 0 | 1;
  sufficient: boolean;
}

/**
 * Load cached bars for a symbol and inject the intraday snapshot as today's
 * partial bar when provided.
 *
 * @param symbol Symbol to load.
 * @param marketDate YYYY-MM-DD run date.
 * @param intraday Whether this is an intraday run.
 * @param runId Run ID for logging.
 * @param intradaySnapshot Optional { ip } intraday price snapshot.
 * @param minRequiredBars Minimum daily bars required to be considered sufficient.
 */
export async function loadSymbolBars(
  symbol: string,
  marketDate: string,
  intraday: boolean,
  runId: string,
  intradaySnapshot?: { ip: number } | null,
  minRequiredBars = 45,
): Promise<SymbolBars> {
  logger.info('rh_agent_data_loader_fetching', { runId, symbol, marketDate, hasIntraday: !!intraday });
  const { dailyBars, weeklyBars, monthlyBars } = await getCachedBarsFromSymbolData(symbol, marketDate, intradaySnapshot ?? null);
  logger.info('rh_agent_data_loader_loaded', {
    runId,
    symbol,
    dailyBars: dailyBars.length,
    weeklyBars: weeklyBars.length,
    monthlyBars: monthlyBars.length,
  });

  return {
    dailyBars,
    weeklyBars,
    monthlyBars,
    lastDailyBarStatus: dailyBars.at(-1)?.barStatus,
    lastWeeklyBarStatus: weeklyBars.at(-1)?.barStatus,
    lastMonthlyBarStatus: monthlyBars.at(-1)?.barStatus,
    sufficient: dailyBars.length >= minRequiredBars,
  };
}

/**
 * Fetch bars from the symbol-data schema:
 *   - symbol-data/{symbol}/daily/{YYYY}  — year-sharded daily bars
 *   - symbol-data/{symbol}/weekly/all    — flat weekly bars
 *   - symbol-data/{symbol}/monthly/all   — flat monthly bars
 *
 * Trims all intervals to bars on or before marketDate.
 * Injects an intraday partial bar into daily when provided.
 */
export async function getCachedBarsFromSymbolData(
  symbol: string,
  marketDate: string,
  intraday: { ip: number } | null = null,
): Promise<{ dailyBars: OhlcBar[]; weeklyBars: OhlcBar[]; monthlyBars: OhlcBar[] }> {
  try {
    const rootRef = db.collection(SYMBOL_DATA_COLLECTION).doc(symbol);

    const [weeklySnap, monthlySnap, yearShards] = await Promise.all([
      rootRef.collection(SYMBOL_BARS_WEEKLY_SUBCOL).doc(SYMBOL_BARS_FLAT_DOC_ID).get(),
      rootRef.collection(SYMBOL_BARS_MONTHLY_SUBCOL).doc(SYMBOL_BARS_FLAT_DOC_ID).get(),
      rootRef.collection(SYMBOL_BARS_DAILY_SUBCOL).get(),
    ]);

    logger.info('rh_agent_symbol_data_loader_query', {
      symbol,
      marketDate,
      weeklyExists: weeklySnap.exists,
      monthlyExists: monthlySnap.exists,
      yearShardCount: yearShards.size,
    });

    if (yearShards.empty) {
      logger.warn('rh_agent_symbol_data_loader_cache_miss', { symbol, marketDate });
      return { dailyBars: [], weeklyBars: [], monthlyBars: [] };
    }

    const trim = (bars: OhlcBar[] | null | undefined) => {
      if (!Array.isArray(bars) || bars.length === 0) return [];
      return bars.filter((b) => (b?.d ?? '') <= marketDate);
    };

    // Merge all year shards into a single sorted array
    const allDailyBars: OhlcBar[] = [];
    for (const shardDoc of yearShards.docs) {
      const bars: OhlcBar[] = (shardDoc.data() as any)?.bars ?? [];
      allDailyBars.push(...bars);
    }
    allDailyBars.sort((a, b) => a.d.localeCompare(b.d));

    let dailyBars = trim(allDailyBars);
    const weeklyBars = trim((weeklySnap.data() as any)?.bars);
    const monthlyBars = trim((monthlySnap.data() as any)?.bars);

    if (intraday && dailyBars.length > 0) {
      const partialBar: OhlcBar = { d: marketDate, o: intraday.ip, h: intraday.ip, l: intraday.ip, c: intraday.ip };
      const last = dailyBars[dailyBars.length - 1];
      dailyBars = last?.d === marketDate
        ? [...dailyBars.slice(0, -1), partialBar]
        : [...dailyBars, partialBar];
    }

    logger.info('rh_agent_symbol_data_loader_result', {
      symbol,
      marketDate,
      dailyBars: dailyBars.length,
      weeklyBars: weeklyBars.length,
      monthlyBars: monthlyBars.length,
    });

    return { dailyBars, weeklyBars, monthlyBars };
  } catch (error: any) {
    logger.error('rh_agent_symbol_data_loader_error', { symbol, marketDate, error: error?.message });
    return { dailyBars: [], weeklyBars: [], monthlyBars: [] };
  }
}

/**
 * Verify that the most recent bar date matches the expected market date.
 * Returns true if data is fresh (from today), false otherwise.
 */
export function verifyDataFreshness(bars: any[], marketDate: string, runId: string, symbol: string): boolean {
  if (bars.length === 0) return false;

  const mostRecentBar = bars[bars.length - 1];
  const barDate = mostRecentBar?.d ?? mostRecentBar?.date ?? mostRecentBar?.t ?? mostRecentBar?.timestamp;

  if (!barDate) {
    logger.warn('rh_agent_data_loader_freshness_no_date', { runId, symbol });
    return false;
  }

  const barDateStr = typeof barDate === 'string'
    ? barDate.slice(0, 10)
    : new Date(barDate).toISOString().slice(0, 10);

  const isFresh = barDateStr === marketDate;

  logger.info('rh_agent_data_loader_freshness', {
    runId,
    symbol,
    marketDate,
    barDate: barDateStr,
    isFresh,
    barIndex: bars.length - 1,
  });

  return isFresh;
}
