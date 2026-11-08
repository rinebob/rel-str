/**
 * DEV-ONLY local port of the backend Trigger Bands pipeline — engine
 * (`functions/src/indicators/st-trigger-bands.ts`) and marker emission
 * (`functions/src/st-cloud-function/indicator-computation.ts`).
 *
 * Lets the sandbox iterate on band/dot behaviour (and render TB on
 * synthetic bars, monthly, and TWO_DAY) without a functions deploy. The
 * callable remains the source of truth on every prod surface — this file
 * must never be imported outside the sandbox page.
 *
 * The expansion-gated arming (a pullback episode may only ARM once the band
 * has expanded since the last breakout), breakout-only dots, and
 * envelope-anchored placement here are the APPROVED backend contract —
 * ported to `functions/src/indicators/st-trigger-bands.ts` +
 * `generateTriggerBandsDotMarkers`. Until the next functions deploy, the
 * deployed callable still returns the old emission (armed-state streaks,
 * wick-anchored), so `TB local` off vs on shows old-vs-new, not parity.
 */

import type { PriceBar } from '../../../shared/components/flex-chart/flex-chart.types';
import type {
  DotMarker,
  IntervalData,
  TriggerBandsPoint,
} from '../../common/indicator.types';
import {
  TRIGGER_BANDS_SIGNAL_TYPES,
  type TriggerBandsSignalType,
} from '@flex-chart/indicator-visuals';

// LENGTH and DOT_ATR_MULT intentionally mirror `ST_TRIGGER_BANDS_LENGTH`
// and `TRIGGER_DOT_ATR_MULT` in `functions/src/indicators/st-trigger-bands.ts`
// and `functions/src/st-cloud-function/indicator-computation.ts` — the
// canonical constants live in `functions/`, which the app build cannot
// import; keep these in sync. The result interface likewise mirrors the
// backend's return shape, which is also defined in `functions/`.
const LENGTH = 3;

export interface TriggerBandsLocalResult {
  upper: (number | null)[];
  lower: (number | null)[];
  longPullback: boolean[];
  longPullbackState: boolean[];
  longBreakout: boolean[];
  shortPullback: boolean[];
  shortPullbackState: boolean[];
  shortBreakout: boolean[];
}

/** Verbatim port of `computeStTriggerBands` — comparisons against a null
 *  band are false (Pine `na` semantics), so warm-up bars never set a flag. */
