import { buildClosePositionTicket } from './close-position-ticket.util';
import { EquityPosition } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';
import {
  OrderSource,
  OrderTicketStatus,
  InstrumentType,
} from '../services/order-ticket.types';

describe('buildClosePositionTicket', () => {
  const position: EquityPosition = {
    symbol: 'AAPL',
    quantity: 100,
    averageBuyPrice: 150,
    sharesHeldForSells: 0,
  };

  it('builds a market order ticket with correct fields', () => {
    const ticket = buildClosePositionTicket(position, 'market', '100', 'acc-123');

    expect(ticket.source).toBe(OrderSource.POSITION_MANAGEMENT);
    expect(ticket.sourceRef).toEqual({ type: 'position_close', id: 'AAPL' });
    expect(ticket.side).toBe('sell');
    expect(ticket.orderType).toBe('market');
    expect(ticket.quantity).toBe('100');
    expect(ticket.limitPrice).toBeUndefined();
    expect(ticket.timeInForce).toBe('gfd');
    expect(ticket.marketHours).toBe('regular_hours');
    expect(ticket.instrumentType).toBe(InstrumentType.EQUITY);
    expect(ticket.symbol).toBe('AAPL');
    expect(ticket.accountNumber).toBe('acc-123');
    expect(ticket.status).toBe(OrderTicketStatus.STAGED);
    expect(ticket.refId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('builds a limit order ticket with limitPrice', () => {
    const ticket = buildClosePositionTicket(position, 'limit', '50', 'acc-123', 155.5);

    expect(ticket.orderType).toBe('limit');
    expect(ticket.quantity).toBe('50');
    expect(ticket.limitPrice).toBe('155.50');
    expect(ticket.timeInForce).toBe('gfd');
  });

  it('omits limitPrice for market orders', () => {
    const ticket = buildClosePositionTicket(position, 'market', '100', 'acc-123');

    expect(ticket.orderType).toBe('market');
    expect(ticket.limitPrice).toBeUndefined();
  });

  it('generates a unique refId for each call', () => {
    const ticket1 = buildClosePositionTicket(position, 'market', '100', 'acc-123');
    const ticket2 = buildClosePositionTicket(position, 'market', '100', 'acc-123');

    expect(ticket1.refId).not.toBe(ticket2.refId);
  });

  it('uses position symbol as sourceRef id', () => {
    const pos: EquityPosition = { symbol: 'DELL', quantity: 50, averageBuyPrice: 200, sharesHeldForSells: 0 };
    const ticket = buildClosePositionTicket(pos, 'market', '50', 'acc-1');

    expect(ticket.sourceRef).toEqual({ type: 'position_close', id: 'DELL' });
    expect(ticket.symbol).toBe('DELL');
  });

  it('formats limit price with 2 decimal places', () => {
    const ticket = buildClosePositionTicket(position, 'limit', '100', 'acc-1', 100);

    expect(ticket.limitPrice).toBe('100.00');
  });
});
