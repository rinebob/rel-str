/** @topic #114 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runEodSelectionPass } from '../../../functions/src/options-strategy-engine/selection/eod-selection-pass';
import type { StrategyInstanceConfig } from '../../../shared/options-strategy-engine-contracts';
import { TradeSide } from '../../../shared/common';
import { OptionType } from '../../../shared/options-common';
import type { HistoricalOptionContract } from '../../../functions/src/types/partner';

function makeContract(
  overrides: Record<string, unknown> = {},
): HistoricalOptionContract {
  return {
    contractID: 'SPY250817P00770000',
    symbol: 'SPY',
    expiration: '2025-08-17',
    strike: '77',
    type: OptionType.PUT,
    last: '0.50',
    mark: '0.55',
    bid: '0.54',
    ask: '0.56',
    volume: '100',
    open_interest: '500',
    date: '2025-08-14',
    delta: '-0.25',
    ...overrides,
  };
}

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


describe('runEodSelectionPass', () => {
  it('selects the put closest to the absolute delta target', async () => {
    const contracts = [
      makeContract({
        contractID: 'SPY250817P00770000',
        delta: '-0.25',
        mark: '0.55',
      }),
      makeContract({
        contractID: 'SPY250821P00770000',
        expiration: '2025-08-21',
        delta: '-0.40',
        mark: '0.80',
      }),
      makeContract({
        contractID: 'SPY250817C00770000',
        delta: '0.25',
        mark: '0.50',
        type: OptionType.CALL,
      }),
    ];

    const provider = {
      getEodChain: async () => contracts,
    };

    const result = await runEodSelectionPass(
      '2025-08-14',
      makeConfig(),
      provider,
    );

    assert.ok(result);
    assert.equal(result.quote.contractID, 'SPY250817P00770000');
    assert.equal(result.quote.type, 'put');
    assert.equal(result.quote.side, TradeSide.SHORT);
    assert.equal(result.dte, 3);
  });

  it('prefers the DTE closest to the midpoint of the band', async () => {
    const contracts = [
      makeContract({
        contractID: 'SPY250815P00770000',
        expiration: '2025-08-15',
        delta: '-0.25',
      }),
      makeContract({
        contractID: 'SPY250817P00770000',
        expiration: '2025-08-17',
        delta: '-0.25',
      }),
    ];

    const provider = {
      getEodChain: async () => contracts,
    };

    const result = await runEodSelectionPass(
      '2025-08-14',
      makeConfig({ dteMin: 1, dteMax: 5 }),
      provider,
    );

    assert.ok(result);
    assert.equal(result.quote.contractID, 'SPY250817P00770000');
  });

  it('returns null when no contract matches the DTE range', async () => {
    const contracts = [
      makeContract({
        contractID: 'SPY250821P00770000',
        expiration: '2025-08-21',
        delta: '-0.30',
      }),
    ];

    const provider = {
      getEodChain: async () => contracts,
    };

    const result = await runEodSelectionPass(
      '2025-08-14',
      makeConfig({ dteMin: 1, dteMax: 3 }),
      provider,
    );

    assert.equal(result, null);
  });

  it('returns null when the best candidate is outside deltaTolerance', async () => {
    const contracts = [
      makeContract({
        contractID: 'SPY250817P00770000',
        delta: '-0.10',
      }),
    ];

    const provider = {
      getEodChain: async () => contracts,
    };

    const result = await runEodSelectionPass(
      '2025-08-14',
      makeConfig({ deltaTolerance: 0.05 }),
      provider,
    );

    assert.equal(result, null);
  });
});
