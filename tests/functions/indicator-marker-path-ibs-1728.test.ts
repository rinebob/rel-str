/**
 * Unit tests for the IBS partition on the marker path (task #1728, Thread #1665).
 *
 * Before this task `generateZoneSignals` (indicator-computation.ts) fed the
 * detectors a zero-filled OHLC stub — `barIbs` always hit the zero-range
 * guard, returned undefined, and every candidate passed through: no marker
 * could ever be filtered. The task passes the real `OhlcBar[]` (already in
 * scope at `generateSymbolSignals`, index-aligned with the points) into the
 * shared `partitionByIbs`, so the chart-dot path partitions exactly like the
 * strategy path.
 *
 * Contract pinned here:
 *   - emitted markers == strategy-path emitted signals on the same bars
 *     (same index+signalType set — the parity contract)
 *   - suppressed candidates land in `suppressed`, never in `emitted`
 *   - undefined IBS (non-finite OHLC, or a young bar pre-activation) passes
 *     through to `emitted` with `ibs: null`
 *   - `candidate.index` addresses BOTH the zone array and the bars array
 *     (1:1 alignment — a marker's `d` is `bars[index].d`)
 *   - dotMarkers.zoneV* carries the `{ emitted, suppressed }` shape;
 *     markers carry their bar's `ibs` (null when uncomputable)
 *   - suppression is emission-only — a suppressed uptick's FIRED latch is
 *     spent; it cannot re-fire
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeSymbolIndicatorSeries,
  generateZoneSignals,
  type IndicatorDataPoint,
} from '../../functions/src/st-cloud-function/indicator-computation';
import {
  detectAllStTrendRiderSignals,
  detectAllZoneZeroCrossSignals,
} from '../../functions/src/st-cloud-function/strategies/signal-detection';
import type { OhlcBar } from '../../functions/src/common/market-data-types';
import type { OHLCV } from '@st/trend-bands';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Fabricate indicator points carrying a hand-written zone sequence. All
 *  fields the detectors ignore stay null/empty — only `d`, `zoneV1`,
 *  `zoneV2` participate. */
function points(zones: (number | null)[], dates?: string[]): IndicatorDataPoint[] {
  return zones.map((z, i) => ({
    d: dates?.[i] ?? `2026-01-${String(i + 1).padStart(2, '0')}`,
    zoneV1: z,
    zoneV2: z,
    diPlus: null,
    diMinus: null,
    diHist: null,
    htfDiHist: null,
    adx: null,
    bands: [],
    htfZoneV2: null,
  }));
}

/** Bars at the requested per-bar IBS: range [0,10], close = ibs * 10.
 *  January 2026 dates — completed periods, always available. */
function bars(ibsValues: number[], dates?: string[]): OhlcBar[] {
  return ibsValues.map((ibs, i) => ({
    d: dates?.[i] ?? `2026-01-${String(i + 1).padStart(2, '0')}`,
    o: 5,
    h: 10,
    l: 0,
    c: ibs * 10,
    v: 1000,
  }));
}

function toOhlcv(b: OhlcBar): OHLCV {
  return { open: b.o, high: b.h, low: b.l, close: b.c, date: b.d };
}

/** Strategy-path emitted set for parity comparison. */
function strategyEmitted(
  zones: number[],
  ohlcv: OHLCV[],
  version: 'V1' | 'V2',
  timeframe: 'D' | 'W',
): { index: number; signalType: string }[] {
  return [
    ...detectAllStTrendRiderSignals(zones, zones, ohlcv, version, timeframe, {}),
    ...detectAllZoneZeroCrossSignals(zones, ohlcv, version, timeframe, {}),
  ]
    .map(s => ({ index: s.index ?? -1, signalType: s.signalType }))
    .sort((a, b) => a.index - b.index);
}

const key = (s: { index: number; signalType: string }) => `${s.index}|${s.signalType}`;

// Long uptick at i=2 (zone +1→+2 in positive window); a second uptick at i=4
// after a re-arming downtick at i=3.
const UPTICK_ZONES = [1, 1, 2, 1, 2];
// Zero cross at i=2 (−1→+2) — no state machine, fires on the flip bar.
const CROSS_ZONES = [-1, -1, 2, 2, 1];

// ─── Emitted = strategy-path emitted (parity contract) ─────────────────────

