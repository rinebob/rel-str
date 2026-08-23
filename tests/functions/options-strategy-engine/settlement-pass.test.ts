/**
 *
 * Unit tests for the settlement pass: settles OPEN positions whose primary leg
 * expires on the run date. Outcome (assigned vs worthless) is determined by
 * querying the brokerage, not by computing it from the underlying close.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runSettlementPass } from '../../../functions/src/options-strategy-engine/passes/settlement-pass';
import type {
  SettlementPassDependencies,
} from '../../../functions/src/options-strategy-engine/passes/settlement-pass';
import { OptionType, PositionSpreadType, StrategyFrequency } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import { ExitPolicy, LifecycleState, type StrategyInstanceConfig } from '../../../shared/options-strategy-engine-contracts';
import type { Position, PositionLeg, DailyUpdate, SettlementData, LegOutcomeUpdate } from '../../../functions/src/options-strategy-engine/types';
import { PositionStatus } from '../../../functions/src/options-strategy-engine/types';

function makeConfig(
  overrides: Partial<StrategyInstanceConfig> = {},
): StrategyInstanceConfig {
  return {
    id: 'inst-1',
    symbol: 'SPY',
    optionType: OptionType.PUT,
    side: TradeSide.SHORT,
    dteMin: 2,
    dteMax: 5,
    targetDelta: 0.3,
    phases: [
      {
        spreadType: PositionSpreadType.CASH_SECURED_PUT,
        targetDelta: 0.3,
        dteMin: 2,
        dteMax: 5,
      },
    ],
    frequency: StrategyFrequency.DAILY,
    openTimePT: '12:00',
    exitPolicies: [{ policy: ExitPolicy.HOLD_TO_EXPIRATION }],
    lifecycleState: LifecycleState.ACTIVE,
    userId: 'test-user',
    createdAt: '2025-08-16T00:00:00Z',
    updatedAt: '2025-08-16T00:00:00Z',
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
  checkBrokerageOutcome?: (config: StrategyInstanceConfig, leg: PositionLeg, position: Position) => Promise<{ assigned: boolean; sharesQuantity?: number }>;
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
    checkBrokerageOutcome:
      overrides.checkBrokerageOutcome ?? (async () => ({ assigned: false })),
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
    assert.equal(result.errors.length, 0);
  });

  it('settles as EXPIRED_WORTHLESS when brokerage reports no assignment', async () => {
    const deps = makeSettlementDeps({
      listOpenPositions: async () => [makePosition()],
      getLegs: async () => [makeLeg({ expiration: '2025-08-17', strike: 100 })],
      getUnderlyingClose: async () => 100,
      checkBrokerageOutcome: async () => ({ assigned: false }),
    });

    const result = await runSettlementPass('inst-1', '2025-08-17', makeConfig(), deps);

    assert.equal(result.settled.length, 1);
    assert.equal(result.errors.length, 0);

    const settled = result.settled[0];
    assert.equal(settled.positionId, 'inst-1-2025-08-15');
    assert.equal(settled.outcome, 'EXPIRED_WORTHLESS');
    assert.equal(settled.strike, 100);
    assert.equal(settled.underlyingClose, 100);
    assert.equal(settled.currentValue, 0);
    assert.equal(settled.unrealizedPnl, 50); // full premium retained

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
    assert.deepEqual(call.dailyUpdate, { date: '2025-08-17', underlyingClose: 100 });
  });

  it('settles as ASSIGNED_HOLDING_SHARES when brokerage reports assignment', async () => {
    const deps = makeSettlementDeps({
      listOpenPositions: async () => [makePosition()],
      getLegs: async () => [makeLeg({ expiration: '2025-08-17', strike: 100 })],
      getUnderlyingClose: async () => 98,
      checkBrokerageOutcome: async () => ({ assigned: true, sharesQuantity: 1 }),
    });

    const result = await runSettlementPass('inst-1', '2025-08-17', makeConfig(), deps);

    assert.equal(result.settled.length, 1);
    assert.equal(result.errors.length, 0);

    const settled = result.settled[0];
    assert.equal(settled.outcome, 'ASSIGNED_HOLDING_SHARES');
    assert.equal(settled.strike, 100);
    assert.equal(settled.underlyingClose, 98);
    assert.equal(settled.currentValue, 9800); // 98 * 100 * 1
    assert.equal(settled.unrealizedPnl, -200); // (98 - 100) * 100 * 1

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
    assert.deepEqual(call.settlement.shares, { quantity: 1, costBasis: 100 });
    assert.deepEqual(call.legOutcomes, [
      { legId: 'PUT-100.00-2025-08-17', outcome: 'ASSIGNED', closeDate: '2025-08-17' },
    ]);
    assert.deepEqual(call.dailyUpdate, { date: '2025-08-17', underlyingClose: 98 });
  });

  it('errors when underlying closing bar is missing', async () => {
    const deps = makeSettlementDeps({
      listOpenPositions: async () => [makePosition()],
      getLegs: async () => [makeLeg({ expiration: '2025-08-17', strike: 100 })],
      getUnderlyingClose: async () => null,
      checkBrokerageOutcome: async () => ({ assigned: false }),
    });

    const result = await runSettlementPass('inst-1', '2025-08-17', makeConfig(), deps);

    assert.equal(result.settled.length, 0);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].error.includes('No underlying closing bar'));
  });

  it('errors for unsupported leg types', async () => {
    const deps = makeSettlementDeps({
      listOpenPositions: async () => [makePosition()],
      getLegs: async () => [makeLeg({ type: OptionType.CALL as any, expiration: '2025-08-17' })],
      getUnderlyingClose: async () => 100,
      checkBrokerageOutcome: async () => ({ assigned: false }),
    });

    const result = await runSettlementPass('inst-1', '2025-08-17', makeConfig(), deps);

    assert.equal(result.settled.length, 0);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].error.includes('not implemented'));
  });

  it('skips positions not expiring on the run date', async () => {
    const deps = makeSettlementDeps({
      listOpenPositions: async () => [makePosition()],
      getLegs: async () => [makeLeg({ expiration: '2025-08-20' })],
      getUnderlyingClose: async () => 100,
      checkBrokerageOutcome: async () => ({ assigned: false }),
    });

    const result = await runSettlementPass('inst-1', '2025-08-17', makeConfig(), deps);

    assert.equal(result.settled.length, 0);
    assert.equal(result.errors.length, 0);
  });
});
