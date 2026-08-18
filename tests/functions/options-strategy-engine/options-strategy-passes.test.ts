/**
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  spreadTypeToOptionSide,
} from '../../../functions/src/options-strategy-engine/options-strategy-passes';
import { PositionSpreadType, StrategyFrequency, OptionType } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import { LifecycleState } from '../../../shared/options-strategy-engine-contracts';
import type { StrategyInstanceConfig } from '../../../functions/src/options-strategy-engine/types';

function makeInstance(overrides: Partial<StrategyInstanceConfig> = {}): StrategyInstanceConfig {
  return {
    id: 'TEST-WHEEL',
    symbol: 'QQQM',
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
