/**
 * Manual ticket staging builders (#1177/#1188) — OrderSource.MANUAL tickets
 * with no signal provenance. Symbols are user-entered, so both builders
 * normalize case and validate the charset that lands in the Firestore doc id.
 */
import {
  InstrumentType,
  OrderSource,
  OrderTicketStatus,
} from '../services/order-ticket.types';
import { buildTicketId } from './signal-order-staging.util';
import {
  buildManualEquityTicket,
  buildManualOptionTicket,
} from './manual-ticket-staging.util';

const NOW = new Date('2026-10-21T18:30:00Z');

const equityCtx = () => ({
  accountNumber: 'acct-1',
  quantity: '7',
  now: NOW,
  buildId: buildTicketId,
  buildRefId: () => 'ref-1',
});

const optionCtx = () => ({
  accountNumber: 'acct-1',
  now: NOW,
  buildRefId: () => 'ref-1',
});

describe('buildManualEquityTicket', () => {
  it('emits a STAGED buy market ticket with MANUAL source and no provenance', () => {
    const t = buildManualEquityTicket('AAPL', equityCtx());

    expect(t).not.toBeNull();
    expect(t!.source).toBe(OrderSource.MANUAL);
    expect(t!.sourceRef).toBeUndefined();
    expect(t!.signalContext).toBeUndefined();
    expect(t!.status).toBe(OrderTicketStatus.STAGED);
    expect(t!.side).toBe('buy');
    expect(t!.orderType).toBe('market');
    expect(t!.timeInForce).toBe('gfd');
    expect(t!.marketHours).toBe('regular_hours');
    expect(t!.instrumentType).toBe(InstrumentType.EQUITY);
    expect(t!.symbol).toBe('AAPL');
    expect(t!.quantity).toBe('7');
    expect(t!.accountNumber).toBe('acct-1');
    expect(t!.refId).toBe('ref-1');
    expect(t!.createdAt).toBe(NOW.toISOString());
    expect(t!.updatedAt).toBe(NOW.toISOString());
  });

  it('ids the ticket {SYMBOL}-BUY-… via the shared buildTicketId', () => {
    const t = buildManualEquityTicket('AAPL', equityCtx());
    expect(t!.id).toBe(buildTicketId('AAPL', 'BUY', NOW));
  });

  it('normalizes case and surrounding whitespace on the user-entered symbol', () => {
    const t = buildManualEquityTicket('  aapl ', equityCtx());
    expect(t!.symbol).toBe('AAPL');
    expect(t!.id).toBe(buildTicketId('AAPL', 'BUY', NOW));
  });

  it.each(['', '   ', 'BRK/B', 'AAPL X', 'AAPL_B', '-', '..', '-AAPL', '.AAPL'])(
    'returns null for a symbol that would corrupt the doc id (%j)',
    (symbol) => {
      expect(buildManualEquityTicket(symbol, equityCtx())).toBeNull();
    },
  );

  it('accepts dot/ hyphen-bearing tickers (BRK.B, BF-B)', () => {
    expect(buildManualEquityTicket('BRK.B', equityCtx())).not.toBeNull();
    expect(buildManualEquityTicket('BF-B', equityCtx())).not.toBeNull();
  });
});

describe('buildManualOptionTicket', () => {
  const contract = { occSymbol: 'AAPL260116C00200000', optionId: 'opt-uuid-1' };

  it('emits a STAGED BTO single-leg ticket with MANUAL source and no provenance', () => {
    const t = buildManualOptionTicket('AAPL', contract, 'buy', optionCtx());

    expect(t).not.toBeNull();
    expect(t!.source).toBe(OrderSource.MANUAL);
    expect(t!.sourceRef).toBeUndefined();
    expect(t!.signalContext).toBeUndefined();
    expect(t!.status).toBe(OrderTicketStatus.STAGED);
    expect(t!.instrumentType).toBe(InstrumentType.OPTION);
    expect(t!.orderType).toBe('limit');
    expect(t!.timeInForce).toBe('gfd');
    expect(t!.marketHours).toBe('regular_hours');
    expect(t!.quantity).toBe('1');
    expect(t!.symbol).toBe('AAPL'); // underlying, not the OCC contract
    expect(t!.side).toBe('buy');
    expect(t!.legs).toEqual([
      {
        side: 'buy',
        symbol: 'AAPL260116C00200000',
        optionId: 'opt-uuid-1',
        positionEffect: 'open',
      },
    ]);
  });

  it('STO emits side sell on both the ticket and the leg', () => {
    const t = buildManualOptionTicket('AAPL', contract, 'sell', optionCtx());
    expect(t!.side).toBe('sell');
    expect(t!.legs[0].side).toBe('sell');
    expect(t!.legs[0].positionEffect).toBe('open');
  });

  it('carries an OPT-MAN-{BTO|STO}-{occ} discriminator that separates sides and never collides with signal ids', () => {
    const bto = buildManualOptionTicket('AAPL', contract, 'buy', optionCtx());
    const sto = buildManualOptionTicket('AAPL', contract, 'sell', optionCtx());
    expect(bto!.id).toBe(buildTicketId('AAPL', 'OPT-MAN-BTO-AAPL260116C00200000', NOW));
    expect(sto!.id).toBe(buildTicketId('AAPL', 'OPT-MAN-STO-AAPL260116C00200000', NOW));
    expect(bto!.id).not.toBe(sto!.id);
  });

  it.each(['', '   ', 'AAPL/B', 'aapl x'])(
    'returns null for a bad underlying symbol (%j)',
    (symbol) => {
      expect(buildManualOptionTicket(symbol, contract, 'buy', optionCtx())).toBeNull();
    },
  );

  it('returns null for a missing contract — a cleared selection must not throw', () => {
    expect(
      buildManualOptionTicket('AAPL', null!, 'buy', optionCtx()),
    ).toBeNull();
  });

  it.each(['AAPL 260116C00200000', 'AAPL/260116C00200000', ''])(
    'returns null for a bad OCC symbol (%j)',
    (occSymbol) => {
      expect(
        buildManualOptionTicket('AAPL', { occSymbol, optionId: 'opt-1' }, 'buy', optionCtx()),
      ).toBeNull();
    },
  );

  it('normalizes a lowercase OCC symbol', () => {
    const t = buildManualOptionTicket(
      'aapl',
      { occSymbol: 'aapl260116c00200000', optionId: 'opt-1' },
      'buy',
      optionCtx(),
    );
    expect(t!.legs[0].symbol).toBe('AAPL260116C00200000');
    expect(t!.symbol).toBe('AAPL');
  });
});
