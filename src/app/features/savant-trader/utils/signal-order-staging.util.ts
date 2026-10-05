/**
 * Signal order staging — shared pure helpers for building signal-staged
 * equity tickets (#743/#755). Extracted from SignalReviewFacade so the
 * gallery can stage the same tickets without duplicating the builder.
 */
import { StSignalItem } from '../services/types';
import {
  EquityOrderTicket,
  InstrumentType,
  OrderSource,
  OrderTicketStatus,
} from '../services/order-ticket.types';
import { buildStOccurrenceDecisionId } from '../services/firestore-helpers';
import { SignalDirection } from '../common/constants';

/** Inputs needed to build signal-staged tickets. */
export interface SignalOrderStagingContext {
  runId: string;
  accountNumber: string;
  defaultDollarAmount: number;
  now: Date;
  buildId: (symbol: string, side: string, now: Date) => string;
  buildRefId: () => string;
}

export function buildSignalOrderTickets(
  symbol: string,
  signals: StSignalItem[],
  context: SignalOrderStagingContext,
): EquityOrderTicket[] {
  const { runId, accountNumber, defaultDollarAmount, now, buildId, buildRefId } = context;
  const seen = new Set<string>();
  const tickets: EquityOrderTicket[] = [];
  for (const signal of signals) {
    const side = signal.direction === SignalDirection.SHORT ? 'sell' : 'buy';
    const dedupKey = `${symbol}-${side}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    const id = buildId(symbol, side, now);
    // Must be the canonical occurrence-decision doc id — the queue's
    // ticket-removal path deletes the decision by this id (#719), and the
    // legacy `${runId}-${symbol}-…` format matched nothing (#717 review).
    const decisionId = buildStOccurrenceDecisionId(runId, symbol, signal.timeframe, signal.signalType);
    // Accept writes one decision doc per signal; tickets dedup by
    // symbol+side, so this ticket owns every same-side decision — removal
    // must clear them all, or a surviving sibling keeps the Accept toggle
    // checked (#719 QA).
    const decisionIds = signals
      .filter((s) => (s.direction === SignalDirection.SHORT ? 'sell' : 'buy') === side)
      .map((s) => buildStOccurrenceDecisionId(runId, symbol, s.timeframe, s.signalType));
    tickets.push({
      id,
      refId: buildRefId(),
      source: OrderSource.SIGNAL_PIPELINE,
      sourceRef: { type: 'occurrence_decision', id: decisionId },
      status: OrderTicketStatus.STAGED,
      accountNumber,
      side,
      orderType: 'market',
      timeInForce: 'gfd',
      marketHours: 'regular_hours',
      instrumentType: InstrumentType.EQUITY,
      symbol,
      dollarAmount: String(defaultDollarAmount),
      signalContext: {
        signalType: signal.signalType,
        barDate: signal.barDate,
        timeframe: signal.timeframe,
        direction: signal.direction,
        decisionId,
        decisionIds,
        // Price at signal generation — the anchor for the queue row's
        // % change since signal. Omitted (not undefined) when absent.
        ...(signal.closePrice != null ? { signalPrice: signal.closePrice } : {}),
      },
      // No bucketId — the user picks a bucket on the ticket (or leaves it
      // Unassigned); the signal type lives in signalContext above.
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  }
  return tickets;
}

/**
 * Build a human-readable ticket id: {SYMBOL}-{SIDE}-{YYMMDD}-{DOW}-{HHMM}PT
 * e.g., AAPL-BUY-260825-MON-1430PT
 */
export function buildTicketId(symbol: string, side: string, now: Date): string {
  const pt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = pt.formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const yy = get('year');
  const mm = get('month');
  const dd = get('day');
  const dow = get('weekday').toUpperCase();
  const hh = get('hour') === '24' ? '00' : get('hour');
  const min = get('minute');
  return `${symbol.toUpperCase()}-${side.toUpperCase()}-${yy}${mm}${dd}-${dow}-${hh}${min}PT`;
}
