/**
 * ST Indicators — Barrel Export
 *
 * Pure math indicator library. No Angular, no Firebase dependencies.
 * Consumed by both the cloud function worker and the frontend flex-chart.
 */

export { HTF_MULTIPLIER, emaSeries, smaSeries, crossover, crossunder, cross, crossoverValue, crossunderValue, nz, nzLookback } from './primitives';
export { computeCtfBand, computeHtfBand, computeStTrendBands } from './st-trend-bands';
export { computeStZone } from './st-zone';
export { computeStTrendStrength } from './st-trend-strength';

export type { OHLCV, BandResult, TrendBandsResult } from './st-trend-bands';
export type { ZoneResult, TrendCategory } from './st-zone';
export type { TrendStrengthResult } from './st-trend-strength';
