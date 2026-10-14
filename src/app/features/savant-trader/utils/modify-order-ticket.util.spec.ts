import { buildModifyOrderTicket } from './modify-order-ticket.util';
import { BrokerOrder } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';
import {
  InstrumentType,
  OrderSource,
  OrderTicketStatus,
} from '../services/order-ticket.types';

function makeOrder(overrides: Partial<BrokerOrder> = {}): BrokerOrder {
  return {
    orderId: 'ord-1',
    accountNumber: '123',
    instrumentType: 'equity',
    symbol: 'AAPL',
    side: 'buy',
    type: 'limit',
    state: 'queued',
    quantity: 10,
    cumulativeQuantity: 0,
    price: 170,
    stopPrice: null,
    averageFillPrice: null,
    createdAt: null,
    ...overrides,
  };
}

describe('buildModifyOrderTicket', () => {
  it('builds a limit ticket mirroring the order, at the new price', () => {
    const ticket = buildModifyOrderTicket(makeOrder(), 180, new Date('2026-10-13T12:00:00Z'))!;

    expect(ticket.symbol).toBe('AAPL');
    expect(ticket.accountNumber).toBe('123');
    expect(ticket.side).toBe('buy');
    expect(ticket.orderType).toBe('limit');
    expect(ticket.limitPrice).toBe('180.00');
    expect(ticket.instrumentType).toBe(InstrumentType.EQUITY);
    expect(ticket.status).toBe(OrderTicketStatus.STAGED);
    expect(ticket.source).toBe(OrderSource.MANUAL);
    expect(ticket.sourceRef).toEqual({ type: 'order_modify', id: 'ord-1' });
  });

  it('mints a fresh uuid refId per call (a cancelled ref_id is burned)', () => {
    const order = makeOrder();
    const t1 = buildModifyOrderTicket(order, 180)!;
    const t2 = buildModifyOrderTicket(order, 180)!;

    expect(t1.refId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(t1.refId).not.toBe(t2.refId);
  });

  it('re-places only the unfilled remainder of a partially-filled order', () => {
    const ticket = buildModifyOrderTicket(
      makeOrder({ quantity: 10, cumulativeQuantity: 4 }),
      180,
    )!;

    expect(ticket.quantity).toBe('6');
  });

  it('carries canonical TIF/market-hours through; falls back on unknowns', () => {
    const gtc = buildModifyOrderTicket(makeOrder({ timeInForce: 'gtc', marketHours: 'all_day_hours' }), 1)!;
    expect(gtc.timeInForce).toBe('gtc');
    expect(gtc.marketHours).toBe('all_day_hours');

    const odd = buildModifyOrderTicket(makeOrder({ timeInForce: 'ioc', marketHours: 'pre_market' }), 1)!;
    expect(odd.timeInForce).toBe('gfd');
    expect(odd.marketHours).toBe('regular_hours');
  });

  it('maps sell side through', () => {
    expect(buildModifyOrderTicket(makeOrder({ side: 'sell' }), 1)!.side).toBe('sell');
  });

  it('returns null when the order has no symbol', () => {
    expect(buildModifyOrderTicket(makeOrder({ symbol: null }), 180)).toBeNull();
  });

  it('returns null when nothing remains unfilled', () => {
    expect(
      buildModifyOrderTicket(makeOrder({ quantity: 10, cumulativeQuantity: 10 }), 180),
    ).toBeNull();
  });
});
