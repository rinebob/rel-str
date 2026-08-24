/**
 * @topic #108 — Options Position Strategy Engine
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spreadTypeToOptionSide } from '../../../functions/src/options-strategy-engine/options-strategy-passes';
import {
  runOptionsSelectionPass,
  runOptionsOpenPass,
  runMarkPassForAllInstances,
  runSettlementForAllInstances,
} from '../../../functions/src/options-strategy-engine/options-strategy-pass-orchestrators';
import { PositionSpreadType, StrategyFrequency, OptionType } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import { LifecycleState } from '../../../shared/options-strategy-engine-contracts';
import type { StrategyInstanceConfig } from '../../../functions/src/options-strategy-engine/types';

function makeInstance(overrides: Partial<StrategyInstanceConfig> = {}): StrategyInstanceConfig {
  return {
    id: 'TEST-WHEEL',
    symbol: 'QQQM',
    optionType: OptionType.PUT,
    side: TradeSide.SHORT,
    phases: [
      {
        spreadType: PositionSpreadType.CASH_SECURED_PUT,
        targetDelta: 0.2,
        dteMin: 21,
        dteMax: 30,
      },
    ],
    frequency: StrategyFrequency.DAILY,
    openTimePT: '12:00',
    exitPolicies: [],
    lifecycleState: LifecycleState.ACTIVE,
    userId: 'test-user',
    createdAt: '2025-08-16T00:00:00Z',
    updatedAt: '2025-08-16T00:00:00Z',
    ...overrides,
  };
}

// ── spreadTypeToOptionSide ──────────────────────────────────────────────────

describe('spreadTypeToOptionSide', () => {
  it('maps CASH_SECURED_PUT to PUT/SHORT', () => {
    const result = spreadTypeToOptionSide(PositionSpreadType.CASH_SECURED_PUT);
    assert.equal(result.optionType, OptionType.PUT);
    assert.equal(result.side, TradeSide.SHORT);
  });

  it('maps COVERED_CALL to CALL/SHORT', () => {
    const result = spreadTypeToOptionSide(PositionSpreadType.COVERED_CALL);
    assert.equal(result.optionType, OptionType.CALL);
    assert.equal(result.side, TradeSide.SHORT);
  });

  it('throws for unsupported spread types', () => {
    // PositionSpreadType only has CASH_SECURED_PUT and COVERED_CALL today;
    // cast an invalid value to exercise the default branch.
    const unsupported = 'UNKNOWN' as unknown as PositionSpreadType;
    assert.throws(
      () => spreadTypeToOptionSide(unsupported),
      /Unsupported spread type/,
    );
  });
});

// ── StrategyInstanceConfig shape ────────────────────────────────────────────

describe('StrategyInstanceConfig', () => {
  it('accepts a config with phases and unified fields', () => {
    const instance = makeInstance();
    assert.equal(instance.symbol, 'QQQM');
    assert.equal(instance.phases[0].spreadType, PositionSpreadType.CASH_SECURED_PUT);
    assert.equal(instance.phases[0].targetDelta, 0.2);
    assert.equal(instance.lifecycleState, LifecycleState.ACTIVE);
  });

  it('accepts a multi-phase (wheel) config', () => {
    const instance = makeInstance({
      phases: [
        {
          spreadType: PositionSpreadType.CASH_SECURED_PUT,
          targetDelta: 0.2,
          dteMin: 21,
          dteMax: 30,
        },
        {
          spreadType: PositionSpreadType.COVERED_CALL,
          targetDelta: 0.3,
          dteMin: 7,
          dteMax: 14,
        },
      ],
    });
    assert.equal(instance.phases.length, 2);
    assert.equal(instance.phases[1].spreadType, PositionSpreadType.COVERED_CALL);
  });
});

// ── Pass orchestrator migration ─────────────────────────────────────────────

describe('runOptionsOpenPass', () => {
  const marketDate = '2025-08-17';

  it('logs warning and exits when no active instances exist', async () => {
    const warnings: string[] = [];
    const pass = async () => {
      warnings.push('should not be called');
      return null;
    };

    await runOptionsOpenPass(
      marketDate,
      async () => [],
      async () => 100,
      pass,
    );

    assert.equal(warnings.length, 0);
  });

  it('calls runOpenPass with the active instance config', async () => {
    const instance = makeInstance({ id: 'ACTIVE-1' });
    const calls: Array<{ instanceId: string; date: string; config: StrategyInstanceConfig; price: number }> = [];
    const pass = async (instanceId: string, date: string, config: StrategyInstanceConfig, currentPrice: number) => {
      calls.push({ instanceId, date, config, price: currentPrice });
      return null;
    };

    await runOptionsOpenPass(
      marketDate,
      async () => [instance],
      async () => 100,
      pass,
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0].instanceId, 'ACTIVE-1');
    assert.equal(calls[0].date, marketDate);
    assert.equal(calls[0].config.symbol, 'QQQM');
    assert.equal(calls[0].price, 100);
  });

  it('skips instances when listActiveInstances returns empty (e.g. PAUSED filtered by repository)', async () => {
    const calls: string[] = [];
    const pass = async (instanceId: string) => {
      calls.push(instanceId);
      return null;
    };

    await runOptionsOpenPass(
      marketDate,
      async () => [], // repository filters out PAUSED instances
      async () => 100,
      pass,
    );

    assert.equal(calls.length, 0);
  });
});

describe('runOptionsSelectionPass', () => {
  const marketDate = '2025-08-17';

  it('calls runEodNightlySelection with the active instance config', async () => {
    const instance = makeInstance({ id: 'ACTIVE-1' });
    const calls: Array<{ marketDate: string; config: StrategyInstanceConfig; underlyingClose: number; instanceId: string }> = [];
    const runSelection = async (
      md: string,
      config: StrategyInstanceConfig,
      underlyingClose: number,
      instanceId: string,
    ) => {
      calls.push({ marketDate: md, config, underlyingClose, instanceId });
      return null;
    };

    await runOptionsSelectionPass(
      marketDate,
      async () => [instance],
      async () => 100,
      runSelection,
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0].marketDate, marketDate);
    assert.equal(calls[0].config.id, 'ACTIVE-1');
    assert.equal(calls[0].underlyingClose, 100);
    assert.equal(calls[0].instanceId, 'ACTIVE-1');
  });

  it('skips instances when listActiveInstances returns empty (e.g. STOPPED filtered by repository)', async () => {
    const calls: string[] = [];
    const runSelection = async (_md: string, _config: StrategyInstanceConfig, _close: number, instanceId: string) => {
      calls.push(instanceId);
      return null;
    };

    await runOptionsSelectionPass(
      marketDate,
      async () => [], // repository filters out STOPPED instances
      async () => 100,
      runSelection,
    );

    assert.equal(calls.length, 0);
  });
});

describe('runMarkPassForAllInstances', () => {
  it('runs the mark pass for every manageable instance', async () => {
    const instance = makeInstance({ id: 'PAUSED-1', lifecycleState: LifecycleState.PAUSED });
    const calls: string[] = [];
    const fakeProvider = { getQuotes: async () => [] } as unknown as import('../../../functions/src/options-strategy-engine/quote-providers/rh-mcp-option-quote-provider').RobinhoodMcpOptionQuoteProvider;
    const fakeMarkPass = async (instanceId: string) => {
      calls.push(instanceId);
      return { instanceId, markedAt: new Date().toISOString(), positions: [], errors: [] };
    };

    await runMarkPassForAllInstances(
      fakeProvider,
      async () => [instance],
      fakeMarkPass as unknown as Parameters<typeof runMarkPassForAllInstances>[2],
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0], 'PAUSED-1');
  });
});

describe('runSettlementForAllInstances', () => {
  const marketDate = '2025-08-17';

  it('runs settlement for every manageable instance', async () => {
    const instance = makeInstance({ id: 'STOPPED-1', lifecycleState: LifecycleState.STOPPED });
    const settlementCalls: string[] = [];
    const heldSharesCalls: string[] = [];

    const fakeSettlementPass = async (instanceId: string) => {
      settlementCalls.push(instanceId);
      return { instanceId, date: marketDate, settled: [], deferred: [], errors: [] };
    };

    const fakeHeldSharesPass = async (instanceId: string) => {
      heldSharesCalls.push(instanceId);
      return { instanceId, date: marketDate, marked: [], deferred: [], errors: [] };
    };

    const fakeStatsPass = async () => ({ scopesWritten: ['instance'] });
    const fakeStatsDepsFactory = () => ({} as never);

    await runSettlementForAllInstances(
      marketDate,
      async () => [instance],
      fakeSettlementPass as unknown as Parameters<typeof runSettlementForAllInstances>[2],
      fakeHeldSharesPass as unknown as Parameters<typeof runSettlementForAllInstances>[3],
      fakeStatsPass as unknown as Parameters<typeof runSettlementForAllInstances>[4],
      fakeStatsDepsFactory as unknown as Parameters<typeof runSettlementForAllInstances>[5],
    );

    assert.equal(settlementCalls.length, 1);
    assert.equal(settlementCalls[0], 'STOPPED-1');
    assert.equal(heldSharesCalls.length, 1);
    assert.equal(heldSharesCalls[0], 'STOPPED-1');
  });
});
