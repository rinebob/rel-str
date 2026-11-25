/**
 * #1679 — FE: IBS filter in detectZoneUptickDots + UptickDotResult partition
 * (Thread #1665, Topic #261).
 *
 * Spec-first suite for the filter: candidate partition emitted vs suppressed
 * on the signal bar's IBS, inclusive bounds, availability pass-through
 * (undefined → emitted), param plumbing, and FIRED-state semantics
 * (a suppressed candidate still consumes the state's only shot — mirrors
 * the BE filter in signal-detection.ts).
 */
import {
  detectZoneUptickDots,
  ST_ZONE_V1_UPTICK_DOTS_INDICATOR,
  ST_ZONE_V2_UPTICK_DOTS_INDICATOR,
  type UptickDotPoint,
} from './st-trend-rider-dots.indicator';
import type { PriceBar } from '../flex-chart.types';
import { detectZoneUptickCandidates } from '@st/signal-detect';
import { partitionByIbs } from '@st/signal-filter';
import { calculateStZone } from './st-zone.indicator';
import { computeStTrendBands, type OHLCV } from '@st/trend-bands';
import { computeStZone } from '@st/zone';

const LONG = '#4caf50';
const SHORT = '#f44336';

/** Pinned wall-clock for every filter-active call — after all fixture dates
 *  and past the noon-ET activation, so every fixture bar's IBS is
 *  computable regardless of when the suite runs. */
const NOW = new Date('2026-12-01T18:00:00Z');

/** PriceBar helper — `close` positioned inside [low, high] sets the bar's
 *  IBS = (close−low)/(high−low). */
function bar(date: string, close: number, low = 90, high = 110): PriceBar {
  return { date, x: new Date(`${date}T00:00:00Z`), open: close, high, low, close };
}

const DATES = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'];

/** Zone series whose only signal is an uptick 2→3 on the last bar (long)
 *  or downtick -2→-3 (short), under a uniformly-signed HTF window. */
function zones(ys: number[], dates: readonly string[] = DATES): { x: Date; y: number }[] {
  return ys.map((y, i) => ({ x: new Date(`${dates[i]}T00:00:00Z`), y }));
}

const LONG_ZONES = zones([2, 2, 2, 3]);
const LONG_HTF = zones([1, 1, 1, 1]);
const SHORT_ZONES = zones([-2, -2, -2, -3]);
const SHORT_HTF = zones([-1, -1, -1, -1]);

function barsWithSignalClose(signalClose: number, low = 90, high = 110): PriceBar[] {
  return DATES.map((d, i) => (i === DATES.length - 1 ? bar(d, signalClose, low, high) : bar(d, 100, low, high)));
}

