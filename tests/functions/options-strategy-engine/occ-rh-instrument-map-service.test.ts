/** @topic #114 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OptionQuoteSource, OptionType } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import {
  buildOccRhInstrumentMapEntry,
  computeInstrumentMapExpiresAt,
} from '../../../functions/src/options-strategy-engine/instrument-map/occ-rh-instrument-map-writer';
import { OccRhInstrumentMapService } from '../../../functions/src/options-strategy-engine/instrument-map/occ-rh-instrument-map-service';
import { McpOccRhInstrumentMapResolver } from '../../../functions/src/options-strategy-engine/instrument-map/mcp-instrument-map-resolver';
import type { OptionQuote } from '../../../shared/options-strategy-engine-contracts';

function makeOptionQuote(overrides: Partial<OptionQuote> = {}): OptionQuote {
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
    ...overrides,
  };
}

describe('buildOccRhInstrumentMapEntry', () => {
  it('computes an expiresAt 3 months after expiration', () => {
    const quote = makeOptionQuote();
    const entry = buildOccRhInstrumentMapEntry(
      quote,
      'inst-123',
      'chain-456',
      '2025-08-14',
    );

    assert.equal(entry.occId, 'SPY250817P00770000');
    assert.equal(entry.instrumentId, 'inst-123');
    assert.equal(entry.chainId, 'chain-456');
    assert.equal(entry.chainSymbol, 'SPY');
    assert.equal(entry.expiration, '2025-08-17');
    assert.equal(entry.strike, 77);
    assert.equal(entry.type, 'put');
    assert.equal(entry.firstTradedDate, '2025-08-14');
    assert.equal(entry.expiresAt, '2025-11-17T00:00:00.000Z');
  });

  it('computes TTL across year boundaries', () => {
    const expiresAt = computeInstrumentMapExpiresAt('2025-11-30');
    assert.equal(expiresAt, '2026-02-28T00:00:00.000Z');
  });
});

describe('OccRhInstrumentMapService', () => {
  it('resolves, builds, and persists a map entry', async () => {
    const written: unknown[] = [];
    const service = new OccRhInstrumentMapService(
      {
        resolve: async () => ({
          instrumentId: 'inst-123',
          chainId: 'chain-456',
        }),
      },
      async (entry) => {
        written.push(entry);
      },
      async () => null,
    );

    const quote = makeOptionQuote();
    const entry = await service.buildAndPersist(quote, '2025-08-14');

    assert.equal(entry.occId, 'SPY250817P00770000');
    assert.equal(written.length, 1);
    assert.equal((written[0] as { instrumentId: string }).instrumentId, 'inst-123');
  });

  it('get returns null when no entry exists', async () => {
    const service = new OccRhInstrumentMapService(
      { resolve: async () => ({ instrumentId: '', chainId: '' }) },
      async () => {},
      async () => null,
    );

    const result = await service.get('SPY250817P00770000');
    assert.equal(result, null);
  });

  it('get returns a fresh entry without resolving', async () => {
    let resolved = false;
    const existing = buildOccRhInstrumentMapEntry(
      makeOptionQuote(),
      'inst-123',
      'chain-456',
    );
    const service = new OccRhInstrumentMapService(
      {
        resolve: async () => {
          resolved = true;
          return { instrumentId: 'other', chainId: 'other' };
        },
      },
      async () => {},
      async () => existing,
      () => new Date('2025-08-14T00:00:00.000Z'),
    );

    const result = await service.get('SPY250817P00770000');
    assert.equal(result?.instrumentId, 'inst-123');
    assert.equal(resolved, false);
  });

  it('getOrResolve returns a fresh entry and does not write', async () => {
    const written: unknown[] = [];
    const existing = buildOccRhInstrumentMapEntry(
      makeOptionQuote(),
      'inst-123',
      'chain-456',
    );
    const service = new OccRhInstrumentMapService(
      { resolve: async () => ({ instrumentId: 'other', chainId: 'other' }) },
      async (entry) => {
        written.push(entry);
      },
      async () => existing,
      () => new Date('2025-08-14T00:00:00.000Z'),
    );

    const result = await service.getOrResolve(makeOptionQuote());
    assert.equal(result.instrumentId, 'inst-123');
    assert.equal(written.length, 0);
  });

  it('getOrResolve backfills a missing entry and writes', async () => {
    const written: unknown[] = [];
    const service = new OccRhInstrumentMapService(
      {
        resolve: async () => ({ instrumentId: 'inst-123', chainId: 'chain-456' }),
      },
      async (entry) => {
        written.push(entry);
      },
      async () => null,
      () => new Date('2025-08-14T00:00:00.000Z'),
    );

    const result = await service.getOrResolve(makeOptionQuote(), '2025-08-14');
    assert.equal(result.instrumentId, 'inst-123');
    assert.equal(written.length, 1);
    assert.equal((written[0] as { firstTradedDate: string }).firstTradedDate, '2025-08-14');
  });

  it('getOrResolve backfills an expired entry and preserves firstTradedDate', async () => {
    const written: unknown[] = [];
    const existing = buildOccRhInstrumentMapEntry(
      makeOptionQuote(),
      'inst-old',
      'chain-old',
      '2025-08-01',
    );
    const service = new OccRhInstrumentMapService(
      {
        resolve: async () => ({ instrumentId: 'inst-new', chainId: 'chain-new' }),
      },
      async (entry) => {
        written.push(entry);
      },
      async () => existing,
      () => new Date('2026-01-01T00:00:00.000Z'),
    );

    const result = await service.getOrResolve(makeOptionQuote());
    assert.equal(result.instrumentId, 'inst-new');
    assert.equal(result.firstTradedDate, '2025-08-01');
    assert.equal(written.length, 1);
  });

  it('buildAndPersist does not overwrite an unchanged fresh entry', async () => {
    const written: unknown[] = [];
    const existing = buildOccRhInstrumentMapEntry(
      makeOptionQuote(),
      'inst-123',
      'chain-456',
    );
    const service = new OccRhInstrumentMapService(
      {
        resolve: async () => ({ instrumentId: 'inst-123', chainId: 'chain-456' }),
      },
      async (entry) => {
        written.push(entry);
      },
      async () => existing,
      () => new Date('2025-08-14T00:00:00.000Z'),
    );

    const result = await service.buildAndPersist(makeOptionQuote());
    assert.equal(result.instrumentId, 'inst-123');
    assert.equal(written.length, 0);
  });

  it('buildAndPersist overwrites and logs when the instrument ID changes', async () => {
    const written: unknown[] = [];
    const existing = buildOccRhInstrumentMapEntry(
      makeOptionQuote(),
      'inst-old',
      'chain-456',
    );
    const service = new OccRhInstrumentMapService(
      {
        resolve: async () => ({ instrumentId: 'inst-new', chainId: 'chain-456' }),
      },
      async (entry) => {
        written.push(entry);
      },
      async () => existing,
      () => new Date('2025-08-14T00:00:00.000Z'),
    );

    const result = await service.buildAndPersist(makeOptionQuote());
    assert.equal(result.instrumentId, 'inst-new');
    assert.equal(written.length, 1);
  });
});

describe('McpOccRhInstrumentMapResolver', () => {
  it('resolves an instrument on the first page', async () => {
    const resolver = new McpOccRhInstrumentMapResolver(async (_tool, _args) => ({
      data: {
        instruments: [
          {
            id: 'wrong-inst',
            chain_id: 'chain-1',
            chain_symbol: 'SPY',
            expiration_date: '2025-08-17',
            strike_price: '80.0000',
            type: 'put',
          },
          {
            id: 'correct-inst',
            chain_id: 'chain-1',
            chain_symbol: 'SPY',
            expiration_date: '2025-08-17',
            strike_price: '77.0000',
            type: 'put',
          },
        ],
      },
    }));

    const result = await resolver.resolve(makeOptionQuote());
    assert.equal(result.instrumentId, 'correct-inst');
    assert.equal(result.chainId, 'chain-1');
  });

  it('paginates until it finds a match', async () => {
    const calls: { tool: string; args: Record<string, unknown> }[] = [];
    const resolver = new McpOccRhInstrumentMapResolver(
      async (tool, args) => {
        calls.push({ tool, args });
        if (!args.cursor) {
          return {
            data: {
              instruments: [],
              next: 'page-2',
            },
          };
        }
        return {
          data: {
            instruments: [
              {
                id: 'paged-inst',
                chain_id: 'chain-2',
                chain_symbol: 'SPY',
                expiration_date: '2025-08-17',
                strike_price: '77.0000',
                type: 'put',
              },
            ],
          },
        };
      },
    );

    const result = await resolver.resolve(makeOptionQuote());
    assert.equal(result.instrumentId, 'paged-inst');
    assert.equal(result.chainId, 'chain-2');
    assert.equal(calls.length, 2);
  });

  it('falls back to get_option_chains when no instrument match is found', async () => {
    const resolver = new McpOccRhInstrumentMapResolver(async (tool, _args) => {
      if (tool === 'mcp__robinhood-trading__get_option_instruments') {
        return { data: { instruments: [] } };
      }
      if (tool === 'mcp__robinhood-trading__get_option_chains') {
        return {
          data: {
            chains: [
              {
                id: 'chain-3',
                symbol: 'SPY',
                expiration_dates: ['2025-08-17'],
              },
            ],
          },
        };
      }
      return {};
    });

    await assert.rejects(
      resolver.resolve(makeOptionQuote()),
      /Could not resolve RH instrument/,
    );
  });
});