describe('marker-path IBS partition — parity with strategy path', () => {
  for (const version of ['V1', 'V2'] as const) {
    for (const timeframe of ['D', 'W'] as const) {
      it(`${version} ${timeframe}: emitted set == strategy-path emitted set on the same bars`, () => {
        const zoneNums = [...UPTICK_ZONES, ...CROSS_ZONES];
        const ibsProfile = [0.5, 0.5, 0.4, 0.5, 0.9, 0.5, 0.5, 0.2, 0.5, 0.5];
        const pts = points(zoneNums);
        const b = bars(ibsProfile);
        const { emitted } = generateZoneSignals(pts, b, version, timeframe);
        const strat = strategyEmitted(zoneNums, b.map(toOhlcv), version, timeframe);
        assert.deepEqual(
          emitted.map(s => ({ index: s.index, signalType: s.signalType })).sort((a, b2) => a.index - b2.index).map(key),
          strat.map(key),
        );
      });
    }
  }

  it('zero-cross suppressed on a failing bar — emitted set excludes it', () => {
    const pts = points(CROSS_ZONES);
    const b = bars([0.5, 0.5, 0.2, 0.5, 0.5]); // cross bar IBS 0.2 → long fails (needs ≥0.5)
    const { emitted, suppressed } = generateZoneSignals(pts, b, 'V1', 'D');
    assert.equal(emitted.length, 0);
    assert.equal(suppressed.length, 1);
    assert.equal(suppressed[0].index, 2);
    assert.equal(suppressed[0].direction, 'long');
    assert.equal(suppressed[0].ibs, 0.2);
  });

  it('zero-cross short suppressed on a strong-close bar', () => {
    const pts = points([1, 1, -2]);
    const b = bars([0.5, 0.5, 0.9]); // short needs ibs ≤ 0.5
    const { emitted, suppressed } = generateZoneSignals(pts, b, 'V2', 'D');
    assert.equal(emitted.length, 0);
    assert.equal(suppressed.length, 1);
    assert.equal(suppressed[0].direction, 'short');
  });

  it('boundary is inclusive: long at ibs exactly 0.5 emits', () => {
    const pts = points(CROSS_ZONES);
    const b = bars([0.5, 0.5, 0.5, 0.5, 0.5]);
    const { emitted, suppressed } = generateZoneSignals(pts, b, 'V1', 'D');
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].ibs, 0.5);
    assert.equal(suppressed.length, 0);
  });

  it('weekly suppression: W cross on a failing bar lands in suppressed', () => {
    const dates = ['2026-01-02', '2026-01-09', '2026-01-16', '2026-01-23', '2026-01-30'];
    const pts = points(CROSS_ZONES, dates);
    const b = bars([0.5, 0.5, 0.2, 0.5, 0.5], dates); // W long cross at ibs 0.2 → fails
    const { emitted, suppressed } = generateZoneSignals(pts, b, 'V2', 'W');
    assert.equal(emitted.length, 0);
    assert.equal(suppressed.length, 1);
    assert.equal(suppressed[0].signalType, 'W_ST_TREND_RIDER_V2_LONG');
    assert.equal(suppressed[0].ibs, 0.2);
  });
});

// ─── Suppression semantics ─────────────────────────────────────────────────

describe('marker-path IBS partition — suppression semantics', () => {
  it('suppressed uptick consumes FIRED — continued uptick does not re-fire', () => {
    // i=2 uptick suppressed (IBS 0.4); i=3 continues up while FIRED → nothing.
    const pts = points([1, 1, 2, 3]);
    const b = bars([0.5, 0.5, 0.4, 0.9]);
    const { emitted, suppressed } = generateZoneSignals(pts, b, 'V1', 'D');
    assert.equal(emitted.length, 0);
    assert.equal(suppressed.length, 1);
    assert.equal(suppressed[0].index, 2);
  });

  it('re-arm then a new uptick emits filtered on its own bar', () => {
    const pts = points(UPTICK_ZONES);
    const b = bars([0.5, 0.5, 0.4, 0.5, 0.9]); // i=2 suppressed; i=4 emits
    const { emitted, suppressed } = generateZoneSignals(pts, b, 'V1', 'D');
    assert.equal(suppressed.length, 1);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].index, 4);
    assert.equal(emitted[0].ibs, 0.9);
  });

  it('every suppressed marker carries the ibs that failed its bound', () => {
    const pts = points(UPTICK_ZONES);
    const b = bars([0.5, 0.5, 0.4, 0.5, 0.3]); // both upticks fail
    const { emitted, suppressed } = generateZoneSignals(pts, b, 'V1', 'D');
    assert.equal(emitted.length, 0);
    assert.equal(suppressed.length, 2);
    for (const s of suppressed) {
      assert.equal(typeof s.ibs, 'number');
      assert.ok((s.ibs as number) < 0.5, `long marker ibs ${s.ibs} must be < T`);
    }
  });
});

// ─── Undefined-IBS pass-through ─────────────────────────────────────────────