describe('detectZoneUptickDots — IBS filter (#1679)', () => {
  describe('partition', () => {
    it('long candidate with IBS ≥ T lands in emitted', () => {
      // close 106 on [90,110] → ibs = 0.8
      const r = detectZoneUptickDots(LONG_ZONES, LONG_HTF, barsWithSignalClose(106), LONG, SHORT, { now: NOW });
      expect(r.emitted).toHaveLength(1);
      expect(r.suppressed).toHaveLength(0);
      expect(r.emitted[0].x).toEqual(new Date('2026-11-19T00:00:00Z'));
    });

    it('long candidate with IBS < T lands in suppressed at identical placement', () => {
      // close 94 on [90,110] → ibs = 0.2
      const r = detectZoneUptickDots(LONG_ZONES, LONG_HTF, barsWithSignalClose(94), LONG, SHORT, { now: NOW });
      expect(r.emitted).toHaveLength(0);
      expect(r.suppressed).toHaveLength(1);
      const p = r.suppressed[0];
      expect(p.x).toEqual(new Date('2026-11-19T00:00:00Z'));
      expect(p.y).toBeLessThan(90); // below the bar low — same placement math as emitted
      expect(p.color).toBe(LONG);
    });

    it('boundary is inclusive: IBS == 0.5 emits long', () => {
      // close 100 on [90,110] → ibs = 0.5
      const r = detectZoneUptickDots(LONG_ZONES, LONG_HTF, barsWithSignalClose(100), LONG, SHORT, { now: NOW });
      expect(r.emitted).toHaveLength(1);
      expect(r.suppressed).toHaveLength(0);
    });

    it('short candidate with IBS > 1−T lands in suppressed', () => {
      const r = detectZoneUptickDots(SHORT_ZONES, SHORT_HTF, barsWithSignalClose(106), LONG, SHORT, { now: NOW });
      expect(r.emitted).toHaveLength(0);
      expect(r.suppressed).toHaveLength(1);
      expect(r.suppressed[0].color).toBe(SHORT);
      expect(r.suppressed[0].y).toBeGreaterThan(110); // above the bar high
    });

    it('short candidate with IBS ≤ 1−T emits; boundary 0.5 inclusive', () => {
      const lo = detectZoneUptickDots(SHORT_ZONES, SHORT_HTF, barsWithSignalClose(94), LONG, SHORT, { now: NOW });
      expect(lo.emitted).toHaveLength(1);
      const edge = detectZoneUptickDots(SHORT_ZONES, SHORT_HTF, barsWithSignalClose(100), LONG, SHORT, { now: NOW });
      expect(edge.emitted).toHaveLength(1);
    });

    it('non-finite OHLC can\'t filter — emits like the BE guard (NaN → pass-through)', () => {
      const bars = barsWithSignalClose(94);
      bars[bars.length - 1] = { ...bars[bars.length - 1], close: NaN };
      const r = detectZoneUptickDots(LONG_ZONES, LONG_HTF, bars, LONG, SHORT, { now: NOW });
      expect(r.emitted).toHaveLength(1);
      expect(r.suppressed).toHaveLength(0);
    });
  });

  describe('availability + pass-through', () => {
    it('undefined IBS (developing bar, pre-activation) → emitted', () => {
      // Signal bar dated today, `now` at 09:00 ET → computeIbs → undefined.
      const now = new Date('2026-11-19T14:00:00Z'); // 09:00 ET
      const bars = barsWithSignalClose(94); // ibs would be 0.2 if computable
      const r = detectZoneUptickDots(LONG_ZONES, LONG_HTF, bars, LONG, SHORT, { now });
      expect(r.emitted).toHaveLength(1);
      expect(r.suppressed).toHaveLength(0);
    });

    it('ibs param omitted → no suppression (unfiltered)', () => {
      const r = detectZoneUptickDots(LONG_ZONES, LONG_HTF, barsWithSignalClose(94), LONG, SHORT);
      expect(r.emitted).toHaveLength(1);
      expect(r.suppressed).toHaveLength(0);
    });
  });

  describe('threshold param', () => {
    it('threshold 0.7: IBS at the bound emits, just under suppresses', () => {
      const at = detectZoneUptickDots(LONG_ZONES, LONG_HTF, barsWithSignalClose(104), LONG, SHORT, { threshold: 0.7, now: NOW });
      expect(at.emitted).toHaveLength(1); // ibs = (104−90)/20 = 0.7 — boundary emits
      const under = detectZoneUptickDots(LONG_ZONES, LONG_HTF, barsWithSignalClose(103), LONG, SHORT, { threshold: 0.7, now: NOW });
      expect(under.emitted).toHaveLength(0);
      expect(under.suppressed).toHaveLength(1);
    });
  });

  describe('state machine parity', () => {
    it('a suppressed candidate consumes FIRED — the next uptick does not re-fire', () => {
      // Two upticks: 2→3 on bar 3 (suppressed, ibs 0.2), flat, then 3→4 on
      // the last bar — with FIRED consumed the second uptick must NOT
      // produce any dot.
      const dates = [...DATES, '2026-11-20'];
      const z = zones([2, 2, 3, 3, 4], dates);
      const htf = zones([1, 1, 1, 1, 1], dates);
      const bars = dates.map((d, i) => bar(d, i === 2 || i === 4 ? 94 : 100));
      const r = detectZoneUptickDots(z, htf, bars, LONG, SHORT, { now: NOW });
      expect(r.emitted).toHaveLength(0);
      expect(r.suppressed).toHaveLength(1);
      expect(r.suppressed[0].x).toEqual(new Date('2026-11-18T00:00:00Z'));
    });
  });

  describe('result shape + regression', () => {
    it('emitted points keep the UptickDotPoint shape {x, y, color}', () => {
      const r = detectZoneUptickDots(LONG_ZONES, LONG_HTF, barsWithSignalClose(106), LONG, SHORT, { now: NOW });
      const p: UptickDotPoint = r.emitted[0];
      expect(p.x).toBeInstanceOf(Date);
      expect(typeof p.y).toBe('number');
      expect(p.color).toBe(LONG);
    });
  });
});

