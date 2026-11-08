/**
 * Spec for the dev-only Trigger Bands local port. Band/flag/cross math and
 * the expansion-gated ARMING rule mirror the backend engine
 * (`functions/src/indicators/st-trigger-bands.ts`) — the gate is the
 * approved backend contract; a pullback episode only arms after the band
 * has expanded since the last breakout.
 */

import type { PriceBar } from '../../../shared/components/flex-chart/flex-chart.types';
import {
  computeStTriggerBandsLocal,
  computeTriggerBandsIntervalData,
} from './trigger-bands-local';
import { TRIGGER_BANDS_SIGNAL_TYPES } from '@flex-chart/indicator-visuals';

function bar(i: number, open: number, high: number, low: number, close: number): PriceBar {
  const day = String(i + 1).padStart(2, '0');
  return { date: `2026-01-${day}`, x: new Date(`2026-01-${day}T08:00:00`), open, high, low, close, volume: 0 };
}

/** Long bar with bodyLow pinned at 10 (open=10) so the short side stays inert. */
function longBar(i: number, bodyHigh: number): PriceBar {
  return bar(i, 10, bodyHigh + 1, 9, bodyHigh);
}

/** Short bar with bodyHigh pinned at 20 (open=20) so the long side stays inert. */
function shortBar(i: number, bodyLow: number): PriceBar {
  return bar(i, 20, 21, bodyLow - 1, bodyLow);
}

/**
 * Canonical sequence — bodyHighs 12,13,14,13,15,13,18,16,19,17; bodyLows 10.
 * upper: -,-,14,14,15,15,18,18,19,19
 *   t3 pause (no expansion yet → no arm), t4 expands, t5 pause arms,
 *   t6 breakout, t7 pause canNOT re-arm, t8 expands, t9 pause arms again.
 */
function canonical(): PriceBar[] {
  return [12, 13, 14, 13, 15, 13, 18, 16, 19, 17].map((bh, i) => longBar(i, bh));
}

describe('computeStTriggerBandsLocal (dev port)', () => {
  it('leaves bands null through the length-3 warm-up window', () => {
    const r = computeStTriggerBandsLocal(canonical());
    expect(r.upper[0]).toBeNull();
    expect(r.lower[0]).toBeNull();
    expect(r.upper[1]).toBeNull();
    expect(r.lower[1]).toBeNull();
    expect(r.upper[2]).toBe(14);
    expect(r.lower[2]).toBe(10);
    expect(r.longPullbackState.slice(0, 2).every((f) => !f)).toBe(true);
  });

  it('computes body-based length-3 Donchian bands (wicks ignored)', () => {
    const r = computeStTriggerBandsLocal(canonical());
    expect(r.upper[3]).toBe(14); // max(13,14,13) bodies, not the 15 wick
    expect(r.lower[3]).toBe(10);
    expect(r.upper[8]).toBe(19); // max(18,16,19)
  });

  it('does not arm a pullback that precedes any band expansion', () => {
    const r = computeStTriggerBandsLocal(canonical());
    expect(r.longPullback[3]).toBe(true);       // 14 <= 14 — flag still fires
    expect(r.longPullbackState[3]).toBe(false); // but the band never expanded → no arm
    expect(r.longPullbackState[5]).toBe(true);  // expansion at t4, pause at t5 arms
  });

  it('clears state on breakout and refuses to re-arm until a fresh expansion', () => {
    const r = computeStTriggerBandsLocal(canonical());
    expect(r.longBreakout[6]).toBe(true);        // 18 > upper[5]=15, armed
    expect(r.longPullbackState[6]).toBe(false);
    expect(r.longPullback[7]).toBe(true);        // 18 <= 18 — a pause right after
    expect(r.longPullbackState[7]).toBe(false);  // the behaviour change: no instant re-arm
    expect(r.longPullbackState[9]).toBe(true);   // expansion at t8 → pause at t9 arms again
  });

  it('holds an armed state through a pause until the breakout resolves it', () => {
    // bodyHighs 12,13,14,15,13,12 → expand at t3, pause arms at t4, holds t5.
    const r = computeStTriggerBandsLocal([12, 13, 14, 15, 13, 12].map((bh, i) => longBar(i, bh)));
    expect(r.longPullbackState[4]).toBe(true);
    expect(r.longPullbackState[5]).toBe(true);
    expect(r.longBreakout.every((f) => !f)).toBe(true);
  });

  it('does not fire a breakout when the band was expanding (no pause precondition)', () => {
    const r = computeStTriggerBandsLocal([11, 12, 13, 14, 15].map((bh, i) => longBar(i, bh)));
    expect(r.longPullback.every((f) => !f)).toBe(true);
    expect(r.longBreakout.every((f) => !f)).toBe(true);
    expect(r.longPullbackState.every((f) => !f)).toBe(true);
  });
});

