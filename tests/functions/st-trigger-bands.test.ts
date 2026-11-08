/**
 * Unit tests for st-trigger-bands.ts — the pure ST Trigger Bands engine
 * (body-based Donchian bands, length 3, with pullback / breakout state).
 *
 * Expected values are hand-worked literals derived from the Pine
 * definitions in the PRD (#863) plus the expansion-gated arming rule —
 * a pullback episode may only arm once the band has expanded since the
 * last breakout — not recomputed with the implementation's own formulas.
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
// Long pullback flags t3..t5 — but the band never expanded first, so under
// the arming gate the long state NEVER arms and no long breakout fires.
// Short pullback flags t3 and t6; the lower band expands (falls) at t4/t5,
// so the t6 pause is the first bar able to arm the short state.
const GOLDEN = flat([10, 11, 12, 11, 10, 9, 12]);

/** Bars with the body low pinned at 10 (open=10, close=bodyHigh) — the
 *  lower band stays flat so the short side never expands and stays inert. */
const pb = (bodyHighs: number[]): OHLCV[] => bodyHighs.map((bh) => bar(10, bh));

// Canonical gated fixture — bodyHighs [12,13,14,13,15,13,18,16,19,17]:
//   upper = [-, -, 14, 14, 15, 15, 18, 18, 19, 19]   lower = [-, -, 10 ×8]
//   t3 pause can't arm (no expansion yet), t4 expands, t5 pause arms,
//   t6 breakout, t7 pause can't re-arm, t8 expands, t9 pause arms again.
const CANONICAL = pb([12, 13, 14, 13, 15, 13, 18, 16, 19, 17]);

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

    it('pauses flag but never arm while the band has not expanded (GOLDEN)', () => {
      assert.deepEqual(r.longPullbackState, [F, F, F, F, F, F, F]);
    });

    it('a pause after an expansion arms; the breakout clears the state and the next pause cannot re-arm', () => {
      const c = computeStTriggerBands(CANONICAL);
      assert.deepEqual(c.upper, [null, null, 14, 14, 15, 15, 18, 18, 19, 19]);
      assert.deepEqual(c.longPullback, [F, F, F, T, F, T, F, T, F, T]);
      assert.deepEqual(c.longPullbackState, [F, F, F, F, F, T, F, F, F, T]);
      assert.deepEqual(c.longBreakout, [F, F, F, F, F, F, T, F, F, F]);
    });

    it('no breakout without a prior pullback (band rising from the start)', () => {
      const rising = computeStTriggerBands(flat([10, 10, 11, 12, 13]));
      assert.deepEqual(rising.longPullback, [F, F, F, F, F]);
      assert.deepEqual(rising.longBreakout, [F, F, F, F, F]);
    });

    it('a body equal to the prior upper band is not a breakout', () => {
      // pb [12,13,14,15,13,15]: upper = [-,-,14,15,15,15]; expansion at t3,
      // pause arms at t4; body 15 at t5 equals the prior upper → no cross.
      const eq = computeStTriggerBands(pb([12, 13, 14, 15, 13, 15]));
      assert.deepEqual(eq.longBreakout, [F, F, F, F, F, F]);
      assert.deepEqual(eq.longPullback, [F, F, F, F, T, T]);
      assert.deepEqual(eq.longPullbackState, [F, F, F, F, T, T]);
    });

    it('an expansion bar while armed is always a breakout — the state never survives a rising band', () => {
      // pb [12,13,14,15,10,9,14,15,13]: upper = [-,-,14,15,15,15,14,15,15]
      //   expansion t3 → pause arms t4, holds t5/t6; t7 the band RISES on
      //   body 15 > prior upper 14 — up2(15)>=up1(14) + cross + armed ⇒
      //   breakout. The state resets; the t8 pause can't re-arm yet.
      const carry = computeStTriggerBands(pb([12, 13, 14, 15, 10, 9, 14, 15, 13]));
      assert.deepEqual(carry.longPullback, [F, F, F, F, T, T, T, F, T]);
      assert.deepEqual(carry.longPullbackState, [F, F, F, F, T, T, T, F, F]);
      assert.deepEqual(carry.longBreakout, [F, F, F, F, F, F, F, T, F]);
    });

    it('the state arms on the first pause after the band has expanded and holds through later pauses', () => {
      // bodies [12,11,10,11,12,13,12,11,13]
      //   upper = [-,-,12,11,12,13,13,13,13]
      //   t3 pause can't arm (nothing expanded yet); t4/t5 are expansions;
      //   t6 pause arms (expansion seen), t7 holds; t8 body 13 vs prior
      //   upper 13 is not greater → no breakout, state stays armed.
      const re = computeStTriggerBands(flat([12, 11, 10, 11, 12, 13, 12, 11, 13]));
      assert.deepEqual(re.upper, [null, null, 12, 11, 12, 13, 13, 13, 13]);
      assert.deepEqual(re.longBreakout, [F, F, F, F, F, F, F, F, F]);
      assert.deepEqual(re.longPullbackState, [F, F, F, F, F, F, T, T, T]);
    });
  });

  describe('short side', () => {
    const r = computeStTriggerBands(GOLDEN);

    it('pullback is true while the lower band is not falling', () => {
      assert.deepEqual(r.shortPullback, [F, F, F, T, F, F, T]);
    });

    it('the first arming pause is the one after the band expanded (GOLDEN)', () => {
      // lower falls at t4/t5 (short expansion) → the t6 pause is the first
      // bar able to arm; t3's pause predates any expansion and can't arm.
      assert.deepEqual(r.shortPullbackState, [F, F, F, F, F, F, T]);
    });

    it('breakout fires on the first falling bar after an armed pullback (mirror fixture)', () => {
      // Mirror of CANONICAL: body lows [18,17,16,17,15,17,12,14,11,13],
      // body highs pinned at 20 so the long side stays inert.
      //   lower = [-,-,16,16,15,15,12,12,11,11]
      //   t5 pause arms (expansion at t4), t6 crossunder = breakout,
      //   t7 pause can't re-arm, t8 expands, t9 pause arms.
      const mb = (bodyLows: number[]): OHLCV[] => bodyLows.map((bl) => bar(20, bl));
      const m = computeStTriggerBands(mb([18, 17, 16, 17, 15, 17, 12, 14, 11, 13]));
      assert.deepEqual(m.shortPullbackState, [F, F, F, F, F, T, F, F, F, T]);
      assert.deepEqual(m.shortBreakout, [F, F, F, F, F, F, T, F, F, F]);
    });

    it('no breakout without a prior pullback (band falling from the start)', () => {
      const falling = computeStTriggerBands(flat([13, 13, 12, 11, 10]));
      assert.deepEqual(falling.shortPullback, [F, F, F, F, F]);
      assert.deepEqual(falling.shortBreakout, [F, F, F, F, F]);
    });

    it('an expansion bar while armed is always a breakout — the state never survives a falling band', () => {
      // Mirror of the long case: bodyLows [18,17,16,15,20,21,16,15,17],
      // bodyHighs pinned at 20. lower = [-,-,16,15,15,15,16,15,15]
      //   expansion t3 → pause arms t4, holds t5/t6; t7 the band FALLS on
      //   body 15 < prior lower 16 — lo2(15)<=lo1(16) + cross + armed ⇒
      //   breakout. The state resets; the t8 pause can't re-arm yet.
      const mb = (bodyLows: number[]): OHLCV[] => bodyLows.map((bl) => bar(20, bl));
      const carry = computeStTriggerBands(mb([18, 17, 16, 15, 20, 21, 16, 15, 17]));
      assert.deepEqual(carry.shortPullback, [F, F, F, F, T, T, T, F, T]);
      assert.deepEqual(carry.shortPullbackState, [F, F, F, F, T, T, T, F, F]);
      assert.deepEqual(carry.shortBreakout, [F, F, F, F, F, F, F, T, F]);
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
      // Canonical t6: long breakout fires while the flat lower band keeps
      // its (unarmed) short pullback flag lit.
      const r = computeStTriggerBands(CANONICAL);
      assert.equal(r.longBreakout[6], true);
      assert.equal(r.shortPullback[6], true);
    });
  });
});
