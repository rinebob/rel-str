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
  };
}

/**
 * Filter cards — timeframe trims occurrences *within* a card (a card survives
 * while any occurrence matches); direction and listFilter drop whole cards.
 */
export function filterGalleryCards(
  cards: GalleryCard[],
  filter: GalleryFilter,
  lists: GalleryListContext,
): GalleryCard[] {
  return cards
    .filter((c) => filter.direction === SignalDirection.ALL || c.direction === filter.direction)
    .filter((c) =>
      shouldShowInListFilter(c.symbol, lists.symbolLists, filter.listFilter, lists.exclusiveListKeys),
    )
    .map((c) =>
      filter.timeframe === SignalTimeframe.ALL
        ? c
        : { ...c, occurrences: c.occurrences.filter((o) => o.timeframe === filter.timeframe) },
    )
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
