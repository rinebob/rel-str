/**
 * Option order-ticket lookups (Topic #942 / Topic #1177) — the option
 * ticket's adopt/block probes. Card-driven tickets match by signal
 * provenance (decisionIds via findCardTickets); manual tickets have no
 * provenance, so identity is {contract, side} — the same axes the
 * OPT-MAN-{BTO|STO} doc-id discriminator mints on.
 */
import { StSignalItem } from '../services/types';
import {
  InstrumentType,
  OptionOrderTicket,
  OrderTicket,
  OrderTicketStatus,
} from '../services/order-ticket.types';
import { findCardTickets } from './gallery-card-actions.util';

/** Ticket statuses that count as live for the SIGNAL-CARD staging
 *  guard — a live option ticket on the card blocks staging a new one
 *  (IMPL-948 caller contract: the deterministic id .set()s
 *  unconditionally, and one open option order per card is the v1
 *  product decision). FILLED counts: a fill means the card's position
 *  is already on. PAPER is absent — paper tickets are equity-only.
 *  The MANUAL lane does not use this set (QA #1226): a live order
 *  doesn't block manual intent — parallel orders / scaling in are
 *  legitimate; manual blocking is only the same-minute doc-id twin
 *  guard in the ensure path. */
export const LIVE_OPTION_TICKET_STATUSES: ReadonlySet<OrderTicketStatus> = new Set([
  OrderTicketStatus.SUBMITTING,
  OrderTicketStatus.SUBMITTED,
  OrderTicketStatus.QUEUED,
  OrderTicketStatus.RESTING,
  OrderTicketStatus.CANCEL_PENDING,
  OrderTicketStatus.FILLED,
]);

/** OPTION tickets matching this card via findCardTickets — side is
 *  pinned 'buy' only to satisfy the equity-check shape; OPTION skips
 *  the side test (a long put on a SHORT card is still side 'buy'). */
export function findCardOptionTickets(args: {
  symbol: string;
  signals: readonly StSignalItem[];
  runId: string;
  ticketsBySymbol: Record<string, OrderTicket[]>;
}): OptionOrderTicket[] {
  return findCardTickets(
    { symbol: args.symbol, side: 'buy', allOccurrences: [...args.signals] },
    { runId: args.runId, ticketsBySymbol: args.ticketsBySymbol },
  ).filter((t): t is OptionOrderTicket => t.instrumentType === InstrumentType.OPTION);
}

/** OPTION tickets for a symbol matching contract + open side — the
 *  manual lane's adopt probe. SOURCE-AGNOSTIC on purpose, the same
 *  invariant the equity path states (manual-order.service.ts): a
 *  STAGED ticket for the same contract+side IS the same pending order
 *  whether a card or a human staged it, so it adopts (created:false —
 *  a card-owned ticket survives manual-dialog close). Live and FILLED
 *  matches do NOT block (QA #1226): manual intent governs — a new
 *  parallel order stages alongside, each ticket tracking its own
 *  broker order. */
export function findMatchingOptionTickets(args: {
  symbol: string;
  occSymbol: string;
  side: 'buy' | 'sell';
  ticketsBySymbol: Record<string, OrderTicket[]>;
}): OptionOrderTicket[] {
  return (args.ticketsBySymbol[args.symbol.toUpperCase()] ?? []).filter(
    (t): t is OptionOrderTicket =>
      t.instrumentType === InstrumentType.OPTION &&
      t.legs[0]?.symbol === args.occSymbol &&
      t.legs[0]?.side === args.side,
  );
}
