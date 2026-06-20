/**
 * Indicator Registry
 *
 * Collects all available indicator definitions and calculators.
 * To add a new indicator:
 *   1. Create indicators/<name>.indicator.ts (see INDICATOR_FILE_EXAMPLE.md)
 *   2. Import and register it here
 */
export { EMA_INDICATOR, calculateEMA } from './ema.indicator';
export { RSI_INDICATOR, calculateRSI } from './rsi.indicator';
export { MACD_INDICATOR, calculateMACD } from './macd.indicator';
export { ST_TREND_BANDS_INDICATOR, calculateStTrendBands } from './st-trend-bands.indicator';
export { ST_ZONE_INDICATOR, calculateStZone } from './st-zone.indicator';
export { ST_TREND_STRENGTH_INDICATOR, calculateStTrendStrength } from './st-trend-strength.indicator';

import type { IndicatorOption, IndicatorCalculator, IndicatorConfig, SeriesType, IndicatorType } from '../flex-chart.types';
import { EMA_INDICATOR, calculateEMA } from './ema.indicator';
import { RSI_INDICATOR, calculateRSI } from './rsi.indicator';
import { MACD_INDICATOR, calculateMACD } from './macd.indicator';
import { ST_TREND_BANDS_INDICATOR, calculateStTrendBands } from './st-trend-bands.indicator';
import { ST_ZONE_INDICATOR, calculateStZone } from './st-zone.indicator';
import { ST_TREND_STRENGTH_INDICATOR, calculateStTrendStrength } from './st-trend-strength.indicator';

/** All available indicators for UI dropdowns */
export const INDICATOR_OPTIONS: IndicatorOption[] = [
  EMA_INDICATOR,
  RSI_INDICATOR,
  MACD_INDICATOR,
  ST_TREND_BANDS_INDICATOR,
  ST_ZONE_INDICATOR,
  ST_TREND_STRENGTH_INDICATOR,
];

/** Calculator map — keyed by IndicatorType, used by computeIndicators() */
export const indicatorCalculators: Record<string, IndicatorCalculator> = {
  ema: calculateEMA,
  rsi: calculateRSI,
  macd: calculateMACD,
  'st-trend-bands': calculateStTrendBands,
  'st-zone': calculateStZone,
  'st-trend-strength': calculateStTrendStrength,
};

/** Default series type per indicator type */
const SERIES_TYPE_MAP: Partial<Record<IndicatorType, SeriesType>> = {
  'st-trend-bands': 'candle',
  'st-trend-strength': 'column',
  'st-zone': 'scatter',
};

/** Build an IndicatorConfig from an IndicatorOption using its declared defaults */
export function buildDefaultConfig(option: IndicatorOption): IndicatorConfig {
  const params: Record<string, number | string | boolean> = {};
  for (const p of option.params) {
    params[p.key] = p.default;
  }

  const label = option.label.toUpperCase().replace(/ /g, '-');
  const paramStr = option.params.map(p => p.default).join(',');
  const name = paramStr ? `${label}(${paramStr})` : label;

  return {
    id: `${option.id}-default`,
    type: option.type,
    pane: option.defaultPane,
    seriesType: SERIES_TYPE_MAP[option.type] || 'line',
    params,
    options: {
      name,
      axisScale: option.axisScale,
      ...option.defaultOptions,
    },
  };
}

/** Default ST indicator suite — auto-loaded on chart */
export const DEFAULT_ST_INDICATORS: IndicatorConfig[] = [
  buildDefaultConfig(ST_TREND_BANDS_INDICATOR),
  buildDefaultConfig(ST_ZONE_INDICATOR),
  buildDefaultConfig(ST_TREND_STRENGTH_INDICATOR),
];
