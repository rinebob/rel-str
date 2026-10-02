/**
 * Paper-ticket eligibility + request construction (#709).
 *
 * Shared by the per-ticket accept-as-paper flow (order-ticket.component)
 * and the batch queue action (signal-order page) so the eligibility rule
 * and request shape can't drift between the two call sites.
 */
import { TradeSide } from '@common';
import type { PaperSignalOrderRequest } from '@paper-trading/contracts';
import {
  InstrumentType,
  OrderSource,
  OrderTicketStatus,
} from '../services/order-ticket.types';
import type {
  EquityOrderTicket,
  EtfOrderTicket,
  OrderTicket,
} from '../services/order-ticket.types';
import { canonicalOccurrenceDecisionId } from '../services/firestore-helpers';
import { computePositionSize, ticketCostBasisPrice } from './position-sizing.util';

/** A staged ticket is paper-eligible only when it's a signal-pipeline
 *  equity/ETF order with a signal context — the paper cohort anchors to
 *  the occurrence decision (signalId). Option tickets and manual tickets
 *  have no such context. Type-narrows away OptionOrderTicket so the
 *  request builder can read `symbol`. */
export function isPaperEligibleTicket(
  ticket: OrderTicket | null | undefined,
): ticket is EquityOrderTicket | EtfOrderTicket {
  return (
    !!ticket &&
    ticket.status === OrderTicketStatus.STAGED &&
    ticket.source === OrderSource.SIGNAL_PIPELINE &&
    ticket.instrumentType !== InstrumentType.OPTION &&
    !!ticket.signalContext?.decisionId
  );
}

/** Build the callable request from an eligible ticket. `direction` comes
 *  from the ticket side — never from signalContext.direction, which is an
 *  untyped string that could be missing/garbage on legacy docs and would
 *  fail the backend's side/direction cross-check. `signalId` is
 *  canonicalized — legacy tickets carry the hyphenated decisionId while
 *  the backend keys stats/idempotency on the canonical doc id. */
export function toPaperSignalOrderRequest(
  ticket: EquityOrderTicket | EtfOrderTicket,
  quantity: number | undefined,
): PaperSignalOrderRequest {
  const ctx = ticket.signalContext!;
  return {
    signalId: canonicalOccurrenceDecisionId(ctx.decisionId, {
      symbol: ticket.symbol,
      timeframe: ctx.timeframe,
      signalType: ctx.signalType,
    }),
    symbol: ticket.symbol,
    direction: ticket.side === 'sell' ? TradeSide.SHORT : TradeSide.LONG,
    quantity,
    refId: ticket.refId,
  };
}

/** Whole-share quantity for a paper request: the ticket's explicit
 *  quantity when set, else whole-share sizing of its dollarAmount target
 *  (or the configured default) at the cost basis — limitPrice for
 *  limit/stop-limit tickets, live quote otherwise (#723 basis). Undefined
 *  when nothing is computable — the callable would reject it anyway. */
export function paperQuantityFor(
  ticket: EquityOrderTicket | EtfOrderTicket,
  livePrice: number | undefined,
  defaultDollarAmount: number,
): number | undefined {
  const qty = parseInt(ticket.quantity ?? '', 10);
  if (Number.isFinite(qty) && qty > 0) return qty;
  const basis = ticketCostBasisPrice(ticket, livePrice);
  const target = parseFloat(ticket.dollarAmount ?? '') || defaultDollarAmount;
  if (!basis || basis <= 0 || target <= 0) return undefined;
  const shares = computePositionSize(basis, target).shares;
  return shares > 0 ? shares : undefined;
}
