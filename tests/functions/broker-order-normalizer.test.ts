import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  TradingInstrumentType,
} from '../../shared/broker-types.ts';
import type {
  RawBrokerOrder,
} from '../../shared/broker-types.ts';
import {
  normalizeBrokerOrder,
  normalizeOrderListResponse,
  extractBrokerOrderFromParsed,
  extractOrderList,
  getToolLevelErrorMessage,
} from '../../functions/src/rh-agent-mcp/broker/broker-order-normalizer.ts';
import { BrokerAdapterError } from '../../functions/src/rh-agent-mcp/broker/broker-adapter-errors.ts';

// ---------------------------------------------------------------------------
// Test fixtures — shapes that mimic real Robinhood MCP tool responses
// ---------------------------------------------------------------------------

const DIRECT_ORDER_RESPONSE = {
  id: 'rh-order-uuid-1',
  ref_id: 'ref-1',
  account_number: '1234567890',
  instrument_id: 'https://api.robinhood.com/instruments/SCHB/',
  symbol: 'SCHB',
  side: 'buy',
  type: 'market',
  state: 'filled',
  quantity: '10',
  cumulative_quantity: '10',
  remaining_quantity: '0',
  price: '99.50',
  average_price: '99.42',
  fees: '0.00',
  time_in_force: 'gfd',
  trigger: 'immediate',
  created_at: '2026-09-04T15:51:00Z',
  last_transaction_at: '2026-09-04T15:51:05Z',
  executions: [{ price: '99.42', quantity: '10' }],
};

const NESTED_ORDER_RESPONSE = {
  data: {
    order: DIRECT_ORDER_RESPONSE,
  },
};

const ORDER_LIST_RESPONSE = {
  results: [DIRECT_ORDER_RESPONSE, { ...DIRECT_ORDER_RESPONSE, id: 'rh-order-uuid-2' }],
  next: 'https://api.robinhood.com/orders/?cursor=abc123',
};

// ---------------------------------------------------------------------------
// normalizeBrokerOrder
// ---------------------------------------------------------------------------

