import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runOpenPass } from '../../../functions/src/options-strategy-engine/passes/open-pass';
import type { OpenPassResult } from '../../../functions/src/options-strategy-engine/passes/open-pass';
import { OptionType, OptionQuoteSource } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import type {
  StrategyInstanceConfig,
  OvernightDeltaSimulation,
} from '../../../shared/options-strategy-engine-contracts';
import type { Position, PositionLeg, RawQuote } from '../../../functions/src/options-strategy-engine/types';
import { PositionStatus } from '../../../functions/src/options-strategy-engine/types';

function makeConfig(
  overrides: Partial<StrategyInstanceConfig> = {},
): StrategyInstanceConfig {
  return {
    symbol: 'SPY',
    optionType: OptionType.PUT,
    side: TradeSide.SHORT,
    dteMin: 2,
    dteMax: 5,
    targetDelta: 0.3,
    overnightGridRangePct: 0.025,
    overnightGridStepPct: 0.005,
    ...overrides,
  };
}

function makeSimulation(
  overrides: Partial<OvernightDeltaSimulation> = {},
): OvernightDeltaSimulation {
  return {
    baseUnderlyingPrice: 100,
    baseContractID: 'SPY250817P00100000',
    rangePct: 0.025,
    stepPct: 0.005,
    grid: [
      { underlyingMovePct: -0.025, underlyingPrice: 97.5, delta: -0.35, mark: 1.20, theta: -0.05 },
      { underlyingMovePct: -0.020, underlyingPrice: 98.0, delta: -0.33, mark: 1.10, theta: -0.05 },
      { underlyingMovePct: -0.015, underlyingPrice: 98.5, delta: -0.31, mark: 1.00, theta: -0.04 },
      { underlyingMovePct: -0.010, underlyingPrice: 99.0, delta: -0.29, mark: 0.90, theta: -0.04 },
      { underlyingMovePct: -0.005, underlyingPrice: 99.5, delta: -0.27, mark: 0.80, theta: -0.03 },
      { underlyingMovePct: 0.000, underlyingPrice: 100.0, delta: -0.25, mark: 0.70, theta: -0.03 },
      { underlyingMovePct: 0.005, underlyingPrice: 100.5, delta: -0.23, mark: 0.60, theta: -0.03 },
      { underlyingMovePct: 0.010, underlyingPrice: 101.0, delta: -0.21, mark: 0.50, theta: -0.02 },
      { underlyingMovePct: 0.015, underlyingPrice: 101.5, delta: -0.19, mark: 0.40, theta: -0.02 },
      { underlyingMovePct: 0.020, underlyingPrice: 102.0, delta: -0.17, mark: 0.30, theta: -0.02 },
      { underlyingMovePct: 0.025, underlyingPrice: 102.5, delta: -0.15, mark: 0.20, theta: -0.01 },
    ],
    computedAt: '2025-08-14T20:00:00.000Z',
    ...overrides,
  };
}

