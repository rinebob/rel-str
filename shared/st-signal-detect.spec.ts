/**
 * #1727 — Shared detector pins (Thread #1665, Topic #261).
 *
 * Direct unit pins for the canonical signal engine. Coverage elsewhere is
 * transitive (node:test wrapper suites, the FE emitter spec, the ADC verify
 * script); this spec pins the detector-level edges where they live:
 * leading-zeros warm-up skip, FIRED-latch re-arm semantics, NaN-window
 * state reset, the intentional NaN-in-zone asymmetry between the two
 * detectors, and zero-cross neutrality rules. Via the `@st/` alias —
 * pins the jest moduleNameMapper wiring like st-ibs.spec.ts.
 */
import {
  detectZoneUptickCandidates,
  detectZoneZeroCrossCandidates,
} from '@st/signal-detect';

const idxDir = (cs: { index: number; direction: string }[]) =>
  cs.map((c) => `${c.index}:${c.direction}`);

describe('detectZoneUptickCandidates', () => {
  it('empty / warm-up-only inputs produce no candidates', () => {
    expect(detectZoneUptickCandidates([], [], 'V1', 'D')).toEqual([]);
    expect(detectZoneUptickCandidates([1], [1], 'V1', 'D')).toEqual([]);
    // All leading zeros then end — nothing to detect on.
    expect(detectZoneUptickCandidates([0, 0, 0], [1, 1, 1], 'V1', 'D')).toEqual([]);
  });

  it('skips leading zeros (warm-up) — an uptick right after the zeros fires', () => {
    // 0,0 warm-up skipped; 2→3 uptick at index 2 with window open.
    const cs = detectZoneUptickCandidates([0, 0, 2, 3], [9, 9, 1, 1], 'V1', 'D');
    expect(idxDir(cs)).toEqual(['3:long']);
  });

  it('FIRED latch: consecutive upticks do not re-fire without a down-delta re-arm', () => {
    // 1→2 fires at index 1; the 3→4 uptick at index 4 can't re-fire.
    const cs = detectZoneUptickCandidates([1, 2, 3, 3, 4], [1, 1, 1, 1, 1], 'V1', 'D');
    expect(idxDir(cs)).toEqual(['1:long']);
  });

  it('a down-delta re-arms the latch — the next uptick fires a second candidate', () => {
    const cs = detectZoneUptickCandidates([2, 3, 2, 4], [1, 1, 1, 1], 'V1', 'D');
    expect(idxDir(cs)).toEqual(['1:long', '3:long']);
  });

  it('window ≤ 0 blocks the uptick; uptick from prevZone 0 is not a candidate', () => {
    // Window negative → long side never armed.
    expect(detectZoneUptickCandidates([1, 2], [-1, -1], 'V1', 'D')).toEqual([]);
    // prevZone 0 (< +1) → uptick doesn't qualify.
    expect(detectZoneUptickCandidates([0, 1], [1, 1], 'V1', 'D')).toEqual([]);
  });

  it('NaN window resets state — a post-gap uptick re-fires', () => {
    // Window NaN at index 2 → both states reset (BE truth); the 3→4 uptick
    // at index 4 fires because the latch re-armed on the gap.
    const cs = detectZoneUptickCandidates(
      [2, 3, 3, 3, 4],
      [1, 1, NaN, 1, 1],
      'V1', 'D',
    );
    expect(idxDir(cs)).toEqual(['1:long', '4:long']);
  });

  it('NaN inside ltfZone is treated as a flat delta — no fire, no re-arm', () => {
    // Pinning the deliberate asymmetry vs zero-cross (which breaks the
    // sequence on NaN). NaN delta: neither uptick nor downtick → state
    // UNCHANGED — FIRED survives the NaN bar, so 4→5 still can't re-fire.
    const cs = detectZoneUptickCandidates(
      [2, 3, NaN, 4, 5],
      [1, 1, 1, 1, 1],
      'V1', 'D',
    );
    expect(idxDir(cs)).toEqual(['1:long']);
  });

  it('windowV2 shorter than ltfZone reads as reset beyond its end', () => {
    // windowV2[2+] undefined → undefined > 0 is false → state reset.
    const cs = detectZoneUptickCandidates([2, 3, 3, 4], [1, 1], 'V1', 'D');
    expect(idxDir(cs)).toEqual(['1:long']);
  });

  it('short side mirrors: downtick from prevZone ≤ −1 under negative window', () => {
    const cs = detectZoneUptickCandidates([-1, -2, -1, -3], [-1, -1, -1, -1], 'V2', 'W');
    expect(idxDir(cs)).toEqual(['1:short', '3:short']);
    expect(cs[0].signalType).toBe('W_ST_TREND_RIDER_V2_SHORT');
  });
});

describe('detectZoneZeroCrossCandidates', () => {
  it('empty / single-bar inputs produce no candidates', () => {
    expect(detectZoneZeroCrossCandidates([], 'V1', 'D')).toEqual([]);
    expect(detectZoneZeroCrossCandidates([2], 'V1', 'D')).toEqual([]);
  });

  it('every sign flip fires — no latch', () => {
    const cs = detectZoneZeroCrossCandidates([1, -1, 2, -2], 'V1', 'D');
    expect(idxDir(cs)).toEqual(['1:short', '2:long', '3:short']);
  });

  it('zero is neutral — transitions to/from zero never fire', () => {
    expect(detectZoneZeroCrossCandidates([1, 0, -1, 0, 1], 'V1', 'D')).toEqual([]);
    // Crossing THROUGH a zero bar doesn't fire either: −1→0 and 0→1 are
    // two separate neutral transitions — only adjacent non-zero flips count.
    expect(detectZoneZeroCrossCandidates([-1, 0, 1], 'V1', 'D')).toEqual([]);
    // A direct sign flip between consecutive non-zero bars fires.
    expect(idxDir(detectZoneZeroCrossCandidates([-2, 3], 'V1', 'D'))).toEqual(['1:long']);
  });

  it('NaN breaks the sequence — no cross fabricated across a gap', () => {
    // -1 → NaN → 1: the NaN bar is skipped AND the -1→1 "cross" across it
    // is not fabricated (prev for index 2 is NaN → continue).
    const cs = detectZoneZeroCrossCandidates([-1, NaN, 1], 'V1', 'D');
    expect(cs).toEqual([]);
  });
});
