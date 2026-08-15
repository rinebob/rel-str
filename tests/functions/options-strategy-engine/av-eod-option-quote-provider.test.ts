/** @topic #114 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AvEodOptionQuoteProvider,
  mapAvContractToOptionQuote,
  type FetchEodChainFn,
} from '../../../functions/src/options-strategy-engine/quote-providers/av-eod-option-quote-provider';
import { OptionQuoteSource } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import type { PartnerHistoricalOptionsResponse } from '../../../functions/src/types/partner';

function makeHistoricalResponse(
  contracts: PartnerHistoricalOptionsResponse['data']['data'],
  date = '2025-08-14',
): PartnerHistoricalOptionsResponse {
  return {
    ok: true,
    symbol: 'SPY',
    date,
    source: 'av',
    endpoint: 'partnerHistoricalOptionsV2',
    data: {
      endpoint: 'partnerHistoricalOptionsV2',
      data: contracts,
    },
    analysis: {
      summary: {
        totalContracts: contracts.length,
        totalVolume: 0,
        totalOpenInterest: 0,
        callContracts: 0,
        putContracts: 0,
        uniqueStrikes: 0,
        avgVolumePerContract: 0,
        avgOpenInterest: 0,
      },
      expirations: [],
      strikes: [],
    },
    timestamp: new Date().toISOString(),
    processingTimeMs: 0,
  };
}

function makeContract(
  overrides: Record<string, string | undefined> = {},
): PartnerHistoricalOptionsResponse['data']['data'][number] {
  return {
    contractID: 'SPY250817P00770000',
    symbol: 'SPY',
    expiration: '2025-08-17',
    strike: '77',
    type: 'put',
    last: '0.65',
    mark: '0.70',
    bid: '0.68',
    bid_size: '10',
    ask: '0.72',
    ask_size: '20',
    volume: '100',
    open_interest: '500',
    date: '2025-08-14',
    implied_volatility: '0.25',
    delta: '-0.30',
    gamma: '0.05',
    theta: '-0.04',
    vega: '0.10',
    rho: '-0.01',
    ...overrides,
  };
}

describe('mapAvContractToOptionQuote', () => {
  it('maps a full AV EOD contract into OptionQuote', () => {
    const quote = mapAvContractToOptionQuote(
      makeContract(),
      TradeSide.SHORT,
      '2025-08-14',
    );

    assert.equal(quote.contractID, 'SPY250817P00770000');
    assert.equal(quote.symbol, 'SPY');
    assert.equal(quote.expiration, '2025-08-17');
    assert.equal(quote.strike, 77);
    assert.equal(quote.type, 'put');
    assert.equal(quote.side, TradeSide.SHORT);
    assert.equal(quote.mark, 0.7);
    assert.equal(quote.bid, 0.68);
    assert.equal(quote.ask, 0.72);
    assert.equal(quote.last, 0.65);
    assert.equal(quote.volume, 100);
    assert.equal(quote.openInterest, 500);
    assert.equal(quote.impliedVolatility, 0.25);
    assert.equal(quote.delta, -0.3);
    assert.equal(quote.gamma, 0.05);
    assert.equal(quote.theta, -0.04);
    assert.equal(quote.vega, 0.1);
    assert.equal(quote.rho, -0.01);
    assert.equal(quote.source, OptionQuoteSource.AV_EOD);
    assert.equal(quote.asOf, '2025-08-14T00:00:00.000Z');
  });

  it('falls back to bid/ask mid when mark is missing', () => {
    const quote = mapAvContractToOptionQuote(
      makeContract({ mark: undefined }),
      TradeSide.LONG,
    );
    assert.equal(quote.mark, 0.7); // (0.68 + 0.72) / 2
  });

  it('falls back to last when mark, bid, and ask are missing', () => {
    const quote = mapAvContractToOptionQuote(
      makeContract({ mark: undefined, bid: undefined, ask: undefined }),
      TradeSide.LONG,
    );
    assert.equal(quote.mark, 0.65);
  });

  it('does not throw when optional Greeks are missing', () => {
    const quote = mapAvContractToOptionQuote(
      makeContract({
        delta: undefined,
        gamma: undefined,
        theta: undefined,
        vega: undefined,
        rho: undefined,
        implied_volatility: undefined,
      }),
      TradeSide.LONG,
    );
    assert.equal(quote.delta, undefined);
    assert.equal(quote.gamma, undefined);
    assert.equal(quote.source, OptionQuoteSource.AV_EOD);
  });

  it('builds an OCC ID when contractID is missing', () => {
    const quote = mapAvContractToOptionQuote(
      makeContract({ contractID: undefined, type: 'CALL' }),
      TradeSide.LONG,
    );
    assert.equal(quote.contractID, 'SPY250817C00077000');
  });
});

describe('AvEodOptionQuoteProvider', () => {
  it('getQuote returns the selected OptionQuote from the EOD chain', async () => {
    const fetchChain: FetchEodChainFn = async (_symbol, _date) =>
      makeHistoricalResponse([makeContract()]);

    const provider = new AvEodOptionQuoteProvider(fetchChain);
    const quote = await provider.getQuote(
      'SPY250817P00770000',
      'SPY',
      TradeSide.SHORT,
    );

    assert.equal(quote.contractID, 'SPY250817P00770000');
    assert.equal(quote.source, OptionQuoteSource.AV_EOD);
    assert.equal(quote.side, TradeSide.SHORT);
  });

  it('getQuote throws when the contract is not in the chain', async () => {
    const fetchChain: FetchEodChainFn = async () => makeHistoricalResponse([]);
    const provider = new AvEodOptionQuoteProvider(fetchChain);

    await assert.rejects(
      provider.getQuote('SPY250817P00770000', 'SPY', TradeSide.SHORT),
      /not found/,
    );
  });

  it('getEodChain returns the raw contract list', async () => {
    const fetchChain: FetchEodChainFn = async () =>
      makeHistoricalResponse([makeContract()]);
    const provider = new AvEodOptionQuoteProvider(fetchChain);
    const chain = await provider.getEodChain('SPY');
    assert.equal(chain.length, 1);
    assert.equal(chain[0]?.contractID, 'SPY250817P00770000');
  });
});
