/**
 * option-ticket-staging.util — buildOptionSignalTicket (#961). Mirrors
 * buildSignalOrderTickets: identical signalContext/decisionIds semantics,
 * but produces a single STAGED OptionOrderTicket (buy-to-open).
 */
import { buildOptionSignalTicket } from './option-ticket-staging.util';
import {
  InstrumentType,
  OrderSource,
  OrderTicketStatus,
} from '../services/order-ticket.types';
import { StSignalItem } from '../services/types';
import { SignalDirection, SignalStatus, SignalTimeframe } from '../common/constants';

const CONTRACT = { occSymbol: 'AAPL251016C00150000', optionId: 'opt-uuid-1' };
const NOW = new Date('2026-10-12T21:30:00Z'); // 2:30 PM PT Monday
const CTX = {
  runId: 'run-1',
  accountNumber: 'agentic-account',
  now: NOW,
  buildRefId: () => 'ref-uuid-1',
};

function makeSignal(direction: SignalDirection, overrides: Partial<StSignalItem> = {}): StSignalItem {
  return {
    id: '2026-10-10',
    symbol: 'AAPL',
    barDate: '2026-10-10',
    marketDate: '2026-10-10',
    runId: 'run-1',
    timeframe: SignalTimeframe.DAILY,
    direction,
    signalType: 'DAILY_BREAKOUT',
    status: SignalStatus.CONFIRMED,
    indicators: {},
    ...overrides,
  };
}

describe('buildOptionSignalTicket', () => {
  it('builds a STAGED single-leg buy-to-open ticket with fixed v1 fields', () => {
    const t = buildOptionSignalTicket('AAPL', [makeSignal(SignalDirection.LONG)], CONTRACT, CTX)!;

    expect(t.instrumentType).toBe(InstrumentType.OPTION);
    expect(t.status).toBe(OrderTicketStatus.STAGED);
    expect(t.source).toBe(OrderSource.SIGNAL_PIPELINE);
    expect(t.sourceRef).toEqual({ type: 'occurrence_decision', id: 'run-1_AAPL_D_DAILY_BREAKOUT' });
    expect(t.accountNumber).toBe('agentic-account');
    expect(t.refId).toBe('ref-uuid-1');
    expect(t.side).toBe('buy');
    expect(t.orderType).toBe('limit');
    expect(t.timeInForce).toBe('gfd');
    expect(t.marketHours).toBe('regular_hours');
    expect(t.symbol).toBe('AAPL');
    expect(t.legs).toEqual([
      { side: 'buy', symbol: 'AAPL251016C00150000', optionId: 'opt-uuid-1', positionEffect: 'open' },
    ]);
    expect(t.quantity).toBe('');
    expect(t.createdAt).toBe(NOW.toISOString());
    expect(t.updatedAt).toBe(NOW.toISOString());
  });

  it('stamps every non-rejected occurrence id — rejected ones excluded by the caller, no side filter on a SHORT card', () => {
    const signals = [
      makeSignal(SignalDirection.SHORT), // a long put on a SHORT card is still side 'buy'
      makeSignal(SignalDirection.SHORT, { timeframe: SignalTimeframe.WEEKLY }),
    ];

    const t = buildOptionSignalTicket('AAPL', signals, CONTRACT, CTX)!;

    expect(t.side).toBe('buy');
    expect(t.signalContext?.decisionIds).toEqual([
      'run-1_AAPL_D_DAILY_BREAKOUT',
      'run-1_AAPL_W_DAILY_BREAKOUT',
    ]);
    expect(t.signalContext?.decisionId).toBe('run-1_AAPL_D_DAILY_BREAKOUT');
    expect(t.signalContext?.direction).toBe('SHORT');
  });

  it('captures the first signal context fields incl. signalPrice, omitting it when absent', () => {
    const withPrice = buildOptionSignalTicket(
      'AAPL',
      [{ ...makeSignal(SignalDirection.LONG), closePrice: 187.5 }],
      CONTRACT,
      CTX,
    )!;
    expect(withPrice.signalContext?.signalPrice).toBe(187.5);
    expect(withPrice.signalContext?.signalType).toBe('DAILY_BREAKOUT');
    expect(withPrice.signalContext?.barDate).toBe('2026-10-10');

    const withoutPrice = buildOptionSignalTicket('AAPL', [makeSignal(SignalDirection.LONG)], CONTRACT, CTX)!;
    expect('signalPrice' in (withoutPrice.signalContext ?? {})).toBe(false);
  });

  it('mints a human-readable id distinguishable from the equity ticket', () => {
    const t = buildOptionSignalTicket('AAPL', [makeSignal(SignalDirection.LONG)], CONTRACT, CTX)!;
    // {SYMBOL}-OPT-{LONG|SHORT}-{occId}-<yymmdd>-<dow>-<hhmm>PT —
    // direction + contract id are the discriminators: different contracts
    // or opposite-direction cards on the same underlying must not collide
    // on a PT-minute-resolution id (no uniqueness enforcement downstream —
    // a duplicate id would .set()-overwrite the first ticket).
    expect(t.id).toMatch(/^AAPL-OPT-LONG-AAPL251016C00150000-\d{6}-[A-Z]{3}-\d{4}PT$/);
    expect(t.id).not.toMatch(/^AAPL-(BUY|SELL)-/);
  });

  it('produces different ids for different contracts at the same minute — same contract is idempotent', () => {
    const signals = [makeSignal(SignalDirection.LONG)];
    const a = buildOptionSignalTicket('AAPL', signals, CONTRACT, CTX)!;
    const b = buildOptionSignalTicket(
      'AAPL',
      signals,
      { occSymbol: 'AAPL251016P00150000', optionId: 'opt-uuid-2' },
      CTX,
    )!;
    const reStaged = buildOptionSignalTicket('AAPL', signals, CONTRACT, CTX)!;
    expect(a.id).not.toBe(b.id);
    expect(reStaged.id).toBe(a.id);
  });

  it('produces different ids for opposite-direction cards on the same contract + minute', () => {
    // A LONG and a SHORT card can coexist on the same underlying — a long
    // put staged off the SHORT card must not collide with the LONG card's
    // same-contract ticket minted in the same PT minute.
    const long = buildOptionSignalTicket('AAPL', [makeSignal(SignalDirection.LONG)], CONTRACT, CTX)!;
    const short = buildOptionSignalTicket('AAPL', [makeSignal(SignalDirection.SHORT)], CONTRACT, CTX)!;
    expect(long.id).not.toBe(short.id);
  });

  it('normalizes occSymbol case but rejects a non-OCC charset (it lands in the doc id)', () => {
    const lower = buildOptionSignalTicket(
      'AAPL',
      [makeSignal(SignalDirection.LONG)],
      { occSymbol: 'aapl251016c00150000', optionId: 'opt-uuid-1' },
      CTX,
    )!;
    expect(lower.legs[0].symbol).toBe('AAPL251016C00150000');
    expect(lower.id).toMatch(/^AAPL-OPT-LONG-AAPL251016C00150000-/);

    expect(
      buildOptionSignalTicket(
        'AAPL',
        [makeSignal(SignalDirection.LONG)],
        { occSymbol: 'BRK/B251016C00150000', optionId: 'opt-uuid-1' },
        CTX,
      ),
    ).toBeNull();
  });

  it('returns null when there are no non-rejected occurrences', () => {
    expect(buildOptionSignalTicket('AAPL', [], CONTRACT, CTX)).toBeNull();
  });
});
