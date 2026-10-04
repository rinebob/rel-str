/**
 * Gallery cards — pure aggregation/filter/sort functions (#743/#754).
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
} from '../common/constants';
import { marketCapTierRank, shouldShowInListFilter } from './utils';

export type GallerySide = 'buy' | 'sell';
export type GallerySortKey = 'sector' | 'marketCap' | 'list';

export const GALLERY_SORT_OPTIONS: { value: GallerySortKey; label: string }[] = [
  { value: 'sector', label: 'Sector' },
  { value: 'marketCap', label: 'Market cap' },
  { value: 'list', label: 'List' },
];

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
  /** Exclusive (triage-bucket) list keys in display order — drives the 'list' sort. */
  exclusiveListKeys: string[];
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

export function sortGalleryCards(
  cards: GalleryCard[],
  sort: GallerySortKey,
  lists: GalleryListContext,
): GalleryCard[] {
  // Precompute each symbol's exclusive-bucket rank once for the 'list' sort.
  const listRank = new Map<string, number>();
  if (sort === 'list') {
    for (const c of cards) {
      listRank.set(
        c.symbol,
        lists.exclusiveListKeys.findIndex((k) =>
          (lists.symbolLists[k] ?? []).includes(c.symbol.toUpperCase()),
        ),
      );
    }
  }

  const key = (c: GalleryCard): [number, string] => {
    if (sort === 'sector') {
      const missing = c.profile.sector === undefined ? 1 : 0;
      return [missing, `${c.profile.sector ?? ''}|${c.profile.industry ?? ''}|${c.symbol}`];
    }
    if (sort === 'marketCap') {
      const tier = c.profile.marketCapTier;
      return [tier === undefined ? 1 : 0, `${tier === undefined ? '' : marketCapTierRank(tier)}|${c.symbol}`];
    }
    const idx = listRank.get(c.symbol) ?? -1;
    return [idx < 0 ? 1 : 0, `${idx < 0 ? '' : idx}|${c.symbol}`];
  };
  return [...cards].sort((a, b) => {
    const [pa, sa] = key(a);
    const [pb, sb] = key(b);
    return pa - pb || sa.localeCompare(sb);
  });
}
