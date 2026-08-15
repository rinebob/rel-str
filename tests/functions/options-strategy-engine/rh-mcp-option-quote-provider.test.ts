/** @topic #114 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TradeSide } from '../../../shared/common';
import { OptionQuoteSource, OptionType } from '../../../shared/options-common';
import type { OptionQuote, OccRhInstrumentMapEntry } from '../../../shared/options-strategy-engine-contracts';
import { RobinhoodMcpOptionQuoteProvider } from '../../../functions/src/options-strategy-engine/quote-providers/rh-mcp-option-quote-provider';
import { OccRhInstrumentMapService } from '../../../functions/src/options-strategy-engine/instrument-map/occ-rh-instrument-map-service';
import { buildOccRhInstrumentMapEntry } from '../../../functions/src/options-strategy-engine/instrument-map/occ-rh-instrument-map-writer';

function makeMapEntry(overrides: Partial<OccRhInstrumentMapEntry> = {}): OccRhInstrumentMapEntry {
  return {
    occId: 'SPY250817P00770000',
    instrumentId: 'inst-123',
    chainId: 'chain-456',
    chainSymbol: 'SPY',
    expiration: '2025-08-17',
    strike: 77,
    type: OptionType.PUT,
    createdAt: '2025-08-14T00:00:00.000Z',
    expiresAt: '2025-11-17T00:00:00.000Z',
    ...overrides,
  };
}

function makeQuoteQuote(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    adjusted_mark_price: '0.55',
    bid_price: '0.54',
    ask_price: '0.56',
    last_trade_price: '0.55',
    implied_volatility: '0.22',
    delta: '-0.32',
    gamma: '0.04',
    theta: '-0.02',
    vega: '0.08',
    rho: '-0.01',
    volume: '1000',
    open_interest: '5000',
    updated_at: '2025-08-14T15:00:00.000Z',
    ...overrides,
  };
}

function makeQuoteResponse(
  instrumentId: string,
  quote: Record<string, unknown> = makeQuoteQuote(),
  close: Record<string, unknown> = { price: '0.55', interpolated: false },
): Record<string, unknown> {
  return {
    results: [
      {
        instrument_id: instrumentId,
        quote,
        close,
      },
    ],
  };
}

function makeProvider(
  entries: Map<string, OccRhInstrumentMapEntry>,
  toolResponses: Record<string, unknown>,
  maxBatchSize = 20,
): {
  provider: RobinhoodMcpOptionQuoteProvider;
  calls: { name: string; args: Record<string, unknown> }[];
} {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const mapService = new OccRhInstrumentMapService(
    { resolve: async () => ({ instrumentId: 'resolved-inst', chainId: 'resolved-chain' }) },
    async (entry) => {
      entries.set(entry.occId, entry);
    },
    async (occId) => entries.get(occId) ?? null,
  );
  const provider = new RobinhoodMcpOptionQuoteProvider({
    mapService,
    callTool: async (name, args) => {
      calls.push({ name, args });
      return toolResponses[name] ?? { results: [] };
    },
    maxBatchSize,
  });
  return { provider, calls };
}

describe('RobinhoodMcpOptionQuoteProvider', () => {
  it('maps a single RH MCP quote to an OptionQuote', async () => {
    const entry = makeMapEntry();
    const entries = new Map<string, OccRhInstrumentMapEntry>([[entry.occId, entry]]);
    const { provider } = makeProvider(
      entries,
      { 'mcp__robinhood-trading__get_option_quotes': makeQuoteResponse('inst-123') },
    );

    const quote = await provider.getQuote('SPY250817P00770000', 'SPY', TradeSide.SHORT);

    assert.equal(quote.contractID, 'SPY250817P00770000');
    assert.equal(quote.symbol, 'SPY');
    assert.equal(quote.expiration, '2025-08-17');
    assert.equal(quote.strike, 77);
    assert.equal(quote.type, OptionType.PUT);
    assert.equal(quote.side, TradeSide.SHORT);
    assert.equal(quote.source, OptionQuoteSource.RH_MCP);
    assert.equal(quote.mark, 0.55);
    assert.equal(quote.bid, 0.54);
    assert.equal(quote.ask, 0.56);
    assert.equal(quote.last, 0.55);
    assert.equal(quote.impliedVolatility, 0.22);
    assert.equal(quote.delta, -0.32);
    assert.equal(quote.gamma, 0.04);
    assert.equal(quote.theta, -0.02);
    assert.equal(quote.vega, 0.08);
    assert.equal(quote.rho, -0.01);
    assert.equal(quote.volume, 1000);
    assert.equal(quote.openInterest, 5000);
    assert.equal(quote.asOf, '2025-08-14T15:00:00.000Z');
  });

  it('backfills the map entry when it is missing', async () => {
    const entries = new Map<string, OccRhInstrumentMapEntry>();
    const { provider } = makeProvider(
      entries,
      {
        'mcp__robinhood-trading__get_option_quotes': makeQuoteResponse('resolved-inst'),
      },
    );

    const quote = await provider.getQuote('SPY250817P00770000', 'SPY', TradeSide.SHORT);

    assert.equal(quote.contractID, 'SPY250817P00770000');
    assert.equal(entries.size, 1);
    assert.equal(entries.get('SPY250817P00770000')?.instrumentId, 'resolved-inst');
  });

  it('throws when close.price is missing', async () => {
    const entry = makeMapEntry();
    const entries = new Map<string, OccRhInstrumentMapEntry>([[entry.occId, entry]]);
    const { provider } = makeProvider(
      entries,
      {
        'mcp__robinhood-trading__get_option_quotes': makeQuoteResponse('inst-123', makeQuoteQuote(), { interpolated: false }),
      },
    );

    await assert.rejects(
      () => provider.getQuote('SPY250817P00770000', 'SPY', TradeSide.SHORT),
      /missing close\.price/,
    );
  });

  it('throws when the mark is missing', async () => {
    const entry = makeMapEntry();
    const entries = new Map<string, OccRhInstrumentMapEntry>([[entry.occId, entry]]);
    const { provider } = makeProvider(
      entries,
      {
        'mcp__robinhood-trading__get_option_quotes': makeQuoteResponse(
          'inst-123',
          { ...makeQuoteQuote(), adjusted_mark_price: undefined, last_trade_price: undefined },
          { price: '0.55' },
        ),
      },
    );

    await assert.rejects(
      () => provider.getQuote('SPY250817P00770000', 'SPY', TradeSide.SHORT),
      /missing mark/,
    );
  });

  it('batches instrument IDs at the configured max batch size', async () => {
    const entries = new Map<string, OccRhInstrumentMapEntry>();
    const toolResponses: Record<string, unknown> = {};
    for (let i = 0; i < 5; i++) {
      const strike = 70 + i;
      const occId = `SPY250817P00${(strike * 1000).toString().padStart(7, '0')}0`;
      const instrumentId = `inst-${i}`;
      entries.set(occId, makeMapEntry({ occId, instrumentId, strike }));
      toolResponses['mcp__robinhood-trading__get_option_quotes'] =
        (toolResponses['mcp__robinhood-trading__get_option_quotes'] as { results?: unknown[] } | undefined) ??
        { results: [] };
      (toolResponses['mcp__robinhood-trading__get_option_quotes'] as { results: unknown[] }).results.push({
        instrument_id: instrumentId,
        quote: makeQuoteQuote(),
        close: { price: '0.55' },
      });
    }

    const { provider, calls } = makeProvider(entries, toolResponses, 2);

    const contractIDs = Array.from(entries.keys());
    const quotes = await provider.getQuotes(contractIDs, TradeSide.SHORT);

    assert.equal(quotes.length, 5);
    assert.equal(calls.length, 3); // 5 items in batches of 2 = 3 calls
    assert.equal((calls[0].args as { instrument_ids: string[] }).instrument_ids.length, 2);
    assert.equal((calls[1].args as { instrument_ids: string[] }).instrument_ids.length, 2);
    assert.equal((calls[2].args as { instrument_ids: string[] }).instrument_ids.length, 1);
  });

  it('preserves input order in getQuotes', async () => {
    const entries = new Map<string, OccRhInstrumentMapEntry>();
    const ids: string[] = [];
    const results: Record<string, unknown>[] = [];
    for (let i = 0; i < 3; i++) {
      const strike = 70 + i;
      const occId = `SPY250817P00${(strike * 1000).toString().padStart(7, '0')}0`;
      const instrumentId = `inst-${i}`;
      ids.push(occId);
      entries.set(occId, makeMapEntry({ occId, instrumentId, strike }));
      results.push({
        instrument_id: instrumentId,
        quote: makeQuoteQuote({ adjusted_mark_price: `${0.5 + i * 0.1}` }),
        close: { price: `${0.5 + i * 0.1}` },
      });
    }

    const { provider } = makeProvider(entries, { 'mcp__robinhood-trading__get_option_quotes': { results } });
    const quotes = await provider.getQuotes(ids, TradeSide.SHORT);

    assert.equal(quotes[0].strike, 70);
    assert.equal(quotes[1].strike, 71);
    assert.equal(quotes[2].strike, 72);
  });
});
