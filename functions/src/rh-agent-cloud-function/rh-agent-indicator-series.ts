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
import { RH_AGENT_ALLOWED_ORIGINS } from './rh-agent-cors';
import type { OhlcBar } from './rh-agent-types';
import {
  computeSymbolIndicatorSeries,
  ChartInterval,
  IndicatorFamily,
  StrategyFamily,
  type SymbolIndicatorSeriesResponse,
  type IntervalData,
} from './rh-agent-indicator-computation';

export {
  computeIndicatorSeries,
  computeSymbolIndicatorSeries,
  type ChartInterval,
  type IndicatorFamily,
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
        (intervalData.indicators as Record<string, unknown>)[family] = source.indicators[family];
      }
    }
    for (const family of strategies) {
      if (source.signals[family]) {
        intervalData.signals[family] = source.signals[family];
      }
    }
    if (source.dotMarkers) {
      intervalData.dotMarkers = {};
      for (const family of strategies) {
        const key = family === StrategyFamily.ZONE_V1 ? 'zoneV1' : family === StrategyFamily.ZONE_V2 ? 'zoneV2' : family === StrategyFamily.TREND_STRENGTH ? 'trendStrength' : null;
        if (key && source.dotMarkers[key]) {
          intervalData.dotMarkers[key] = source.dotMarkers[key];
        }
      }
    }
    if (source.htfWindows) {
      intervalData.htfWindows = {};
      if (source.htfWindows.weekly) {
        intervalData.htfWindows.weekly = source.htfWindows.weekly;
      }
      if (source.htfWindows.monthly) {
        intervalData.htfWindows.monthly = source.htfWindows.monthly;
      }
    }
    filteredIntervals[interval] = intervalData;
  }
  return { ...response, intervals: filteredIntervals };
}

/**
 * Callable: fetch pre-computed indicator time series for a symbol.
 * Reads from rs-bars/{symbol} and computes all indicators on the backend.
 */
export const rhAgentGetSymbolIndicatorSeries = onCall<GetIndicatorSeriesRequest, Promise<SymbolIndicatorSeriesResponse>>(
  {
    cors: RH_AGENT_ALLOWED_ORIGINS,
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

      const dotCounts = {
        dailyV1: result.intervals.daily?.dotMarkers?.zoneV1?.length ?? 0,
        dailyV2: result.intervals.daily?.dotMarkers?.zoneV2?.length ?? 0,
        dailyTs: result.intervals.daily?.dotMarkers?.trendStrength?.length ?? 0,
        weeklyV1: result.intervals.weekly?.dotMarkers?.zoneV1?.length ?? 0,
        weeklyV2: result.intervals.weekly?.dotMarkers?.zoneV2?.length ?? 0,
        weeklyTs: result.intervals.weekly?.dotMarkers?.trendStrength?.length ?? 0,
      };
      const htfCounts = {
        dailyWeekly: result.intervals.daily?.htfWindows?.weekly?.length ?? 0,
        weeklyMonthly: result.intervals.weekly?.htfWindows?.monthly?.length ?? 0,
      };
      logger.info('rh_agent_indicator_series_computed', { symbol, dotCounts, htfCounts });

      const filtered = filterResponse(result, requestedIntervals, requestedIndicators, requestedStrategies);

      const filteredDotCounts = {
        dailyV1: filtered.intervals.daily?.dotMarkers?.zoneV1?.length ?? 0,
        dailyV2: filtered.intervals.daily?.dotMarkers?.zoneV2?.length ?? 0,
        dailyTs: filtered.intervals.daily?.dotMarkers?.trendStrength?.length ?? 0,
        weeklyV1: filtered.intervals.weekly?.dotMarkers?.zoneV1?.length ?? 0,
        weeklyV2: filtered.intervals.weekly?.dotMarkers?.zoneV2?.length ?? 0,
        weeklyTs: filtered.intervals.weekly?.dotMarkers?.trendStrength?.length ?? 0,
      };
      const filteredHtfCounts = {
        dailyWeekly: filtered.intervals.daily?.htfWindows?.weekly?.length ?? 0,
        weeklyMonthly: filtered.intervals.weekly?.htfWindows?.monthly?.length ?? 0,
      };
      logger.info('rh_agent_indicator_series_complete', { symbol, dailyBars: daily.length, weeklyBars: weekly.length, monthlyBars: monthly.length, intervals: requestedIntervals, indicators: requestedIndicators, strategies: requestedStrategies, filteredDotCounts, filteredHtfCounts });
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
