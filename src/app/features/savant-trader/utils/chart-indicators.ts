/**
 * RH Agent Chart Indicators
 *
 * Public barrel for RH Agent chart indicator utilities. Implementation lives in
 * the `chart-indicators/` directory; this file re-exports the stable public API
 * so callers do not need to know the internal module layout.
 */

export type { ChartScatterPoint, ChartExtras } from './chart-indicators/base-indicators';
export type { ExtrasSignals } from './chart-indicators/extras-signals';
export {
  buildBaseIndicators,
  addHtfZoneWindow,
  addSignalDots,
  addUptickDots,
  addChartExtras,
  UptickDotColors,
} from './chart-indicators/base-indicators';

export {
  uptickDotsFromHistory,
  convertTrendStrengthDotMarkers,
  convertZoneDotMarkers,
  convertHtfWindowData,
} from './chart-indicators/signal-marker-converters';

export {
  convertIntervalIndicators,
  injectCallableIndicatorData,
} from './chart-indicators/indicator-converters';

export { createExtrasSignals } from './chart-indicators/extras-signals';

export { ST_ZONE_WINDOW_MONTHLY_INDICATOR, ST_ZONE_WINDOW_WEEKLY_INDICATOR } from './chart-indicators/base-indicators';
export { ST_ZONE_V1_UPTICK_DOTS_INDICATOR, ST_ZONE_V2_UPTICK_DOTS_INDICATOR } from './chart-indicators/base-indicators';
