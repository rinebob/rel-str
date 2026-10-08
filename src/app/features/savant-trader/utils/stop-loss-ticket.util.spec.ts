import { buildPositionStopLossTicket, buildStopLossTicket, buildStopLossUpdateTicket } from './stop-loss-ticket.util';
import {
  EquityOrderTicket,
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

  it('writes the selected timeInForce and marketHours onto the ticket', () => {
    const ticket = buildPositionStopLossTicket('CLMT', '2', 51.95, 'acc-1', {
      timeInForce: 'gfd',
      marketHours: 'extended_hours',
    });

    expect(ticket.timeInForce).toBe('gfd');
    expect(ticket.marketHours).toBe('extended_hours');
  });

  it('defaults missing params independently', () => {
    const ticket = buildPositionStopLossTicket('CLMT', '2', 51.95, 'acc-1', {
      marketHours: 'all_day_hours',
    });

    expect(ticket.timeInForce).toBe('gtc');
    expect(ticket.marketHours).toBe('all_day_hours');
  });
});

describe('buildStopLossUpdateTicket', () => {
  it('records the replaced order id in a stop_loss_update sourceRef', () => {
    const ticket = buildStopLossUpdateTicket('AAPL', '100', 160.5, 'acc-123', 'order-abc');

    expect(ticket.source).toBe(OrderSource.POSITION_MANAGEMENT);
    expect(ticket.sourceRef).toEqual({ type: 'stop_loss_update', id: 'order-abc' });
    expect(ticket.side).toBe('sell');
    expect(ticket.orderType).toBe('stop_loss');
    expect(ticket.symbol).toBe('AAPL');
    expect(ticket.quantity).toBe('100');
    expect(ticket.stopPrice).toBe('160.50');
    expect(ticket.accountNumber).toBe('acc-123');
  });

  it('carries the selected timeInForce and marketHours', () => {
    const ticket = buildStopLossUpdateTicket('AAPL', '100', 160.5, 'acc-123', 'order-abc', {
      timeInForce: 'gfd',
      marketHours: 'extended_hours',
    });

    expect(ticket.timeInForce).toBe('gfd');
    expect(ticket.marketHours).toBe('extended_hours');
  });

  it('defaults to gtc / regular_hours when params are omitted', () => {
    const ticket = buildStopLossUpdateTicket('AAPL', '100', 160.5, 'acc-123', 'order-abc');

    expect(ticket.timeInForce).toBe('gtc');
    expect(ticket.marketHours).toBe('regular_hours');
  });
});

describe('buildStopLossTicket', () => {
  const entry: EquityOrderTicket = {
    id: 'entry-1',
    refId: 'ref-1',
    source: OrderSource.SIGNAL_PIPELINE,
    status: OrderTicketStatus.FILLED,
    accountNumber: 'acc-1',
    side: 'buy',
    orderType: 'market',
    timeInForce: 'gfd',
    marketHours: 'regular_hours',
    instrumentType: InstrumentType.EQUITY,
    symbol: 'AAPL',
    quantity: '10',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  it('links the stop to the entry ticket and threads params', () => {
    const ticket = buildStopLossTicket(entry, 'AAPL', '10', 150, 'acc-1', {
      timeInForce: 'gfd',
      marketHours: 'all_day_hours',
    });

    expect(ticket.sourceRef).toEqual({ type: 'stop_loss', id: 'entry-1' });
    expect(ticket.timeInForce).toBe('gfd');
    expect(ticket.marketHours).toBe('all_day_hours');
  });
});
