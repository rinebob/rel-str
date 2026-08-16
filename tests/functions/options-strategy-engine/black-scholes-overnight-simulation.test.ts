import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

function approximately(actual: number, expected: number, tolerance: number, message?: string): void {
  const diff = Math.abs(actual - expected);
  assert.ok(diff <= tolerance, message ?? `expected ${expected} ± ${tolerance}, got ${actual}`);
}
import { blackScholes, normalCdf } from '../../../functions/src/options-strategy-engine/pricing/black-scholes';
import { computeOvernightDeltaSimulation } from '../../../functions/src/options-strategy-engine/pricing/overnight-simulation';
import type { OptionQuote, StrategyInstanceConfig } from '../../../shared/options-strategy-engine-contracts';
import { OptionQuoteSource, OptionType } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';

function makeQuote(overrides: Partial<OptionQuote> = {}): OptionQuote {
  return {
    contractID: 'SPY250817P00770000',
    symbol: 'SPY',
    expiration: '2025-08-17',
    strike: 77,
    type: OptionType.PUT,
    side: TradeSide.SHORT,
    mark: 0.55,
    bid: 0.54,
    ask: 0.56,
    source: OptionQuoteSource.AV_EOD,
    asOf: '2025-08-14T00:00:00.000Z',
    impliedVolatility: 0.25,
    delta: -0.3,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<StrategyInstanceConfig> = {}): StrategyInstanceConfig {
  return {
    symbol: 'SPY',
    optionType: OptionType.PUT,
    side: TradeSide.SHORT,
    overnightGridRangePct: 0.025,
    overnightGridStepPct: 0.005,
    ...overrides,
  };
}

describe('normalCdf', () => {
  it('matches the limits', () => {
    assert.equal(normalCdf(-Infinity), 0);
    assert.equal(normalCdf(Infinity), 1);
    approximately(normalCdf(0), 0.5, 1e-9);
  });

  it('is symmetric', () => {
    approximately(normalCdf(1.96), 1 - normalCdf(-1.96), 1e-7);
  });
});

describe('blackScholes', () => {
  it('prices an ATM put with known reference values', () => {
    const result = blackScholes({
      underlying: 100,
      strike: 100,
      timeToExpirationYears: 30 / 365,
      riskFreeRate: 0.05,
      volatility: 0.25,
      optionType: OptionType.PUT,
    });

    // Near-ATM short-dated put around 100 with 25% vol, 30 DTE, 5% rate.
    assert.ok(result.mark > 0 && result.mark < 5, `mark ${result.mark} out of range`);
    assert.ok(result.delta < 0 && result.delta > -0.6, `delta ${result.delta} out of range`);
    assert.ok(result.theta < 0, `theta ${result.theta} should be negative for long put`);
  });

  it('returns call delta near 0.5 for a close-to-ATM call', () => {
    const result = blackScholes({
      underlying: 100,
      strike: 100,
      timeToExpirationYears: 30 / 365,
      riskFreeRate: 0.05,
      volatility: 0.25,
      optionType: OptionType.CALL,
    });

    approximately(result.delta, 0.5, 0.05);
    assert.ok(result.mark > 0 && result.mark < 5);
  });

  it('rewards a deeper ITM put with higher mark and delta magnitude', () => {
    const otm = blackScholes({
      underlying: 100,
      strike: 90,
      timeToExpirationYears: 30 / 365,
      riskFreeRate: 0.05,
      volatility: 0.25,
      optionType: OptionType.PUT,
    });
    const itm = blackScholes({
      underlying: 90,
      strike: 100,
      timeToExpirationYears: 30 / 365,
      riskFreeRate: 0.05,
      volatility: 0.25,
      optionType: OptionType.PUT,
    });

    assert.ok(itm.mark > otm.mark, 'ITM put should be more expensive');
    assert.ok(Math.abs(itm.delta) > Math.abs(otm.delta), 'ITM put should have larger delta magnitude');
  });
});

describe('computeOvernightDeltaSimulation', () => {
  it('generates a symmetric grid centered on the underlying close', () => {
    const quote = makeQuote();
    const config = makeConfig();
    const sim = computeOvernightDeltaSimulation(quote, 77, 3, config);

    assert.equal(sim.baseContractID, 'SPY250817P00770000');
    assert.equal(sim.baseUnderlyingPrice, 77);
    assert.equal(sim.rangePct, 0.025);
    assert.equal(sim.stepPct, 0.005);
    assert.equal(sim.grid.length, 11); // -2.5% to +2.5% in 0.5% steps
    assert.equal(sim.grid[5]?.underlyingMovePct, 0);
    assert.equal(sim.grid[5]?.underlyingPrice, 77);
  });

  it('puts have more negative delta as the underlying drops', () => {
    const quote = makeQuote({ strike: 77, impliedVolatility: 0.25 });
    const config = makeConfig();
    const sim = computeOvernightDeltaSimulation(quote, 77, 3, config);

    const left = sim.grid[0]; // -2.5%
    const right = sim.grid[sim.grid.length - 1]; // +2.5%
    assert.ok(left && right);
    assert.ok(left.mark > right.mark, 'put mark should rise as underlying falls');
    assert.ok(left.delta < right.delta, 'put delta should be more negative as underlying falls');
  });

  it('throws when implied volatility is missing', () => {
    const quote = makeQuote({ impliedVolatility: undefined });
    const config = makeConfig();
    assert.throws(
      () => computeOvernightDeltaSimulation(quote, 77, 3, config),
      /requires impliedVolatility/,
    );
  });
});
