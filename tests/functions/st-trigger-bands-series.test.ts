/**
 * Integration tests for the Trigger Bands wiring in the indicator-series
 * pipeline (#877): TriggerBandsPoint series, pullback/breakout dot markers,
 * and the callable's response filtering. The engine itself is covered by
 * st-trigger-bands.test.ts.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ChartInterval,
  IndicatorFamily,
  StrategyFamily,
  computeIndicatorSeries,
  computeSymbolIndicatorSeries,
} from '../../functions/src/st-cloud-function/indicator-computation';
import {
  DEFAULT_INDICATORS,
  DEFAULT_STRATEGIES,
  filterResponse,
} from '../../functions/src/st-cloud-function/indicator-series-filter';
import type { OhlcBar } from '../../functions/src/common/market-data-types';

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Flat bars: o == c == h == l == x, dated consecutively from 2026-01-01. */
function flatBars(xs: number[]): OhlcBar[] {
  return xs.map((x, i) => ({
    d: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    o: x, h: x, l: x, c: x, v: 1000,
  }));
}

/** Deterministic wave with real ranges, long enough for every family. */
function waveBars(n: number): OhlcBar[] {
  return Array.from({ length: n }, (_, i) => {
    const mid = 100 + 10 * Math.sin(i / 5) + i * 0.05;
    return {
      d: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10),
      o: mid - 0.5, h: mid + 2, l: mid - 2, c: mid + 0.5, v: 1000,
    };
  });
}

// Engine golden fixture (see st-trigger-bands.test.ts): bodies [10,11,12,11,10,9,12]
//   long pullback t3,t4,t5 · long breakout t6 · short pullback t3,t6 · short breakout t4
const GOLDEN = flatBars([10, 11, 12, 11, 10, 9, 12]);

const compute = (daily: OhlcBar[], weekly = daily, monthly = daily) =>
  computeSymbolIndicatorSeries('TEST', daily, weekly, monthly);

// ─── Series ───────────────────────────────────────────────────────────────

describe('indicators.triggerBands', () => {
  it('is returned for daily, weekly and monthly, one point per bar with matching dates', () => {
    const r = compute(GOLDEN, GOLDEN.slice(0, 5), GOLDEN.slice(0, 4));
    assert.equal(r.intervals.daily!.indicators.triggerBands!.length, 7);
    assert.equal(r.intervals.weekly!.indicators.triggerBands!.length, 5);
    assert.equal(r.intervals.monthly!.indicators.triggerBands!.length, 4);
    assert.deepEqual(
      r.intervals.daily!.indicators.triggerBands!.map((p) => p.d),
      GOLDEN.map((b) => b.d),
    );
  });

  it('is present for intervals shorter than the 30-bar gate the other indicators use', () => {
    const r = compute(GOLDEN);
    const pts = r.intervals.daily!.indicators.triggerBands!;
    assert.equal(pts.length, 7);
    assert.equal(r.intervals.daily!.indicators.zoneV1![0].zone, null); // other families stay gated
    assert.equal(pts[2].upper, 12);
  });

  it('carries bands (null warm-up) and the six flags from the engine', () => {
    const pts = compute(GOLDEN).intervals.daily!.indicators.triggerBands!;
    assert.deepEqual(pts.map((p) => p.upper), [null, null, 12, 12, 12, 11, 12]);
    assert.deepEqual(pts.map((p) => p.lower), [null, null, 10, 11, 10, 9, 9]);
    assert.deepEqual(pts.map((p) => p.longPullback), [false, false, false, true, true, true, false]);
    assert.deepEqual(pts.map((p) => p.longPullbackState), [false, false, false, true, true, true, false]);
    assert.deepEqual(pts.map((p) => p.longBreakout), [false, false, false, false, false, false, true]);
    assert.deepEqual(pts.map((p) => p.shortPullback), [false, false, false, true, false, false, true]);
    assert.deepEqual(pts.map((p) => p.shortPullbackState), [false, false, false, true, false, false, true]);
    assert.deepEqual(pts.map((p) => p.shortBreakout), [false, false, false, false, true, false, false]);
  });

  it('maps non-finite bands to null', () => {
    const bars = flatBars([10, 11, 12, 11]);
    bars[2] = { ...bars[2], o: NaN, c: NaN };
    const pts = compute(bars).intervals.daily!.indicators.triggerBands!;
    for (const p of pts) {
      assert.ok(p.upper === null || Number.isFinite(p.upper));
      assert.ok(p.lower === null || Number.isFinite(p.lower));
    }
    assert.equal(pts[2].upper, null);
  });

  it('leaves the existing indicator families unchanged', () => {
    const bars = waveBars(120);
    const r = compute(bars, bars, bars);
    const base = computeIndicatorSeries(bars, bars, bars).daily;
    assert.deepEqual(r.intervals.daily!.indicators.zoneV1, base.map((p) => ({ d: p.d, zone: p.zoneV1 })));
    assert.deepEqual(r.intervals.daily!.indicators.zoneV2, base.map((p) => ({ d: p.d, zone: p.zoneV2 })));
    assert.deepEqual(r.intervals.daily!.indicators.trendBands, base.map((p) => ({ d: p.d, bands: p.bands })));
    assert.ok(r.intervals.daily!.dotMarkers!.trendStrength);
    assert.ok(r.intervals.daily!.dotMarkers!.zoneV1);
    assert.ok(r.intervals.daily!.htfWindows!.weekly);
  });
});