describe('computeTriggerBandsIntervalData (dev port)', () => {
  it('produces the callable IntervalData shape consumed by inject/convert', () => {
    const bars = canonical();
    const data = computeTriggerBandsIntervalData(bars);
    expect(data.signals).toEqual({});
    expect(data.indicators.triggerBands).toHaveLength(bars.length);
    expect(data.indicators.triggerBands?.[2]).toEqual({
      d: '2026-01-03',
      upper: 14,
      lower: 10,
      longPullback: false,
      longPullbackState: false,
      longBreakout: false,
      shortPullback: false,
      shortPullbackState: false,
      shortBreakout: false,
    });
  });

  it('emits breakout dots only — pullback flags already show as band colour', () => {
    const data = computeTriggerBandsIntervalData(canonical());
    const dots = data.dotMarkers?.triggerBands ?? [];
    expect(dots).toHaveLength(1);
    expect(dots[0]).toMatchObject({
      index: 6,
      direction: 'long',
      version: 'TB',
      signalType: TRIGGER_BANDS_SIGNAL_TYPES.LONG_BREAKOUT,
    });
    expect(dots.filter((d) => d.signalType === TRIGGER_BANDS_SIGNAL_TYPES.LONG_PULLBACK)).toEqual([]);
    expect(dots.filter((d) => d.signalType === TRIGGER_BANDS_SIGNAL_TYPES.SHORT_PULLBACK)).toEqual([]);
  });

  it('anchors dots outside the envelope — long below the lower band, short above the upper', () => {
    const bars = canonical();
    const data = computeTriggerBandsIntervalData(bars);
    const points = data.indicators.triggerBands ?? [];
    for (const m of data.dotMarkers?.triggerBands ?? []) {
      const p = points[m.index];
      expect(m.d).toBe(bars[m.index].date);
      if (m.direction === 'long') {
        expect(p.lower).not.toBeNull();
        expect(m.y).toBeLessThan(p.lower as number);
      } else {
        expect(p.upper).not.toBeNull();
        expect(m.y).toBeGreaterThan(p.upper as number);
      }
    }
  });

  it('short fixture: breakout dot above the upper band (16 bars — exercises the ATR recursion)', () => {
    // Mirror of canonical: bodyLows 18,17,16,17,15,17,12,14,11,13,13×6;
    // bodyHighs pinned at 20. Lower band expands at t4 → pause arms at t5 →
    // short breakout at t6; the t9+ pauses re-arm but never resolve.
    const bars = [18, 17, 16, 17, 15, 17, 12, 14, 11, 13, 13, 13, 13, 13, 13, 13]
      .map((bl, i) => shortBar(i, bl));
    const data = computeTriggerBandsIntervalData(bars);
    const points = data.indicators.triggerBands ?? [];
    const dots = data.dotMarkers?.triggerBands ?? [];
    expect(dots).toHaveLength(1);
    expect(dots[0]).toMatchObject({
      index: 6,
      direction: 'short',
      version: 'TB',
      signalType: TRIGGER_BANDS_SIGNAL_TYPES.SHORT_BREAKOUT,
    });
    const p = points[6];
    expect(p.upper).toBe(20);
    expect(dots[0].y).toBeGreaterThan(20);
  });
});
