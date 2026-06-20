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

import type { IndicatorOption, IndicatorCalculator } from '../flex-chart.types';
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
