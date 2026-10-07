/**
 * Unit tests for st-trigger-bands.ts — the pure ST Trigger Bands engine
 * (body-based Donchian bands, length 3, with pullback / breakout state).
 *
 * Expected values are hand-worked literals derived from the Pine
 * definitions in the PRD (#863), not recomputed with the implementation's
 * own formulas.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeStTriggerBands } from '../../functions/src/indicators/st-trigger-bands';
import type { OHLCV } from '../../functions/src/indicators/st-trend-bands';

// ─── Helpers ──────────────────────────────────────────────────────────────

/** A bar whose body is open→close; wicks default to the body. */
function bar(open: number, close: number, high?: number, low?: number): OHLCV {
  return {
    open,
    close,
    high: high ?? Math.max(open, close),
    low: low ?? Math.min(open, close),
  };
}

/** Flat bars: open == close == x, so bodyHigh == bodyLow == x. */
const flat = (xs: number[]): OHLCV[] => xs.map((x) => bar(x, x));

const T = true;
const F = false;

// Golden fixture: bodies [10, 11, 12, 11, 10, 9, 12].
//   upper = [-, -, 12, 12, 12, 11, 12]   lower = [-, -, 10, 11, 10, 9, 9]
// Long: pullback t3..t5 (upper not rising), state on t3..t5, breakout t6
//   (upper 11→12 after a flat/falling bar, body 12 > prior upper 11).
// Short: pullback t3 and t6 (lower not falling); breakout t4 (lower 11→10
//   after rising, body 10 < prior lower 11, state armed by t3's pullback).
const GOLDEN = flat([10, 11, 12, 11, 10, 9, 12]);

