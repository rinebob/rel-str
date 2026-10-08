/**
 * Gallery card actions — status derivation + ticket matching (#743/#755/#819).
 *
 * The ticket/status half of the gallery card model, split from
 * gallery-cards.util so each file stays one concept: that file aggregates,
 * filters, and groups; this one answers "what is this card's lifecycle
 * status, which tickets status it, and what can the user do next."
 *
 * Every reader here takes the card's FULL occurrence set
 * (`allOccurrences`), never the timeframe-trimmed `occurrences` — a
 * decision or ticket on a leg the filter hides must still status,
 * timestamp, and match the card (#819 r2).
 */
import {
  EquityOrderTicket,
  EtfOrderTicket,
  InstrumentType,
  OrderTicket,
  OrderTicketStatus,
} from '../services/order-ticket.types';
import { StSignalItem } from '../services/types';
import {
  buildStOccurrenceDecisionId,
  canonicalOccurrenceDecisionId,
} from '../services/firestore-helpers';
import {
  GalleryActionContext,
  GalleryCard,
  GalleryCardStatus,
} from './gallery-cards.util';

/**
 * Enrich filtered cards with action status (#755): the signal-staged ticket
 * for this run+side, the derived lifecycle status, and the action timestamp
 * used for sunk ordering.
 */
export function enrichGalleryCards(
  cards: GalleryCard[],
  actions: GalleryActionContext,
): GalleryCard[] {
  return cards.map((c) => {
    const ticket = findCardTicket(c, actions);
    return {
      ...c,
      status: deriveCardStatus(c, ticket, actions),
      ticket,
      actionedAt: ticket ? (ticket.terminalAt ?? ticket.updatedAt) : latestDecidedAt(c, actions),
    };
  });
}

/** Canonical decision id for an occurrence in the viewed run. */
function occurrenceDecisionId(o: StSignalItem, ctx: GalleryActionContext): string {
  return buildStOccurrenceDecisionId(ctx.runId, o.symbol, o.timeframe, o.signalType);
}

/** Latest decidedAt across the card's FULL occurrence set — '' when none
 *  decided. A decision on a timeframe leg the filter hides must still
 *  timestamp the card (#819 r2). */
function latestDecidedAt(card: GalleryCard, ctx: GalleryActionContext): string {
  return card.allOccurrences
    .map((o) => ctx.decisions[occurrenceDecisionId(o, ctx)]?.decidedAt)
    .filter((d): d is string => !!d)
    .sort()
    .pop() ?? '';
}

/** All tickets statusing a card: same symbol+side, staged from one of the
 *  card's own occurrence decisions — exact canonical-id equality over the
 *  card's FULL occurrence set (allOccurrences — a ticket can't vanish when
 *  the signal filter hides its occurrence, #819 r2), not a
 *  `startsWith(runId_)` test (run ids embed underscores, so a decision id
 *  from run `${runA}_X` would falsely prefix-match viewed run `runA`, and
 *  an id for a decision not on this card would match too). Canonicalizing
 *  per-occurrence also resolves legacy-format secondary decisionIds whose
 *  embedded timeframe/signalType differ from the ticket's headline fields,
 *  and scopes matches to THIS run — a same-symbol/same-side ticket from
 *  another run carries that run's decision ids and never matches (#755
 *  review). Sorted by updatedAt desc. Equity/ETF only — option tickets
 *  carry no signalContext and can't stage from a signal. */
export function findCardTickets(
  card: GalleryCard,
  ctx: GalleryActionContext,
): Array<EquityOrderTicket | EtfOrderTicket> {
  return (ctx.ticketsBySymbol[card.symbol.toUpperCase()] ?? [])
    .filter((t): t is EquityOrderTicket | EtfOrderTicket => {
      if (t.instrumentType === InstrumentType.OPTION) return false;
      if (t.side !== card.side || !t.signalContext) return false;
      const sc = t.signalContext;
      const ids = sc.decisionIds?.length ? sc.decisionIds : [sc.decisionId];
      return card.allOccurrences.some((o) =>
        ids.some((id: string) => canonicalOccurrenceDecisionId(id, o) === occurrenceDecisionId(o, ctx)),
      );
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The latest ticket statusing a card — see {@link findCardTickets}. */
function findCardTicket(
  card: GalleryCard,
  ctx: GalleryActionContext,
): EquityOrderTicket | EtfOrderTicket | undefined {
  return findCardTickets(card, ctx)[0];
}

/** Status precedence: watch outranks everything — Monitor means "tracked
 *  elsewhere," so the card leaves the actionable set. A fully-REJECTed card
 *  ranks next — the decision supersedes any ticket state (a staged ticket
 *  is removed on reject anyway). Ticket lifecycle fills the rest. */
function deriveCardStatus(
  card: GalleryCard,
  ticket: OrderTicket | undefined,
  ctx: GalleryActionContext,
): GalleryCardStatus {
  // List contents are stored uppercase — normalize like the list-filter lookups.
  if (ctx.monitorSymbols.has(card.symbol.toUpperCase())) return 'watched';
  if (card.allRejected) {
    return 'rejected';
  }
  if (!ticket) return 'pending';
  switch (ticket.status) {
    case OrderTicketStatus.SUBMITTING:
      return 'submitting';
    case OrderTicketStatus.SUBMITTED:
    case OrderTicketStatus.QUEUED:
    case OrderTicketStatus.RESTING:
      return 'resting';
    case OrderTicketStatus.FILLED:
    case OrderTicketStatus.PAPER:
      return 'settled';
    case OrderTicketStatus.FAILED:
    case OrderTicketStatus.CANCELLED:
      return 'failed';
    default: // STAGED — nothing placed yet
      return 'pending';
  }
}

const SUNK_STATUSES: ReadonlySet<GalleryCardStatus> = new Set(['watched', 'settled', 'failed', 'rejected']);

/** Cards that leave the actionable set: watched/settled/failed/rejected
 *  sink to the bottom group. Resting stays in place — an in-flight order
 *  is still actionable context (#755, IMPL: resting stays). */
export function isSunkCard(card: GalleryCard): boolean {
  return SUNK_STATUSES.has(card.status);
}

/**
 * Trade/Paper precondition: the card must be in a decidable state —
 * `pending` or `watched` (a parked decision that stays tradeable) — must
 * not be fully rejected, and must not already carry a live ticket. A
 * STAGED ticket passes: Trade reopens it rather than duplicating. Sunk
 * cards expose only Restore — a rejected card restaging would carry
 * REJECT decisionIds whose removal silently un-rejects (#755 review).
 * The `allRejected` check matters for watched cards: Monitor wins status
 * precedence, so a fully-rejected watched card renders 'watched' and the
 * status check alone wouldn't catch it. */
export function canTradeCard(card: GalleryCard): boolean {
  if (card.status !== 'pending' && card.status !== 'watched') return false;
  if (card.allRejected) return false;
  return !card.ticket || card.ticket.status === OrderTicketStatus.STAGED;
}

/** Reject/Restore precondition: pending and watched cards can be
 *  rejected; a rejected card can be restored. Terminal and in-flight
 *  states are dealt with — no decision writes on them. */
export function canRejectCard(card: GalleryCard): boolean {
  return (
    card.status === 'pending' ||
    card.status === 'watched' ||
    card.status === 'rejected'
  );
}
