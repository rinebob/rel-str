/**
 *
 * Unit tests for the settlement pass: settles OPEN positions whose primary leg
 * expires on the run date into EXPIRED_WORTHLESS or ASSIGNED_HOLDING_SHARES.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runSettlementPass } from '../../../functions/src/options-strategy-engine/passes/settlement-pass';
import type {
  SettlementPassDependencies,
} from '../../../functions/src/options-strategy-engine/passes/settlement-pass';
import { OptionType } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import type { StrategyInstanceConfig } from '../../../shared/options-strategy-engine-contracts';
import type { Position, PositionLeg, DailyUpdate, SettlementData, LegOutcomeUpdate } from '../../../functions/src/options-strategy-engine/types';
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
    ...overrides,
  };
}

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'inst-1-2025-08-15',
    instanceId: 'inst-1',
    symbol: 'SPY',
    status: PositionStatus.OPEN,
    premiumCollected: 50,
    capitalRequired: 10000,
    openDate: '2025-08-15',
    currentValue: 40,
    currentValueAsOf: '2025-08-16T18:00:00Z',
    unrealizedPnl: 10,
    ...overrides,
  };
}

function makeLeg(overrides: Partial<PositionLeg> = {}): PositionLeg {
  return {
    id: 'PUT-100.00-2025-08-17',
    type: OptionType.PUT,
    side: TradeSide.SHORT,
    strike: 100,
    expiration: '2025-08-17',
    openDate: '2025-08-15',
    contractID: 'SPY250817P00100000',
    premium: 0.50,
    ...overrides,
  };
}

interface SettlementCall {
  positionId: string;
  settlement: SettlementData;
  legOutcomes: LegOutcomeUpdate[];
  dailyUpdate?: DailyUpdate;
}

function makeSettlementDeps(overrides: {
  listOpenPositions?: (instanceId: string) => Promise<Position[]>;
  getLegs?: (positionId: string) => Promise<PositionLeg[]>;
  getUnderlyingClose?: (symbol: string, date: string) => Promise<number | null>;
  markPositionSettled?: (
    positionId: string,
    settlement: SettlementData,
    legOutcomes: LegOutcomeUpdate[],
    dailyUpdate?: DailyUpdate,
  ) => Promise<void>;
} = {}): SettlementPassDependencies & {
  settleCalls: SettlementCall[];
} {
  const settleCalls: SettlementCall[] = [];
  return {
    listOpenPositions: overrides.listOpenPositions ?? (async () => [makePosition()]),
    getLegs: overrides.getLegs ?? (async () => [makeLeg()]),
    getUnderlyingClose:
      overrides.getUnderlyingClose ?? (async () => 98),
    markPositionSettled:
      overrides.markPositionSettled ??
      (async (
        positionId: string,
        settlement: SettlementData,
        legOutcomes: LegOutcomeUpdate[],
        dailyUpdate?: DailyUpdate,
      ) => {
        settleCalls.push({ positionId, settlement, legOutcomes, dailyUpdate });
      }),
    settleCalls,
  };
}

describe('runSettlementPass', () => {
  it('returns empty result when no open positions', async () => {
    const deps = makeSettlementDeps({
      listOpenPositions: async () => [],
    });

    const result = await runSettlementPass('inst-1', '2025-08-17', makeConfig(), deps);

    assert.equal(result.instanceId, 'inst-1');
    assert.equal(result.date, '2025-08-17');
    assert.equal(result.settled.length, 0);
    assert.equal(result.deferred.length, 0);
    assert.equal(result.errors.length, 0);
  });

  it('settles an OTM short put as EXPIRED_WORTHLESS, retaining full premium', async () => {
    // strike 100, underlying closes at 100 -> 100 > 99.99 -> worthless
    const deps = makeSettlementDeps({
      listOpenPositions: async () => [makePosition()],
      getLegs: async () => [makeLeg({ expiration: '2025-08-17', strike: 100 })],
      getUnderlyingClose: async () => 100,
    });

    const result = await runSettlementPass('inst-1', '2025-08-17', makeConfig(), deps);

    assert.equal(result.settled.length, 1);
    assert.equal(result.deferred.length, 0);
    assert.equal(result.errors.length, 0);

    const settled = result.settled[0];
    assert.equal(settled.positionId, 'inst-1-2025-08-15');
    assert.equal(settled.outcome, 'EXPIRED_WORTHLESS');
    assert.equal(settled.strike, 100);
    assert.equal(settled.underlyingClose, 100);
    assert.equal(settled.currentValue, 0);
    assert.equal(settled.unrealizedPnl, 50); // full premium retained

    // markPositionSettled called once with worthless settlement, no shares/assignment
    assert.equal(deps.settleCalls.length, 1);
    const call = deps.settleCalls[0];
    assert.equal(call.positionId, 'inst-1-2025-08-15');
    assert.equal(call.settlement.status, 'EXPIRED_WORTHLESS');
    assert.equal(call.settlement.currentValue, 0);
    assert.equal(call.settlement.unrealizedPnl, 50);
    assert.equal(call.settlement.assignment, undefined);
    assert.equal(call.settlement.shares, undefined);
    assert.deepEqual(call.legOutcomes, [
      { legId: 'PUT-100.00-2025-08-17', outcome: 'EXPIRED_WORTHLESS', closeDate: '2025-08-17' },
    ]);

    // daily-updates/{date} written atomically with settlement, underlying close, no markPrice
    assert.deepEqual(call.dailyUpdate, { date: '2025-08-17', underlyingClose: 100 });
  });

  it('settles an ITM short put as ASSIGNED_HOLDING_SHARES with shares at strike cost basis', async () => {
    // strike 100, underlying closes at 98 -> 98 <= 99.99 -> assigned
    const deps = makeSettlementDeps({
      listOpenPositions: async () => [makePosition()],
      getLegs: async () => [makeLeg({ expiration: '2025-08-17', strike: 100 })],
      getUnderlyingClose: async () => 98,
    });

    const result = await runSettlementPass('inst-1', '2025-08-17', makeConfig(), deps);

    assert.equal(result.settled.length, 1);
    assert.equal(result.deferred.length, 0);
    assert.equal(result.errors.length, 0);

    const settled = result.settled[0];
    assert.equal(settled.outcome, 'ASSIGNED_HOLDING_SHARES');
    assert.equal(settled.strike, 100);
    assert.equal(settled.underlyingClose, 98);
    // currentValue = close * 100 * quantity (1 contract) = 9800
    assert.equal(settled.currentValue, 9800);
    // unrealizedPnl = (close - strike) * 100 * quantity = (98 - 100) * 100 = -200
    assert.equal(settled.unrealizedPnl, -200);

    assert.equal(deps.settleCalls.length, 1);
    const call = deps.settleCalls[0];
    assert.equal(call.settlement.status, 'ASSIGNED_HOLDING_SHARES');
    assert.equal(call.settlement.currentValue, 9800);
    assert.equal(call.settlement.unrealizedPnl, -200);
    assert.deepEqual(call.settlement.assignment, {
      strikePrice: 100,
      underlyingCloseAtExpiration: 98,
      assignedAt: '2025-08-17',
    });
    // quantity = contracts (1), costBasis = per-share strike
    assert.deepEqual(call.settlement.shares, { quantity: 1, costBasis: 100 });
    assert.deepEqual(call.legOutcomes, [
      { legId: 'PUT-100.00-2025-08-17', outcome: 'ASSIGNED', closeDate: '2025-08-17' },
    ]);

    // daily-updates/{date} written atomically with settlement
    assert.deepEqual(call.dailyUpdate, { date: '2025-08-17', underlyingClose: 98 });
  });

  it('treats underlying closing exactly at strike - 0.01 as assigned (auto-exercise threshold)', async () => {
    // strike 100, close 99.99 -> 99.99 <= 99.99 -> assigned
    const deps = makeSettlementDeps({
      listOpenPositions: async () => [makePosition()],
      getLegs: async () => [makeLeg({ expiration: '2025-08-17', strike: 100 })],
      getUnderlyingClose: async () => 99.99,
    });

    const result = await runSettlementPass('inst-1', '2025-08-17', makeConfig(), deps);

    assert.equal(result.settled.length, 1);
    assert.equal(result.settled[0].outcome, 'ASSIGNED_HOLDING_SHARES');
  });

  it('treats underlying closing just above strike - 0.01 as worthless (OTM side of threshold)', async () => {
    // strike 100, close 99.991 -> 99.991 > 99.99 -> worthless
    const deps = makeSettlementDeps({
      listOpenPositions: async () => [makePosition()],
      getLegs: async () => [makeLeg({ expiration: '2025-08-17', strike: 100 })],
      getUnderlyingClose: async () => 99.991,
    });

    const result = await runSettlementPass('inst-1', '2025-08-17', makeConfig(), deps);

    assert.equal(result.settled.length, 1);
    assert.equal(result.settled[0].outcome, 'EXPIRED_WORTHLESS');
  });

  it('defers settlement when no underlying closing bar is available for the date', async () => {
    const deps = makeSettlementDeps({
      listOpenPositions: async () => [makePosition()],
      getLegs: async () => [makeLeg({ expiration: '2025-08-17', strike: 100 })],
      getUnderlyingClose: async () => null,
    });

    const result = await runSettlementPass('inst-1', '2025-08-17', makeConfig(), deps);

    assert.equal(result.settled.length, 0);
    assert.equal(result.deferred.length, 1);
    assert.equal(result.deferred[0].positionId, 'inst-1-2025-08-15');
    assert.match(result.deferred[0].reason, /No underlying closing bar/);
    // Nothing written when deferred
    assert.equal(deps.settleCalls.length, 0);
  });

  it('skips positions whose leg does not expire on the run date', async () => {
    const deps = makeSettlementDeps({
      listOpenPositions: async () => [makePosition()],
      getLegs: async () => [makeLeg({ expiration: '2025-08-24', strike: 100 })],
      getUnderlyingClose: async () => 100,
    });

    const result = await runSettlementPass('inst-1', '2025-08-17', makeConfig(), deps);

    assert.equal(result.settled.length, 0);
    assert.equal(result.deferred.length, 0);
    assert.equal(result.errors.length, 0);
    assert.equal(deps.settleCalls.length, 0);
  });

  it('settles multiple expiring positions independently; one failure does not block the others', async () => {
    const posA = makePosition({ id: 'inst-1-2025-08-15', premiumCollected: 50 });
    const posB = makePosition({ id: 'inst-1-2025-08-14', premiumCollected: 30 });
    const deps = makeSettlementDeps({
      listOpenPositions: async () => [posA, posB],
      getLegs: async (positionId) => {
        if (positionId === 'inst-1-2025-08-15') {
          throw new Error('legs read failed');
        }
        return [makeLeg({ id: 'PUT-100.00-2025-08-17', expiration: '2025-08-17', strike: 100 })];
      },
      getUnderlyingClose: async () => 100,
    });

    const result = await runSettlementPass('inst-1', '2025-08-17', makeConfig(), deps);

    assert.equal(result.settled.length, 1);
    assert.equal(result.settled[0].positionId, 'inst-1-2025-08-14');
    assert.equal(result.settled[0].outcome, 'EXPIRED_WORTHLESS');
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].positionId, 'inst-1-2025-08-15');
    assert.match(result.errors[0].error, /legs read failed/);
  });
});
