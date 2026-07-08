/**
 * Intraday Weekly/Monthly Symbol-Data Sync
 *
 * Refreshes the trailing W/M bars in symbol-data during RH Agent intraday runs.
 * SA now updates the trailing W/M bar's OHLCV on each intraday tick (using the
 * current trading day as the bar date). This module fetches those latest bars
 * and merges them into symbol-data so the SOT stays current during RTH.
 *
 * The nightly symbol-data-sync remains the authoritative backfill; this is only
 * an incremental refresh of the current incomplete period.
 */
import { logger } from 'firebase-functions/v2';
import { callPartnerTimeSeries } from '../partner-proxy';
import type { OhlcBar } from '../common/market-data-types';
import { normalizeBar } from './symbol-data-bar-helpers';
import { writeWeeklyMonthlyBars } from './symbol-data-writer';

/**
 * Number of trailing W/M bars to fetch from SA on each intraday refresh.
 * We only need the latest bar, but fetch a tiny buffer in case the partner
 * response is missing the very last tick on an edge-case run.
 */
const INTRADAY_WM_LIMIT = 1;

/**
 * Fetch the latest weekly and monthly bars from SA and merge them into
 * symbol-data/{symbol}/weekly/all and monthly/all.
 */
export async function syncIntradayWmToSymbolData(symbol: string, marketDate: string): Promise<void> {
  logger.info('rh_agent_wm_sync_start', { symbol, marketDate });

  try {
    const [rawWeekly, rawMonthly] = await Promise.all([
      callPartnerTimeSeries({ symbol, interval: 'WEEKLY', adjusted: true, limit: INTRADAY_WM_LIMIT, to: marketDate }).catch((err: any) => {
        logger.warn('rh_agent_wm_sync_weekly_fetch_failed', { symbol, marketDate, error: err?.message });
        return null;
      }),
      callPartnerTimeSeries({ symbol, interval: 'MONTHLY', adjusted: true, limit: INTRADAY_WM_LIMIT, to: marketDate }).catch((err: any) => {
        logger.warn('rh_agent_wm_sync_monthly_fetch_failed', { symbol, marketDate, error: err?.message });
        return null;
      }),
    ]);

    const incomingWeekly = ((rawWeekly as any)?.bars ?? []).map(normalizeBar).filter(Boolean) as OhlcBar[];
    const incomingMonthly = ((rawMonthly as any)?.bars ?? []).map(normalizeBar).filter(Boolean) as OhlcBar[];

    if (incomingWeekly.length === 0 && incomingMonthly.length === 0) {
      logger.info('rh_agent_wm_sync_no_data', { symbol, marketDate });
      return;
    }

    await writeWeeklyMonthlyBars(symbol, incomingWeekly, incomingMonthly);

    logger.info('rh_agent_wm_sync_complete', {
      symbol,
      marketDate,
      weeklyCount: incomingWeekly.length,
      monthlyCount: incomingMonthly.length,
      lastWeeklyDate: incomingWeekly.at(-1)?.d,
      lastMonthlyDate: incomingMonthly.at(-1)?.d,
    });
  } catch (error: any) {
    logger.error('rh_agent_wm_sync_error', { symbol, marketDate, error: error?.message });
    throw error;
  }
}
