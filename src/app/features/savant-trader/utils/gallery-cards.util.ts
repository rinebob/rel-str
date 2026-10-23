/**
 * Gallery cards — pure aggregation/filter/group functions (#743/#754/#783).
 *
 * Signal occurrences (one per run + symbol + timeframe + direction detection)
 * aggregate into one GalleryCard per symbol+side. D and W occurrences of the
 * same side merge into the same card; opposite directions for a symbol
 * produce two cards.
 */
import {
  StSignalItem,
  StSymbolProfile,
} from '../services/types';
import { OrderTicket } from '../services/order-ticket.types';
import {
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

/** Lifecycle shown on the card (#755). 'actioned' is NOT a status — it is
 *  the section derived from settled/failed/rejected (see
 *  isActionedCard). Monitor list membership deliberately does NOT status
 *  a card (#762 QA): a watched symbol's fresh signal is still actionable
 *  — monitoring ≠ a decision about this signal. */
export type GalleryCardStatus =
  | 'pending'
  | 'submitting'
  | 'resting'
  | 'settled'
  | 'failed'
  | 'rejected';

export interface GalleryCard {
  /** `${symbol}:${side}` — stable key for tracking, session rejects, and tickets. */
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
  /** Derived from ticket + session reject state — see enrichGalleryCards. */
  status: GalleryCardStatus;
  /** The card was rejected this session (#1017 — card-level and
   *  session-ephemeral since durable REJECT decisions are gone). */
  allRejected: boolean;
  /** The signal-staged ticket statusing this card, when one exists —
   *  equity/ETF or OPTION (#964 — option tickets status the card via
   *  decisionIds; `ticketLine` renders a per-variant terms string). */
  ticket?: OrderTicket;
  /** Best-effort action timestamp (ticket terminalAt/updatedAt, else the
   *  session-reject timestamp); '' when unknown — drives actioned
   *  ordering (desc, untimestamped last). */
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

/** Session/ticket state the card pipeline reads (#755; #1017 — the
 *  durable decisions map became a session-ephemeral rejected-card set). */
export interface GalleryActionContext {
  /** The viewed run — tickets are scoped to it. */
  runId: string;
  /** Session-rejected cards — card key → reject timestamp. */
  rejectedCards: ReadonlyMap<string, string>;
  /** Live/staged tickets grouped by symbol (OrderTicketStore.ticketsBySymbol). */
  ticketsBySymbol: Record<string, OrderTicket[]>;
}

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
 * Filter cards — timeframe trims *within* a card; direction and listFilter
 * drop whole cards. `rejected` supplies the session-ephemeral rejected-card
 * set (#1017 — card-level now that durable REJECTs are gone); a rejected
 * card keeps its occurrences so its context stays reachable on the card.
 */
export function filterGalleryCards(
  cards: GalleryCard[],
  filter: GalleryFilter,
  lists: GalleryListContext,
  rejected: ReadonlyMap<string, string>,
): GalleryCard[] {
  return cards
    .filter((c) => filter.direction === SignalDirection.ALL || c.direction === filter.direction)
    .filter((c) =>
      shouldShowInListFilter(c.symbol, lists.symbolLists, filter.listFilter, lists.exclusiveListKeys),
    )
    .map((c) => ({
      ...c,
      // Trim from the canonical full set — a re-filter of an already
      // trimmed card can't permanently lose the other timeframe's legs.
      occurrences: c.allOccurrences.filter(
        (o) => filter.timeframe === SignalTimeframe.ALL || o.timeframe === filter.timeframe,
      ),
      allRejected: rejected.has(c.key),
    }))
    .filter((c) => c.occurrences.length > 0);
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
 * every upstream patch (tickets, session rejects, history, lists) — without
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

/** The Actioned section's card order — action time desc; untimestamped
 *  cards (e.g. a reconcile-landed settle with no actionedAt) go last. */
export function actionedGalleryCards(cards: GalleryCard[]): GalleryCard[] {
  return [...cards].sort((a, b) => {
    if (a.actionedAt === b.actionedAt) return a.key.localeCompare(b.key);
    if (!a.actionedAt) return 1;
    if (!b.actionedAt) return -1;
    return b.actionedAt.localeCompare(a.actionedAt);
  });
}
