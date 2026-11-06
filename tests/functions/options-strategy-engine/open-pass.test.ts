import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runOpenPass } from '../../../functions/src/options-strategy-engine/passes/open-pass';
import type { OpenPassResult } from '../../../functions/src/options-strategy-engine/passes/open-pass';
import { OptionType, OptionQuoteSource, PositionSpreadType, StrategyFrequency } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import { ExitPolicy, LifecycleState, type StrategyInstanceConfig, type OvernightDeltaSimulation } from '../../../shared/options-strategy-engine-contracts';
import type { Position, PositionLeg, RawQuote } from '../../../functions/src/options-strategy-engine/types';
import { PositionStatus } from '../../../functions/src/options-strategy-engine/types';
import type {
  EmitStOrderTicketInput,
  StTicketTransitionResult,
} from '../../../functions/src/order-tickets/st-order-ticket-writer';
import type { StMode } from '../../../shared/st-types';

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
      listInstancePositions: async () => [],
      createPosition: async () => ({}) as Position,
      writeOpenPassResult: async () => {},
    });

    assert.equal(result, null);
  });

  it('opens a new position while a prior-day position remains open (daily ladder, #1247)', async () => {
    const result = await runOpenPass('inst-1', '2025-08-15', makeConfig(), 101, {
      readDailyAnalysis: async () => makeSimulation(),
      listInstancePositions: async () => [
        {
          id: 'inst-1-2025-08-14',
          instanceId: 'inst-1',
          openDate: '2025-08-14',
          status: PositionStatus.OPEN,
        } as Position,
      ],
      getPosition: async () => null,
      createPosition: async (position) =>
        ({ id: 'inst-1-2025-08-15', ...position }) as Position,
      writeOpenPassResult: async () => {},
    });

    assert.ok(result);
    assert.equal(result.skipped, false);
    assert.equal(result.skipReason, null);
    assert.equal(result.positionId, 'inst-1-2025-08-15');
  });

  it('skips when a position was already opened today (same-day retry)', async () => {
    const written: OpenPassResult[] = [];
    const result = await runOpenPass('inst-1', '2025-08-15', makeConfig(), 101, {
      readDailyAnalysis: async () => makeSimulation(),
      listInstancePositions: async () => [
        {
          id: 'inst-1-2025-08-15',
          instanceId: 'inst-1',
          openDate: '2025-08-15',
          status: PositionStatus.OPEN,
        } as Position,
      ],
      createPosition: async () => {
        throw new Error('should not create position');
      },
      writeOpenPassResult: async (_iid, _date, r) => {
        written.push(r);
      },
    });

    assert.ok(result);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, 'already_opened_today');
    // The skip result carries the blocking leg's id — a same-day retry
    // must not erase the opened position's id from the latest-doc record.
    assert.equal(result.positionId, 'inst-1-2025-08-15');
    assert.equal(result.contractID, 'SPY250817P00100000');
    assert.equal(result.baseUnderlyingPrice, 100);
    assert.equal(result.currentUnderlyingPrice, 101);
    assert.equal(written.length, 1);
    assert.equal(written[0].skipped, true);
  });

  it('skips when open positions reach maxOpenPositions', async () => {
    const result = await runOpenPass(
      'inst-1',
      '2025-08-15',
      makeConfig({ maxOpenPositions: 1 }),
      101,
      {
        readDailyAnalysis: async () => makeSimulation(),
        listInstancePositions: async () => [
          {
            id: 'inst-1-2025-08-14',
            instanceId: 'inst-1',
            openDate: '2025-08-14',
            status: PositionStatus.OPEN,
          } as Position,
        ],
        createPosition: async () => {
          throw new Error('should not create position');
        },
        writeOpenPassResult: async () => {},
      },
    );

    assert.ok(result);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, 'max_open_positions');
    assert.equal(result.positionId, null);
  });

  it('opens when open count is below maxOpenPositions', async () => {
    const result = await runOpenPass(
      'inst-1',
      '2025-08-15',
      makeConfig({ maxOpenPositions: 2 }),
      101,
      {
        readDailyAnalysis: async () => makeSimulation(),
        listInstancePositions: async () => [
          {
            id: 'inst-1-2025-08-14',
            instanceId: 'inst-1',
            openDate: '2025-08-14',
            status: PositionStatus.OPEN,
          } as Position,
        ],
        getPosition: async () => null,
        createPosition: async (position) =>
          ({ id: 'inst-1-2025-08-15', ...position }) as Position,
        writeOpenPassResult: async () => {},
      },
    );

    assert.ok(result);
    assert.equal(result.skipped, false);
    assert.equal(result.positionId, 'inst-1-2025-08-15');
  });

  it('closed positions do not count toward maxOpenPositions (#1247 r1)', async () => {
    const result = await runOpenPass(
      'inst-1',
      '2025-08-15',
      makeConfig({ maxOpenPositions: 1 }),
      101,
      {
        readDailyAnalysis: async () => makeSimulation(),
        listInstancePositions: async () => [
          {
            id: 'inst-1-2025-08-10',
            instanceId: 'inst-1',
            openDate: '2025-08-10',
            status: PositionStatus.CLOSED,
          } as Position,
        ],
        getPosition: async () => null,
        createPosition: async (position) =>
          ({ id: 'inst-1-2025-08-15', ...position }) as Position,
        writeOpenPassResult: async () => {},
      },
    );

    assert.ok(result);
    assert.equal(result.skipped, false);
    assert.equal(result.positionId, 'inst-1-2025-08-15');
  });

  it('weekly instance skips when a position opened within the last 7 days', async () => {
    const result = await runOpenPass(
      'inst-1',
      '2025-08-15',
      makeConfig({ frequency: StrategyFrequency.WEEKLY }),
      101,
      {
        readDailyAnalysis: async () => makeSimulation(),
        listInstancePositions: async () => [
          {
            id: 'inst-1-2025-08-11',
            instanceId: 'inst-1',
            openDate: '2025-08-11',
            status: PositionStatus.OPEN,
          } as Position,
        ],
        createPosition: async () => {
          throw new Error('should not create position');
        },
        writeOpenPassResult: async () => {},
      },
    );

    assert.ok(result);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, 'already_opened_in_period');
  });

  it('weekly instance skips when the in-period leg already closed (#1247 r1)', async () => {
    // A leg that opened Monday and expired/assigned by Thursday still
    // consumed the week's cadence slot — cadence anchors to openDate
    // across ALL positions, not just survivors.
    const result = await runOpenPass(
      'inst-1',
      '2025-08-15',
      makeConfig({ frequency: StrategyFrequency.WEEKLY }),
      101,
      {
        readDailyAnalysis: async () => makeSimulation(),
        listInstancePositions: async () => [
          {
            id: 'inst-1-2025-08-11',
            instanceId: 'inst-1',
            openDate: '2025-08-11',
            status: PositionStatus.EXPIRED_WORTHLESS,
          } as Position,
        ],
        createPosition: async () => {
          throw new Error('should not create position');
        },
        writeOpenPassResult: async () => {},
      },
    );

    assert.ok(result);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, 'already_opened_in_period');
    assert.equal(result.positionId, 'inst-1-2025-08-11');
  });

  it('a same-day closed leg still blocks a retry cleanly (#1247 r1)', async () => {
    // Without the all-positions cadence read, a same-day early close is
    // invisible to the gate and the retry would collide at createPosition.
    const result = await runOpenPass('inst-1', '2025-08-15', makeConfig(), 101, {
      readDailyAnalysis: async () => makeSimulation(),
      listInstancePositions: async () => [
        {
          id: 'inst-1-2025-08-15',
          instanceId: 'inst-1',
          openDate: '2025-08-15',
          status: PositionStatus.CLOSED,
        } as Position,
      ],
      createPosition: async () => {
        throw new Error('should not create position');
      },
      writeOpenPassResult: async () => {},
    });

    assert.ok(result);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, 'already_opened_today');
    assert.equal(result.positionId, 'inst-1-2025-08-15');
  });

  it('skips cleanly when the position doc already exists before ordering (#1247 r1)', async () => {
    // Concurrent-invocation backstop: the cadence list read went stale —
    // the deterministic-ID check must fire BEFORE the brokerage order.
    const calls: string[] = [];
    const result = await runOpenPass('inst-1', '2025-08-15', makeConfig(), 101, {
      readDailyAnalysis: async () => makeSimulation(),
      listInstancePositions: async () => [],
      getPosition: async (id) => {
        calls.push(`getPosition:${id}`);
        return { id } as Position;
      },
      placeBrokerageOrder: async () => {
        calls.push('placeOrder');
        return { orderId: 'x', fillPrice: 0.5 };
      },
      createPosition: async () => {
        throw new Error('should not create position');
      },
      writeOpenPassResult: async () => {},
    });

    assert.ok(result);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, 'already_opened_today');
    assert.equal(result.positionId, '250815-SPY-CSP-030-5-D-1200');
    assert.deepEqual(calls, ['getPosition:250815-SPY-CSP-030-5-D-1200']);
  });

  it('weekly instance opens when the last open was 7 days ago', async () => {
    const result = await runOpenPass(
      'inst-1',
      '2025-08-15',
      makeConfig({ frequency: StrategyFrequency.WEEKLY }),
      101,
      {
        readDailyAnalysis: async () => makeSimulation(),
        listInstancePositions: async () => [
          {
            id: 'inst-1-2025-08-08',
            instanceId: 'inst-1',
            openDate: '2025-08-08',
            status: PositionStatus.OPEN,
          } as Position,
        ],
        getPosition: async () => null,
        createPosition: async (position) =>
          ({ id: 'inst-1-2025-08-15', ...position }) as Position,
        writeOpenPassResult: async () => {},
      },
    );

    assert.ok(result);
    assert.equal(result.skipped, false);
    assert.equal(result.positionId, 'inst-1-2025-08-15');
  });

  it('skips when maxOvernightMovePct is exceeded', async () => {
    const result = await runOpenPass(
      'inst-1',
      '2025-08-15',
      makeConfig({ maxOvernightMovePct: 0.01 }),
      103,
      {
        readDailyAnalysis: async () => makeSimulation(),
        listInstancePositions: async () => [],
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
      listInstancePositions: async () => [],
      getPosition: async () => null,
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
        listInstancePositions: async () => [],
        getPosition: async () => null,
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
      listInstancePositions: async () => [],
      getPosition: async () => null,
      createPosition: async (position) => ({ id: 'inst-1-2025-08-15', ...position } as Position),
      writeOpenPassResult: async () => {},
    });

    assert.ok(result);
    assert.equal(result.nearestGridPoint.underlyingPrice, 98.5);
    assert.equal(result.nearestGridPoint.mark, 1.00);
    assert.ok(Math.abs(result.actualOvernightMovePct - (-0.015)) < 0.001);
  });
});

