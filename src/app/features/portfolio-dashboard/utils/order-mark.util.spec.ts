import { orderMark } from './order-mark.util';
import {
  BrokerOrder,
  EquityQuote,
  OptionQuote,
} from '../../../core/robinhood-mcp/types/robinhood-mcp.types';

function makeOrder(overrides: Partial<BrokerOrder> = {}): BrokerOrder {
  return {
    orderId: 'ord-1',
    accountNumber: '123',
    instrumentType: 'equity',
    symbol: 'AAPL',
    side: 'buy',
    type: 'limit',
    state: 'queued',
    quantity: 1,
    cumulativeQuantity: 0,
    price: 100,
    stopPrice: null,
    averageFillPrice: null,
    createdAt: null,
    ...overrides,
  };
}

const eqQuotes = (price: number | null) =>
  new Map<string, EquityQuote>([
    ['AAPL', { symbol: 'AAPL', lastTradePrice: price, previousClose: 179 }],
  ]);
const optQuotes = (price: number | null) =>
  new Map<string, OptionQuote>([
    ['opt-1', { instrumentId: 'opt-1', lastTradePrice: price, previousClose: 3.1 }],
  ]);

describe('orderMark', () => {
  it('joins an equity order on symbol → equityQuotes', () => {
    expect(orderMark(makeOrder(), eqQuotes(180.5), null)).toBe(180.5);
  });

  it('joins a single-leg option order on legs[0].optionId → optionQuotes', () => {
    const order = makeOrder({
      instrumentType: 'option',
      symbol: null,
      legs: [{ side: 'buy', optionId: 'opt-1', quantity: 1, positionEffect: 'open' }],
    });
    expect(orderMark(order, null, optQuotes(3.4))).toBe(3.4);
  });

  it('returns null for a multi-leg option order', () => {
    const order = makeOrder({
      instrumentType: 'option',
      symbol: null,
      legs: [
        { side: 'buy', optionId: 'opt-1', quantity: 1, positionEffect: 'open' },
        { side: 'sell', optionId: 'opt-2', quantity: 1, positionEffect: 'open' },
      ],
    });
    expect(orderMark(order, null, optQuotes(3.4))).toBeNull();
  });

  it('returns null when the option leg lacks an optionId', () => {
    const order = makeOrder({
      instrumentType: 'option',
      symbol: null,
      legs: [{ side: 'buy', optionId: null, quantity: 1, positionEffect: 'open' }],
    });
    expect(orderMark(order, null, optQuotes(3.4))).toBeNull();
  });

  it('returns null when the quote is absent or priced null', () => {
    expect(orderMark(makeOrder(), new Map(), null)).toBeNull();
    expect(orderMark(makeOrder(), eqQuotes(null), null)).toBeNull();
  });

  it('returns null for an equity order with no symbol', () => {
    expect(orderMark(makeOrder({ symbol: null }), eqQuotes(180.5), null)).toBeNull();
  });

  it('tolerates null quote maps', () => {
    expect(orderMark(makeOrder(), null, null)).toBeNull();
  });
});
