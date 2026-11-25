/**
 * ST Indicators — Barrel Export
 *
 * The canonical pure-math engines live in shared/ (#1727 — one body,
 * consumed by functions/ and src/app via @st/* aliases). This barrel
 * re-exports them alongside the functions-local engines that have no
 * FE-local recompute need (trend-strength, trigger-bands, std-dev-lines).
 */

export { HTF_MULTIPLIER, emaSeries, smaSeries, crossover, crossunder, cross, crossoverValue, crossunderValue, nz, nzLookback } from '@st/primitives';
export { computeCtfBand, computeHtfBand, computeStTrendBands, computeTrendBandWidth } from '@st/trend-bands';
export { computeStZone } from '@st/zone';
export { computeStZoneV2 } from '@st/zone-v2';
export { computeStTrendStrength } from './st-trend-strength';

export type { OHLCV, BandResult, TrendBandsResult, TrendBandWidthResult, TrendBandWidthParams } from '@st/trend-bands';
export type { ZoneResult, TrendCategory } from '@st/zone';
export type { ZoneV2Result } from '@st/zone-v2';
export type { TrendStrengthResult } from './st-trend-strength';
