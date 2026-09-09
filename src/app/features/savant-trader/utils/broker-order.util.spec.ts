import { BrokerOrderSnapshot, OrderTicketStatus } from '../services/order-ticket.types';
import {
  extractOrdersFromResponse,
  normalizeToBrokerOrderSnapshot,
  parseEquityOrdersResponse,
  isActiveStopLoss,
  findActiveStopLoss,
  rhStateToTerminalStatus,
  rhStateToDisplayStatus,
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
    type: 'market',
    trigger: 'stop',
    state: 'confirmed',
    symbol: 'AAPL',
    stop_price: '140.00',
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
      expect(map['stop-1'].type).toBe('market');
    });
  });

  describe('isActiveStopLoss', () => {
    const stopOrder: BrokerOrderSnapshot = {
      id: 'stop-1', symbol: 'AAPL', side: 'sell', type: 'market', state: 'confirmed',
      quantity: '10', cumulativeQuantity: '0', price: null, stopPrice: '140',
      fees: '0', dollarBasedAmount: null, timeInForce: 'gtc', marketHours: 'regular_hours',
      trigger: 'stop', placedAgent: 'agentic', createdAt: '', lastTransactionAt: '',
    };

    it('returns true for an active stop-loss sell order (trigger=stop)', () => {
      expect(isActiveStopLoss(stopOrder, 'AAPL')).toBe(true);
    });

    it('returns true for a stop-loss with type=market and trigger=stop (real RH shape)', () => {
      expect(isActiveStopLoss({ ...stopOrder, type: 'market', trigger: 'stop' }, 'AAPL')).toBe(true);
    });

    it('returns false for a buy-side stop order', () => {
      expect(isActiveStopLoss({ ...stopOrder, side: 'buy' }, 'AAPL')).toBe(false);
    });

    it('returns false for a market order without stop trigger', () => {
      expect(isActiveStopLoss({ ...stopOrder, trigger: 'immediate' }, 'AAPL')).toBe(false);
    });

    it('returns false for a cancelled stop order', () => {
      expect(isActiveStopLoss({ ...stopOrder, state: 'cancelled' }, 'AAPL')).toBe(false);
      expect(isActiveStopLoss({ ...stopOrder, state: 'canceled' }, 'AAPL')).toBe(false);
    });

    it('returns false for a rejected stop order', () => {
      expect(isActiveStopLoss({ ...stopOrder, state: 'rejected' }, 'AAPL')).toBe(false);
    });

    it('returns false for a filled stop order', () => {
      expect(isActiveStopLoss({ ...stopOrder, state: 'filled' }, 'AAPL')).toBe(false);
    });

    it('returns false for a different symbol', () => {
      expect(isActiveStopLoss(stopOrder, 'MSFT')).toBe(false);
    });
  });

  describe('findActiveStopLoss', () => {
    const stopOrder: BrokerOrderSnapshot = {
      id: 'stop-1', symbol: 'AAPL', side: 'sell', type: 'market', state: 'confirmed',
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

  describe('rhStateToTerminalStatus', () => {
    it('maps filled to FILLED', () => {
      expect(rhStateToTerminalStatus('filled')).toBe(OrderTicketStatus.FILLED);
    });

    it('maps cancelled to CANCELLED (case-insensitive)', () => {
      expect(rhStateToTerminalStatus('cancelled')).toBe(OrderTicketStatus.CANCELLED);
      expect(rhStateToTerminalStatus('CANCELLED')).toBe(OrderTicketStatus.CANCELLED);
      expect(rhStateToTerminalStatus('Canceled')).toBe(OrderTicketStatus.CANCELLED);
    });

    it('maps failed/rejected/voided to FAILED', () => {
      expect(rhStateToTerminalStatus('failed')).toBe(OrderTicketStatus.FAILED);
      expect(rhStateToTerminalStatus('rejected')).toBe(OrderTicketStatus.FAILED);
      expect(rhStateToTerminalStatus('voided')).toBe(OrderTicketStatus.FAILED);
    });

    it('returns null for non-terminal states', () => {
      expect(rhStateToTerminalStatus('confirmed')).toBeNull();
      expect(rhStateToTerminalStatus('queued')).toBeNull();
      expect(rhStateToTerminalStatus('partially_filled')).toBeNull();
    });
  });

  describe('rhStateToDisplayStatus', () => {
    it('maps terminal states via rhStateToTerminalStatus', () => {
      expect(rhStateToDisplayStatus('filled', true)).toBe(OrderTicketStatus.FILLED);
      expect(rhStateToDisplayStatus('cancelled', true)).toBe(OrderTicketStatus.CANCELLED);
    });

    it('maps queued to QUEUED', () => {
      expect(rhStateToDisplayStatus('queued', false)).toBe(OrderTicketStatus.QUEUED);
    });

    it('maps confirmed to SUBMITTED for market orders', () => {
      expect(rhStateToDisplayStatus('confirmed', true)).toBe(OrderTicketStatus.SUBMITTED);
    });

    it('maps confirmed to RESTING for non-market orders', () => {
      expect(rhStateToDisplayStatus('confirmed', false)).toBe(OrderTicketStatus.RESTING);
    });

    it('maps partially_filled to SUBMITTED for market orders', () => {
      expect(rhStateToDisplayStatus('partially_filled', true)).toBe(OrderTicketStatus.SUBMITTED);
    });

    it('maps partially_filled to RESTING for non-market orders', () => {
      expect(rhStateToDisplayStatus('partially_filled', false)).toBe(OrderTicketStatus.RESTING);
    });
  });
});