// ── #1002 — canonical st-order-tickets emission ────────────────────────────

type TicketEmitCall = EmitStOrderTicketInput;

function spyTickets(calls: string[]) {
  const emits: TicketEmitCall[] = [];
  const fills: { id: string; averagePrice: number }[] = [];
  const fails: { id: string; category: string }[] = [];
  return {
    emits,
    fills,
    fails,
    dep: {
      emit: async (input: TicketEmitCall) => {
        calls.push('emit');
        emits.push(input);
        return `${input.mode === 'live' ? 'liv' : 'pap'}_${input.idSeed}`;
      },
      markFilled: async (id: string, fill: { averagePrice: number; filledQty: number; filledAt: string }): Promise<StTicketTransitionResult> => {
        calls.push('markFilled');
        fills.push({ id, averagePrice: fill.averagePrice });
        return { applied: true, ticketId: id, to: 'filled' };
      },
      markFailed: async (id: string, error: { category: string; message: string }): Promise<StTicketTransitionResult> => {
        calls.push('markFailed');
        fails.push({ id, category: error.category });
        return { applied: true, ticketId: id, to: 'failed' };
      },
    },
  };
}

const ticketDeps = (calls: string[]) => {
  const spy = spyTickets(calls);
  return {
    spy,
    deps: {
      readDailyAnalysis: async () => makeSimulation(),
      listInstancePositions: async () => [],
      getPosition: async () => null,
      createPosition: async (position: Omit<Position, 'id'>) =>
        ({ id: 'inst-1-2025-08-15', ...position }) as Position,
      writeOpenPassResult: async () => {},
      tickets: spy.dep,
    },
  };
};

