/** @topic #114 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runMarkPass } from '../../../functions/src/options-strategy-engine/passes/mark-pass';
import type { BatchQuoteProvider } from '../../../functions/src/options-strategy-engine/passes/mark-pass';
import { OptionType, OptionQuoteSource } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import type { StrategyInstanceConfig, OptionQuote } from '../../../shared/options-strategy-engine-contracts';
import type { Position, PositionLeg, RawQuote } from '../../../functions/src/options-strategy-engine/types';
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

function makePosition(
  overrides: Partial<Position> = {},
): Position {
  return {
    id: 'inst-1-2025-08-15',
    instanceId: 'inst-1',
    symbol: 'SPY',
    status: PositionStatus.OPEN,
    premiumCollected: 50,
    capitalRequired: 10000,
    openDate: '2025-08-15',
    currentValue: 50,
    currentValueAsOf: '2025-08-15T14:00:00Z',
    unrealizedPnl: 0,
    ...overrides,
  };
}

function makeLeg(
  overrides: Partial<PositionLeg> = {},
): PositionLeg {
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

function makeQuote(
  overrides: Partial<OptionQuote> = {},
): OptionQuote {
  return {
    contractID: 'SPY250817P00100000',
    symbol: 'SPY',
    expiration: '2025-08-17',
    strike: 100,
    type: OptionType.PUT,
    side: TradeSide.SHORT,
    mark: 0.40,
    source: OptionQuoteSource.RH_MCP,
    asOf: '2025-08-15T18:00:00Z',
    ...overrides,
  };
}

function makeMarkDeps(overrides: {
  listOpenPositions?: (instanceId: string) => Promise<Position[]>;
  getLegs?: (positionId: string) => Promise<PositionLeg[]>;
  quoteProvider?: BatchQuoteProvider;
  markPosition?: (positionId: string, update: Partial<Position>, rawQuote: RawQuote) => Promise<void>;
} = {}) {
  return {
    listOpenPositions: overrides.listOpenPositions ?? (async () => [makePosition()]),
    getLegs: overrides.getLegs ?? (async () => [makeLeg()]),
    quoteProvider: overrides.quoteProvider ?? ({ getQuotes: async () => [makeQuote()] } as BatchQuoteProvider),
    markPosition: overrides.markPosition ?? (async () => {}),
  };
}

describe('runMarkPass', () => {
  it('returns empty result when no open positions', async () => {
    const result = await runMarkPass('inst-1', makeConfig(), {
      ...makeMarkDeps({ listOpenPositions: async () => [] }),
    });

    assert.equal(result.instanceId, 'inst-1');
    assert.equal(result.positions.length, 0);
    assert.equal(result.errors.length, 0);
  });

  it('marks a position with current quote and updates P&L', async () => {
    const marks: { positionId: string; update: Partial<Position>; rawQuote: RawQuote }[] = [];

    const result = await runMarkPass('inst-1', makeConfig(), {
      ...makeMarkDeps({
        quoteProvider: { getQuotes: async () => [makeQuote({ mark: 0.40 })] } as BatchQuoteProvider,
        markPosition: async (positionId, update, rawQuote) => {
          marks.push({ positionId, update, rawQuote });
        },
      }),
    });

    assert.equal(result.positions.length, 1);
    const pos = result.positions[0];
    assert.equal(pos.positionId, 'inst-1-2025-08-15');
    assert.equal(pos.contractID, 'SPY250817P00100000');
    assert.equal(pos.mark, 0.40);
    assert.equal(pos.currentValue, 40); // 0.40 * 100

    // SHORT P&L: premiumCollected - currentValue = 50 - 40 = 10
    assert.equal(pos.unrealizedPnl, 10);

    // markPosition called atomically
    assert.equal(marks.length, 1);
    assert.equal(marks[0].positionId, 'inst-1-2025-08-15');
    assert.equal(marks[0].update.currentValue, 40);
    assert.equal(marks[0].update.unrealizedPnl, 10);
    assert.equal(marks[0].rawQuote.date, new Date().toISOString().slice(0, 10));
  });

  it('records error when no leg with contractID is found', async () => {
    const result = await runMarkPass('inst-1', makeConfig(), {
      ...makeMarkDeps({
        getLegs: async () => [makeLeg({ contractID: undefined })],
        quoteProvider: { getQuotes: async () => [] } as BatchQuoteProvider,
      }),
    });

    assert.equal(result.positions.length, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].positionId, 'inst-1-2025-08-15');
    assert.equal(result.errors[0].error, 'No leg with contractID found');
  });

  it('records errors when quote provider throws', async () => {
    const result = await runMarkPass('inst-1', makeConfig(), {
      ...makeMarkDeps({
        quoteProvider: {
          getQuotes: async () => {
            throw new Error('MCP connection failed');
          },
        } as BatchQuoteProvider,
      }),
    });

    assert.equal(result.positions.length, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].error, 'MCP connection failed');
  });

  it('records error when quote is missing for a contract', async () => {
    const result = await runMarkPass('inst-1', makeConfig(), {
      ...makeMarkDeps({
        quoteProvider: {
          getQuotes: async () => [
            makeQuote({ contractID: 'DIFFERENT_CONTRACT', mark: 0.30 }),
          ],
        } as BatchQuoteProvider,
      }),
    });

    assert.equal(result.positions.length, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].contractID, 'SPY250817P00100000');
    assert.equal(result.errors[0].error, 'No quote returned for contract');
  });

  it('computes P&L correctly for LONG side', async () => {
    const result = await runMarkPass(
      'inst-1',
      makeConfig({ side: TradeSide.LONG }),
      {
        ...makeMarkDeps({
          listOpenPositions: async () => [
            makePosition({
              premiumCollected: 0,
              capitalRequired: 50, // paid 0.50 * 100
            }),
          ],
          getLegs: async () => [makeLeg({ side: TradeSide.LONG })],
          quoteProvider: {
            getQuotes: async () => [makeQuote({ mark: 0.60, side: TradeSide.LONG })],
          } as BatchQuoteProvider,
        }),
      },
    );

    assert.equal(result.positions.length, 1);
    // LONG P&L: currentValue - capitalRequired = 60 - 50 = 10
    assert.equal(result.positions[0].unrealizedPnl, 10);
    assert.equal(result.positions[0].currentValue, 60);
  });

  it('throws when quoteProvider is not provided', async () => {
    await assert.rejects(
      () => runMarkPass('inst-1', makeConfig(), {}),
      /quoteProvider is required/,
    );
  });

  it('surfaces interpolatedClose flag from quote', async () => {
    const result = await runMarkPass('inst-1', makeConfig(), {
      ...makeMarkDeps({
        quoteProvider: {
          getQuotes: async () => [makeQuote({ mark: 0.35, interpolatedClose: true })],
        } as BatchQuoteProvider,
      }),
    });

    assert.equal(result.positions.length, 1);
    assert.equal(result.positions[0].interpolatedClose, true);
    assert.equal(result.positions[0].mark, 0.35);
    // P&L still computed from mark, not from interpolated close
    assert.equal(result.positions[0].unrealizedPnl, 15); // 50 - 35
  });

  it('defaults interpolatedClose to false when not set on quote', async () => {
    const result = await runMarkPass('inst-1', makeConfig(), {
      ...makeMarkDeps({
        quoteProvider: {
          getQuotes: async () => [makeQuote({ mark: 0.40 })],
        } as BatchQuoteProvider,
      }),
    });

    assert.equal(result.positions.length, 1);
    assert.equal(result.positions[0].interpolatedClose, false);
  });

  it('records data-quality error when quote provider throws for missing close.price', async () => {
    const result = await runMarkPass('inst-1', makeConfig(), {
      ...makeMarkDeps({
        quoteProvider: {
          getQuotes: async () => {
            throw new Error('RH MCP quote provider: missing close.price for SPY250817P00100000');
          },
        } as BatchQuoteProvider,
      }),
    });

    assert.equal(result.positions.length, 0);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].error.includes('close.price'));
  });

  it('passes all contract IDs to quote provider in a single batch call', async () => {
    let batchCallCount = 0;
    let batchContractIDs: string[] = [];

    const positions = [
      makePosition({ id: 'inst-1-2025-08-15' }),
      makePosition({ id: 'inst-1-2025-08-16', openDate: '2025-08-16' }),
    ];

    const result = await runMarkPass('inst-1', makeConfig(), {
      ...makeMarkDeps({
        listOpenPositions: async () => positions,
        getLegs: async (positionId) => {
          if (positionId === 'inst-1-2025-08-15') return [makeLeg()];
          return [makeLeg({ contractID: 'SPY250819P00100000' })];
        },
        quoteProvider: {
          getQuotes: async (contractIDs, _side) => {
            batchCallCount++;
            batchContractIDs = contractIDs;
            return contractIDs.map((id) =>
              makeQuote({
                contractID: id,
                mark: id === 'SPY250817P00100000' ? 0.40 : 0.30,
              }),
            );
          },
        } as BatchQuoteProvider,
      }),
    });

    assert.equal(batchCallCount, 1);
    assert.equal(batchContractIDs.length, 2);
    assert.ok(batchContractIDs.includes('SPY250817P00100000'));
    assert.ok(batchContractIDs.includes('SPY250819P00100000'));
    assert.equal(result.positions.length, 2);
  });
});
