/**
 * @topic #984 — ST Firestore Reorg (task #998)
 *
 * Shape pins for the canonical `st-order-tickets` contract. Doc-level
 * coverage — literal value sets, structural keys, terms validation.
 */
import {
  ST_TICKET_ORIGIN_TYPES,
  ST_TICKET_STATES,
  ST_TICKET_SIDES,
  ST_TICKET_INSTRUMENTS,
  validateStTicketTerms,
  StOrderTicket,
} from './st-order-tickets';
import { ST_MODES } from './st-types';

const TICKET: StOrderTicket = {
  id: 'pap_abc123',
  origin: { type: 'signal', signalId: 'ADPT_2026-10-15_D_ST_TREND_RIDER_V1_LONG' },
  auto: true,
  mode: 'paper',
  terms: { symbol: 'ADPT', side: 'buy', quantity: 2 },
  state: 'staged',
  refId: 'rs-paper-abc123',
  accountTarget: 'acct-paper-u1',
  userId: 'u1',
  createdAt: '2026-10-15T14:00:00.000Z',
  updatedAt: '2026-10-15T14:00:00.000Z',
};

/** Live option ticket — legs carry the RH ordering identity. */
const OPTION_TICKET: StOrderTicket = {
  ...TICKET,
  id: 'liv_def456',
  mode: 'live',
  terms: {
    symbol: 'ADPT',
    side: 'sell',
    instrument: 'option',
    quantity: 1,
    orderType: 'limit',
    timeInForce: 'gfd',
    limits: { limitPrice: 0.25 },
    legs: [{
      side: 'sell',
      occSymbol: 'ADPT 260116P00010000',
      optionId: 'opt-uuid-1',
      positionEffect: 'open',
    }],
  },
};

describe('StOrderTicket value sets', () => {
  it('origin types match the planned sig/prg/man/mgmt vocabulary', () => {
    expect(ST_TICKET_ORIGIN_TYPES).toEqual(['signal', 'program', 'manual', 'management']);
  });

  it('ticket states cover staging through terminal, incl. failed', () => {
    expect(ST_TICKET_STATES).toEqual([
      'staged', 'submitted', 'cancel_pending', 'filled', 'cancelled', 'expired', 'failed',
    ]);
  });

  it('side/instrument value sets match the legacy order enums', () => {
    expect(ST_TICKET_SIDES).toEqual(['buy', 'sell']);
    expect(ST_TICKET_INSTRUMENTS).toEqual(['equity', 'etf', 'option']);
  });

  it('StMode covers live + paper', () => {
    expect(ST_MODES).toEqual(['live', 'paper']);
  });
});

describe('StOrderTicket shape', () => {
  it('key set stays stable', () => {
    expect(Object.keys(TICKET).sort()).toEqual([
      'accountTarget', 'auto', 'createdAt', 'id', 'mode', 'origin', 'refId',
      'state', 'terms', 'updatedAt', 'userId',
    ]);
  });

  it('doc-id prefix mirrors mode', () => {
    for (const mode of ST_MODES) {
      const t: StOrderTicket = { ...TICKET, id: `${mode === 'live' ? 'liv' : 'pap'}_x`, mode };
      expect(t.id.startsWith(mode === 'live' ? 'liv_' : 'pap_')).toBe(true);
    }
  });

  it('terms always carries the underlying symbol', () => {
    expect(TICKET.terms.symbol).toBe('ADPT');
    expect(OPTION_TICKET.terms.symbol).toBe('ADPT');
  });

  it('option tickets carry leg contract identity', () => {
    const leg = OPTION_TICKET.terms.legs![0];
    expect(leg.optionId).toBe('opt-uuid-1');
    expect(leg.positionEffect).toBe('open');
    expect(OPTION_TICKET.terms.orderType).toBe('limit');
  });
});

describe('validateStTicketTerms', () => {
  it('accepts quantity-only and dollarAmount-only terms', () => {
    expect(() => validateStTicketTerms({ symbol: 'ADPT', side: 'buy', quantity: 2 })).not.toThrow();
    expect(() => validateStTicketTerms({ symbol: 'ADPT', side: 'buy', dollarAmount: 250 })).not.toThrow();
  });

  it('rejects both quantity and dollarAmount', () => {
    expect(() =>
      validateStTicketTerms({ symbol: 'ADPT', side: 'buy', quantity: 2, dollarAmount: 250 }),
    ).toThrow(/mutually exclusive/);
  });

  it('rejects neither quantity nor dollarAmount', () => {
    expect(() => validateStTicketTerms({ symbol: 'ADPT', side: 'buy' })).toThrow(/required/);
  });

  it('rejects non-positive and non-integer quantities', () => {
    for (const quantity of [0, -5, 1.5, NaN, Infinity]) {
      expect(() => validateStTicketTerms({ symbol: 'ADPT', side: 'buy', quantity })).toThrow(/positive integer/);
    }
  });

  it('rejects non-positive and non-finite dollar amounts', () => {
    for (const dollarAmount of [0, -100, NaN, Infinity]) {
      expect(() => validateStTicketTerms({ symbol: 'ADPT', side: 'buy', dollarAmount })).toThrow(/positive and finite/);
    }
  });
});