describe('normalizeBrokerOrder', () => {
  it('normalizes a direct order response into RawBrokerOrder', () => {
    const order = normalizeBrokerOrder(DIRECT_ORDER_RESPONSE, '1234567890');
    assert.equal(order.brokerOrderId, 'rh-order-uuid-1');
    assert.equal(order.refId, 'ref-1');
    assert.equal(order.accountNumber, '1234567890');
    assert.equal(order.instrumentType, TradingInstrumentType.EQUITY);
    assert.equal(order.symbol, 'SCHB');
    assert.equal(order.side, 'buy');
    assert.equal(order.type, 'market');
    assert.equal(order.rawState, 'filled');
    assert.equal(order.requestedQuantity, '10');
    assert.equal(order.cumulativeQuantity, '10');
    assert.equal(order.remainingQuantity, '0');
    assert.equal(order.averageFillPrice, '99.42');
    assert.equal(order.fees, '0.00');
    assert.equal(order.timeInForce, 'gfd');
    assert.equal(order.trigger, 'immediate');
    assert.equal(order.createdAt, '2026-09-04T15:51:00Z');
    assert.equal(order.lastTransactionAt, '2026-09-04T15:51:05Z');
    assert.ok(Array.isArray(order.executions));
    assert.equal(order.executions!.length, 1);
    assert.deepEqual(order.rawResponse, DIRECT_ORDER_RESPONSE);
  });

  it('extracts order from nested parsed.data.order response', () => {
    const order = normalizeBrokerOrder(NESTED_ORDER_RESPONSE, '1234567890');
    assert.equal(order.brokerOrderId, 'rh-order-uuid-1');
    assert.equal(order.symbol, 'SCHB');
    assert.equal(order.rawState, 'filled');
  });

  it('throws BrokerAdapterError when broker order ID is missing', () => {
    const noId = { ...DIRECT_ORDER_RESPONSE, id: undefined };
    assert.throws(
      () => normalizeBrokerOrder(noId, '1234567890'),
      BrokerAdapterError,
    );
  });

  it('throws BrokerAdapterError when response is not an object', () => {
    assert.throws(
      () => normalizeBrokerOrder('not-an-object', '1234567890'),
      BrokerAdapterError,
    );
    assert.throws(
      () => normalizeBrokerOrder(null, '1234567890'),
      BrokerAdapterError,
    );
  });

  it('throws BrokerAdapterError when side is not buy or sell', () => {
    const badSide = { ...DIRECT_ORDER_RESPONSE, side: 'sell_short' };
    assert.throws(
      () => normalizeBrokerOrder(badSide, '1234567890'),
      BrokerAdapterError,
    );
  });

  it('accepts sell side', () => {
    const sellOrder = { ...DIRECT_ORDER_RESPONSE, side: 'sell' };
    const order = normalizeBrokerOrder(sellOrder, '1234567890');
    assert.equal(order.side, 'sell');
  });

  it('preserves unknown raw states without mapping them', () => {
    const unknownState = { ...DIRECT_ORDER_RESPONSE, state: 'unverified_future_state' };
    const order = normalizeBrokerOrder(unknownState, '1234567890');
    assert.equal(order.rawState, 'unverified_future_state');
  });

  it('preserves all supported raw states', () => {
    const states = ['queued', 'confirmed', 'filled', 'cancelled', 'canceled', 'rejected', 'failed', 'expired', 'partially_filled'];
    for (const state of states) {
      const order = normalizeBrokerOrder({ ...DIRECT_ORDER_RESPONSE, state }, '1234567890');
      assert.equal(order.rawState, state);
    }
  });

  it('preserves stopPrice and dollarBasedAmount when present', () => {
    const stopOrder = {
      ...DIRECT_ORDER_RESPONSE,
      id: 'rh-stop-1',
      type: 'stop_market',
      state: 'confirmed',
      stop_price: '95.00',
      dollar_based_amount: '1000.00',
      trigger: 'stop',
      triggered_at: '2026-09-04T16:00:00Z',
    };
    const order = normalizeBrokerOrder(stopOrder, '1234567890');
    assert.equal(order.stopPrice, '95.00');
    assert.equal(order.dollarBasedAmount, '1000.00');
    assert.equal(order.trigger, 'stop');
    assert.equal(order.triggeredAt, '2026-09-04T16:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// normalizeOrderListResponse
// ---------------------------------------------------------------------------

describe('normalizeOrderListResponse', () => {
  it('normalizes a results array into BrokerOrderPage with cursor', () => {
    const page = normalizeOrderListResponse(ORDER_LIST_RESPONSE, '1234567890');
    assert.equal(page.orders.length, 2);
    assert.equal(page.orders[0]!.brokerOrderId, 'rh-order-uuid-1');
    assert.equal(page.orders[1]!.brokerOrderId, 'rh-order-uuid-2');
    assert.equal(page.nextCursor, 'abc123');
  });

  it('normalizes an orders container as alternative to results', () => {
    const ordersContainer = { orders: [DIRECT_ORDER_RESPONSE], next: null };
    const page = normalizeOrderListResponse(ordersContainer, '1234567890');
    assert.equal(page.orders.length, 1);
    assert.equal(page.nextCursor, undefined);
  });

  it('returns empty page when response has no recognizable container', () => {
    const page = normalizeOrderListResponse({ unrelated: true }, '1234567890');
    assert.equal(page.orders.length, 0);
    assert.equal(page.nextCursor, undefined);
  });

  it('returns empty page for empty results array', () => {
    const page = normalizeOrderListResponse({ results: [], next: null }, '1234567890');
    assert.equal(page.orders.length, 0);
    assert.equal(page.nextCursor, undefined);
  });

  it('extracts cursor from next URL query parameter', () => {
    const withUrlCursor = {
      results: [DIRECT_ORDER_RESPONSE],
      next: 'https://api.robinhood.com/orders/?cursor=xyz789',
    };
    const page = normalizeOrderListResponse(withUrlCursor, '1234567890');
    assert.equal(page.nextCursor, 'xyz789');
  });

  it('returns undefined cursor when next URL has no cursor param', () => {
    const noCursorParam = {
      results: [DIRECT_ORDER_RESPONSE],
      next: 'https://api.robinhood.com/orders/',
    };
    const page = normalizeOrderListResponse(noCursorParam, '1234567890');
    assert.equal(page.nextCursor, undefined);
  });

  it('counts skipped items that fail normalization', () => {
    const mixedList = {
      results: [
        DIRECT_ORDER_RESPONSE,
        { ...DIRECT_ORDER_RESPONSE, id: undefined }, // will fail
        { ...DIRECT_ORDER_RESPONSE, id: 'rh-order-uuid-3', side: 'bad_side' }, // will fail
      ],
      next: null,
    };
    const page = normalizeOrderListResponse(mixedList, '1234567890');
    assert.equal(page.orders.length, 1);
    assert.equal(page.skipped, 2);
  });
});

// ---------------------------------------------------------------------------
// getToolLevelErrorMessage
// ---------------------------------------------------------------------------

describe('getToolLevelErrorMessage', () => {
  it('detects isError flag and returns error message', () => {
    assert.equal(getToolLevelErrorMessage({ isError: true, error: 'order rejected' }), 'order rejected');
  });

  it('detects nested isError in parsed.data and returns nested error message', () => {
    assert.equal(
      getToolLevelErrorMessage({ data: { isError: true, error: 'Insufficient buying power' } }),
      'Insufficient buying power',
    );
  });

  it('returns default message for isError without error field', () => {
    assert.equal(getToolLevelErrorMessage({ isError: true }), 'Unknown tool error');
    assert.equal(getToolLevelErrorMessage({ data: { isError: true } }), 'Unknown tool error');
  });

  it('returns undefined for normal responses without isError', () => {
    assert.equal(getToolLevelErrorMessage(DIRECT_ORDER_RESPONSE), undefined);
    assert.equal(getToolLevelErrorMessage({ data: { order: DIRECT_ORDER_RESPONSE } }), undefined);
  });

  it('returns undefined for null or non-object inputs', () => {
    assert.equal(getToolLevelErrorMessage(null), undefined);
    assert.equal(getToolLevelErrorMessage('string'), undefined);
    assert.equal(getToolLevelErrorMessage(undefined), undefined);
  });
});

// ---------------------------------------------------------------------------
// extractBrokerOrderFromParsed
// ---------------------------------------------------------------------------

describe('extractBrokerOrderFromParsed', () => {
  it('extracts from direct response', () => {
    const extracted = extractBrokerOrderFromParsed(DIRECT_ORDER_RESPONSE);
    assert.ok(extracted);
    assert.equal(extracted.id, 'rh-order-uuid-1');
  });

  it('extracts from nested parsed.data.order', () => {
    const extracted = extractBrokerOrderFromParsed(NESTED_ORDER_RESPONSE);
    assert.ok(extracted);
    assert.equal(extracted.id, 'rh-order-uuid-1');
  });

  it('returns null for unrecognized shapes', () => {
    assert.equal(extractBrokerOrderFromParsed({ unrelated: true }), null);
    assert.equal(extractBrokerOrderFromParsed(null), null);
    assert.equal(extractBrokerOrderFromParsed('string'), null);
  });
});

// ---------------------------------------------------------------------------
// extractOrderList
// ---------------------------------------------------------------------------

describe('extractOrderList', () => {
  it('extracts results array', () => {
    const list = extractOrderList(ORDER_LIST_RESPONSE);
    assert.ok(list);
    assert.equal(list!.length, 2);
  });

  it('extracts orders array', () => {
    const list = extractOrderList({ orders: [DIRECT_ORDER_RESPONSE] });
    assert.ok(list);
    assert.equal(list!.length, 1);
  });

  it('returns null for non-list shapes', () => {
    assert.equal(extractOrderList({ unrelated: true }), null);
    assert.equal(extractOrderList(NESTED_ORDER_RESPONSE), null);
    assert.equal(extractOrderList(null), null);
  });

  it('returns empty array for empty results', () => {
    const list = extractOrderList({ results: [] });
    assert.ok(list);
    assert.equal(list!.length, 0);
  });
});
