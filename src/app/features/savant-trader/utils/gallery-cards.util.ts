/**
 * Gallery cards — pure aggregation/filter/group functions (#743/#754/#783).
 *
 * Signal occurrences (one per run + symbol + timeframe + direction detection)
 * aggregate into one GalleryCard per symbol+side. D and W occurrences of the
 * same side merge into the same card; opposite directions for a symbol
 * produce two cards.
 */
import {
  StOccurrenceDecision,
  StSignalItem,
  StSymbolProfile,
} from '../services/types';
import {
  EquityOrderTicket,
  EtfOrderTicket,
  InstrumentType,
  OrderTicket,
  OrderTicketStatus,
} from '../services/order-ticket.types';
import {
  buildStOccurrenceDecisionId,
  canonicalOccurrenceDecisionId,
} from '../services/firestore-helpers';
import {
  ReviewDecision,
  SignalDirection,
  SignalTimeframe,
  SymbolListFilter,
  GroupDimension,
} from '../common/constants';
import {
  getGroupKey,
  getGroupLabel,
  marketCapTierRank,
  shouldShowInListFilter,
  UNKNOWN_GROUP,
} from './utils';

export type GallerySide = 'buy' | 'sell';

/** Lifecycle shown on the card (#755). 'sunk' is NOT a status — it is the
 *  grouping derived from watched/settled/failed/rejected (see isSunkCard). */
export type GalleryCardStatus =
  | 'pending'
  | 'submitting'
  | 'resting'
  | 'settled'
  | 'failed'
  | 'watched'
  | 'rejected';

export interface GalleryCard {
  /** `${symbol}:${side}` — stable key for tracking and, later, decisions/tickets. */
  key: string;
  symbol: string;
  side: GallerySide;
  /** Trade direction — LONG maps to buy, SHORT to sell. */
  direction: SignalDirection;
  profile: StSymbolProfile;
  /** Contributing occurrences, barDate descending. */
  occurrences: StSignalItem[];
  /** Derived from ticket + Monitor membership — see enrichGalleryCards. */
  status: GalleryCardStatus;
  /** Every occurrence in the run's symbol+side set carries a durable
   *  REJECT (#755 review) — computed by `filterGalleryCards` over the
   *  full pre-trim set, since reject/restore write the full set too: a
   *  timeframe filter must not shrink the verdict. Tracked separately
   *  from status because Monitor wins precedence — a watched card can
   *  still be fully rejected, and that state must stay restorable and
   *  non-tradeable even though it renders 'watched'. */
  allRejected: boolean;
  /** The signal-staged ticket statusing this card, when one exists —
   *  always equity/ETF (the gallery only stages stock tickets). */
  ticket?: EquityOrderTicket | EtfOrderTicket;
  /** Best-effort action timestamp (ticket terminalAt/updatedAt, else the
   *  latest occurrence decidedAt); '' when unknown — drives sunk ordering
   *  (desc, untimestamped last). */
  actionedAt: string;
}

export interface GalleryFilter {
  timeframe: SignalTimeframe;
  direction: SignalDirection;
  listFilter: SymbolListFilter;
}

export interface GalleryListContext {
  symbolLists: Record<string, string[]>;
  /** Exclusive (triage-bucket) list keys — drives the untriaged/NO_MEMBERSHIP derivation. */
  exclusiveListKeys: string[];
}

/** Decision/ticket/monitor state the card pipeline reads (#755). */
export interface GalleryActionContext {
  /** The viewed run — decisions and tickets are scoped to it. */
  runId: string;
  /** Durable occurrence decisions keyed by canonical decision id. */
  decisions: Record<string, StOccurrenceDecision>;
  /** Live/staged tickets grouped by symbol (OrderTicketStore.ticketsBySymbol). */
  ticketsBySymbol: Record<string, OrderTicket[]>;
  /** Symbols in the MONITOR list — Monitor is symbol-level, both side cards watch. */
  monitorSymbols: ReadonlySet<string>;
}

/** Expansion-panel key for the pinned sunk group — deliberately not
 *  dimension-prefixed so its collapse state survives dimension switches. */
export const SUNK_GROUP_KEY = 'sunk';

const SUNK_STATUSES: ReadonlySet<GalleryCardStatus> = new Set(['watched', 'settled', 'failed', 'rejected']);

/** One expando section of the grouped gallery (#783). */
export interface GalleryGroup {
  /** `${dimension}:${groupKey}` — stable key for expansion state and tracking. */
  key: string;
  label: string;
  cards: GalleryCard[];
}

export function buildGalleryCards(
  profiles: StSymbolProfile[],
  signalsBySymbol: Record<string, StSignalItem[]>,
): GalleryCard[] {
  const cards: GalleryCard[] = [];
  for (const p of profiles) {
    const signals = signalsBySymbol[p.symbol] ?? [];
    const long = signals.filter((s) => s.direction === SignalDirection.LONG);
    const short = signals.filter((s) => s.direction === SignalDirection.SHORT);
    if (long.length) cards.push(card(p, 'buy', long));
    if (short.length) cards.push(card(p, 'sell', short));
  }
  return cards;
}

function card(p: StSymbolProfile, side: GallerySide, occurrences: StSignalItem[]): GalleryCard {
  return {
    key: `${p.symbol}:${side}`,
    symbol: p.symbol,
    side,
    direction: side === 'buy' ? SignalDirection.LONG : SignalDirection.SHORT,
    profile: p,
    occurrences: [...occurrences].sort((a, b) => b.barDate.localeCompare(a.barDate)),
    status: 'pending',
    allRejected: false,
    actionedAt: '',
  };
}

