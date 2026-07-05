/**
 * Symbol Data Loader
 *
 * Reads cached D/W/M bars from rs-bars/{symbol} and injects an intraday partial
 * bar when needed. This is a pure data-loading concern extracted from the
 * worker so it can be tested independently.
 */
import { logger } from 'firebase-functions/v2';
import { db } from '../firebase-admin-init';
import type { OhlcBar } from './rh-agent-types';
import { RsBarsDoc } from '../rs-bars/rs-bars-sync';

export interface SymbolBars {
  dailyBars: OhlcBar[];
  weeklyBars: OhlcBar[];
  monthlyBars: OhlcBar[];
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
  const { dailyBars, weeklyBars, monthlyBars } = await getCachedBars(symbol, marketDate, intradaySnapshot ?? null);
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
    sufficient: dailyBars.length >= minRequiredBars,
  };
}

/**
 * Fetch bars from rs-bars/{symbol} — the single local source of truth.
 * Populated nightly by rsBarsSyncNightly. Returns D/W/M bars trimmed to
 * bars on or before marketDate so historical runs see the correct snapshot.
 */
async function getCachedBars(
  symbol: string,
  marketDate: string,
  intraday: { ip: number } | null = null
): Promise<{ dailyBars: OhlcBar[]; weeklyBars: OhlcBar[]; monthlyBars: OhlcBar[] }> {
  try {
    const docRef = db.collection('rs-bars').doc(symbol);
    const snap = await docRef.get();

    logger.info('rh_agent_data_loader_cache_query', { symbol, marketDate, collection: 'rs-bars', exists: snap.exists });

    if (!snap.exists) {
      logger.warn('rh_agent_data_loader_cache_miss', { symbol, marketDate, note: 'Run rsBarsSyncAdmin to backfill' });
      return { dailyBars: [], weeklyBars: [], monthlyBars: [] };
    }

    const data = snap.data() as RsBarsDoc | undefined;

    /** Trim bars to dates on or before marketDate for correct historical snapshots. */
    const trim = (bars: OhlcBar[] | null | undefined) => {
      if (!Array.isArray(bars) || bars.length === 0) return [];
      const filtered = bars.filter((b) => (b?.d ?? '') <= marketDate);
      return filtered.length > 0 ? filtered : [];
    };

    let dailyBars = trim(data?.daily);
    const weeklyBars = trim(data?.weekly);
    const monthlyBars = trim(data?.monthly);

    // Inject today's intraday price as a partial bar (replace-or-append).
    if (intraday && dailyBars) {
      const partialBar: OhlcBar = { d: marketDate, o: intraday.ip, h: intraday.ip, l: intraday.ip, c: intraday.ip };
      const last = dailyBars[dailyBars.length - 1];
      dailyBars = last?.d === marketDate
        ? [...dailyBars.slice(0, -1), partialBar]
        : [...dailyBars, partialBar];
    }

    logger.info('rh_agent_data_loader_cache_result', {
      symbol,
      marketDate,
      dailyBars: dailyBars.length,
      weeklyBars: weeklyBars.length,
      monthlyBars: monthlyBars.length,
    });

    if (dailyBars.length === 0) {
      logger.warn('rh_agent_data_loader_no_daily_bars', { symbol, marketDate });
    }

    return { dailyBars, weeklyBars, monthlyBars };
  } catch (error: any) {
    logger.error('rh_agent_data_loader_cache_error', { symbol, marketDate, error: error?.message });
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
