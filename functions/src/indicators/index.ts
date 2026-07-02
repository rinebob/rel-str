/**
 * ST Indicators — Barrel Export
 *
 * Pure math indicator library. No Angular, no Firebase dependencies.
 * Consumed by both the cloud function worker and the frontend flex-chart.
 */

export { HTF_MULTIPLIER, emaSeries, smaSeries, crossover, crossunder, cross, crossoverValue, crossunderValue, nz, nzLookback } from './primitives';
export { computeCtfBand, computeHtfBand, computeStTrendBands, computeTrendBandWidth } from './st-trend-bands';
export { computeStZone } from './st-zone';
export { computeStZoneV2 } from './st-zone-v2';
export { computeStTrendStrength } from './st-trend-strength';

export type { OHLCV, BandResult, TrendBandsResult, TrendBandWidthResult, TrendBandWidthParams } from './st-trend-bands';
export type { ZoneResult, TrendCategory } from './st-zone';
export type { ZoneV2Result } from './st-zone-v2';
export type { TrendStrengthResult } from './st-trend-strength';
