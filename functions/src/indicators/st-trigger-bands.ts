/**
 * ST-Trigger-Bands — Savant Trader Trigger Bands
 *
 * Donchian channels over candle BODIES (length 3) plus a per-side
 * pullback / breakout state machine. A pullback (the band on one side stops
 * expanding) arms a setup; a breakout (the body crosses the prior band) is
 * the entry trigger. Ported from rb-st-trigger-bands.pine.
 *
 * All computation is pure math on OHLCV arrays. No external dependencies.
 */

import type { OHLCV } from './st-trend-bands';

export const ST_TRIGGER_BANDS_LENGTH = 3;

export interface StTriggerBandsResult {
  /** Highest body high over the last 3 bars; null until 3 bars exist. */
  upper: (number | null)[];
  /** Lowest body low over the last 3 bars; null until 3 bars exist. */
  lower: (number | null)[];
  longPullback: boolean[];
  longPullbackState: boolean[];
  longBreakout: boolean[];
  shortPullback: boolean[];
  shortPullbackState: boolean[];
  shortBreakout: boolean[];
}

/**
 * Compute the Trigger Bands for every bar. Comparisons involving a null band
 * are false (Pine `na` semantics), so warm-up bars never set a flag.
 */
export function computeStTriggerBands(bars: OHLCV[]): StTriggerBandsResult {
  const n = bars.length;
  const bodyHigh = bars.map((b) => Math.max(b.open, b.close));
  const bodyLow = bars.map((b) => Math.min(b.open, b.close));

  const upper: (number | null)[] = new Array(n).fill(null);
  const lower: (number | null)[] = new Array(n).fill(null);
  for (let t = ST_TRIGGER_BANDS_LENGTH - 1; t < n; t++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = t - ST_TRIGGER_BANDS_LENGTH + 1; k <= t; k++) {
      hi = Math.max(hi, bodyHigh[k]);
      lo = Math.min(lo, bodyLow[k]);
    }
    upper[t] = hi;
    lower[t] = lo;
  }

  const longPullback = new Array<boolean>(n).fill(false);
  const longPullbackState = new Array<boolean>(n).fill(false);
  const longBreakout = new Array<boolean>(n).fill(false);
  const shortPullback = new Array<boolean>(n).fill(false);
  const shortPullbackState = new Array<boolean>(n).fill(false);
  const shortBreakout = new Array<boolean>(n).fill(false);

  // `cmp` is false whenever either operand is null (Pine na comparison).
  const cmp = (a: number | null, b: number | null, op: (x: number, y: number) => boolean): boolean =>
    a !== null && b !== null && op(a, b);
  const at = (arr: (number | null)[], i: number): number | null => (i >= 0 ? arr[i] : null);

  for (let t = 0; t < n; t++) {
    const up = upper[t];
    const up1 = at(upper, t - 1);
    const up2 = at(upper, t - 2);
    const lo = lower[t];
    const lo1 = at(lower, t - 1);
    const lo2 = at(lower, t - 2);

    longPullback[t] = cmp(up, up1, (x, y) => x <= y);
    // Pine ta.crossover(bodyHigh, upper[1]): above now, at-or-below on the previous bar.
    const crossUp =
      cmp(bodyHigh[t], up1, (x, y) => x > y) &&
      t > 0 && cmp(bodyHigh[t - 1], up2, (x, y) => x <= y);
    longBreakout[t] = cmp(up2, up1, (x, y) => x >= y) && crossUp && t > 0 && longPullbackState[t - 1];
    longPullbackState[t] = longPullback[t]
      ? true
      : longBreakout[t]
        ? false
        : t > 0 && longPullbackState[t - 1];

    shortPullback[t] = cmp(lo, lo1, (x, y) => x >= y);
    // Pine ta.crossunder(bodyLow, lower[1]): below now, at-or-above on the previous bar.
    const crossDn =
      cmp(bodyLow[t], lo1, (x, y) => x < y) &&
      t > 0 && cmp(bodyLow[t - 1], lo2, (x, y) => x >= y);
    shortBreakout[t] = cmp(lo2, lo1, (x, y) => x <= y) && crossDn && t > 0 && shortPullbackState[t - 1];
    shortPullbackState[t] = shortPullback[t]
      ? true
      : shortBreakout[t]
        ? false
        : t > 0 && shortPullbackState[t - 1];
  }

  return {
    upper,
    lower,
    longPullback,
    longPullbackState,
    longBreakout,
    shortPullback,
    shortPullbackState,
    shortBreakout,
  };
}
