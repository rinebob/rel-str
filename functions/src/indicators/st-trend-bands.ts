/**
 * ST-Trend-Bands — Savant Trader Trend Bands
 *
 * Smoothed trend band engine producing 4 bands (CTF fast/slow, HTF fast/slow).
 * Ported from rb-smha-core.pine and rb-smha-core-htf.pine.
 *
 * All computation is pure math on OHLCV arrays. No external dependencies.
 */

import { emaSeries, crossover, crossunder, HTF_MULTIPLIER } from './primitives';

// =============================================================================
// INTERFACES
// =============================================================================

export interface OHLCV {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** Single band output — one value per input bar */
export interface BandResult {
  o: number[];     // band open
  h: number[];     // band high (forced: max(o,c))
  l: number[];     // band low  (forced: min(o,c))
  c: number[];     // band close
  m: number[];     // band midpoint: l + |h-l|/2
  up: boolean[];   // trend up: c > o
  dn: boolean[];   // trend down: o > c
  crossUp: boolean[];  // raw close crosses above band high
  crossDn: boolean[];  // raw close crosses below band low
}

/** Complete 4-band output */
export interface TrendBandsResult {
  band1: BandResult;  // CTF fast (length 5)
  band2: BandResult;  // CTF slow (length 10)
  band3: BandResult;  // HTF fast (length 5, multiplied)
  band4: BandResult;  // HTF slow (length 10, multiplied)
}

// =============================================================================
// SYSTEM CONSTANTS
// =============================================================================

const CTF_FAST_LENGTH = 5;
const CTF_SLOW_LENGTH = 10;
const HTF_FAST_LENGTH = 5;
const HTF_SLOW_LENGTH = 10;

// =============================================================================
// CTF BAND ENGINE
// =============================================================================

/**
 * Compute a single CTF smoothed trend band.
 * Direct port of smha_fast_slow_src from rb-smha-core.pine.
 *
 * @param bars - OHLCV input bars
 * @param smoothLength - EMA pre-smooth length
 * @param afterSmoothLength - EMA post-smooth length
 * @returns BandResult with arrays of same length as input
 */
export function computeCtfBand(
  bars: OHLCV[],
  smoothLength: number,
  afterSmoothLength: number
): BandResult {
  const len = bars.length;

  // Extract raw OHLC arrays
  const rawOpen = bars.map(b => b.open);
  const rawHigh = bars.map(b => b.high);
  const rawLow = bars.map(b => b.low);
  const rawClose = bars.map(b => b.close);

  // Step 1: Pre-smooth OHLC with EMA(smoothLength)
  const smoothO = emaSeries(rawOpen, smoothLength);
  const smoothH = emaSeries(rawHigh, smoothLength);
  const smoothL = emaSeries(rawLow, smoothLength);
  const smoothC = emaSeries(rawClose, smoothLength);

  // Step 2: Heiken Ashi transform on smoothed OHLC
  const haClose = new Array<number>(len).fill(NaN);
  const haOpen = new Array<number>(len).fill(NaN);
  const haHigh = new Array<number>(len).fill(NaN);
  const haLow = new Array<number>(len).fill(NaN);

  for (let i = 0; i < len; i++) {
    if (isNaN(smoothO[i]) || isNaN(smoothH[i]) || isNaN(smoothL[i]) || isNaN(smoothC[i])) {
      continue;
    }

    haClose[i] = (smoothO[i] + smoothH[i] + smoothL[i] + smoothC[i]) / 4;

    if (i === 0 || isNaN(haOpen[i - 1])) {
      // Seed: (smoothO + smoothC) / 2
      haOpen[i] = (smoothO[i] + smoothC[i]) / 2;
    } else {
      haOpen[i] = (haOpen[i - 1] + haClose[i - 1]) / 2;
    }

    haHigh[i] = Math.max(smoothH[i], haOpen[i], haClose[i]);
    haLow[i] = Math.min(smoothL[i], haOpen[i], haClose[i]);
  }

  // Step 3: Post-smooth HA OHLC with EMA(afterSmoothLength)
  const postO = emaSeries(haOpen, afterSmoothLength);
  emaSeries(haHigh, afterSmoothLength); // computed but body-forcing overrides H
  emaSeries(haLow, afterSmoothLength);  // computed but body-forcing overrides L
  const postC = emaSeries(haClose, afterSmoothLength);

  // Step 4: Force body and compute midpoint
  const bandO = new Array<number>(len).fill(NaN);
  const bandH = new Array<number>(len).fill(NaN);
  const bandL = new Array<number>(len).fill(NaN);
  const bandC = new Array<number>(len).fill(NaN);
  const bandM = new Array<number>(len).fill(NaN);
  const up = new Array<boolean>(len).fill(false);
  const dn = new Array<boolean>(len).fill(false);

  for (let i = 0; i < len; i++) {
    if (isNaN(postO[i]) || isNaN(postC[i])) continue;

    bandO[i] = postO[i];
    bandC[i] = postC[i];

    // Force body: H = max(O,C), L = min(O,C)
    bandH[i] = Math.max(postO[i], postC[i]);
    bandL[i] = Math.min(postO[i], postC[i]);
    bandM[i] = bandL[i] + Math.abs(bandH[i] - bandL[i]) / 2;

    up[i] = bandC[i] > bandO[i];
    dn[i] = bandO[i] > bandC[i];
  }

  // Step 5: Cross triggers (raw close vs band high/low)
  const crossUp = crossover(rawClose, bandH);
  const crossDn = crossunder(rawClose, bandL);

  return { o: bandO, h: bandH, l: bandL, c: bandC, m: bandM, up, dn, crossUp, crossDn };
}

// =============================================================================
// HTF BAND ENGINE
// =============================================================================

/**
 * Compute a single HTF smoothed trend band with jagged stepping.
 * Direct port of htf_smha_fast_slow from rb-smha-core-htf.pine.
 *
 * Key differences from CTF:
 * - EMA lengths are multiplied by HTF_MULTIPLIER (3)
 * - Recursive haOpen lookback uses [i - HTF_MULTIPLIER] instead of [i - 1]
 * - Output is "jagged": values update every HTF_MULTIPLIER bars, carry forward otherwise
 *
 * @param bars - OHLCV input bars (chart timeframe)
 * @param smoothLength - Base EMA pre-smooth length (will be multiplied by 3)
 * @param afterSmoothLength - Base EMA post-smooth length (will be multiplied by 3)
 * @returns BandResult with jagged (stepped) arrays
 */
export function computeHtfBand(
  bars: OHLCV[],
  smoothLength: number,
  afterSmoothLength: number
): BandResult {
  const len = bars.length;
  const mult = HTF_MULTIPLIER;
  const beforeLength = smoothLength * mult;
  const afterLength = afterSmoothLength * mult;

  // Extract raw OHLC arrays
  const rawOpen = bars.map(b => b.open);
  const rawHigh = bars.map(b => b.high);
  const rawLow = bars.map(b => b.low);
  const rawClose = bars.map(b => b.close);

  // Step 1: Pre-smooth with scaled EMA length
  const smoothO = emaSeries(rawOpen, beforeLength);
  const smoothH = emaSeries(rawHigh, beforeLength);
  const smoothL = emaSeries(rawLow, beforeLength);
  const smoothC = emaSeries(rawClose, beforeLength);

  // Step 2: Heiken Ashi with scaled lookback
  const haClose = new Array<number>(len).fill(NaN);
  const haOpen = new Array<number>(len).fill(NaN);
  const haHigh = new Array<number>(len).fill(NaN);
  const haLow = new Array<number>(len).fill(NaN);

  for (let i = 0; i < len; i++) {
    if (isNaN(smoothO[i]) || isNaN(smoothH[i]) || isNaN(smoothL[i]) || isNaN(smoothC[i])) {
      continue;
    }

    haClose[i] = (smoothO[i] + smoothH[i] + smoothL[i] + smoothC[i]) / 4;

    // HTF lookback: haOpen[i - mult] instead of haOpen[i - 1]
    if (i < mult || isNaN(haOpen[i - mult])) {
      haOpen[i] = (smoothO[i] + smoothC[i]) / 2;
    } else {
      haOpen[i] = (haOpen[i - mult] + haClose[i - mult]) / 2;
    }

    haHigh[i] = Math.max(smoothH[i], haOpen[i], haClose[i]);
    haLow[i] = Math.min(smoothL[i], haOpen[i], haClose[i]);
  }

  // Step 3: Post-smooth with scaled EMA length
  const postO = emaSeries(haOpen, afterLength);
  emaSeries(haHigh, afterLength); // computed but body-forcing overrides H
  emaSeries(haLow, afterLength);  // computed but body-forcing overrides L
  const postC = emaSeries(haClose, afterLength);

  // Step 4: Force body (continuous, before jagged stepping)
  const contO = new Array<number>(len).fill(NaN);
  const contH = new Array<number>(len).fill(NaN);
  const contL = new Array<number>(len).fill(NaN);
  const contC = new Array<number>(len).fill(NaN);
  const contM = new Array<number>(len).fill(NaN);

  for (let i = 0; i < len; i++) {
    if (isNaN(postO[i]) || isNaN(postC[i])) continue;

    contO[i] = postO[i];
    contC[i] = postC[i];
    contH[i] = Math.max(postO[i], postC[i]);
    contL[i] = Math.min(postO[i], postC[i]);
    contM[i] = contL[i] + Math.abs(contH[i] - contL[i]) / 2;
  }

  // Step 5: Jagged stepping — update every `mult` bars, carry forward otherwise
  const bandO = new Array<number>(len).fill(NaN);
  const bandH = new Array<number>(len).fill(NaN);
  const bandL = new Array<number>(len).fill(NaN);
  const bandC = new Array<number>(len).fill(NaN);
  const bandM = new Array<number>(len).fill(NaN);

  for (let i = 0; i < len; i++) {
    // closeTimeMatch: every `mult` bars (0-indexed: i % mult === mult - 1)
    const isHtfClose = (i % mult) === (mult - 1);

    if (isHtfClose && !isNaN(contO[i])) {
      bandO[i] = contO[i];
      bandC[i] = contC[i];
      bandH[i] = Math.max(contO[i], contC[i]);
      bandL[i] = Math.min(contO[i], contC[i]);
      bandM[i] = bandL[i] + Math.abs(bandH[i] - bandL[i]) / 2;
    } else if (i > 0) {
      // Carry forward previous value
      bandO[i] = bandO[i - 1];
      bandH[i] = bandH[i - 1];
      bandL[i] = bandL[i - 1];
      bandC[i] = bandC[i - 1];
      bandM[i] = bandM[i - 1];
    }
  }

  // Re-force body on jagged values
  for (let i = 0; i < len; i++) {
    if (!isNaN(bandO[i]) && !isNaN(bandC[i])) {
      bandH[i] = Math.max(bandO[i], bandC[i]);
      bandL[i] = Math.min(bandO[i], bandC[i]);
    }
  }

  // Trend flags
  const up = new Array<boolean>(len).fill(false);
  const dn = new Array<boolean>(len).fill(false);
  for (let i = 0; i < len; i++) {
    if (!isNaN(bandO[i]) && !isNaN(bandC[i])) {
      up[i] = bandC[i] > bandO[i];
      dn[i] = bandO[i] > bandC[i];
    }
  }

  // Cross triggers (raw close vs jagged band high/low)
  const crossUp = crossover(rawClose, bandH);
  const crossDn = crossunder(rawClose, bandL);

  return { o: bandO, h: bandH, l: bandL, c: bandC, m: bandM, up, dn, crossUp, crossDn };
}

// =============================================================================
// MAIN EXPORT: Compute all 4 bands
// =============================================================================

/**
 * Compute the full ST-Trend-Bands indicator (4 bands).
 *
 * @param bars - OHLCV input bars (chart timeframe, e.g. daily)
 * @returns TrendBandsResult with all 4 bands
 */
export function computeStTrendBands(bars: OHLCV[]): TrendBandsResult {
  return {
    band1: computeCtfBand(bars, CTF_FAST_LENGTH, CTF_FAST_LENGTH),
    band2: computeCtfBand(bars, CTF_SLOW_LENGTH, CTF_SLOW_LENGTH),
    band3: computeHtfBand(bars, HTF_FAST_LENGTH, HTF_FAST_LENGTH),
    band4: computeHtfBand(bars, HTF_SLOW_LENGTH, HTF_SLOW_LENGTH),
  };
}

// =============================================================================
// ST-TREND-BAND-WIDTH: Compression → Expansion → Pullback regime detection
// =============================================================================

/** Parameters for computeTrendBandWidth */
export interface TrendBandWidthParams {
  N: number;                  // lookback for ratio and rolling min/max (default: 10)
  expansionThreshold: number; // expansionRatio must exceed this to count as a spike (default: 1.25)
  retainThreshold: number;    // expansionRatio must stay above this at signal bar (default: 1.10)
  maxPullbackBars: number;    // spike must have occurred within this many bars (default: 10)
}

/** Per-bar output of the ST-TrendBandWidth derived series */
export interface TrendBandWidthResult {
  width:            number[];   // raw total span: max(all band highs) - min(all band lows)
  expansionRatio:   number[];   // width[i] / width[i-N] — how much wider now vs N bars ago
  spiked:           boolean[];  // expansionRatio > expansionThreshold
  barsSinceSpike:   number[];   // bars elapsed since last spiked=true
  recentlyExpanded: boolean[];  // barsSinceSpike <= maxPullbackBars
  stillElevated:    boolean[];  // expansionRatio > retainThreshold
  validSetup:       boolean[];  // recentlyExpanded && stillElevated — the regime gate
}

const DEFAULT_WIDTH_PARAMS: TrendBandWidthParams = {
  N:                  10,
  expansionThreshold: 1.25,
  retainThreshold:    1.10,
  maxPullbackBars:    10,
};

/**
 * Compute ST-TrendBandWidth from an existing TrendBandsResult.
 *
 * Derived series only — no new indicator math. One pass over band high/low arrays.
 * validSetup[i] is true when a recent expansion spike is still elevated at bar i,
 * identifying the compression → expansion → pullback regime for high-probability entries.
 *
 * @param bands  - Output of computeStTrendBands()
 * @param params - Optional overrides for thresholds and lookback
 */
export function computeTrendBandWidth(
  bands: TrendBandsResult,
  params: Partial<TrendBandWidthParams> = {},
): TrendBandWidthResult {
  const { N, expansionThreshold, retainThreshold, maxPullbackBars } = { ...DEFAULT_WIDTH_PARAMS, ...params };

  const { band1, band2, band3, band4 } = bands;
  const len = band1.h.length;

  const width            = new Array<number>(len).fill(NaN);
  const expansionRatio   = new Array<number>(len).fill(NaN);
  const spiked           = new Array<boolean>(len).fill(false);
  const barsSinceSpike   = new Array<number>(len).fill(Infinity);
  const recentlyExpanded = new Array<boolean>(len).fill(false);
  const stillElevated    = new Array<boolean>(len).fill(false);
  const validSetup       = new Array<boolean>(len).fill(false);

  // Pass 1: compute raw width per bar
  for (let i = 0; i < len; i++) {
    const maxH = Math.max(band1.h[i], band2.h[i], band3.h[i], band4.h[i]);
    const minL = Math.min(band1.l[i], band2.l[i], band3.l[i], band4.l[i]);
    if (isFinite(maxH) && isFinite(minL)) {
      width[i] = maxH - minL;
    }
  }

  // Pass 2: compute derived series
  let lastSpikeBar = -Infinity;

  for (let i = N; i < len; i++) {
    const w    = width[i];
    const wN   = width[i - N];

    if (isNaN(w) || isNaN(wN) || wN === 0) continue;

    expansionRatio[i] = w / wN;
    spiked[i]         = expansionRatio[i] > expansionThreshold;

    if (spiked[i]) lastSpikeBar = i;

    barsSinceSpike[i]   = i - lastSpikeBar;
    recentlyExpanded[i] = barsSinceSpike[i] <= maxPullbackBars;
    stillElevated[i]    = expansionRatio[i] > retainThreshold;
    validSetup[i]       = recentlyExpanded[i] && stillElevated[i];
  }

  return { width, expansionRatio, spiked, barsSinceSpike, recentlyExpanded, stillElevated, validSetup };
}
