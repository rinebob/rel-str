/**
 * RH Agent Indicator Series
 *
 * Backend source of truth for ST indicator time series and signal markers.
 *
 * The frontend should not recompute ST indicators. It calls the exported callable,
 * receives pre-computed D/W/M series aligned to the bar dates, and plots them.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { db } from '../firebase-admin-init';
import { RS_BARS_COLLECTION } from '../rs-bars/rs-bars-sync';
import {
  computeSymbolIndicatorSeries,
  ChartInterval,
  IndicatorFamily,
  StrategyFamily,
  type OhlcBar,
  type SymbolIndicatorSeriesResponse,
  type IntervalData,
} from './rh-agent-indicator-computation';

export {
  computeIndicatorSeries,
  computeSymbolIndicatorSeries,
  type ChartInterval,
  type IndicatorFamily,
  type OhlcBar,
  type StrategyFamily,
  type IndicatorDataPoint,
  type IndicatorIntervalData,
  type IndicatorSignalMarker,
  type BandPoint,
  type SignalIntervalData,
  type SymbolIndicatorSeriesResponse,
  type IntervalData,
} from './rh-agent-indicator-computation';

interface GetIndicatorSeriesRequest {
  symbol: string;
  marketDate?: string;
  intervals?: ChartInterval[];
  indicators?: IndicatorFamily[];
  strategies?: StrategyFamily[];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const DEFAULT_INTERVALS: ChartInterval[] = [ChartInterval.DAILY, ChartInterval.WEEKLY, ChartInterval.MONTHLY];
const DEFAULT_INDICATORS: IndicatorFamily[] = [IndicatorFamily.ZONE_V1, IndicatorFamily.ZONE_V2, IndicatorFamily.TREND_STRENGTH, IndicatorFamily.TREND_BANDS];
const DEFAULT_STRATEGIES: StrategyFamily[] = [StrategyFamily.ZONE_V1, StrategyFamily.ZONE_V2, StrategyFamily.TREND_STRENGTH];

function filterResponse(
  response: SymbolIndicatorSeriesResponse,
  intervals: ChartInterval[],
  indicators: IndicatorFamily[],
  strategies: StrategyFamily[],
): SymbolIndicatorSeriesResponse {
  const filteredIntervals: SymbolIndicatorSeriesResponse['intervals'] = {};
  for (const interval of intervals) {
    const source = response.intervals[interval];
    if (!source) continue;
    const intervalData: IntervalData = { indicators: {}, signals: {} };
    for (const family of indicators) {
      if (source.indicators[family]) {
        intervalData.indicators[family] = source.indicators[family];
      }
    }
    for (const family of strategies) {
      if (source.signals[family]) {
        intervalData.signals[family] = source.signals[family];
      }
    }
    filteredIntervals[interval] = intervalData;
  }
  return { ...response, intervals: filteredIntervals };
}

/** Allowed origins for the indicator series callable. */
const ALLOWED_ORIGINS = [
  'https://rel-str--rel-str.web.app',
  'https://rel-str--rel-str.us-central1.hosted.app',
  'https://rel-str.web.app',
  'https://savanttrader.com',
  'https://www.savanttrader.com',
  'http://localhost:4200',
  'http://localhost:4210',
  'http://localhost:5000',
];

/**
 * Callable: fetch pre-computed indicator time series for a symbol.
 * Reads from rs-bars/{symbol} and computes all indicators on the backend.
 */
export const rhAgentGetSymbolIndicatorSeries = onCall<GetIndicatorSeriesRequest, Promise<SymbolIndicatorSeriesResponse>>(
  {
    cors: ALLOWED_ORIGINS,
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (request) => {
    try {
      const { symbol, marketDate, intervals, indicators, strategies } = request.data;
      if (!symbol || typeof symbol !== 'string') {
        throw new HttpsError('invalid-argument', 'symbol is required');
      }

      const requestedIntervals = intervals?.length ? intervals : DEFAULT_INTERVALS;
      const requestedIndicators = indicators?.length ? indicators : DEFAULT_INDICATORS;
      const requestedStrategies = strategies?.length ? strategies : DEFAULT_STRATEGIES;

      logger.info('rh_agent_indicator_series_request', { symbol, marketDate, intervals: requestedIntervals, indicators: requestedIndicators, strategies: requestedStrategies });

      const docRef = db.collection(RS_BARS_COLLECTION).doc(symbol);
      const snap = await docRef.get();
      if (!snap.exists) {
        throw new HttpsError('not-found', `No rs-bars data found for ${symbol}`);
      }

      const doc = snap.data() as { daily?: OhlcBar[]; weekly?: OhlcBar[]; monthly?: OhlcBar[] };
      const daily = doc.daily ?? [];
      const weekly = doc.weekly ?? [];
      const monthly = doc.monthly ?? [];

      if (daily.length < 30) {
        throw new HttpsError('failed-precondition', `Insufficient daily bars for ${symbol}: ${daily.length}`);
      }

      const result = computeSymbolIndicatorSeries(symbol, daily, weekly, monthly);
      result.marketDate = marketDate || todayIso();
      const filtered = filterResponse(result, requestedIntervals, requestedIndicators, requestedStrategies);

      logger.info('rh_agent_indicator_series_complete', { symbol, dailyBars: daily.length, weeklyBars: weekly.length, monthlyBars: monthly.length, intervals: requestedIntervals, indicators: requestedIndicators, strategies: requestedStrategies });
      return filtered;
    } catch (err) {
      logger.error('rh_agent_indicator_series_error', { symbol: request.data?.symbol, error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
      if (err instanceof HttpsError) {
        throw err;
      }
      throw new HttpsError('internal', err instanceof Error ? err.message : 'Unknown error');
    }
  }
);