/**
 * Filter cards — timeframe and REJECTed occurrences trim *within* a card;
 * direction and listFilter drop whole cards. A card whose every occurrence
 * is REJECTed keeps them: the decision must stay reachable on the card
 * (reset / un-reject), so it survives and sinks as 'rejected' rather than
 * silently vanishing (#755). `actions` supplies the durable decisions —
 * required so callers can't silently skip the reject trim; pass
 * `{ runId: '', decisions: {} }` when decisions aren't tracked.
 */
export function filterGalleryCards(
  cards: GalleryCard[],
  filter: GalleryFilter,
  lists: GalleryListContext,
  actions: Pick<GalleryActionContext, 'runId' | 'decisions'>,
): GalleryCard[] {
  return cards
    .filter((c) => filter.direction === SignalDirection.ALL || c.direction === filter.direction)
    .filter((c) =>
      shouldShowInListFilter(c.symbol, lists.symbolLists, filter.listFilter, lists.exclusiveListKeys),
    )
    .map((c) => {
      // Verdict over the FULL pre-trim set — all timeframes, since the
      // reject write covers them all (#755 review r3).
      const allRejected =
        c.occurrences.length > 0 && c.occurrences.every((o) => isRejectedOccurrence(o, actions));
      const inTimeframe = c.occurrences.filter(
        (o) => filter.timeframe === SignalTimeframe.ALL || o.timeframe === filter.timeframe,
      );
      const kept = inTimeframe.filter((o) => !isRejectedOccurrence(o, actions));
      // All-rejected → restore so the card can render its rejected context.
      return { ...c, occurrences: kept.length ? kept : inTimeframe, allRejected };
    })
    .filter((c) => c.occurrences.length > 0);
}

function isRejectedOccurrence(
  o: StSignalItem,
  actions: Pick<GalleryActionContext, 'runId' | 'decisions'>,
): boolean {
  const id = buildStOccurrenceDecisionId(actions.runId, o.symbol, o.timeframe, o.signalType);
  return actions.decisions[id]?.decisionType === ReviewDecision.REJECT;
}

/**
 * Group cards for the expando layout (#783) — mirrors signal-review's
 * buildSymbolGroups: bucket by the profile's dimension value (sector /
 * industry / marketCapTier), '(Unknown)' sinks last, market-cap groups
 * order by tier rank, and cards within a group order by marketCap desc.
 * Group keys are dimension-prefixed so expansion state can't collide across
 * dimensions ('Technology' sector vs 'Technology' industry).
 */
export function groupGalleryCards(
  cards: GalleryCard[],
  dimension: GroupDimension,
): GalleryGroup[] {
  const byKey = new Map<string, GalleryCard[]>();
  for (const c of cards) {
    const key = getGroupKey(c.profile, dimension);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(c); else byKey.set(key, [c]);
  }

  const sortedKeys = [...byKey.keys()].sort((a, b) => {
    if (a === UNKNOWN_GROUP) return 1;
    if (b === UNKNOWN_GROUP) return -1;
    if (dimension === GroupDimension.MARKET_CAP_TIER) {
      return marketCapTierRank(a) - marketCapTierRank(b);
    }
    return a.localeCompare(b);
  });

  return sortedKeys.map((key) => ({
    key: `${dimension}:${key}`,
    label: getGroupLabel(key, dimension),
    cards: [...byKey.get(key)!].sort((a, b) => (b.profile.marketCap ?? 0) - (a.profile.marketCap ?? 0)),
  }));
}

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

/** Latest decidedAt across the card's occurrences — '' when none decided. */
function latestDecidedAt(card: GalleryCard, ctx: GalleryActionContext): string {
  return card.occurrences
    .map((o) => ctx.decisions[occurrenceDecisionId(o, ctx)]?.decidedAt)
    .filter((d): d is string => !!d)
    .sort()
    .pop() ?? '';
}

/** All tickets statusing a card: same symbol+side, staged from one of the
 *  card's own occurrence decisions — exact canonical-id equality, not a
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
  const canonicalId = (o: StSignalItem) =>
    buildStOccurrenceDecisionId(ctx.runId, o.symbol, o.timeframe, o.signalType);
  return (ctx.ticketsBySymbol[card.symbol.toUpperCase()] ?? [])
    .filter((t): t is EquityOrderTicket | EtfOrderTicket => {
      if (t.instrumentType === InstrumentType.OPTION) return false;
      if (t.side !== card.side || !t.signalContext) return false;
      const sc = t.signalContext;
      const ids = sc.decisionIds?.length ? sc.decisionIds : [sc.decisionId];
      return card.occurrences.some((o) =>
        ids.some((id) => canonicalOccurrenceDecisionId(id, o) === canonicalId(o)),
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

/** The card's still-open staged ticket — the Trade button reopens this
 *  instead of duplicating (#759). */
export function findStagedCardTicket(
  card: GalleryCard,
  ctx: GalleryActionContext,
): EquityOrderTicket | EtfOrderTicket | undefined {
  const ticket = findCardTicket(card, ctx);
  return ticket?.status === OrderTicketStatus.STAGED ? ticket : undefined;
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

/** The pinned bottom group collecting sunk cards, ordered by action time
 *  desc; untimestamped cards (e.g. externally watched) go last. */
export function sunkGalleryGroup(cards: GalleryCard[]): GalleryGroup {
  return {
    key: SUNK_GROUP_KEY,
    label: 'Sunk',
    cards: [...cards].sort((a, b) => {
      if (a.actionedAt === b.actionedAt) return a.key.localeCompare(b.key);
      if (!a.actionedAt) return 1;
      if (!b.actionedAt) return -1;
      return b.actionedAt.localeCompare(a.actionedAt);
    }),
  };
}
