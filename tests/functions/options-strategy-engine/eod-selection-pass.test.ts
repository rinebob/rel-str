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
    id: 'test',
    symbol: 'SPY',
    optionType: OptionType.PUT,
    side: TradeSide.SHORT,
    dte: 3,
    targetDelta: -0.3,
    overnightGridRangePct: 0.025,
    overnightGridStepPct: 0.005,
    ...overrides,
  } as StrategyInstanceConfig;
}


describe('runEodSelectionPass', () => {
  it('selects the put closest to the signed delta target within the nearest-DTE expiry', async () => {
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
    assert.equal(result.selected.contractId, 'SPY250817P00770000');
    assert.equal(result.selected.delta, -0.25);
  });

  it('picks the expiration nearest the configured dte', async () => {
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
      makeConfig({ dte: 1 }),
      provider,
    );

    assert.ok(result);
    assert.equal(result.quote.contractID, 'SPY250815P00770000');
  });

  it('returns null when the chain has no eligible contract', async () => {
    const contracts = [
      makeContract({
        contractID: 'SPY250817C00770000',
        delta: '0.25',
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

  it('returns null when the config lacks a concrete coordinate', async () => {
    const contracts = [makeContract()];

    const provider = {
      getEodChain: async () => contracts,
    };

    const result = await runEodSelectionPass(
      '2025-08-14',
      makeConfig({ dte: undefined, targetDelta: undefined }),
      provider,
    );

    assert.equal(result, null);
  });

  it('skips candidates with unparseable delta rather than fabricating', async () => {
    const contracts = [
      makeContract({
        contractID: 'SPY250817P00770000',
        delta: 'junk',
      }),
      makeContract({
        contractID: 'SPY250817P00780000',
        strike: '78',
        delta: '-0.30',
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
    assert.equal(result.quote.contractID, 'SPY250817P00780000');
  });

  it('selects the call closest to the signed delta target for a covered-call config', async () => {
    const contracts = [
      makeContract({
        contractID: 'SPY250817C00770000',
        type: OptionType.CALL,
        delta: '0.32',
      }),
      makeContract({
        contractID: 'SPY250817C00780000',
        type: OptionType.CALL,
        strike: '78',
        delta: '0.60',
      }),
    ];

    const provider = {
      getEodChain: async () => contracts,
    };

    const result = await runEodSelectionPass(
      '2025-08-14',
      makeConfig({ optionType: OptionType.CALL, targetDelta: 0.3 }),
      provider,
    );

    assert.ok(result);
    assert.equal(result.selected.contractId, 'SPY250817C00770000');
    assert.equal(result.selected.delta, 0.32);
  });

  it('throws when the argmin winner carries no price fields — the coordinate pick is not negotiable (#1501 r1)', async () => {
    // Mark is fill-time data, not a selection criterion — the selector
    // deliberately drops the old requireMark eligibility. But the quote
    // mapper still cannot fabricate a price: an unpriceable winner fails
    // loudly (orchestrator catches per-instance) rather than silently
    // picking the next-best contract.
    const contracts = [
      makeContract({
        contractID: 'SPY250817P00770000',
        delta: '-0.30',
        mark: undefined,
        bid: undefined,
        ask: undefined,
        last: undefined,
      }),
      makeContract({
        contractID: 'SPY250817P00780000',
        strike: '78',
        delta: '-0.28',
      }),
    ];

    const provider = {
      getEodChain: async () => contracts,
    };

    await assert.rejects(() =>
      runEodSelectionPass('2025-08-14', makeConfig(), provider),
    );
  });
});
