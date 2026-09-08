import { BrokerOrderSnapshot } from '../services/order-ticket.types';
import {
  extractOrdersFromResponse,
  normalizeToBrokerOrderSnapshot,
  parseEquityOrdersResponse,
  isActiveStopLoss,
  findActiveStopLoss,
} from './broker-order.util';

describe('broker-order.util', () => {
  const orderRaw = {
    id: 'order-1',
    instrument_id: 'inst-1',
    symbol: 'AAPL',
    side: 'buy',
    type: 'market',
    state: 'filled',
    quantity: '10',
    cumulative_quantity: '10',
    price: null,
    stop_price: null,
    fees: '0',
    dollar_based_amount: null,
    time_in_force: 'gfd',
    market_hours: 'regular_hours',
    trigger: 'immediate',
    placed_agent: 'agentic',
    created_at: '2026-09-07T12:00:00Z',
    last_transaction_at: '2026-09-07T12:00:00Z',
    executions: [],
  };

  const stopOrderRaw = {
    ...orderRaw,
    id: 'stop-1',
    side: 'sell',
    type: 'stop_market',
    state: 'confirmed',
    symbol: 'AAPL',
  };

  describe('extractOrdersFromResponse', () => {
    it('extracts from root results array', () => {
      const parsed = { results: [orderRaw] };
      expect(extractOrdersFromResponse(parsed).length).toBe(1);
    });

    it('extracts from root orders array', () => {
      const parsed = { orders: [orderRaw] };
      expect(extractOrdersFromResponse(parsed).length).toBe(1);
    });

    it('extracts from nested data.results', () => {
      const parsed = { data: { results: [orderRaw] } };
      expect(extractOrdersFromResponse(parsed).length).toBe(1);
    });

    it('extracts from nested data.orders', () => {
      const parsed = { data: { orders: [orderRaw] } };
      expect(extractOrdersFromResponse(parsed).length).toBe(1);
    });

    it('returns empty array for unrecognized shape', () => {
      expect(extractOrdersFromResponse({ foo: 'bar' }).length).toBe(0);
    });

    it('returns empty array for non-object input', () => {
      expect(extractOrdersFromResponse(null).length).toBe(0);
      expect(extractOrdersFromResponse(undefined).length).toBe(0);
      expect(extractOrdersFromResponse('string').length).toBe(0);
    });
  });

  describe('normalizeToBrokerOrderSnapshot', () => {
    it('normalizes a raw order into a BrokerOrderSnapshot', () => {
      const snapshot = normalizeToBrokerOrderSnapshot(orderRaw);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.id).toBe('order-1');
      expect(snapshot!.symbol).toBe('AAPL');
      expect(snapshot!.state).toBe('filled');
    });

    it('returns null when id is missing or non-string', () => {
      expect(normalizeToBrokerOrderSnapshot({ ...orderRaw, id: undefined })).toBeNull();
      expect(normalizeToBrokerOrderSnapshot({ ...orderRaw, id: 123 })).toBeNull();
    });
  });

  describe('parseEquityOrdersResponse', () => {
    it('parses a list response into a map keyed by order ID', () => {
      const parsed = { results: [orderRaw, stopOrderRaw] };
      const map = parseEquityOrdersResponse(parsed);
      expect(Object.keys(map).length).toBe(2);
      expect(map['order-1'].symbol).toBe('AAPL');
      expect(map['stop-1'].type).toBe('stop_market');
    });
  });

  describe('isActiveStopLoss', () => {
    const stopOrder: BrokerOrderSnapshot = {
      id: 'stop-1', symbol: 'AAPL', side: 'sell', type: 'stop_market', state: 'confirmed',
      quantity: '10', cumulativeQuantity: '0', price: null, stopPrice: '140',
      fees: '0', dollarBasedAmount: null, timeInForce: 'gtc', marketHours: 'regular_hours',
      trigger: 'stop', placedAgent: 'agentic', createdAt: '', lastTransactionAt: '',
    };

    it('returns true for an active stop-loss sell order', () => {
      expect(isActiveStopLoss(stopOrder, 'AAPL')).toBe(true);
    });

    it('returns false for a buy-side stop order', () => {
      expect(isActiveStopLoss({ ...stopOrder, side: 'buy' }, 'AAPL')).toBe(false);
    });

    it('returns false for a non-stop order type', () => {
      expect(isActiveStopLoss({ ...stopOrder, type: 'market' }, 'AAPL')).toBe(false);
    });

    it('returns false for a cancelled stop order', () => {
      expect(isActiveStopLoss({ ...stopOrder, state: 'cancelled' }, 'AAPL')).toBe(false);
      expect(isActiveStopLoss({ ...stopOrder, state: 'canceled' }, 'AAPL')).toBe(false);
    });

    it('returns false for a rejected stop order', () => {
      expect(isActiveStopLoss({ ...stopOrder, state: 'rejected' }, 'AAPL')).toBe(false);
    });

    it('returns false for a different symbol', () => {
      expect(isActiveStopLoss(stopOrder, 'MSFT')).toBe(false);
    });
  });

  describe('findActiveStopLoss', () => {
    const stopOrder: BrokerOrderSnapshot = {
      id: 'stop-1', symbol: 'AAPL', side: 'sell', type: 'stop_limit', state: 'confirmed',
      quantity: '10', cumulativeQuantity: '0', price: null, stopPrice: '140',
      fees: '0', dollarBasedAmount: null, timeInForce: 'gtc', marketHours: 'regular_hours',
      trigger: 'stop', placedAgent: 'agentic', createdAt: '', lastTransactionAt: '',
    };
    const entryOrder: BrokerOrderSnapshot = {
      ...stopOrder, id: 'entry-1', side: 'buy', type: 'market', state: 'filled', stopPrice: null,
    };

    it('finds the active stop-loss for a symbol', () => {
      const map = { 'entry-1': entryOrder, 'stop-1': stopOrder };
      expect(findActiveStopLoss(map, 'AAPL')?.id).toBe('stop-1');
    });

    it('returns null when no active stop-loss exists', () => {
      const map = { 'entry-1': entryOrder };
      expect(findActiveStopLoss(map, 'AAPL')).toBeNull();
    });

    it('returns null for an empty map', () => {
      expect(findActiveStopLoss({}, 'AAPL')).toBeNull();
    });
  });
});
