import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  TradingInstrumentType,
} from '../../shared/broker-types.ts';
import {
  normalizeSymbolPosition,
  normalizePositionListResponse,
} from '../../functions/src/rh-agent-mcp/broker/broker-position-normalizer.ts';
import { BrokerAdapterError } from '../../functions/src/rh-agent-mcp/broker/broker-adapter-errors.ts';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const POSITION_RESPONSE = {
  account_number: '1234567890',
  symbol: 'SCHB',
  instrument_id: 'https://api.robinhood.com/instruments/SCHB/',
  quantity: '10.5',
  intraday_quantity: '0',
  average_buy_price: '99.42',
  shares_held_for_sells: '0',
  shares_available_for_sells: '10.5',
  position_type: 'long',
  updated_at: '2026-09-04T16:00:00Z',
};

const NESTED_POSITION_RESPONSE = {
  data: { position: POSITION_RESPONSE },
};

const POSITION_LIST_RESPONSE = {
  results: [POSITION_RESPONSE],
  next: null,
};

// ---------------------------------------------------------------------------
// normalizeSymbolPosition
// ---------------------------------------------------------------------------

describe('normalizeSymbolPosition', () => {
  it('normalizes a direct position response into RawSymbolPosition', () => {
    const pos = normalizeSymbolPosition(POSITION_RESPONSE, '1234567890');
    assert.equal(pos.accountNumber, '1234567890');
    assert.equal(pos.symbol, 'SCHB');
    assert.equal(pos.instrumentType, TradingInstrumentType.EQUITY);
    assert.equal(pos.quantity, '10.5');
    assert.equal(pos.intradayQuantity, '0');
    assert.equal(pos.averageBuyPrice, '99.42');
    assert.equal(pos.sharesHeldForSells, '0');
    assert.equal(pos.sharesAvailableForSells, '10.5');
    assert.equal(pos.positionType, 'long');
    assert.equal(pos.observedAt, '2026-09-04T16:00:00Z');
  });

  it('extracts position from nested parsed.data.position response', () => {
    const pos = normalizeSymbolPosition(NESTED_POSITION_RESPONSE, '1234567890');
    assert.equal(pos.symbol, 'SCHB');
    assert.equal(pos.quantity, '10.5');
  });

  it('uses caller accountNumber when raw response omits it', () => {
    const noAccount = { ...POSITION_RESPONSE, account_number: undefined };
    const pos = normalizeSymbolPosition(noAccount, '9999999999');
    assert.equal(pos.accountNumber, '9999999999');
  });

  it('throws BrokerAdapterError when symbol is missing', () => {
    const noSymbol = { ...POSITION_RESPONSE, symbol: undefined };
    assert.throws(
      () => normalizeSymbolPosition(noSymbol, '1234567890'),
      BrokerAdapterError,
    );
  });
});

// ---------------------------------------------------------------------------
// normalizePositionListResponse
// ---------------------------------------------------------------------------

describe('normalizePositionListResponse', () => {
  it('normalizes a results array into RawSymbolPositionPage', () => {
    const page = normalizePositionListResponse(POSITION_LIST_RESPONSE, '1234567890');
    assert.equal(page.positions.length, 1);
    assert.equal(page.positions[0]!.symbol, 'SCHB');
    assert.equal(page.nextCursor, undefined);
  });

  it('extracts cursor from next URL', () => {
    const withCursor = {
      results: [POSITION_RESPONSE],
      next: 'https://api.robinhood.com/positions/?cursor=pos-cursor-1',
    };
    const page = normalizePositionListResponse(withCursor, '1234567890');
    assert.equal(page.nextCursor, 'pos-cursor-1');
  });

  it('counts skipped items that fail normalization', () => {
    const mixedList = {
      results: [
        POSITION_RESPONSE,
        { ...POSITION_RESPONSE, symbol: undefined }, // will fail
      ],
      next: null,
    };
    const page = normalizePositionListResponse(mixedList, '1234567890');
    assert.equal(page.positions.length, 1);
    assert.equal(page.skipped, 1);
  });

  it('returns empty page for empty results array', () => {
    const page = normalizePositionListResponse({ results: [], next: null }, '1234567890');
    assert.equal(page.positions.length, 0);
    assert.equal(page.nextCursor, undefined);
  });
});