describe('computeStTriggerBands', () => {
  describe('shape and warm-up', () => {
    it('returns empty arrays for empty input', () => {
      const r = computeStTriggerBands([]);
      assert.deepEqual(r.upper, []);
      assert.deepEqual(r.lower, []);
      assert.deepEqual(r.longPullback, []);
      assert.deepEqual(r.shortBreakout, []);
    });

    it('fewer than 3 bars: null bands, all flags false, lengths match', () => {
      const r = computeStTriggerBands(flat([10, 11]));
      assert.deepEqual(r.upper, [null, null]);
      assert.deepEqual(r.lower, [null, null]);
      for (const key of [
        'longPullback', 'longPullbackState', 'longBreakout',
        'shortPullback', 'shortPullbackState', 'shortBreakout',
      ] as const) {
        assert.deepEqual(r[key], [F, F], key);
      }
    });

    it('every output array has the input length', () => {
      const r = computeStTriggerBands(GOLDEN);
      for (const arr of Object.values(r)) assert.equal(arr.length, GOLDEN.length);
    });
  });

  describe('bands', () => {
    it('upper = highest body high over 3 bars, lower = lowest body low', () => {
      const r = computeStTriggerBands(GOLDEN);
      assert.deepEqual(r.upper, [null, null, 12, 12, 12, 11, 12]);
      assert.deepEqual(r.lower, [null, null, 10, 11, 10, 9, 9]);
    });

    it('uses candle bodies — wicks do not widen the bands', () => {
      const bars = [
        bar(10, 12, 20, 5), // up bar: body 10..12, wick 5..20
        bar(12, 10, 25, 1), // down bar: body 10..12
        bar(10, 12, 30, 0),
      ];
      const r = computeStTriggerBands(bars);
      assert.equal(r.upper[2], 12);
      assert.equal(r.lower[2], 10);
    });

    it('doji bars (open == close) are valid', () => {
      const r = computeStTriggerBands(flat([5, 5, 5]));
      assert.equal(r.upper[2], 5);
      assert.equal(r.lower[2], 5);
    });
  });

  describe('long side', () => {
    const r = computeStTriggerBands(GOLDEN);

    it('pullback is true while the upper band is not rising', () => {
      assert.deepEqual(r.longPullback, [F, F, F, T, T, T, F]);
    });

    it('pullback state latches on pullback and clears on breakout', () => {
      assert.deepEqual(r.longPullbackState, [F, F, F, T, T, T, F]);
    });

    it('breakout fires on the first rising bar after an armed pullback', () => {
      assert.deepEqual(r.longBreakout, [F, F, F, F, F, F, T]);
    });

    it('no breakout without a prior pullback (band rising from the start)', () => {
      const rising = computeStTriggerBands(flat([10, 10, 11, 12, 13]));
      assert.deepEqual(rising.longPullback, [F, F, F, F, F]);
      assert.deepEqual(rising.longBreakout, [F, F, F, F, F]);
    });

    it('a body equal to the prior upper band is not a breakout', () => {
      // bodies [10,11,12,11,10,12]: upper = [-,-,12,12,12,12]; state armed at
      // t3/t4; body 12 at t5 equals the prior upper 12 → no cross.
      const eq = computeStTriggerBands(flat([10, 11, 12, 11, 10, 12]));
      assert.deepEqual(eq.longBreakout, [F, F, F, F, F, F]);
      assert.deepEqual(eq.longPullback, [F, F, F, T, T, T]);
      assert.deepEqual(eq.longPullbackState, [F, F, F, T, T, T]);
    });

    it('breakout re-arms only after a new pullback', () => {
      // bodies [12,11,10,11,12,13,12,11,13]
      //   upper = [-,-,12,11,12,13,13,13,13]
      //   t3: pullback (11<=12) arms; t4: upper 11→12 rises → breakout, disarm
      //   t5: upper rises again (13>12) but state off → no breakout
      //   t6: upper 13<=13 pullback re-arms; t7: pullback; t8: body 13 vs
      //   prior upper 13 is not greater → no breakout
      const re = computeStTriggerBands(flat([12, 11, 10, 11, 12, 13, 12, 11, 13]));
      assert.deepEqual(re.upper, [null, null, 12, 11, 12, 13, 13, 13, 13]);
      assert.deepEqual(re.longBreakout, [F, F, F, F, T, F, F, F, F]);
      assert.deepEqual(re.longPullbackState, [F, F, F, T, F, F, T, T, T]);
    });
  });

  describe('short side', () => {
    const r = computeStTriggerBands(GOLDEN);

    it('pullback is true while the lower band is not falling', () => {
      assert.deepEqual(r.shortPullback, [F, F, F, T, F, F, T]);
    });

    it('pullback state latches and clears on breakout', () => {
      assert.deepEqual(r.shortPullbackState, [F, F, F, T, F, F, T]);
    });

    it('breakout fires on the first falling bar after an armed pullback', () => {
      assert.deepEqual(r.shortBreakout, [F, F, F, F, T, F, F]);
    });

    it('no breakout without a prior pullback (band falling from the start)', () => {
      const falling = computeStTriggerBands(flat([13, 13, 12, 11, 10]));
      assert.deepEqual(falling.shortPullback, [F, F, F, F, F]);
      assert.deepEqual(falling.shortBreakout, [F, F, F, F, F]);
    });
  });

  describe('symmetry', () => {
    // Negating every price swaps highs and lows, so the short flags of the
    // original must equal the long flags of the mirrored series and vice versa.
    const mirror = (bars: OHLCV[]): OHLCV[] =>
      bars.map((b) => bar(-b.open, -b.close, -b.low, -b.high));

    const sets: Record<string, OHLCV[]> = {
      golden: GOLDEN,
      wiggle: flat([12, 11, 10, 11, 12, 13, 12, 11, 13, 14, 13, 12, 15, 14, 14, 16]),
      bodies: [
        bar(10, 12), bar(12, 11), bar(11, 13), bar(13, 12), bar(12, 10),
        bar(10, 9), bar(9, 12), bar(12, 14), bar(14, 13), bar(13, 11),
      ],
    };

    for (const [name, bars] of Object.entries(sets)) {
      it(`long flags equal mirrored short flags (${name})`, () => {
        const a = computeStTriggerBands(bars);
        const m = computeStTriggerBands(mirror(bars));
        assert.deepEqual(a.longPullback, m.shortPullback);
        assert.deepEqual(a.longPullbackState, m.shortPullbackState);
        assert.deepEqual(a.longBreakout, m.shortBreakout);
        assert.deepEqual(a.shortPullback, m.longPullback);
        assert.deepEqual(a.shortPullbackState, m.longPullbackState);
        assert.deepEqual(a.shortBreakout, m.longBreakout);
        assert.deepEqual(a.upper.map((v) => (v === null ? null : -v)), m.lower);
        assert.deepEqual(a.lower.map((v) => (v === null ? null : -v)), m.upper);
      });
    }
  });

  describe('edge cases', () => {
    it('flat market: pullback from the 4th bar on, no breakouts', () => {
      const r = computeStTriggerBands(flat([10, 10, 10, 10, 10, 10]));
      assert.deepEqual(r.upper, [null, null, 10, 10, 10, 10]);
      assert.deepEqual(r.longPullback, [F, F, F, T, T, T]);
      assert.deepEqual(r.shortPullback, [F, F, F, T, T, T]);
      assert.deepEqual(r.longBreakout, [F, F, F, F, F, F]);
      assert.deepEqual(r.shortBreakout, [F, F, F, F, F, F]);
    });

    it('long and short flags are independent on the same bar', () => {
      // Golden t6: long breakout and short pullback both fire.
      const r = computeStTriggerBands(GOLDEN);
      assert.equal(r.longBreakout[6], true);
      assert.equal(r.shortPullback[6], true);
    });
  });
});