// ─── Dot markers ──────────────────────────────────────────────────────────

describe('dotMarkers.triggerBands', () => {
  const dots = () => compute(GOLDEN).intervals.daily!.dotMarkers!.triggerBands!;
  const of = (signalType: string) => dots().filter((m) => m.signalType === signalType);

  it('emits a dot per breakout bar and per ARMED pullback bar (state stays lit until breakout), tagged version TB', () => {
    // Golden fixture: long pullback state t3-t5 (clears on the t6 breakout) →
    // dots on all three bars; short state t3 and t6 (t4 breakout cleared it).
    assert.equal(dots().length, 1 + 1 + 3 + 2);
    assert.ok(dots().every((m) => m.version === 'TB'));
    assert.deepEqual(of('TRIGGER_BANDS_LONG_BREAKOUT').map((m) => m.index), [6]);
    assert.deepEqual(of('TRIGGER_BANDS_SHORT_BREAKOUT').map((m) => m.index), [4]);
    assert.deepEqual(of('TRIGGER_BANDS_LONG_PULLBACK').map((m) => m.index), [3, 4, 5]);
    assert.deepEqual(of('TRIGGER_BANDS_SHORT_PULLBACK').map((m) => m.index), [3, 6]);
  });

  it('long dots sit below the bar low and short dots above the bar high', () => {
    for (const m of dots()) {
      const bar = GOLDEN[m.index];
      if (m.direction === 'long') assert.ok(m.y < bar.l, `${m.signalType}@${m.index} y=${m.y}`);
      else assert.ok(m.y > bar.h, `${m.signalType}@${m.index} y=${m.y}`);
    }
  });

  it('direction follows the side, d follows the bar date', () => {
    for (const m of of('TRIGGER_BANDS_LONG_BREAKOUT').concat(of('TRIGGER_BANDS_LONG_PULLBACK'))) {
      assert.equal(m.direction, 'long');
      assert.equal(m.d, GOLDEN[m.index].d);
    }
    for (const m of of('TRIGGER_BANDS_SHORT_BREAKOUT').concat(of('TRIGGER_BANDS_SHORT_PULLBACK'))) {
      assert.equal(m.direction, 'short');
    }
  });

  it('is empty for fewer than 3 bars', () => {
    assert.deepEqual(compute(flatBars([10, 11])).intervals.daily!.dotMarkers!.triggerBands, []);
  });
});

// ─── Callable filtering ───────────────────────────────────────────────────

describe('filterResponse', () => {
  const full = () => compute(waveBars(120), waveBars(120), waveBars(120));
  const intervals = [ChartInterval.DAILY, ChartInterval.WEEKLY];

  it('returns triggerBands series and dots when TRIGGER_BANDS is requested', () => {
    const f = filterResponse(full(), intervals, [IndicatorFamily.TRIGGER_BANDS], DEFAULT_STRATEGIES);
    assert.ok(f.intervals.daily!.indicators.triggerBands!.length > 0);
    assert.ok(f.intervals.daily!.dotMarkers!.triggerBands!.length > 0);
    assert.ok(f.intervals.weekly!.indicators.triggerBands!.length > 0);
  });

  it('returns neither for the default indicator set', () => {
    const f = filterResponse(full(), intervals, DEFAULT_INDICATORS, DEFAULT_STRATEGIES);
    assert.equal(f.intervals.daily!.indicators.triggerBands, undefined);
    assert.equal(f.intervals.daily!.dotMarkers!.triggerBands, undefined);
  });

  it('does not return trigger-band dots for a strategies-only request', () => {
    const f = filterResponse(full(), intervals, [IndicatorFamily.ZONE_V1], [StrategyFamily.TRIGGER_BANDS]);
    assert.equal(f.intervals.daily!.dotMarkers!.triggerBands, undefined);
  });

  it('requesting TRIGGER_BANDS does not add other families dots', () => {
    const f = filterResponse(full(), intervals, [IndicatorFamily.TRIGGER_BANDS], []);
    assert.equal(f.intervals.daily!.dotMarkers!.zoneV1, undefined);
    assert.equal(f.intervals.daily!.dotMarkers!.trendStrength, undefined);
  });

  it('default sets are unchanged and exclude TRIGGER_BANDS', () => {
    assert.ok(!DEFAULT_INDICATORS.includes(IndicatorFamily.TRIGGER_BANDS));
    assert.ok(!DEFAULT_STRATEGIES.includes(StrategyFamily.TRIGGER_BANDS));
    assert.deepEqual(DEFAULT_INDICATORS, [
      IndicatorFamily.ZONE_V1, IndicatorFamily.ZONE_V2, IndicatorFamily.TREND_STRENGTH, IndicatorFamily.TREND_BANDS,
    ]);
  });
});
