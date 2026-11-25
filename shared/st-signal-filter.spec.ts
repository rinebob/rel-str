/**
 * @topic #261 — Trading Indicator Library, Thread #1665
 * @task #1727 — SHARED: partitionByIbs spec suite
 *
 * Pins the filter contract every surface shares: direction bounds
 * (long ≥ T / short ≤ 1−T inclusive, EPSILON ulp guard), undefined-IBS
 * pass-through, ctx-omitted unfiltered mode, ibs attachment, tolerant
 * bar shapes (OHLCV / OhlcBar aliases / PriceBar), and index alignment
 * (candidate.index addresses bars).
 */
import { partitionByIbs, barIbs } from '@st/signal-filter';
import type { IbsFilterContext, IbsBarLike } from '@st/signal-filter';

/** Pinned wall clock — after every fixture date and past noon-ET
 *  activation, so availability never interferes with the bound tests. */
const NOW = new Date('2026-12-01T18:00:00Z');
const CTX: IbsFilterContext = { now: NOW };

function cand(index: number, direction: 'long' | 'short') {
  return { index, direction, signalType: `D_T_${direction.toUpperCase()}` };
}

/** Bars where only bars[2] matters: range [90,110], close sets IBS. */
function bars(signalClose: number): IbsBarLike[] {
  return [
    { high: 110, low: 90, close: 100, date: '2026-11-16' },
    { high: 110, low: 90, close: 100, date: '2026-11-17' },
    { high: 110, low: 90, close: signalClose, date: '2026-11-18' },
  ];
}

describe('partitionByIbs — bound partition', () => {
  it('long ≥ T emits; < T suppresses; boundary inclusive', () => {
    const at = partitionByIbs([cand(2, 'long')], bars(100), 'D', CTX);      // ibs = 0.5
    const over = partitionByIbs([cand(2, 'long')], bars(106), 'D', CTX);   // ibs = 0.8
    const under = partitionByIbs([cand(2, 'long')], bars(94), 'D', CTX);   // ibs = 0.2
    expect(at.emitted).toHaveLength(1);
    expect(over.emitted).toHaveLength(1);
    expect(under.emitted).toHaveLength(0);
    expect(under.suppressed).toHaveLength(1);
  });

  it('short ≤ 1−T emits; > suppresses; boundary inclusive', () => {
    const at = partitionByIbs([cand(2, 'short')], bars(100), 'D', CTX);     // ibs = 0.5
    const under = partitionByIbs([cand(2, 'short')], bars(94), 'D', CTX);   // ibs = 0.2
    const over = partitionByIbs([cand(2, 'short')], bars(106), 'D', CTX);   // ibs = 0.8
    expect(at.emitted).toHaveLength(1);
    expect(under.emitted).toHaveLength(1);
    expect(over.emitted).toHaveLength(0);
    expect(over.suppressed).toHaveLength(1);
  });

  it('threshold override: T=0.7 emits at ibs 0.7, suppresses below', () => {
    const ctx: IbsFilterContext = { now: NOW, threshold: 0.7 };
    const at = partitionByIbs([cand(2, 'long')], bars(104), 'D', ctx);      // ibs = 0.7
    const under = partitionByIbs([cand(2, 'long')], bars(103), 'D', ctx);   // ibs = 0.65
    expect(at.emitted).toHaveLength(1);
    expect(under.suppressed).toHaveLength(1);
  });

  it('EPSILON guard: T=0.15 short bound is inclusive at the computed 1−T', () => {
    // ibs exactly 0.85 → emits short (1−0.15 rounds to 0.8499999999999999)
    const b: IbsBarLike[] = [
      { high: 0, low: 0, close: 0 },
      { high: 0, low: 0, close: 0 },
      { high: 20, low: 0, close: 17, date: '2026-11-18' },  // ibs = 17/20 = 0.85
    ];
    const r = partitionByIbs([cand(2, 'short')], b, 'D', { now: NOW, threshold: 0.15 });
    expect(r.emitted).toHaveLength(1);
  });
});

describe('partitionByIbs — pass-through + unfiltered', () => {
  it('missing bar → undefined ibs → emitted (index beyond bars)', () => {
    const r = partitionByIbs([cand(9, 'short')], bars(106), 'D', CTX);
    expect(r.emitted).toHaveLength(1);
    expect(r.emitted[0].ibs).toBeNull();
  });

  it('non-finite OHLC → undefined ibs → emitted', () => {
    const b = bars(94);
    b[2] = { high: NaN, low: 90, close: 94 };
    const r = partitionByIbs([cand(2, 'long')], b, 'D', CTX);
    expect(r.emitted).toHaveLength(1);
  });

  it('ctx omitted → unfiltered: everything emits, ibs still attached', () => {
    const r = partitionByIbs([cand(2, 'long'), cand(2, 'short')], bars(94), 'D');
    expect(r.emitted).toHaveLength(2);
    expect(r.suppressed).toHaveLength(0);
    expect(r.emitted[0].ibs).toBeCloseTo(0.2, 10);
  });

  it('developing bar pre-activation → undefined → emitted', () => {
    // "now" is the same ET date as the signal bar, before noon ET.
    const now = new Date('2026-11-18T14:00:00Z'); // 09:00 ET
    const b = bars(94);                            // ibs would be 0.2 if evaluated
    const r = partitionByIbs([cand(2, 'long')], b, 'D', { now, threshold: 0.9 });
    expect(r.emitted).toHaveLength(1);
    expect(r.emitted[0].ibs).toBeNull();
  });
});

describe('partitionByIbs — tolerant bar shapes + index alignment', () => {
  it('OhlcBar alias fields (h/l/c/d) evaluate identically', () => {
    const b: IbsBarLike[] = [
      { h: 0, l: 0, c: 0 }, { h: 0, l: 0, c: 0 },
      { h: 110, l: 90, c: 106, d: '2026-11-18' },   // ibs = 0.8
    ];
    const r = partitionByIbs([cand(2, 'long')], b, 'D', CTX);
    expect(r.emitted).toHaveLength(1);
    expect(r.emitted[0].ibs).toBeCloseTo(0.8, 10);
  });

  it('candidate.index selects its own bar — later bars do not affect earlier candidates', () => {
    const b = bars(100);
    b[0] = { high: 110, low: 90, close: 94, date: '2026-11-16' }; // ibs 0.2 at index 0
    const r = partitionByIbs([cand(0, 'long'), cand(2, 'long')], b, 'D', CTX);
    expect(r.suppressed.map((s) => s.index)).toEqual([0]);
    expect(r.emitted.map((e) => e.index)).toEqual([2]);
  });
});

describe('barIbs', () => {
  it('returns undefined on missing/non-finite bar, 0.5 on zero range', () => {
    expect(barIbs(undefined, 'D', CTX)).toBeUndefined();
    expect(barIbs({ high: NaN, low: 0, close: 1 }, 'D', CTX)).toBeUndefined();
    expect(barIbs({ high: 5, low: 5, close: 5 }, 'D', CTX)).toBe(0.5);
  });
});
