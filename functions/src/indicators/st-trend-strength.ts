/**
 * ST-Trend-Strength — Savant Trader Trend Strength (DI+/-)
 *
 * Directional trend strength indicator using DI+, DI-, and histogram.
 * All lookbacks use HTF_MULTIPLIER (3) — this is the native timeframe
 * for this indicator per the source PineScript.
 *
 * Ported from rb-DI-plus-minus-lib.pine.
 */

import { smaSeries, crossoverValue, crossunderValue, nz, HTF_MULTIPLIER } from './primitives';
import type { OHLCV } from './st-trend-bands';

// =============================================================================
// INTERFACES
// =============================================================================

export interface TrendStrengthResult {
  diPlus: number[];        // DI+ series
  diMinus: number[];       // DI- series
  diHist: number[];        // DI+ - DI- histogram
  dx: number[];            // Directional Index
  adx: number[];           // Average Directional Index (SMA of DX)
  crossesZero: boolean[];            // diHist crosses zero in either direction
  crossesAboveZero: boolean[];       // diHist crosses above zero
  crossesBelowZero: boolean[];       // diHist crosses below zero
  crossesAboveUpper: boolean[];      // diHist crosses above upper threshold
  crossesBelowLower: boolean[];      // diHist crosses below lower threshold
  crossesBelowUpper: boolean[];      // diHist crosses below upper threshold
  crossesAboveLower: boolean[];      // diHist crosses above lower threshold
  upBreak: boolean[];                // break pattern: diHist > 0 && rising after dip
  dnBreak: boolean[];                // break pattern: diHist < 0 && falling after bounce
}

// =============================================================================
// SYSTEM CONSTANTS
// =============================================================================

const ADX_LENGTH = 14;
const UPPER_THRESHOLD = 10;
const LOWER_THRESHOLD = -10;

// =============================================================================
// MAIN COMPUTATION
// =============================================================================

/**
 * Compute ST-Trend-Strength (DI+/-) indicator.
 * Direct port of rb_di_plus_minus from rb-DI-plus-minus-lib.pine.
 *
 * All lookbacks use HTF_MULTIPLIER (3):
 * - True range compares against close[i-3]
 * - Directional movement compares high[i] vs high[i-3], low[i-3] vs low[i]
 * - Wilder smoothing uses smoothed[i-3] for carry-forward
 *
 * @param bars - OHLCV input bars
 * @returns TrendStrengthResult with all DI values and signals
 */
export function computeStTrendStrength(bars: OHLCV[]): TrendStrengthResult {
  const len = bars.length;
  const mult = HTF_MULTIPLIER;

  const rawHigh = bars.map(b => b.high);
  const rawLow = bars.map(b => b.low);
  const rawClose = bars.map(b => b.close);

  // Core DI arrays
  const diPlus = new Array<number>(len).fill(NaN);
  const diMinus = new Array<number>(len).fill(NaN);
  const diHist = new Array<number>(len).fill(NaN);
  const dx = new Array<number>(len).fill(NaN);

  // Wilder-smoothed accumulators
  const smoothedTR = new Array<number>(len).fill(0);
  const smoothedDMPlus = new Array<number>(len).fill(0);
  const smoothedDMMinus = new Array<number>(len).fill(0);

  for (let i = 0; i < len; i++) {
    // Need at least `mult` bars of lookback
    if (i < mult) continue;

    const h = rawHigh[i];
    const l = rawLow[i];
    const prevClose = nz(rawClose[i - mult]);
    const prevHigh = nz(rawHigh[i - mult]);
    const prevLow = nz(rawLow[i - mult]);

    // True Range: max(H-L, |H - close[i-mult]|, |L - close[i-mult]|)
    const trueRange = Math.max(
      h - l,
      Math.abs(h - prevClose),
      Math.abs(l - prevClose)
    );

    // Directional Movement
    const upMove = h - prevHigh;
    const downMove = prevLow - l;

    const dmPlus = (upMove > downMove && upMove > 0) ? upMove : 0;
    const dmMinus = (downMove > upMove && downMove > 0) ? downMove : 0;

    // Wilder smoothing: smoothed[i] = smoothed[i-mult] - (smoothed[i-mult] / period) + current
    const prevSmoothedTR = i >= mult ? nz(smoothedTR[i - mult]) : 0;
    const prevSmoothedDMPlus = i >= mult ? nz(smoothedDMPlus[i - mult]) : 0;
    const prevSmoothedDMMinus = i >= mult ? nz(smoothedDMMinus[i - mult]) : 0;

    smoothedTR[i] = prevSmoothedTR - (prevSmoothedTR / ADX_LENGTH) + trueRange;
    smoothedDMPlus[i] = prevSmoothedDMPlus - (prevSmoothedDMPlus / ADX_LENGTH) + dmPlus;
    smoothedDMMinus[i] = prevSmoothedDMMinus - (prevSmoothedDMMinus / ADX_LENGTH) + dmMinus;

    // DI+ and DI-
    if (smoothedTR[i] !== 0) {
      diPlus[i] = (smoothedDMPlus[i] / smoothedTR[i]) * 100;
      diMinus[i] = (smoothedDMMinus[i] / smoothedTR[i]) * 100;
    } else {
      diPlus[i] = 0;
      diMinus[i] = 0;
    }

    // DX
    const diSum = diPlus[i] + diMinus[i];
    if (diSum !== 0) {
      dx[i] = (Math.abs(diPlus[i] - diMinus[i]) / diSum) * 100;
    } else {
      dx[i] = 0;
    }

    // diHist
    diHist[i] = diPlus[i] - diMinus[i];
  }

  // ADX = SMA(DX, ADX_LENGTH)
  const adx = smaSeries(dx, ADX_LENGTH);

  // ==========================================================================
  // SIGNAL GENERATION
  // ==========================================================================

  // Cross triggers on diHist
  const crossesAboveZero = crossoverValue(diHist, 0);
  const crossesBelowZero = crossunderValue(diHist, 0);
  const crossesZero = crossesAboveZero.map((v, i) => v || crossesBelowZero[i]);
  const crossesAboveUpper = crossoverValue(diHist, UPPER_THRESHOLD);
  const crossesBelowLower = crossunderValue(diHist, LOWER_THRESHOLD);
  const crossesBelowUpper = crossunderValue(diHist, UPPER_THRESHOLD);
  const crossesAboveLower = crossoverValue(diHist, LOWER_THRESHOLD);

  // Break patterns
  const upBreak = new Array<boolean>(len).fill(false);
  const dnBreak = new Array<boolean>(len).fill(false);

  for (let i = 2; i < len; i++) {
    if (isNaN(diHist[i]) || isNaN(diHist[i - 1]) || isNaN(diHist[i - 2])) continue;

    // upBreak: diHist > 0 AND diHist > prev AND prev < prevPrev (V-shape recovery)
    upBreak[i] = diHist[i] > 0 && diHist[i] > diHist[i - 1] && diHist[i - 1] < diHist[i - 2];

    // dnBreak: diHist < 0 AND diHist < prev AND prev > prevPrev (inverted-V breakdown)
    dnBreak[i] = diHist[i] < 0 && diHist[i] < diHist[i - 1] && diHist[i - 1] > diHist[i - 2];
  }

  return {
    diPlus,
    diMinus,
    diHist,
    dx,
    adx,
    crossesZero,
    crossesAboveZero,
    crossesBelowZero,
    crossesAboveUpper,
    crossesBelowLower,
    crossesBelowUpper,
    crossesAboveLower,
    upBreak,
    dnBreak,
  };
}
