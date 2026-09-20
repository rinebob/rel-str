import {
  mergeDateList,
  defaultTypeForStart,
  toUtcDateString,
  type SwingCompareDateItem,
} from './swing-compare.utils';
import { OptionType } from '@options-contract/contracts';
import { SignalDirection } from '../../../common/constants';
import type { Pivot } from '../../../../shared/components/flex-chart/indicators/st-zigzag.types';
import type { StSignalItem } from '../../../services/types';
import { SignalStatus, SignalTimeframe } from '../../../common/constants';

// =============================================================================
// Fixtures
// =============================================================================

const ms = (dateStr: string): number => new Date(dateStr + 'T00:00:00.000Z').getTime();

function makePivot(overrides: Partial<Pivot> = {}): Pivot {
  return {
    barIndex: 0,
    time: ms('2025-04-07'),
    price: 100,
    isHigh: false,
    confirmed: true,
    ...overrides,
  };
}

function makeSignal(overrides: Partial<StSignalItem> = {}): StSignalItem {
  return {
    id: 's1',
    symbol: 'QQQ',
    barDate: '2025-04-08',
    marketDate: '2025-04-08',
    runId: 'run-1',
    timeframe: SignalTimeframe.DAILY,
    direction: SignalDirection.LONG,
    signalType: 'D_ZONE_V1_UPTICK',
    status: SignalStatus.INTERIM,
    indicators: {},
    closePrice: 100,
    ...overrides,
  };
}

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