describe('dots indicator params (#1679)', () => {
  for (const opt of [ST_ZONE_V1_UPTICK_DOTS_INDICATOR, ST_ZONE_V2_UPTICK_DOTS_INDICATOR]) {
    it(`${opt.id} carries showSuppressedSignals + ibsThreshold with defaults`, () => {
      const keys = opt.params.map(p => p.key);
      expect(keys).toContain('showSuppressedSignals');
      expect(keys).toContain('ibsThreshold');
      const show = opt.params.find(p => p.key === 'showSuppressedSignals')!;
      const t = opt.params.find(p => p.key === 'ibsThreshold')!;
      expect(show.default).toBe(false);
      expect(t.default).toBe(0.5);
      expect(t.min).toBe(0);
      expect(t.max).toBe(1);
    });
  }
});

/**
 * #1727 — cross-surface parity: the sandbox emitter and the BE emit path
 * compose the SAME shared engine (detectZoneUptickCandidates +
 * partitionByIbs), so the emitted/suppressed index sets must be identical
 * on the same inputs. The BE wrapper adds only record shaping
 * (direction → StSignalDirection, indicators.ibs) after this identical
 * partition — composing the same two calls here is the honest parity check.
 * Zone-math parity is pinned too: the FE calculator delegates to the same
 * shared engine, so its emitted values must equal computeStZone's.
 */

describe('cross-surface parity (#1727)', () => {
  it('sandbox and BE emit paths produce identical emitted/suppressed index sets', () => {
    // Zone series with two long candidates (2, 4 — a down-delta re-arms
    // the latch between them) + one short (7 — the −1 bar positions
    // prevZone ≤ −1 for the −2 downtick). Window positive covers longs,
    // negative covers the short.
    const zoneNums = [2, 2, 3, 2, 4, 2, -1, -2, -3];
    const winNums = [1, 1, 1, 1, 1, 1, -1, -1, -1];
    const dates = [
      '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14',
      '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20',
    ];
    const zonePts = zoneNums.map((y, i) => ({ x: new Date(`${dates[i]}T00:00:00Z`), y }));
    const winPts = winNums.map((y, i) => ({ x: new Date(`${dates[i]}T00:00:00Z`), y }));
    // Signal-bar closes: index 2 ibs=0.9 (long emits), 4 ibs=0.1 (long
    // suppresses), 7 ibs=0.9 (short suppresses — needs ≤0.5).
    const closes = [100, 100, 108, 100, 92, 100, 100, 108, 100];
    const bars = closes.map((c, i) => bar(dates[i], c));

    const ctx = { now: NOW, threshold: 0.5 };

    // BE emit path — exactly what signal-detection.ts composes.
    const cands = detectZoneUptickCandidates(zoneNums, winNums, 'V1', 'D');
    const be = partitionByIbs(cands, bars, 'D', ctx);

    // FE emitter path.
    const fe = detectZoneUptickDots(zonePts, winPts, bars, LONG, SHORT, ctx, 'V1');

    const feEmittedIdx = fe.emitted.map((d) => dates.indexOf(d.x.toISOString().slice(0, 10)));
    const feSuppIdx = fe.suppressed.map((d) => dates.indexOf(d.x.toISOString().slice(0, 10)));

    expect(feEmittedIdx.sort()).toEqual(be.emitted.map((c) => c.index).sort());
    expect(feSuppIdx.sort()).toEqual(be.suppressed.map((c) => c.index).sort());
    // And the sets are the ones we designed: 2 emitted, 4 + 7 suppressed.
    expect(be.emitted.map((c) => c.index).sort()).toEqual([2]);
    expect(be.suppressed.map((c) => c.index).sort()).toEqual([4, 7]);
  });

  it('zone math parity: FE calculateStZone values equal shared computeStZone', () => {
    // 60 bars of deterministic movement — enough for bands to engage.
    const prices = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 8 + i * 0.3);
    const bars = prices.map((c, i) => {
      const date = `2026-01-${String((i % 28) + 1).padStart(2, '0')}`;
      return {
        date,
        x: new Date(Date.UTC(2026, Math.floor(i / 28), (i % 28) + 1)),
        open: c - 0.4, high: c + 1.2, low: c - 1.2, close: c,
      };
    });
    const fe = calculateStZone(bars, {});
    const ohlcv: OHLCV[] = bars.map((b) => ({ open: b.open, high: b.high, low: b.low, close: b.close }));
    const shared = computeStZone(ohlcv, computeStTrendBands(ohlcv)).zone;

    expect(fe.length).toBeGreaterThan(0);
    for (const p of fe) {
      const i = bars.findIndex((b) => b.x.getTime() === p.x.getTime());
      expect(p.y).toBe(shared[i]);
    }
  });
});
