/**
 * Unit tests for detectAllZoneZeroCrossSignals — zero-cross sign-flip detection.
 *
 * Tests cover: sign flips, jumps over zero, zero-neutral behavior, NaN breaks,
 * multiple crosses, signalType naming, and reason text.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { detectAllZoneZeroCrossSignals } from '../../functions/src/st-cloud-function/strategies/signal-detection';
import type { OHLCV } from '../../functions/src/st-cloud-function/strategies/base-strategy';

// ─── Helpers ────────────────────────────────────────────────────────────────

function bars(n: number): OHLCV[] {
  return Array.from({ length: n }, (_, i) => ({ open: 0, high: 0, low: 0, close: 0, date: `2026-01-${String(i + 1).padStart(2, '0')}` }));
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('detectAllZoneZeroCrossSignals', () => {
  it('returns empty for arrays with fewer than 2 elements', () => {
    assert.deepEqual(detectAllZoneZeroCrossSignals([], bars(0), 'V1', 'D'), []);
    assert.deepEqual(detectAllZoneZeroCrossSignals([1], bars(1), 'V1', 'D'), []);
  });

  it('detects bullish cross: [-1, +1] → long at index 1', () => {
    const signals = detectAllZoneZeroCrossSignals([-1, 1], bars(2), 'V1', 'D');
    assert.equal(signals.length, 1);
    assert.equal(signals[0].action, 'LONG');
    assert.equal(signals[0].index, 1);
    assert.equal(signals[0].signalType, 'D_ST_TREND_RIDER_V1_LONG');
  });

  it('detects bearish cross: [+1, -1] → short at index 1', () => {
    const signals = detectAllZoneZeroCrossSignals([1, -1], bars(2), 'V1', 'D');
    assert.equal(signals.length, 1);
    assert.equal(signals[0].action, 'SHORT');
    assert.equal(signals[0].index, 1);
    assert.equal(signals[0].signalType, 'D_ST_TREND_RIDER_V1_SHORT');
  });

  it('detects jumps over zero: [-3, +2] → long', () => {
    const signals = detectAllZoneZeroCrossSignals([-3, 2], bars(2), 'V1', 'D');
    assert.equal(signals.length, 1);
    assert.equal(signals[0].action, 'LONG');
  });

  it('detects jumps over zero: [+3, -2] → short', () => {
    const signals = detectAllZoneZeroCrossSignals([3, -2], bars(2), 'V1', 'D');
    assert.equal(signals.length, 1);
    assert.equal(signals[0].action, 'SHORT');
  });

  it('zero is neutral: [-1, 0] → no signal', () => {
    const signals = detectAllZoneZeroCrossSignals([-1, 0], bars(2), 'V1', 'D');
    assert.equal(signals.length, 0);
  });

  it('zero is neutral: [0, +1] → no signal', () => {
    const signals = detectAllZoneZeroCrossSignals([0, 1], bars(2), 'V1', 'D');
    assert.equal(signals.length, 0);
  });

  it('zero is neutral: [+1, 0] → no signal', () => {
    const signals = detectAllZoneZeroCrossSignals([1, 0], bars(2), 'V1', 'D');
    assert.equal(signals.length, 0);
  });

  it('zero is neutral: [0, -1] → no signal', () => {
    const signals = detectAllZoneZeroCrossSignals([0, -1], bars(2), 'V1', 'D');
    assert.equal(signals.length, 0);
  });

  it('NaN breaks the sequence: [-1, NaN, +1] → no signal', () => {
    const signals = detectAllZoneZeroCrossSignals([-1, NaN, 1], bars(3), 'V1', 'D');
    assert.equal(signals.length, 0);
  });

  it('leading NaN: [NaN, -1, +1] → long at index 2', () => {
    const signals = detectAllZoneZeroCrossSignals([NaN, -1, 1], bars(3), 'V1', 'D');
    assert.equal(signals.length, 1);
    assert.equal(signals[0].action, 'LONG');
    assert.equal(signals[0].index, 2);
  });

  it('trailing NaN: [-1, +1, NaN] → long at index 1 only', () => {
    const signals = detectAllZoneZeroCrossSignals([-1, 1, NaN], bars(3), 'V1', 'D');
    assert.equal(signals.length, 1);
    assert.equal(signals[0].index, 1);
  });

  it('multi-bar transit through zero: [-1, 0, +1] → no signal (zero is neutral)', () => {
    const signals = detectAllZoneZeroCrossSignals([-1, 0, 1], bars(3), 'V1', 'D');
    assert.equal(signals.length, 0);
  });

  it('multi-bar transit through zero: [-1, 0, 0, +1] → no signal', () => {
    const signals = detectAllZoneZeroCrossSignals([-1, 0, 0, 1], bars(4), 'V1', 'D');
    assert.equal(signals.length, 0);
  });

  it('multiple crosses: [-1, +1, -1, +1] → 3 signals (long, short, long)', () => {
    const signals = detectAllZoneZeroCrossSignals([-1, 1, -1, 1], bars(4), 'V1', 'D');
    assert.equal(signals.length, 3);
    assert.equal(signals[0].action, 'LONG');
    assert.equal(signals[0].index, 1);
    assert.equal(signals[1].action, 'SHORT');
    assert.equal(signals[1].index, 2);
    assert.equal(signals[2].action, 'LONG');
    assert.equal(signals[2].index, 3);
  });

  it('uses V2 signalType when version=V2', () => {
    const signals = detectAllZoneZeroCrossSignals([-1, 1], bars(2), 'V2', 'D');
    assert.equal(signals[0].signalType, 'D_ST_TREND_RIDER_V2_LONG');
  });

  it('uses W timeframe prefix when timeframe=W', () => {
    const signals = detectAllZoneZeroCrossSignals([-1, 1], bars(2), 'V1', 'W');
    assert.equal(signals[0].signalType, 'W_ST_TREND_RIDER_V1_LONG');
  });

  it('includes reason text describing the cross', () => {
    const signals = detectAllZoneZeroCrossSignals([-2, 1], bars(2), 'V1', 'D');
    assert.equal(signals[0].reason, 'ST Trend Rider: V1 zone crossed zero -2→1');
  });

  it('includes zone indicators in signal', () => {
    const signals = detectAllZoneZeroCrossSignals([-2, 3], bars(2), 'V2', 'D');
    assert.equal(signals[0].indicators['zoneV2'], 3);
    assert.equal(signals[0].indicators['zoneV2Prev'], -2);
  });

  it('all-zero array → no signals', () => {
    const signals = detectAllZoneZeroCrossSignals([0, 0, 0, 0], bars(4), 'V1', 'D');
    assert.equal(signals.length, 0);
  });

  it('same-sign transitions → no signals', () => {
    const signals = detectAllZoneZeroCrossSignals([1, 2, 3, 2, 1], bars(5), 'V1', 'D');
    assert.equal(signals.length, 0);
  });

  it('valid cross after NaN gap: [-1, NaN, NaN, +1] → no signal (gap breaks)', () => {
    const signals = detectAllZoneZeroCrossSignals([-1, NaN, NaN, 1], bars(4), 'V1', 'D');
    assert.equal(signals.length, 0);
  });

  it('cross after gap recovers: [-1, NaN, -1, +1] → long at index 3', () => {
    const signals = detectAllZoneZeroCrossSignals([-1, NaN, -1, 1], bars(4), 'V1', 'D');
    assert.equal(signals.length, 1);
    assert.equal(signals[0].action, 'LONG');
    assert.equal(signals[0].index, 3);
  });
});
