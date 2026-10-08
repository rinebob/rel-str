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
  OrderTicket,
} from '../services/order-ticket.types';
import { buildStOccurrenceDecisionId } from '../services/firestore-helpers';
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
  /** The card's FULL occurrence set — untrimmed by the signal-timeframe
   *  filter. `occurrences` is trimmed for the card's list render, but the
   *  chart must see both timeframes so the card's own dots survive a
   *  chart-interval vs signal-filter mismatch (#819 review: filter=D +
   *  chart=W left zero card dots). */
  allOccurrences: StSignalItem[];
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
  const sorted = [...occurrences].sort((a, b) => b.barDate.localeCompare(a.barDate));
  return {
    key: `${p.symbol}:${side}`,
    symbol: p.symbol,
    side,
    direction: side === 'buy' ? SignalDirection.LONG : SignalDirection.SHORT,
    profile: p,
    occurrences: sorted,
    allOccurrences: sorted,
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
      // reject write covers them all (#755 review r3). Read allOccurrences
      // so a re-filter of an already-trimmed card can't shrink the verdict.
      const allRejected =
        c.allOccurrences.length > 0 && c.allOccurrences.every((o) => isRejectedOccurrence(o, actions));
      // Trim from the canonical full set — a re-filter of an already
      // trimmed card can't permanently lose the other timeframe's legs.
      const inTimeframe = c.allOccurrences.filter(
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
 * Perf: retain prior card object identities across pipeline rebuilds.
 * filterGalleryCards/enrichGalleryCards mint fresh GalleryCard objects on
 * every upstream patch (tickets, decisions, history, lists) — without
 * retention every card input churns and every mounted card chart
 * re-renders per patch. Reusing the previous instance when nothing
 * rendered-relevant changed keeps OnPush/signal inputs stable.
 */
export function retainGalleryCards(
  prev: readonly GalleryCard[],
  next: GalleryCard[],
): GalleryCard[] {
  if (prev.length === 0) return next;
  const prevByKey = new Map(prev.map((c) => [c.key, c]));
  return next.map((c) => {
    const p = prevByKey.get(c.key);
    return p && sameGalleryCard(p, c) ? p : c;
  });
}

/** Shallow equivalence over the fields the card + chart actually read.
 *  Occurrences compare element-wise — filter() rebuilds the array but the
 *  StSignalItem refs stay stable. */
function sameGalleryCard(a: GalleryCard, b: GalleryCard): boolean {
  return (
    a.symbol === b.symbol &&
    a.side === b.side &&
    a.direction === b.direction &&
    a.profile === b.profile &&
    a.allRejected === b.allRejected &&
    a.status === b.status &&
    a.actionedAt === b.actionedAt &&
    a.ticket === b.ticket &&
    a.occurrences.length === b.occurrences.length &&
    a.occurrences.every((o, i) => o === b.occurrences[i]) &&
    a.allOccurrences.length === b.allOccurrences.length &&
    a.allOccurrences.every((o, i) => o === b.allOccurrences[i])
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
