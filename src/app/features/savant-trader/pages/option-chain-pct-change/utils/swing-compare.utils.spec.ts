import {
  mergeDateList,
  defaultTypeForStart,
  toUtcDateString,
  swingPolyline,
  swingSegments,
  type SwingCompareDateItem,
} from './swing-compare.utils';
import { OptionType } from '@options-contract/contracts';
import { SignalDirection } from '../../../common/constants';
import type { StSignalItem } from '../../../services/types';
import {
  fixtureMs as ms,
  makePivotFixture as makePivot,
  makeSignalFixture as makeSignal,
  makeSwingFixture,
} from '../testing/swing-fixtures';

// =============================================================================
// pivotDate
// =============================================================================

describe('toUtcDateString', () => {
  it('converts a ms timestamp to YYYY-MM-DD (UTC)', () => {
    expect(toUtcDateString(ms('2025-04-07'))).toBe('2025-04-07');
  });
});

// =============================================================================
// mergeDateList
// =============================================================================

describe('mergeDateList', () => {
  const frame = { start: '2025-04-01', end: '2025-04-30' };

  it('merges confirmed pivots + signals inside the frame, sorted ascending, labeled', () => {
    const pivots = [
      makePivot({ time: ms('2025-04-10'), isHigh: true }),
      makePivot({ time: ms('2025-04-15'), isHigh: false }),
    ];
    const signals = [makeSignal({ barDate: '2025-04-12', direction: SignalDirection.SHORT })];

    const list = mergeDateList(pivots, signals, frame.start, frame.end);

    // frame.start is always included as the first entry.
    expect(list.map((d) => d.date)).toEqual(['2025-04-01', '2025-04-10', '2025-04-12', '2025-04-15']);
    expect(list[0].labels).toContain('frame-start');
    expect(list[1].labels).toContain('swing-high');
    expect(list[1].pivotIsHigh).toBe(true);
    expect(list[2].labels).toContain('SHORT');
    expect(list[2].signalDirections).toEqual([SignalDirection.SHORT]);
    expect(list[3].labels).toContain('swing-low');
  });

  it('excludes unconfirmed pivots', () => {
    const pivots = [
      makePivot({ time: ms('2025-04-10'), confirmed: true }),
      makePivot({ time: ms('2025-04-12'), confirmed: false }),
    ];
    const list = mergeDateList(pivots, [], frame.start, frame.end);
    expect(list.map((d) => d.date)).toEqual(['2025-04-01', '2025-04-10']);
  });

  it('excludes pivots and signals outside the frame bounds', () => {
    const pivots = [
      makePivot({ time: ms('2025-03-31') }), // before start
      makePivot({ time: ms('2025-04-10') }),
      makePivot({ time: ms('2025-05-01') }), // after end
    ];
    const signals = [
      makeSignal({ barDate: '2025-03-15' }),
      makeSignal({ barDate: '2025-04-20' }),
      makeSignal({ barDate: '2025-05-15' }),
    ];
    const list = mergeDateList(pivots, signals, frame.start, frame.end);
    expect(list.map((d) => d.date)).toEqual(['2025-04-01', '2025-04-10', '2025-04-20']);
  });

  it('dedupes a same-date pivot+signal into one entry with both labels', () => {
    const pivots = [makePivot({ time: ms('2025-04-10'), isHigh: true })];
    const signals = [makeSignal({ barDate: '2025-04-10', direction: SignalDirection.SHORT })];

    const list = mergeDateList(pivots, signals, frame.start, frame.end);

    const merged = list.find((d) => d.date === '2025-04-10')!;
    expect(merged.labels).toEqual(expect.arrayContaining(['swing-high', 'SHORT']));
    expect(merged.pivotIsHigh).toBe(true);
    expect(merged.signalDirections).toEqual([SignalDirection.SHORT]);
    expect(list.filter((d) => d.date === '2025-04-10')).toHaveLength(1);
  });

  it('includes the frame start date itself, labeled', () => {
    const list = mergeDateList([], [], frame.start, frame.end);
    expect(list[0].date).toBe(frame.start);
    expect(list[0].labels).toContain('frame-start');
  });

  it('marks a pivot on the frame-start date as both frame-start and pivot', () => {
    const pivots = [makePivot({ time: ms('2025-04-01'), isHigh: false })];
    const list = mergeDateList(pivots, [], frame.start, frame.end);
    expect(list).toHaveLength(1);
    expect(list[0].labels).toEqual(expect.arrayContaining(['frame-start', 'swing-low']));
  });

  it('includes a pivot landing exactly on the frame end (inclusive bounds)', () => {
    const pivots = [makePivot({ time: ms('2025-04-30'), isHigh: true })];
    const signals = [makeSignal({ barDate: '2025-04-30' })];
    const list = mergeDateList(pivots, signals, frame.start, frame.end);
    const endItem = list.find((d) => d.date === '2025-04-30');
    expect(endItem).toBeDefined();
    expect(endItem!.labels).toEqual(expect.arrayContaining(['swing-high', 'LONG']));
  });

  it('handles an empty signal list (pivots only)', () => {
    const pivots = [makePivot({ time: ms('2025-04-10') })];
    const list = mergeDateList(pivots, [], frame.start, frame.end);
    expect(list.map((d) => d.date)).toEqual(['2025-04-01', '2025-04-10']);
  });
});

