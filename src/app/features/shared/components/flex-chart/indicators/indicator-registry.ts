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
export { ST_ZONE_V2_INDICATOR, calculateStZoneV2 } from './st-zone-v2.indicator';
export { ST_TREND_STRENGTH_INDICATOR, calculateStTrendStrength } from './st-trend-strength.indicator';
export { ST_ZONE_WINDOW_MONTHLY_INDICATOR, ST_ZONE_WINDOW_WEEKLY_INDICATOR, computeZoneWindowData } from './st-zone-window.indicator';
export { ST_SIGNAL_DOTS_INDICATOR, computeSignalDots } from './st-signal-dots.indicator';
export { ST_ZONE_V1_UPTICK_DOTS_INDICATOR, ST_ZONE_V2_UPTICK_DOTS_INDICATOR, detectZoneUptickDots } from './st-zone-uptick-dots.indicator';
export { ST_TREND_BAND_WIDTH_INDICATOR, calculateStTrendBandWidth, computeBandWidthDots } from './st-trend-band-width.indicator';

import type { IndicatorOption, IndicatorCalculator, IndicatorConfig, SeriesType, IndicatorType } from '../flex-chart.types';
import { StIndicator } from '../flex-chart.types';
import { EMA_INDICATOR, calculateEMA } from './ema.indicator';
import { RSI_INDICATOR, calculateRSI } from './rsi.indicator';
import { MACD_INDICATOR, calculateMACD } from './macd.indicator';
import { ST_TREND_BANDS_INDICATOR, calculateStTrendBands } from './st-trend-bands.indicator';
import { ST_ZONE_INDICATOR, calculateStZone } from './st-zone.indicator';
import { ST_ZONE_V2_INDICATOR, calculateStZoneV2 } from './st-zone-v2.indicator';
import { ST_TREND_STRENGTH_INDICATOR, calculateStTrendStrength } from './st-trend-strength.indicator';
import { ST_ZONE_WINDOW_MONTHLY_INDICATOR, ST_ZONE_WINDOW_WEEKLY_INDICATOR } from './st-zone-window.indicator';
import { ST_SIGNAL_DOTS_INDICATOR } from './st-signal-dots.indicator';
import { ST_ZONE_V1_UPTICK_DOTS_INDICATOR, ST_ZONE_V2_UPTICK_DOTS_INDICATOR } from './st-zone-uptick-dots.indicator';
import { ST_TREND_BAND_WIDTH_INDICATOR, calculateStTrendBandWidth } from './st-trend-band-width.indicator';

/** ST-only indicators for the checkbox toggle menu */
export const ST_INDICATOR_OPTIONS: IndicatorOption[] = [
  ST_TREND_BANDS_INDICATOR,
  ST_TREND_STRENGTH_INDICATOR,
  ST_ZONE_INDICATOR,
  ST_ZONE_V2_INDICATOR,
  ST_ZONE_WINDOW_WEEKLY_INDICATOR,
  ST_ZONE_WINDOW_MONTHLY_INDICATOR,
  ST_SIGNAL_DOTS_INDICATOR,
  ST_ZONE_V1_UPTICK_DOTS_INDICATOR,
  ST_ZONE_V2_UPTICK_DOTS_INDICATOR,
  ST_TREND_BAND_WIDTH_INDICATOR,
];

/** Calculator map — keyed by IndicatorType, used by computeIndicators() */
export const indicatorCalculators: Record<string, IndicatorCalculator> = {
  ema: calculateEMA,
  rsi: calculateRSI,
  macd: calculateMACD,
  [StIndicator.TREND_BANDS]:    calculateStTrendBands,
  [StIndicator.ZONE]:           calculateStZone,
  [StIndicator.ZONE_V2]:        calculateStZoneV2,
  [StIndicator.TREND_STRENGTH]:   calculateStTrendStrength,
  [StIndicator.TREND_BAND_WIDTH]:  calculateStTrendBandWidth,
};

/** Default series type per indicator type */
const SERIES_TYPE_MAP: Partial<Record<IndicatorType, SeriesType>> = {
  [StIndicator.TREND_BANDS]:      'candle',
  [StIndicator.TREND_STRENGTH]:   'column',
  [StIndicator.ZONE]:             'scatter',
  [StIndicator.ZONE_V2]:          'scatter',
  [StIndicator.ZONE_WINDOW]:      'scatter',
  [StIndicator.SIGNAL_DOTS]:      'scatter',
  [StIndicator.ZONE_UPTICK_DOTS]:  'scatter',
  [StIndicator.TREND_BAND_WIDTH]:   'column',
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
  { ...buildDefaultConfig(ST_TREND_STRENGTH_INDICATOR), pane: 'lower-1' },
  { ...buildDefaultConfig(ST_ZONE_INDICATOR), pane: 'lower-2', options: { ...buildDefaultConfig(ST_ZONE_INDICATOR).options, name: 'ST-ZONE V1' } },
  { ...buildDefaultConfig(ST_ZONE_V2_INDICATOR), pane: 'lower-3', options: { ...buildDefaultConfig(ST_ZONE_V2_INDICATOR).options, name: 'ST-ZONE V2' } },
];
