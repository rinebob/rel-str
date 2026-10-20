/**
 * signal-order-staging.util spec — orderTicketTerms (#762 review):
 * pins the shared terms formatter the gallery card line and the dialog
 * confirmation both consume.
 */
import { orderTicketTerms } from './signal-order-staging.util';
import {
  EquityOrderTicket,
  InstrumentType,
  OptionOrderTicket,
  OrderSource,
  OrderTicketStatus,
} from '../services/order-ticket.types';

const base: Omit<EquityOrderTicket, 'instrumentType' | 'symbol'> = {
  id: 't-1',
  refId: 'r-1',
  source: OrderSource.SIGNAL_PIPELINE,
  status: OrderTicketStatus.STAGED,
  accountNumber: 'a',
  side: 'buy',
  orderType: 'limit',
  timeInForce: 'gfd',
  marketHours: 'regular_hours',
  createdAt: '',
  updatedAt: '',
};

describe('orderTicketTerms', () => {
  it('renders quantity @ limit for equity limit tickets', () => {
    const t: EquityOrderTicket = {
      ...base, instrumentType: InstrumentType.EQUITY, symbol: 'AAPL',
      quantity: '10', limitPrice: '210.50',
    };
    expect(orderTicketTerms(t)).toBe('10 @ 210.50');
  });

  it('renders quantity @ mkt when a quantity ticket lacks a limit price', () => {
    const t: EquityOrderTicket = {
      ...base, instrumentType: InstrumentType.EQUITY, symbol: 'AAPL',
      orderType: 'market', quantity: '10',
    };
    expect(orderTicketTerms(t)).toBe('10 @ mkt');
  });

  it('renders the dollar amount for signal-staged market tickets', () => {
    const t: EquityOrderTicket = {
      ...base, instrumentType: InstrumentType.EQUITY, symbol: 'AAPL',
      orderType: 'market', dollarAmount: '200',
    };
    expect(orderTicketTerms(t)).toBe('$200');
  });

  it('renders contract terms for option tickets — price, not limitPrice', () => {
    const t = {
      ...base, instrumentType: InstrumentType.OPTION, quantity: '2', price: '1.25',
    } as OptionOrderTicket;
    expect(orderTicketTerms(t)).toBe('opt 2 @ 1.25');
  });
});