// =============================================================================
// defaultTypeForStart
// =============================================================================

describe('defaultTypeForStart', () => {
  const item = (over: Partial<SwingCompareDateItem>): SwingCompareDateItem => ({
    date: '2025-04-10',
    labels: [],
    pivotIsHigh: null,
    pivotPrice: null,
    signalDirections: [],
    ...over,
  });

  it('returns CALL for a swing-low start', () => {
    expect(defaultTypeForStart(item({ pivotIsHigh: false }))).toBe(OptionType.CALL);
  });

  it('returns CALL for a LONG signal start', () => {
    expect(defaultTypeForStart(item({ signalDirections: [SignalDirection.LONG] }))).toBe(OptionType.CALL);
  });

  it('returns PUT for a swing-high start', () => {
    expect(defaultTypeForStart(item({ pivotIsHigh: true }))).toBe(OptionType.PUT);
  });

  it('returns PUT for a SHORT signal start', () => {
    expect(defaultTypeForStart(item({ signalDirections: [SignalDirection.SHORT] }))).toBe(OptionType.PUT);
  });

  it('prefers CALL when both a low pivot and SHORT signal share a date', () => {
    // A low-pivot start suggests the bounce direction regardless of the
    // signal's direction — CALL wins.
    expect(
      defaultTypeForStart(item({ pivotIsHigh: false, signalDirections: [SignalDirection.SHORT] })),
    ).toBe(OptionType.CALL);
  });
});

// =============================================================================
// Mini-chart geometry — swingPolyline / swingSegments
// =============================================================================

const mkSwing = (start: string, sPrice: number, end: string, ePrice: number, dir: 'up' | 'down' = 'up') =>
  makeSwingFixture(start, end, dir, sPrice, ePrice);

describe('swingPolyline', () => {
  it('returns empty string for no pivots', () => {
    expect(swingPolyline([], 100, 40)).toBe('');
  });

  it('returns a points string normalized into the viewbox for multi-pivot sets', () => {
    const pivots = [
      makePivot({ time: ms('2025-04-01'), price: 100, isHigh: false }),
      makePivot({ time: ms('2025-04-10'), price: 120, isHigh: true }),
      makePivot({ time: ms('2025-04-20'), price: 90, isHigh: false }),
    ];
    const pts = swingPolyline(pivots, 100, 40);
    const pairs = pts.trim().split(' ').map((p) => p.split(',').map(Number));
    expect(pairs).toHaveLength(3);
    // x ascending, within [0,100]; y within [0,40]; higher price = lower y
    expect(pairs[0][0]).toBeLessThan(pairs[1][0]);
    expect(pairs[1][0]).toBeLessThan(pairs[2][0]);
    expect(pairs.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 40)).toBe(true);
    expect(pairs[1][1]).toBeLessThan(pairs[0][1]); // 120 > 100 → smaller y
  });
});

describe('swingSegments', () => {
  it('returns empty for no swings', () => {
    expect(swingSegments([], 100, 40)).toEqual([]);
  });

  it('produces one segment per swing with normalized endpoints', () => {
    const swings = [
      mkSwing('2025-04-01', 100, '2025-04-10', 120, 'up'),
      mkSwing('2025-04-10', 120, '2025-04-20', 90, 'down'),
    ];
    const segs = swingSegments(swings, 100, 40);
    expect(segs).toHaveLength(2);
    expect(segs[0].swing).toBe(swings[0]);
    expect(segs[0].x2).toBe(segs[1].x1); // contiguous
    expect(segs[1].y2).toBeGreaterThan(segs[1].y1); // down swing → larger y at end
  });
});
