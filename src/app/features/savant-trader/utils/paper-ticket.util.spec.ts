import {
  isPaperEligibleTicket,
  toPaperSignalOrderRequest,
  paperQuantityFor,
} from './paper-ticket.util';
import {
  EquityOrderTicket,
  InstrumentType,
  OrderSource,
  OrderTicket,
  OrderTicketStatus,
} from '../services/order-ticket.types';
import type { OrderTicketSignalContext } from '../services/order-ticket.types';

function ctx(decisionId: string): OrderTicketSignalContext {
  return {
    signalType: 'ST_ENTRY',
    barDate: '2026-08-24',
    timeframe: 'daily',
    direction: 'LONG',
    decisionId,
  };
}

function makeTicket(overrides: Partial<EquityOrderTicket> = {}): EquityOrderTicket {
  return {
    id: 't1',
    refId: 'ref-t1',
    source: OrderSource.SIGNAL_PIPELINE,
    status: OrderTicketStatus.STAGED,
    accountNumber: '123456789',
    side: 'buy',
    orderType: 'market',
    timeInForce: 'gfd',
    marketHours: 'regular_hours',
    instrumentType: InstrumentType.EQUITY,
    symbol: 'AAPL',
    quantity: '100',
    createdAt: '2026-08-25T12:00:00Z',
    updatedAt: '2026-08-25T12:00:00Z',
    signalContext: ctx('dec-1'),
    ...overrides,
  } as EquityOrderTicket;
}

describe('paper-ticket.util (#709)', () => {
  describe('isPaperEligibleTicket', () => {
    it('accepts a staged signal-pipeline equity ticket with a decision id', () => {
      expect(isPaperEligibleTicket(makeTicket())).toBe(true);
    });

    it('rejects non-staged, option, manual, and context-less tickets', () => {
      expect(
        isPaperEligibleTicket(makeTicket({ status: OrderTicketStatus.SUBMITTED })),
      ).toBe(false);
      expect(
        isPaperEligibleTicket({
          ...makeTicket(),
          instrumentType: InstrumentType.OPTION,
          legs: [],
        } as OrderTicket),
      ).toBe(false);
      expect(
        isPaperEligibleTicket(makeTicket({ source: OrderSource.MANUAL })),
      ).toBe(false);
      expect(isPaperEligibleTicket(makeTicket({ signalContext: undefined }))).toBe(false);
      expect(isPaperEligibleTicket(null)).toBe(false);
    });
  });

  describe('toPaperSignalOrderRequest', () => {
    it('canonicalizes a legacy hyphen decisionId to the doc id', () => {
      // Legacy tickets carry `${runId}-${symbol}-${tf}-${type}` while the
      // backend keys stats/idempotency on `${runId}_${SYMBOL}_${tf}_${type}`.
      const t = makeTicket({
        signalContext: ctx('run-2026-09-01-AAPL-daily-ST_ENTRY'),
      });
      const req = toPaperSignalOrderRequest(t, 5);
      expect(req.signalId).toBe('run-2026-09-01_AAPL_daily_ST_ENTRY');
      expect(req.symbol).toBe('AAPL');
      expect(req.refId).toBe('ref-t1');
      expect(req.quantity).toBe(5);
    });

    it('leaves an already-canonical decisionId untouched', () => {
      const t = makeTicket({ signalContext: ctx('run-1_AAPL_daily_ST_ENTRY') });
      expect(toPaperSignalOrderRequest(t, 5).signalId).toBe('run-1_AAPL_daily_ST_ENTRY');
    });

    it('maps a sell-side ticket to SHORT — never reads untyped ctx.direction', () => {
      const t = makeTicket({ side: 'sell', signalContext: ctx('d') });
      expect(toPaperSignalOrderRequest(t, 5).direction).toBe('short');
    });
  });

  describe('paperQuantityFor', () => {
    it('returns the explicit quantity when set', () => {
      expect(paperQuantityFor(makeTicket({ quantity: '7' }), 50, 100)).toBe(7);
    });

    it('derives whole shares from dollarAmount at the live price', () => {
      const t = makeTicket({ quantity: undefined, dollarAmount: '500' });
      expect(paperQuantityFor(t, 50, 100)).toBe(10);
    });

    it('sizes limit tickets off limitPrice — the committed basis (#723)', () => {
      const t = makeTicket({
        orderType: 'limit',
        limitPrice: '40',
        quantity: undefined,
        dollarAmount: '400',
      });
      // 400 / limitPrice(40) = 10 — not 400/live(50) = 8.
      expect(paperQuantityFor(t, 50, 100)).toBe(10);
    });

    it('falls back to the configured default when dollarAmount is absent', () => {
      const t = makeTicket({ quantity: undefined, dollarAmount: undefined });
      expect(paperQuantityFor(t, 50, 100)).toBe(2); // 100/50
    });

    it('returns undefined when nothing is computable (no price)', () => {
      const t = makeTicket({ quantity: undefined, dollarAmount: '500' });
      expect(paperQuantityFor(t, undefined, 100)).toBeUndefined();
    });
  });
});