describe('marker-path IBS partition — undefined IBS passes', () => {
  it('non-finite OHLC on the signal bar → emits with ibs null', () => {
    const pts = points(CROSS_ZONES);
    const b = bars([0.5, 0.5, 0.5, 0.5, 0.5]);
    b[2] = { d: b[2].d, o: 5, h: NaN, l: 0, c: 6, v: 1000 };
    const { emitted, suppressed } = generateZoneSignals(pts, b, 'V1', 'D');
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].index, 2);
    assert.equal(emitted[0].ibs, null);
    assert.equal(suppressed.length, 0);
  });

  it('zero-range flat bar → ibs 0.5 → passes both bounds', () => {
    const pts = points(CROSS_ZONES);
    const b = bars([0.5, 0.5, 0.5, 0.5, 0.5]);
    b[2] = { d: b[2].d, o: 5, h: 5, l: 5, c: 5, v: 1000 };
    const { emitted } = generateZoneSignals(pts, b, 'V1', 'D');
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].ibs, 0.5);
  });

  it('young bar pre-activation → emits with ibs null (ctx now injected)', () => {
    const pts = points(CROSS_ZONES, ['2026-11-20', '2026-11-23', '2026-11-24', '2026-11-24', '2026-11-24']);
    const b = bars([0.5, 0.5, 0.4, 0.5, 0.5],
      ['2026-11-20', '2026-11-23', '2026-11-24', '2026-11-24', '2026-11-24']);
    // Cross bar dated 2026-11-24 ("today"), now = Tue 09:00 ET — pre-activation.
    const now = new Date('2026-11-24T14:00:00Z'); // 09:00 ET
    const { emitted, suppressed } = generateZoneSignals(pts, b, 'V1', 'D', { now });
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].ibs, null);
    assert.equal(suppressed.length, 0);
  });
});

// ─── Alignment ─────────────────────────────────────────────────────────────

describe('marker-path IBS partition — index alignment', () => {
  it('marker.index addresses bars[index] — d matches the bar date', () => {
    const dates = ['2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05', '2026-02-06'];
    const pts = points(UPTICK_ZONES, dates);
    const b = bars([0.5, 0.5, 0.9, 0.5, 0.9], dates);
    const { emitted } = generateZoneSignals(pts, b, 'V1', 'D');
    assert.ok(emitted.length >= 1);
    for (const s of emitted) {
      assert.equal(s.d, b[s.index].d);
      assert.equal(s.d, dates[s.index]);
    }
  });

  it('data/bars length mismatch throws — the 1:1 invariant is structural', () => {
    const pts = points(UPTICK_ZONES);
    const b = bars([0.5, 0.5, 0.9, 0.5]); // one short
    assert.throws(() => generateZoneSignals(pts, b, 'V1', 'D'), /misaligned/);
  });
});

// ─── Doc shape through computeSymbolIndicatorSeries ────────────────────────

describe('marker-path IBS partition — response doc shape', () => {
  it('dotMarkers.zoneV* is { emitted, suppressed }; signals.zoneV* = emitted', () => {
    // 50 daily / 50 weekly / 35 monthly monotone-up bars — passes the
    // 45/30 and 45/30 gates; zones compute whatever they compute — the
    // shape assertions hold regardless of signal content.
    const mk = (n: number, prefix: string): OhlcBar[] =>
      Array.from({ length: n }, (_, i) => ({
        d: `${prefix}${String(i).padStart(3, '0')}`,
        o: 100 + i,
        h: 101 + i,
        l: 99 + i,
        c: 100 + i,
        v: 1000,
      }));
    const res = computeSymbolIndicatorSeries('SYNTH', mk(50, '2026-d-'), mk(50, '2026-w-'), mk(35, '2026-m-'));

    for (const iv of ['daily', 'weekly'] as const) {
      const zv1 = res.intervals[iv]?.dotMarkers?.zoneV1;
      const zv2 = res.intervals[iv]?.dotMarkers?.zoneV2;
      assert.ok(zv1 && Array.isArray(zv1.emitted) && Array.isArray(zv1.suppressed), `${iv}.zoneV1 shape`);
      assert.ok(zv2 && Array.isArray(zv2.emitted) && Array.isArray(zv2.suppressed), `${iv}.zoneV2 shape`);
      // signals list = the emitted set (suppressed are never "signals")
      const sigs = res.intervals[iv]?.signals?.zoneV1 ?? [];
      assert.deepEqual(
        sigs.map(s => s.index).sort((a, b) => a - b),
        (zv1?.emitted ?? []).map(m => m.index).sort((a, b) => a - b),
        `${iv} signals.zoneV1 == dotMarkers.zoneV1.emitted`,
      );
    }
  });
});
