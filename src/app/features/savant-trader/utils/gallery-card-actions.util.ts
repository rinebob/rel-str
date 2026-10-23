/**
 * Gallery card actions — status derivation + ticket matching (#743/#755/#819).
 * Every actioned-status card exposes the inverse of the action that
 * actioned it: rejected → Restore, failed → Requeue or
 * Reject. Settled is terminal — a fill can't be un-done.
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
 * used for actioned ordering.
 */
export function enrichGalleryCards(
  cards: GalleryCard[],
  actions: GalleryActionContext,
): GalleryCard[] {
  return cards.map((c) => {
    const ticket = findCardTicket(c, actions);
    return {
      ...c,
      status: deriveCardStatus(c, ticket),
      ticket,
      actionedAt: ticket
        ? (ticket.terminalAt ?? ticket.updatedAt)
        : (actions.rejectedCards.get(c.key) ?? ''),
    };
  });
}

/** Canonical decision id for an occurrence in the viewed run — a pure
 *  deterministic join key between cards and ticket provenance (#1017 —
 *  no decision doc ever existed for it). */
function occurrenceDecisionId(o: StSignalItem, ctx: Pick<GalleryActionContext, 'runId'>): string {
  return buildStOccurrenceDecisionId(ctx.runId, o.symbol, o.timeframe, o.signalType);
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
 *  review). Sorted by updatedAt desc. OPTION tickets are admitted by the
 *  same decisionIds test (#964) — the side check exists for equity's
 *  symbol+side dedupe, and an option ticket is always `side: 'buy'` (a
 *  long put on a SHORT card must still status it). */
export function findCardTickets(
  card: Pick<GalleryCard, 'symbol' | 'side' | 'allOccurrences'>,
  ctx: Pick<GalleryActionContext, 'runId' | 'ticketsBySymbol'>,
): OrderTicket[] {
  // A live ticket (order in flight / just placed) outranks a STAGED one
  // regardless of updatedAt — otherwise touching the staged ticket would
  // flip a resting card back to 'pending' and hide the live order (#964
  // review). Within a rank, newest first.
  const rank = (t: OrderTicket) =>
    t.status === OrderTicketStatus.SUBMITTING ||
    t.status === OrderTicketStatus.SUBMITTED ||
    t.status === OrderTicketStatus.QUEUED ||
    t.status === OrderTicketStatus.RESTING ||
    t.status === OrderTicketStatus.CANCEL_PENDING
      ? 1
      : 0;
  return (ctx.ticketsBySymbol[card.symbol.toUpperCase()] ?? [])
    .filter((t) => {
      if (t.instrumentType !== InstrumentType.OPTION && t.side !== card.side) return false;
      if (!t.signalContext) return false;
      const sc = t.signalContext;
      const ids = sc.decisionIds?.length ? sc.decisionIds : [sc.decisionId];
      return card.allOccurrences.some((o) =>
        ids.some((id: string) => canonicalOccurrenceDecisionId(id, o) === occurrenceDecisionId(o, ctx)),
      );
    })
    .sort((a, b) => rank(b) - rank(a) || b.updatedAt.localeCompare(a.updatedAt));
}

/** The latest ticket statusing a card — see {@link findCardTickets}. */
function findCardTicket(
  card: GalleryCard,
  ctx: GalleryActionContext,
): OrderTicket | undefined {
  return findCardTickets(card, ctx)[0];
}

/** Status precedence: a session-rejected card outranks ticket state (a
 *  staged ticket is removed on reject anyway); ticket lifecycle fills
 *  the rest. Monitor list membership deliberately does NOT status a
 *  card (#762 QA) — monitoring a symbol isn't a decision about this
 *  signal, so watched symbols' cards stay actionable. */
function deriveCardStatus(
  card: GalleryCard,
  ticket: OrderTicket | undefined,
): GalleryCardStatus {
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
    case OrderTicketStatus.CANCEL_PENDING:
      return 'resting';
    case OrderTicketStatus.FILLED:
    case OrderTicketStatus.PAPER:
      return 'settled';
    case OrderTicketStatus.FAILED:
    case OrderTicketStatus.CANCELLED:
    case OrderTicketStatus.EXPIRED:
      return 'failed';
    default: // STAGED — nothing placed yet
      return 'pending';
  }
}

/** Manual paper-send on gallery cards — DISABLED. The auto-paper ingest
 *  pass (#553/#917, `stAutoPaperIngest` on run completion) captures every
 *  in-scope signal automatically, so the per-card Paper button only
 *  duplicates what the pipeline already does. Set true to re-enable the
 *  manual send — `paperCard` stays live on the service. */
export const GALLERY_MANUAL_PAPER_ENABLED = false;

const ACTIONED_STATUSES: ReadonlySet<GalleryCardStatus> = new Set(['settled', 'failed', 'rejected']);

/** Cards that leave the actionable set: settled/failed/rejected
 *  collect in the Actioned section at the bottom. Resting stays in place —
 *  an in-flight order is still actionable context (#755, IMPL: resting
 *  stays). */
export function isActionedCard(card: GalleryCard): boolean {
  return ACTIONED_STATUSES.has(card.status);
}

/**
 * Trade/Paper precondition: the card must be in a decidable state —
 * `pending` — must not be session-rejected, and must not already carry a
 * live ticket. A STAGED ticket passes: Trade reopens it rather than
 * duplicating. Rejected cards expose only Restore. */
export function canTradeCard(card: GalleryCard): boolean {
  if (card.status !== 'pending') return false;
  return !card.ticket || card.ticket.status === OrderTicketStatus.STAGED;
}

/** Reject/Restore precondition: pending and failed cards can
 *  be rejected (on a failed card the REJECTs dismiss it for good); a
 *  rejected card can be restored. Settled and in-flight states are dealt
 *  with — no decision writes on them. */
export function canRejectCard(card: GalleryCard): boolean {
  return (
    card.status === 'pending' ||
    card.status === 'failed' ||
    card.status === 'rejected'
  );
}

/** Requeue precondition: a failed card's terminal ticket regenerates to
 *  STAGED (#717 — RH burns a terminal order's refId, so the patch mints a
 *  fresh one). The card returns to pending and Trade reopens the ticket. */
export function canRequeueCard(card: GalleryCard): boolean {
  return card.status === 'failed';
}