describe('runOpenPass — st-order-tickets emission (#1002)', () => {
  it('stages a program/auto/paper ticket BEFORE the brokerage order, marks it filled', async () => {
    const calls: string[] = [];
    const { deps, spy } = ticketDeps(calls);
    const result = await runOpenPass('inst-1', '2025-08-15', makeConfig(), 101, deps);

    assert.ok(result);
    assert.deepEqual(calls, ['emit', 'markFilled']);
    assert.equal(spy.emits.length, 1);
    const t = spy.emits[0];
    assert.equal(t.mode, 'paper', 'legacy instance has no mode → paper');
    assert.equal(t.auto, true);
    assert.deepEqual(t.origin, { type: 'program', instanceId: 'inst-1' });
    assert.equal(t.idSeed, '250815-SPY-CSP-030-5-D-1200', 'idSeed = deterministic positionId');
    assert.equal(t.terms.symbol, 'SPY');
    assert.equal(t.terms.side, 'sell', 'SHORT strategy sells the option');
    assert.equal(t.terms.instrument, 'option');
    assert.equal(t.terms.quantity, 1);
    assert.equal(t.accountTarget, 'acct-test-user');
    assert.equal(t.userId, 'test-user');
    // fill stamped from the brokerage order's fill price (stub returns mark)
    assert.equal(spy.fills.length, 1);
    assert.equal(spy.fills[0].id, 'pap_250815-SPY-CSP-030-5-D-1200');
    assert.equal(spy.fills[0].averagePrice, 0.5);
  });

  it('emits a liv_ ticket when the instance carries mode: live', async () => {
    const calls: string[] = [];
    const { deps, spy } = ticketDeps(calls);
    // Post-#1006 the canonical st-strategy-instances doc carries `mode`.
    const liveConfig = makeConfig() as StrategyInstanceConfig & { mode?: StMode };
    liveConfig.mode = 'live';
    await runOpenPass('inst-1', '2025-08-15', liveConfig, 101, deps);
    assert.equal(spy.emits[0].mode, 'live');
    assert.equal(spy.fills[0].id, 'liv_250815-SPY-CSP-030-5-D-1200');
  });

  it('emits nothing on a same-day retry skip (already opened today)', async () => {
    const calls: string[] = [];
    const spy = spyTickets(calls);
    const result = await runOpenPass('inst-1', '2025-08-15', makeConfig(), 101, {
      readDailyAnalysis: async () => makeSimulation(),
      listInstancePositions: async () => [
        {
          id: 'existing',
          openDate: '2025-08-15',
          status: PositionStatus.OPEN,
        } as Position,
      ],
      writeOpenPassResult: async () => {},
      tickets: spy.dep,
    });
    assert.equal(result?.skipped, true);
    assert.equal(result?.skipReason, 'already_opened_today');
    assert.equal(spy.emits.length, 0);
  });

  it('marks the ticket failed when the brokerage order throws', async () => {
    const calls: string[] = [];
    const spy = spyTickets(calls);
    await assert.rejects(
      runOpenPass('inst-1', '2025-08-15', makeConfig(), 101, {
        readDailyAnalysis: async () => makeSimulation(),
        listInstancePositions: async () => [],
        getPosition: async () => null,
        placeBrokerageOrder: async () => {
          throw new Error('broker down');
        },
        createPosition: async (position: Omit<Position, 'id'>) => ({ id: 'x', ...position }) as Position,
        writeOpenPassResult: async () => {},
        tickets: spy.dep,
      }),
      /broker down/,
    );
    assert.equal(spy.fails.length, 1);
    assert.equal(spy.fails[0].category, 'program-fill');
    assert.equal(spy.fills.length, 0);
  });

  it('marks the ticket failed when createPosition throws', async () => {
    const calls: string[] = [];
    const spy = spyTickets(calls);
    await assert.rejects(
      runOpenPass('inst-1', '2025-08-15', makeConfig(), 101, {
        readDailyAnalysis: async () => makeSimulation(),
        listInstancePositions: async () => [],
        getPosition: async () => null,
        createPosition: async () => {
          throw new Error('firestore write failed');
        },
        writeOpenPassResult: async () => {},
        tickets: spy.dep,
      }),
      /firestore write failed/,
    );
    assert.equal(spy.fails.length, 1);
  });
});