export function computeStTriggerBandsLocal(bars: PriceBar[]): TriggerBandsLocalResult {
  const n = bars.length;
  const bodyHigh = bars.map((b) => Math.max(b.open, b.close));
  const bodyLow = bars.map((b) => Math.min(b.open, b.close));

  const upper: (number | null)[] = new Array(n).fill(null);
  const lower: (number | null)[] = new Array(n).fill(null);
  for (let t = LENGTH - 1; t < n; t++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = t - LENGTH + 1; k <= t; k++) {
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

  const cmp = (a: number | null, b: number | null, op: (x: number, y: number) => boolean): boolean =>
    a !== null && b !== null && op(a, b);
  const at = (arr: (number | null)[], i: number): number | null => (i >= 0 ? arr[i] : null);

  // Expansion-gated arming: a pullback episode may only ARM once the band
  // has expanded since the last breakout — the deployed engine re-arms on
  // the first paused bar, which puts dots on nearly every post-breakout
  // bar. The breakout bar's own expansion doesn't count (reset checked
  // first). Long expansion = upper rising; short expansion = lower falling.
  let longExpanded = false;
  let shortExpanded = false;

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
    if (longBreakout[t]) longExpanded = false;
    else if (cmp(up, up1, (x, y) => x > y)) longExpanded = true;
    longPullbackState[t] = longBreakout[t]
      ? false
      : longPullback[t] && longExpanded
        ? true
        : t > 0 && longPullbackState[t - 1];

    shortPullback[t] = cmp(lo, lo1, (x, y) => x >= y);
    // Pine ta.crossunder(bodyLow, lower[1]): below now, at-or-above on the previous bar.
    const crossDn =
      cmp(bodyLow[t], lo1, (x, y) => x < y) &&
      t > 0 && cmp(bodyLow[t - 1], lo2, (x, y) => x >= y);
    shortBreakout[t] = cmp(lo2, lo1, (x, y) => x <= y) && crossDn && t > 0 && shortPullbackState[t - 1];
    if (shortBreakout[t]) shortExpanded = false;
    else if (cmp(lo, lo1, (x, y) => x < y)) shortExpanded = true;
    shortPullbackState[t] = shortBreakout[t]
      ? false
      : shortPullback[t] && shortExpanded
        ? true
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

/** Port of the BE `computeATR` (Wilder seed) adapted to PriceBar fields. */
function computeAtrLocal(bars: PriceBar[], period = 14): number[] {
  const atr: number[] = new Array(bars.length).fill(0);
  if (bars.length < 2) return atr;

  const tr: number[] = [bars[0].high - bars[0].low];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }

  let sum = 0;
  for (let i = 0; i < Math.min(period, tr.length); i++) sum += tr[i];
  const seed = sum / Math.min(period, tr.length);
  for (let i = 0; i < period && i < bars.length; i++) atr[i] = seed;

  for (let i = period; i < bars.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }

  return atr;
}

// Same multiplier as the callable (TRIGGER_DOT_ATR_MULT) — closer to the bar
// than the zone dots so a TB dot and a zone dot on the same bar do not overlap.
const DOT_ATR_MULT = 1.5;

/** Breakout dots only — the pullback flags already show as band colour, and
 *  dotting every flagged bar was noise. Long dots sit just below the lower
 *  band, short dots just above the upper band — outside the envelope, never
 *  inside the channel. */
function generateDotMarkersLocal(points: TriggerBandsPoint[], bars: PriceBar[]): DotMarker[] {
  if (points.length === 0 || bars.length === 0) return [];
  const atr = computeAtrLocal(bars);
  const markers: DotMarker[] = [];
  points.forEach((p, i) => {
    const bar = bars[i];
    if (!bar) return;
    const offset = atr[i] * DOT_ATR_MULT;
    const push = (direction: 'long' | 'short', signalType: TriggerBandsSignalType, y: number): void => {
      markers.push({ d: p.d, index: i, direction, y, version: 'TB', signalType });
    };
    if (p.longBreakout && p.lower !== null) push('long', TRIGGER_BANDS_SIGNAL_TYPES.LONG_BREAKOUT, p.lower - offset);
    if (p.shortBreakout && p.upper !== null) push('short', TRIGGER_BANDS_SIGNAL_TYPES.SHORT_BREAKOUT, p.upper + offset);
  });
  return markers;
}

/**
 * Compute the callable-equivalent `IntervalData` for a bar series — feeds
 * `injectTriggerBandsData` (bands) and `convertTriggerBandsDotMarkers`
 * (dots) exactly like the lean response does.
 */
export function computeTriggerBandsIntervalData(bars: PriceBar[]): IntervalData {
  const r = computeStTriggerBandsLocal(bars);
  const triggerBands: TriggerBandsPoint[] = bars.map((b, i) => ({
    d: b.date,
    upper: r.upper[i],
    lower: r.lower[i],
    longPullback: r.longPullback[i],
    longPullbackState: r.longPullbackState[i],
    longBreakout: r.longBreakout[i],
    shortPullback: r.shortPullback[i],
    shortPullbackState: r.shortPullbackState[i],
    shortBreakout: r.shortBreakout[i],
  }));
  return {
    indicators: { triggerBands },
    signals: {},
    dotMarkers: { triggerBands: generateDotMarkersLocal(triggerBands, bars) },
  };
}