describe('runOpenPass', () => {
  it('returns null when no daily-analysis exists', async () => {
    const result = await runOpenPass('inst-1', '2025-08-15', makeConfig(), 101, {
      readDailyAnalysis: async () => null,
      listOpenPositions: async () => [],
      createPosition: async () => ({}) as Position,
      writeOpenPassResult: async () => {},
    });

    assert.equal(result, null);
  });

  it('skips when an existing open position is found', async () => {
    const written: OpenPassResult[] = [];
    const result = await runOpenPass('inst-1', '2025-08-15', makeConfig(), 101, {
      readDailyAnalysis: async () => makeSimulation(),
      listOpenPositions: async () => [
        { id: 'inst-1-2025-08-14', instanceId: 'inst-1' } as Position,
      ],
      createPosition: async () => ({}) as Position,
      writeOpenPassResult: async (_iid, _date, r) => { written.push(r); },
    });

    assert.ok(result);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, 'existing_position');
    assert.equal(result.positionId, null);
    assert.equal(result.contractID, 'SPY250817P00100000');
    assert.equal(result.baseUnderlyingPrice, 100);
    assert.equal(result.currentUnderlyingPrice, 101);
    assert.equal(written.length, 1);
    assert.equal(written[0].skipped, true);
  });

  it('skips when maxOvernightMovePct is exceeded', async () => {
    const result = await runOpenPass(
      'inst-1',
      '2025-08-15',
      makeConfig({ maxOvernightMovePct: 0.01 }),
      103,
      {
        readDailyAnalysis: async () => makeSimulation(),
        listOpenPositions: async () => [],
        createPosition: async () => ({}) as Position,
        writeOpenPassResult: async () => {},
      },
    );

    assert.ok(result);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, 'max_overnight_move_exceeded');
    assert.equal(result.positionId, null);
  });

  it('opens a position when no existing position and move is within bounds', async () => {
    const createdPositions: { position: Omit<Position, 'id'>; legs: PositionLeg[]; rawQuote: RawQuote }[] = [];
    const written: OpenPassResult[] = [];

    const result = await runOpenPass('inst-1', '2025-08-15', makeConfig(), 101, {
      readDailyAnalysis: async () => makeSimulation(),
      listOpenPositions: async () => [],
      createPosition: async (position, legs, rawQuote) => {
        createdPositions.push({ position, legs, rawQuote });
        return { id: 'inst-1-2025-08-15', ...position } as Position;
      },
      writeOpenPassResult: async (_iid, _date, r) => { written.push(r); },
    });

    assert.ok(result);
    assert.equal(result.skipped, false);
    assert.equal(result.skipReason, null);
    assert.equal(result.positionId, 'inst-1-2025-08-15');
    assert.equal(result.contractID, 'SPY250817P00100000');

    // Nearest grid point for price 101 is the +1.0% point (underlyingPrice=101.0)
    assert.equal(result.nearestGridPoint.underlyingPrice, 101.0);
    assert.equal(result.nearestGridPoint.mark, 0.50);

    // Actual overnight move: (101 - 100) / 100 = 0.01
    assert.equal(result.actualOvernightMovePct, 0.01);

    // Position created with correct fields
    assert.equal(createdPositions.length, 1);
    const { position, legs, rawQuote } = createdPositions[0];
    assert.equal(position.instanceId, 'inst-1');
    assert.equal(position.symbol, 'SPY');
    assert.equal(position.status, PositionStatus.OPEN);
    assert.equal(position.openDate, '2025-08-15');
    assert.equal(position.premiumCollected, 50); // 0.50 * 100 (SHORT)
    assert.equal(position.capitalRequired, 10000); // strike 100 * 100

    // Leg
    assert.equal(legs.length, 1);
    assert.equal(legs[0].contractID, 'SPY250817P00100000');
    assert.equal(legs[0].type, OptionType.PUT);
    assert.equal(legs[0].side, TradeSide.SHORT);
    assert.equal(legs[0].strike, 100);
    assert.equal(legs[0].premium, 0.50);

    // Raw quote
    assert.equal(rawQuote.date, '2025-08-15');

    // Result written
    assert.equal(written.length, 1);
    assert.equal(written[0].positionId, 'inst-1-2025-08-15');
  });

  it('does not apply maxOvernightMovePct when it is null', async () => {
    const result = await runOpenPass(
      'inst-1',
      '2025-08-15',
      makeConfig({ maxOvernightMovePct: null }),
      105,
      {
        readDailyAnalysis: async () => makeSimulation(),
        listOpenPositions: async () => [],
        createPosition: async (position) => ({ id: 'inst-1-2025-08-15', ...position } as Position),
        writeOpenPassResult: async () => {},
      },
    );

    assert.ok(result);
    assert.equal(result.skipped, false);
    // 5% move should be allowed when maxOvernightMovePct is null
    assert.ok(Math.abs(result.actualOvernightMovePct - 0.05) < 0.001);
  });

  it('selects nearest grid point correctly for a price below base', async () => {
    const result = await runOpenPass('inst-1', '2025-08-15', makeConfig(), 98.5, {
      readDailyAnalysis: async () => makeSimulation(),
      listOpenPositions: async () => [],
      createPosition: async (position) => ({ id: 'inst-1-2025-08-15', ...position } as Position),
      writeOpenPassResult: async () => {},
    });

    assert.ok(result);
    assert.equal(result.nearestGridPoint.underlyingPrice, 98.5);
    assert.equal(result.nearestGridPoint.mark, 1.00);
    assert.ok(Math.abs(result.actualOvernightMovePct - (-0.015)) < 0.001);
  });
});
