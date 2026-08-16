import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  toSharedConfig,
  spreadTypeToOptionSide,
} from '../../../functions/src/options-strategy-engine/options-strategy-passes';
import { PositionSpreadType, StrategyFrequency, OptionType } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
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
    exitCriteria: null,
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

// ── toSharedConfig ──────────────────────────────────────────────────────────

describe('toSharedConfig', () => {
  it('converts a registry config with phases to shared config', () => {
    const instance = makeInstance();
    const config = toSharedConfig(instance);

    assert.ok(config);
    assert.equal(config!.symbol, 'QQQM');
    assert.equal(config!.optionType, OptionType.PUT);
    assert.equal(config!.side, TradeSide.SHORT);
    assert.equal(config!.targetDelta, 0.2);
    assert.equal(config!.dteMin, 21);
    assert.equal(config!.dteMax, 30);
  });

  it('uses the first phase', () => {
    const instance = makeInstance({
      phases: [
        {
          spreadType: PositionSpreadType.COVERED_CALL,
          targetDelta: 0.3,
          dteMin: 7,
          dteMax: 14,
        },
      ],
    });
    const config = toSharedConfig(instance);

    assert.ok(config);
    assert.equal(config!.optionType, OptionType.CALL);
    assert.equal(config!.targetDelta, 0.3);
    assert.equal(config!.dteMin, 7);
    assert.equal(config!.dteMax, 14);
  });

  it('returns null when no phases are configured', () => {
    const instance = makeInstance({ phases: [] });
    const config = toSharedConfig(instance);
    assert.equal(config, null);
  });

  it('returns null when phases is undefined', () => {
    const instance = makeInstance({ phases: undefined });
    const config = toSharedConfig(instance);
    assert.equal(config, null);
  });
});
