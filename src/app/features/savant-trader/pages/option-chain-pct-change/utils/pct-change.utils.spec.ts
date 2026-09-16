import { computePctChange, cellKey, type PctChangeFilter } from './pct-change.utils';
import { OptionType } from '@options-contract/contracts';
import type { HistoricalOptionContract } from '@options-contract/contracts';

function makeContract(overrides: Partial<HistoricalOptionContract> = {}): HistoricalOptionContract {
  return {
    contractID: 'TEST',
    symbol: 'QQQ',
    expiration: '2024-03-15',
    strike: '100',
    type: OptionType.CALL,
    mark: '5.00',
    delta: '0.5',
    ...overrides,
  };
}

const START_DATE = '2024-01-15';
const TARGET_DATE = '2024-02-15';
const CALL_FILTER: PctChangeFilter = { type: OptionType.CALL };

describe('computePctChange', () => {
  it('computes correct pctChange for a contract present in both snapshots', () => {
    const start = [makeContract({ contractID: 'A', mark: '10.00' })];
    const target = [makeContract({ contractID: 'A', mark: '15.00' })];
    const grid = computePctChange(start, target, START_DATE, TARGET_DATE, CALL_FILTER);
    expect(grid.cells.size).toBe(1);
    const cell = grid.cells.get(cellKey(100, '2024-03-15'))!;
    expect(cell.pctChange).toBeCloseTo(50, 5);
    expect(cell.startPrice).toBe(10);
    expect(cell.targetPrice).toBe(15);
  });

  it('excludes contracts only in the start snapshot', () => {
    const start = [makeContract({ contractID: 'A', mark: '10.00' })];
    const target: HistoricalOptionContract[] = [];
    const grid = computePctChange(start, target, START_DATE, TARGET_DATE, CALL_FILTER);
    expect(grid.cells.size).toBe(0);
  });

  it('excludes contracts only in the target snapshot', () => {
    const start: HistoricalOptionContract[] = [];
    const target = [makeContract({ contractID: 'A', mark: '10.00' })];
    const grid = computePctChange(start, target, START_DATE, TARGET_DATE, CALL_FILTER);
    expect(grid.cells.size).toBe(0);
  });

  it('excludes contracts with missing/non-numeric mark in start', () => {
    const start = [makeContract({ contractID: 'A', mark: undefined })];
    const target = [makeContract({ contractID: 'A', mark: '10.00' })];
    const grid = computePctChange(start, target, START_DATE, TARGET_DATE, CALL_FILTER);
    expect(grid.cells.size).toBe(0);
  });

  it('excludes contracts with missing/non-numeric mark in target', () => {
    const start = [makeContract({ contractID: 'A', mark: '10.00' })];
    const target = [makeContract({ contractID: 'A', mark: 'N/A' })];
    const grid = computePctChange(start, target, START_DATE, TARGET_DATE, CALL_FILTER);
    expect(grid.cells.size).toBe(0);
  });

  it('excludes contracts with mark "0" in start (division by zero)', () => {
    const start = [makeContract({ contractID: 'A', mark: '0' })];
    const target = [makeContract({ contractID: 'A', mark: '10.00' })];
    const grid = computePctChange(start, target, START_DATE, TARGET_DATE, CALL_FILTER);
    expect(grid.cells.size).toBe(0);
  });

  it('filters by type=call — only call contracts retained', () => {
    const start = [
      makeContract({ contractID: 'C', mark: '10.00', type: OptionType.CALL }),
      makeContract({ contractID: 'P', mark: '10.00', type: OptionType.PUT }),
    ];
    const target = [
      makeContract({ contractID: 'C', mark: '12.00', type: OptionType.CALL }),
      makeContract({ contractID: 'P', mark: '12.00', type: OptionType.PUT }),
    ];
    const grid = computePctChange(start, target, START_DATE, TARGET_DATE, CALL_FILTER);
    expect(grid.cells.size).toBe(1);
    expect(grid.cells.has(cellKey(100, '2024-03-15'))).toBe(true);
  });

  it('filters by type=put — only put contracts retained', () => {
    const start = [
      makeContract({ contractID: 'C', mark: '10.00', type: OptionType.CALL }),
      makeContract({ contractID: 'P', mark: '10.00', type: OptionType.PUT }),
    ];
    const target = [
      makeContract({ contractID: 'C', mark: '12.00', type: OptionType.CALL }),
      makeContract({ contractID: 'P', mark: '12.00', type: OptionType.PUT }),
    ];
    const grid = computePctChange(start, target, START_DATE, TARGET_DATE, { type: OptionType.PUT });
    expect(grid.cells.size).toBe(1);
    expect(grid.cells.has(cellKey(100, '2024-03-15'))).toBe(true);
  });

  it('filters by duration range — only matching expirations retained', () => {
    const start = [
      makeContract({ contractID: 'A', mark: '10.00', expiration: '2024-01-20' }),
      makeContract({ contractID: 'B', mark: '10.00', expiration: '2024-06-15' }),
    ];
    const target = [
      makeContract({ contractID: 'A', mark: '12.00', expiration: '2024-01-20' }),
      makeContract({ contractID: 'B', mark: '12.00', expiration: '2024-06-15' }),
    ];
    const grid = computePctChange(start, target, START_DATE, TARGET_DATE, {
      type: OptionType.CALL,
      durationGteDays: 30,
      durationLteDays: 180,
    });
    expect(grid.cells.size).toBe(1);
    expect(grid.cells.has(cellKey(100, '2024-06-15'))).toBe(true);
  });

  it('filters by strike range — only matching strikes retained', () => {
    const start = [
      makeContract({ contractID: 'A', mark: '10.00', strike: '50' }),
      makeContract({ contractID: 'B', mark: '10.00', strike: '150' }),
    ];
    const target = [
      makeContract({ contractID: 'A', mark: '12.00', strike: '50' }),
      makeContract({ contractID: 'B', mark: '12.00', strike: '150' }),
    ];
    const grid = computePctChange(start, target, START_DATE, TARGET_DATE, {
      type: OptionType.CALL,
      strikeGte: 100,
      strikeLte: 200,
    });
    expect(grid.cells.size).toBe(1);
    expect(grid.cells.has(cellKey(150, '2024-03-15'))).toBe(true);
  });

  it('filters by delta range on absolute value of delta', () => {
    const start = [
      makeContract({ contractID: 'A', mark: '10.00', delta: '0.3' }),
      makeContract({ contractID: 'B', mark: '10.00', delta: '-0.8' }),
    ];
    const target = [
      makeContract({ contractID: 'A', mark: '12.00', delta: '0.3' }),
      makeContract({ contractID: 'B', mark: '12.00', delta: '-0.8' }),
    ];
    const grid = computePctChange(start, target, START_DATE, TARGET_DATE, {
      type: OptionType.CALL,
      deltaGte: 0.5,
      deltaLte: 1.0,
    });
    expect(grid.cells.size).toBe(1);
    expect(grid.cells.has(cellKey(100, '2024-03-15'))).toBe(true);
  });

  it('excludes contracts with missing delta when a delta filter is set', () => {
    const start = [makeContract({ contractID: 'A', mark: '10.00', delta: undefined })];
    const target = [makeContract({ contractID: 'A', mark: '12.00', delta: undefined })];
    const grid = computePctChange(start, target, START_DATE, TARGET_DATE, {
      type: OptionType.CALL,
      deltaGte: 0.5,
    });
    expect(grid.cells.size).toBe(0);
  });

  it('retains contracts with missing delta when no delta filter is set', () => {
    const start = [makeContract({ contractID: 'A', mark: '10.00', delta: undefined })];
    const target = [makeContract({ contractID: 'A', mark: '12.00', delta: undefined })];
    const grid = computePctChange(start, target, START_DATE, TARGET_DATE, CALL_FILTER);
    expect(grid.cells.size).toBe(1);
    const cell = grid.cells.get(cellKey(100, '2024-03-15'))!;
    expect(cell.delta).toBeNull();
  });

  it('with no filters — all matching contracts retained', () => {
    const start = [
      makeContract({ contractID: 'A', mark: '10.00', strike: '50' }),
      makeContract({ contractID: 'B', mark: '10.00', strike: '150' }),
    ];
    const target = [
      makeContract({ contractID: 'A', mark: '12.00', strike: '50' }),
      makeContract({ contractID: 'B', mark: '12.00', strike: '150' }),
    ];
    const grid = computePctChange(start, target, START_DATE, TARGET_DATE, CALL_FILTER);
    expect(grid.cells.size).toBe(2);
  });

  it('sorts strikes ascending in output', () => {
    const start = [
      makeContract({ contractID: 'A', mark: '10.00', strike: '150' }),
      makeContract({ contractID: 'B', mark: '10.00', strike: '50' }),
      makeContract({ contractID: 'C', mark: '10.00', strike: '100' }),
    ];
    const target = [
      makeContract({ contractID: 'A', mark: '12.00', strike: '150' }),
      makeContract({ contractID: 'B', mark: '12.00', strike: '50' }),
      makeContract({ contractID: 'C', mark: '12.00', strike: '100' }),
    ];
    const grid = computePctChange(start, target, START_DATE, TARGET_DATE, CALL_FILTER);
    expect(grid.strikes).toEqual([50, 100, 150]);
  });

  it('sorts expirations ascending in output', () => {
    const start = [
      makeContract({ contractID: 'A', mark: '10.00', expiration: '2024-06-15' }),
      makeContract({ contractID: 'B', mark: '10.00', expiration: '2024-01-20' }),
      makeContract({ contractID: 'C', mark: '10.00', expiration: '2024-03-15' }),
    ];
    const target = [
      makeContract({ contractID: 'A', mark: '12.00', expiration: '2024-06-15' }),
      makeContract({ contractID: 'B', mark: '12.00', expiration: '2024-01-20' }),
      makeContract({ contractID: 'C', mark: '12.00', expiration: '2024-03-15' }),
    ];
    const grid = computePctChange(start, target, START_DATE, TARGET_DATE, CALL_FILTER);
    expect(grid.expirations).toEqual(['2024-01-20', '2024-03-15', '2024-06-15']);
  });

  it('computes p5/p95 percentiles correctly from the pctChange distribution', () => {
    const start: HistoricalOptionContract[] = [];
    const target: HistoricalOptionContract[] = [];
    for (let i = 0; i < 20; i++) {
      const id = `C${i}`;
      const startPrice = 10;
      const targetPrice = 10 + i;
      start.push(makeContract({ contractID: id, mark: String(startPrice), strike: String(i) }));
      target.push(makeContract({ contractID: id, mark: String(targetPrice), strike: String(i) }));
    }
    const grid = computePctChange(start, target, START_DATE, TARGET_DATE, CALL_FILTER);
    // pctChange values are 0, 10, 20, ..., 190
    // p5 = 5th percentile of [0,10,...,190] = 9.5
    // p95 = 95th percentile of [0,10,...,190] = 180.5
    expect(grid.p5).toBeCloseTo(9.5, 1);
    expect(grid.p95).toBeCloseTo(180.5, 1);
  });

  it('handles empty input chains without crashing', () => {
    const grid = computePctChange([], [], START_DATE, TARGET_DATE, CALL_FILTER);
    expect(grid.cells.size).toBe(0);
    expect(grid.strikes).toEqual([]);
    expect(grid.expirations).toEqual([]);
    expect(grid.p5).toBe(0);
    expect(grid.p95).toBe(0);
  });

  it('handles all contracts excluded by filters without crashing', () => {
    const start = [makeContract({ contractID: 'A', mark: '10.00', strike: '50' })];
    const target = [makeContract({ contractID: 'A', mark: '12.00', strike: '50' })];
    const grid = computePctChange(start, target, START_DATE, TARGET_DATE, {
      type: OptionType.CALL,
      strikeGte: 200,
    });
    expect(grid.cells.size).toBe(0);
    expect(grid.strikes).toEqual([]);
    expect(grid.expirations).toEqual([]);
  });

  it('computes durationDays from start to target date', () => {
    const grid = computePctChange([], [], '2024-01-15', '2024-02-15', CALL_FILTER);
    expect(grid.durationDays).toBe(31);
  });

  it('handles same start and target date — all pctChange = 0', () => {
    const start = [makeContract({ contractID: 'A', mark: '10.00' })];
    const target = [makeContract({ contractID: 'A', mark: '10.00' })];
    const grid = computePctChange(start, target, START_DATE, START_DATE, CALL_FILTER);
    const cell = grid.cells.get(cellKey(100, '2024-03-15'))!;
    expect(cell.pctChange).toBe(0);
  });

  it('handles negative pctChange (price dropped)', () => {
    const start = [makeContract({ contractID: 'A', mark: '10.00' })];
    const target = [makeContract({ contractID: 'A', mark: '5.00' })];
    const grid = computePctChange(start, target, START_DATE, TARGET_DATE, CALL_FILTER);
    const cell = grid.cells.get(cellKey(100, '2024-03-15'))!;
    expect(cell.pctChange).toBe(-50);
  });

  it('produces a single 1x1 grid for a single contract', () => {
    const start = [makeContract({ contractID: 'A', mark: '10.00' })];
    const target = [makeContract({ contractID: 'A', mark: '12.00' })];
    const grid = computePctChange(start, target, START_DATE, TARGET_DATE, CALL_FILTER);
    expect(grid.strikes.length).toBe(1);
    expect(grid.expirations.length).toBe(1);
    expect(grid.cells.size).toBe(1);
  });
});
