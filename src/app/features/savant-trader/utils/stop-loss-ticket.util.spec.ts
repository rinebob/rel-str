import { buildPositionStopLossTicket } from './stop-loss-ticket.util';
import {
  OrderSource,
  OrderTicketStatus,
  InstrumentType,
} from '../services/order-ticket.types';

describe('buildPositionStopLossTicket', () => {
  it('builds a stop-loss ticket with correct fields', () => {
    const ticket = buildPositionStopLossTicket('AAPL', '100', 160.5, 'acc-123');

    expect(ticket.source).toBe(OrderSource.POSITION_MANAGEMENT);
    expect(ticket.sourceRef).toEqual({ type: 'stop_loss', id: 'AAPL' });
    expect(ticket.side).toBe('sell');
    expect(ticket.orderType).toBe('stop_loss');
    expect(ticket.quantity).toBe('100');
    expect(ticket.stopPrice).toBe('160.50');
    expect(ticket.timeInForce).toBe('gtc');
    expect(ticket.marketHours).toBe('regular_hours');
    expect(ticket.instrumentType).toBe(InstrumentType.EQUITY);
    expect(ticket.symbol).toBe('AAPL');
    expect(ticket.accountNumber).toBe('acc-123');
    expect(ticket.status).toBe(OrderTicketStatus.STAGED);
    expect(ticket.refId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('formats stop price with 2 decimal places', () => {
    const ticket = buildPositionStopLossTicket('AAPL', '50', 100, 'acc-1');
    expect(ticket.stopPrice).toBe('100.00');
  });

  it('generates a unique refId for each call', () => {
    const t1 = buildPositionStopLossTicket('AAPL', '100', 160, 'acc-1');
    const t2 = buildPositionStopLossTicket('AAPL', '100', 160, 'acc-1');
    expect(t1.refId).not.toBe(t2.refId);
  });

  it('uses position symbol as sourceRef id', () => {
    const ticket = buildPositionStopLossTicket('MSFT', '200', 300, 'acc-1');
    expect(ticket.sourceRef).toEqual({ type: 'stop_loss', id: 'MSFT' });
    expect(ticket.symbol).toBe('MSFT');
  });
});
