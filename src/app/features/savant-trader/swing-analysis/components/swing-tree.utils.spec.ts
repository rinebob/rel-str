import { buildTreeSwings, type TreeSwingRow } from './swing-tree.utils';
import type { Swing } from '../../../shared/components/flex-chart/indicators/st-zigzag.types';

function makeSwing(startTime: number, endTime: number, overrides: Partial<Swing> = {}): Swing {
  return {
    direction: 'up',
    start: { time: startTime, price: 100, barIndex: 0 },
    end: { time: endTime, price: 110, barIndex: 1 },
    magnitudePercent: 10,
    magnitudeAbsolute: 10,
    duration: 1,
    volume: 1000,
    confirmed: true,
    ...overrides,
  };
}

/** Large swings spanning [0,1000]→[1000,2000]→[2000,3000] — consecutive, shared pivots. */
function makeLargeSwings(): Swing[] {
  return [
    makeSwing(0, 1000),
    makeSwing(1000, 2000, { direction: 'down' }),
    makeSwing(2000, 3000),
  ];
}

describe('buildTreeSwings', () => {
  it('assigns small swings to the containing parent by start time', () => {
    const small = [
      makeSwing(200, 400),
      makeSwing(1200, 1400),
      makeSwing(1500, 1700),
    ];
    const rows = buildTreeSwings(makeLargeSwings(), small);
    const parents = rows.filter((r) => !r.isOrphan);
    expect(parents[0].children.length).toBe(1);
    expect(parents[0].children[0].start.time).toBe(200);
    expect(parents[1].children.length).toBe(2);
    expect(parents[2].children.length).toBe(0);
  });

  it('assigns a small swing starting on a shared pivot to the LATER parent', () => {
    // t=1000 is parent[0].end == parent[1].start — the small swing develops
    // inside parent[1].
    const small = [makeSwing(1000, 1100)];
    const rows = buildTreeSwings(makeLargeSwings(), small);
    const parents = rows.filter((r) => !r.isOrphan);
    expect(parents[0].children.length).toBe(0);
    expect(parents[1].children.length).toBe(1);
    expect(parents[1].children[0].start.time).toBe(1000);
  });

  it('assigns a small swing spanning two parents to the one active at its start', () => {
    const small = [makeSwing(800, 1500)]; // starts inside parent[0], ends inside parent[1]
    const rows = buildTreeSwings(makeLargeSwings(), small);
    const parents = rows.filter((r) => !r.isOrphan);
    expect(parents[0].children.length).toBe(1);
    expect(parents[1].children.length).toBe(0);
  });

  it('marks a small swing before the first parent as an orphan', () => {
    const small = [makeSwing(-500, -100)];
    const rows = buildTreeSwings(makeLargeSwings(), small);
    expect(rows[0].isOrphan).toBe(true);
    expect(rows[0].start.time).toBe(-500);
    expect(rows[0].children).toEqual([]);
  });

  it('marks a small swing after the last parent ends as an orphan', () => {
    const small = [makeSwing(3100, 3500)];
    const rows = buildTreeSwings(makeLargeSwings(), small);
    const orphan = rows.find((r) => r.isOrphan);
    expect(orphan).toBeTruthy();
    expect(orphan!.start.time).toBe(3100);
  });

  it('returns orphan rows only when there are no large swings', () => {
    const small = [makeSwing(100, 200), makeSwing(300, 400)];
    const rows = buildTreeSwings([], small);
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.isOrphan)).toBe(true);
  });

  it('returns an empty array when both inputs are empty', () => {
    expect(buildTreeSwings([], [])).toEqual([]);
  });

  it('keeps children chronological even when input is unordered', () => {
    const small = [
      makeSwing(1500, 1700),
      makeSwing(1200, 1400),
    ];
    const rows = buildTreeSwings(makeLargeSwings(), small);
    const parent = rows.filter((r) => !r.isOrphan)[1];
    expect(parent.children.map((c) => c.start.time)).toEqual([1200, 1500]);
  });

  it('returns top-level rows in chronological order', () => {
    const small = [makeSwing(-500, -100), makeSwing(3200, 3500)];
    const rows = buildTreeSwings(makeLargeSwings(), small);
    expect(rows.map((r) => r.start.time)).toEqual([-500, 0, 1000, 2000, 3200]);
  });

  it('includes a small swing starting exactly at the first parent start', () => {
    const small = [makeSwing(0, 200)];
    const rows = buildTreeSwings(makeLargeSwings(), small);
    const parents = rows.filter((r) => !r.isOrphan);
    expect(parents[0].children.length).toBe(1);
  });

  it('does not mutate input arrays or swing objects', () => {
    const large = makeLargeSwings();
    const small = [makeSwing(200, 400)];
    const largeLen = large.length;
    const smallLen = small.length;
    const rows = buildTreeSwings(large, small);
    expect(large.length).toBe(largeLen);
    expect(small.length).toBe(smallLen);
    // Parents are copies (spread) — inputs don't gain a children property.
    expect(large[0]).not.toHaveProperty('children');
    expect(rows.find((r) => !r.isOrphan)).not.toBe(large[0]);
  });
});
