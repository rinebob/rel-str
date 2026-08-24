import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runEodNightlySelection } from '../../../functions/src/options-strategy-engine/eod-orchestrator';
import { OptionQuoteSource, OptionType } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import type { StrategyInstanceConfig } from '../../../shared/options-strategy-engine-contracts';
import type { HistoricalOptionContract } from '../../../functions/src/types/partner';
import { OccRhInstrumentMapService } from '../../../functions/src/options-strategy-engine/instrument-map/occ-rh-instrument-map-service';

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
    implied_volatility: '0.25',
    date: '2025-08-14',
    delta: '-0.25',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<StrategyInstanceConfig> = {}): StrategyInstanceConfig {
  return {
    id: 'test',
    symbol: 'SPY',
    optionType: OptionType.PUT,
    side: TradeSide.SHORT,
    dteMin: 2,
    dteMax: 5,
    targetDelta: 0.3,
    overnightGridRangePct: 0.025,
    overnightGridStepPct: 0.005,
    ...overrides,
  } as StrategyInstanceConfig;
}

const defaultProvider = {
  getEodChain: async () => [makeContract()],
};

const defaultMapService = new OccRhInstrumentMapService(
  { resolve: async () => ({ instrumentId: 'inst-123', chainId: 'chain-456' }) },
  async () => {},
);

describe('runEodNightlySelection', () => {
  it('returns null when no contract matches', async () => {
    const provider = {
      getEodChain: async () => [],
    };

    const result = await runEodNightlySelection(
      '2025-08-14',
      makeConfig(),
      77,
      'instance-1',
      { provider },
    );

    assert.equal(result, null);
  });

  it('returns quote, map entry, and simulation for a selected contract', async () => {
    const written: { instanceId: string; date: string; simulation: unknown }[] = [];
    const writeSimulation = async (
      instanceId: string,
      date: string,
      simulation: unknown,
    ) => {
      written.push({ instanceId, date, simulation });
    };

    const result = await runEodNightlySelection(
      '2025-08-14',
      makeConfig(),
      77,
      'instance-1',
      {
        provider: defaultProvider,
        mapService: defaultMapService,
        writeSimulation,
      },
    );

    assert.ok(result);
    assert.equal(result.quote.contractID, 'SPY250817P00770000');
    assert.equal(result.mapEntry.instrumentId, 'inst-123');
    assert.equal(result.simulation.baseUnderlyingPrice, 77);
    assert.equal(result.simulation.grid.length, 11);
    assert.equal(written.length, 1);
    assert.equal(written[0].instanceId, 'instance-1');
    assert.equal(written[0].date, '2025-08-14');
  });
});
