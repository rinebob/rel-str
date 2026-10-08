/**
 * ST Indicator Series — response filtering.
 *
 * Pure (no Firebase imports) so the callable's filtering rules are unit
 * testable. The callable computes the full response, then returns only the
 * requested intervals, indicator families and strategy families.
 */

import {
  ChartInterval,
  IndicatorFamily,
  StrategyFamily,
  type IntervalData,
  type SymbolIndicatorSeriesResponse,
} from './indicator-computation';

export const DEFAULT_INTERVALS: ChartInterval[] = [ChartInterval.DAILY, ChartInterval.WEEKLY, ChartInterval.MONTHLY];
export const DEFAULT_INDICATORS: IndicatorFamily[] = [IndicatorFamily.ZONE_V1, IndicatorFamily.ZONE_V2, IndicatorFamily.TREND_STRENGTH, IndicatorFamily.TREND_BANDS];
export const DEFAULT_STRATEGIES: StrategyFamily[] = [StrategyFamily.ZONE_V1, StrategyFamily.ZONE_V2, StrategyFamily.TREND_STRENGTH];

export function filterResponse(
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
      // Trigger Bands is an indicator (no strategy family): its dots follow the indicator request.
      if (indicators.includes(IndicatorFamily.TRIGGER_BANDS) && source.dotMarkers.triggerBands) {
        intervalData.dotMarkers.triggerBands = source.dotMarkers.triggerBands;
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
