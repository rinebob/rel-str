/**
 * Position-gallery card view-model and pure mapping utilities (#926/#950-951).
 *
 * `PositionCard` is deliberately separate from the signal gallery's
 * `GalleryCard` — positions and signals never mix (#926 PRD). The join
 * consumes only existing pipeline data: `EquityPositionWithPnL` from
 * PortfolioDashboardStore, equity quotes, live broker orders, StSymbolProfile
 * metadata, and resolved allocation bucket names.
 */
import {
  BrokerOrder,
  EquityPosition,
  EquityQuote,
} from '../../../../../core/robinhood-mcp/types/robinhood-mcp.types';
import type { StSymbolProfile } from '../../../../savant-trader/services/types';
import { SymbolListFilter } from '../../../../savant-trader/common/constants';
import { isStopLossProtecting } from '../../../utils/portfolio-pnl.util';
import {
  marketCapTierRank,
  shouldShowInListFilter,
  tierLabel,
  UNKNOWN_GROUP,
} from '../../../../savant-trader/utils/utils';
import { EquityPositionWithPnL } from '../../../portfolio-dashboard.types';

export type PositionSide = 'long' | 'short';

/** Grouping dimensions for the position gallery — allocation bucket first
 *  (PRD), then the signal gallery's profile dimensions, then flat. */
export enum PositionGroupDimension {
  BUCKET = 'BUCKET',
  SECTOR = 'SECTOR',
  INDUSTRY = 'INDUSTRY',
  CAP_TIER = 'CAP_TIER',
  NONE = 'NONE',
}

export interface PositionCard {
  /** `${accountNumber}:${symbol}` — stable identity for @for tracking. */
  key: string;
  accountNumber: string;
  symbol: string;
  side: PositionSide;
  quantity: number;
  averageCost: number | null;
  marketPrice: number | null;
  dayChange: number | null;
  dayChangePct: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  marketValue: number | null;
  daysHeld: number | null;
  /** Resolved allocation bucket display name — null when unattributed or
   *  the attribution points at a deleted bucket. */
  bucketName: string | null;
  protected: boolean;
  stopPrice: number | null;
  /** Signed distance from mark to stop, percent. Long-only today —
   *  `isProtectiveStopOrder` is a sell-side predicate. */
  stopDistancePct: number | null;
  /** Live equity orders resting on this symbol — the Orders popup list. */
  openOrders: BrokerOrder[];
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  capTier: string | null;
  /** Company market cap — the flat-mode sort key (not position value). */
  marketCap: number | null;
}

export interface PositionCardFilter {
  side: 'all' | PositionSide;
  listFilter: SymbolListFilter;
}

export interface PositionListContext {
  symbolLists: Record<string, string[]>;
  exclusiveListKeys: readonly string[];
}

/** Calendar days between an ISO entry timestamp and `now`. */
export function daysHeldFromEntry(entryDate: string | null, now: Date): number | null {
  if (!entryDate) return null;
  const ms = now.getTime() - new Date(entryDate).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  return Math.floor(ms / 86_400_000);
}

/**
 * Join positions with quotes, live orders, profiles, and bucket names.
 * Every data source degrades independently — a missing quote/profile/
 * attribution produces null fields on the card, never a missing card.
 *
 * `bucketNameBySymbol` is resolved upstream (facade joins attributions to
 * bucket docs): symbol → display name for attributed positions only.
 */
export function buildPositionCards(
  accountNumber: string,
  positions: EquityPositionWithPnL[],
  quotes: Map<string, EquityQuote> | null,
  liveOrders: BrokerOrder[],
  profiles: Map<string, StSymbolProfile>,
  bucketNameBySymbol: Map<string, string>,
  now: Date = new Date(),
): PositionCard[] {
  // A card exists while shares are held — zero/null-quantity records
  // (closed remnants, fully sell-committed symbols) produce no card,
  // matching the positions table's `!closed` convention.
  return positions.filter((p) => !p.closed).map((p) => {
    const quote = quotes?.get(p.symbol) ?? null;
    // The store's withPnL join already derives currentPrice from the same
    // quotes map — prefer it; the map supplies previousClose for day change.
    const marketPrice = p.currentPrice ?? quote?.lastTradePrice ?? null;
    const previousClose = quote?.previousClose ?? null;
    // Instrument day move — signed by the symbol's direction, NOT the
    // position's. The card negates for shorts at render so the display
    // tracks the position's day P&L; the facade's dayPnl = dayChange ×
    // signed quantity stays correct on the raw field. A zero/NaN close
    // can't be a sane baseline, so it degrades to null like a missing
    // quote rather than displaying the full price as the day's "change".
    const dayChange =
      marketPrice !== null && Number.isFinite(marketPrice) &&
      previousClose !== null && previousClose > 0
        ? marketPrice - previousClose
        : null;
    const dayChangePct =
      dayChange !== null && previousClose !== null && previousClose > 0
        ? (dayChange / previousClose) * 100
        : null;
    const quantity = p.quantity ?? 0;
    const cardOrders = liveOrders.filter(
      (o) => o.instrumentType === 'equity' && o.symbol === p.symbol,
    );
    // isStopLossProtecting is sell-side and requires a positive quantity —
    // a sell stop resting on a shorted symbol is not protection, so
    // shorts never read protected.
    const stopOrder = cardOrders.find((o) => isStopLossProtecting(o, [p])) ?? null;
    const stopPrice = stopOrder?.stopPrice ?? null;
    const stopDistancePct =
      stopPrice !== null && marketPrice !== null && marketPrice !== 0
        ? ((marketPrice - stopPrice) / marketPrice) * 100
        : null;
    const profile = profiles.get(p.symbol.toUpperCase()) ?? null;

    return {
      key: `${accountNumber}:${p.symbol}`,
      accountNumber,
      symbol: p.symbol,
      side: quantity < 0 ? ('short' as const) : ('long' as const),
      quantity,
      averageCost: p.averageBuyPrice,
      marketPrice,
      dayChange,
      dayChangePct,
      unrealizedPnl: p.pnl,
      unrealizedPnlPct: p.pnlPercent,
      marketValue: marketPrice !== null ? Math.abs(quantity) * marketPrice : null,
      daysHeld: daysHeldFromEntry(p.entryDate, now),
      bucketName: bucketNameBySymbol.get(p.symbol) ?? null,
      protected: stopOrder !== null,
      stopPrice,
      stopDistancePct,
      openOrders: cardOrders,
      companyName: profile?.name ?? null,
      sector: profile?.sector ?? null,
      industry: profile?.industry ?? null,
      capTier: profile?.marketCapTier ?? null,
      marketCap: profile?.marketCap ?? null,
    };
  });
}

/** Side + symbol-list filters — same semantics as the signal gallery's
 *  list filter (`ALL` passes everything; a named list requires membership). */
export function filterPositionCards(
  cards: PositionCard[],
  filter: PositionCardFilter,
  lists: PositionListContext,
): PositionCard[] {
  return cards.filter(
    (c) =>
      (filter.side === 'all' || c.side === filter.side) &&
      shouldShowInListFilter(c.symbol, lists.symbolLists, filter.listFilter, lists.exclusiveListKeys),
  );
}

/** Flat-mode ordering — company market cap desc, unknown caps last,
 *  symbol asc on ties. NOT position market value (PRD). */
export function sortFlatPositionCards(cards: PositionCard[]): PositionCard[] {
  return [...cards].sort((a, b) => {
    const ac = a.marketCap ?? -Infinity;
    const bc = b.marketCap ?? -Infinity;
    if (bc !== ac) return bc - ac;
    return a.symbol.localeCompare(b.symbol);
  });
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export interface PositionCardGroup {
  /** `${dimension}:${label}` — dimension-scoped so a dimension switch
   *  starts with fresh expansion state and a round-trip restores it;
   *  keys persist across re-sorts and refreshes. */
  key: string;
  label: string;
  cards: PositionCard[];
}

/** Bucket-dimension sink for positions with no resolved bucket name.
 *  The profile-dimension sink is the shared `UNKNOWN_GROUP`. */
export const UNASSIGNED_GROUP_LABEL = '(Unassigned)';

function positionGroupKey(card: PositionCard, dimension: PositionGroupDimension): string {
  switch (dimension) {
    case PositionGroupDimension.BUCKET:
      return card.bucketName || UNASSIGNED_GROUP_LABEL;
    case PositionGroupDimension.SECTOR:
      return card.sector || UNKNOWN_GROUP;
    case PositionGroupDimension.INDUSTRY:
      return card.industry || UNKNOWN_GROUP;
    case PositionGroupDimension.CAP_TIER:
      // Display label matches the card's tier badge (MEGA/LG/...).
      return card.capTier ? tierLabel(card.capTier) : UNKNOWN_GROUP;
    default:
      // #820 lesson: never collapse an unhandled dimension into a silent
      // '' group — a future enum member without a case must throw.
      throw new Error(`groupPositionCards: unhandled dimension ${dimension}`);
  }
}

/** Group already-sorted cards by the dimension. Input order is preserved
 *  within each group — callers apply `sortFlatPositionCards` first so
 *  within-group order is the flat market-cap ranking. The dimension value
 *  is the primary group order: alphabetical for label dimensions, tier
 *  rank for cap-tier (MEGA→MICRO regardless of whose caps are biggest);
 *  ranking groups by their top card's cap would let market cap dominate
 *  the sort again. The missing-data sinks ((Unassigned)/(Unknown)) always
 *  sort last — the signal gallery's convention. NONE returns no groups
 *  (the page renders flatCards). */
export function groupPositionCards(
  cards: PositionCard[],
  dimension: PositionGroupDimension,
): PositionCardGroup[] {
  if (dimension === PositionGroupDimension.NONE) return [];
  const byLabel = new Map<string, PositionCard[]>();
  for (const c of cards) {
    const label = positionGroupKey(c, dimension);
    const bucket = byLabel.get(label);
    if (bucket) bucket.push(c);
    else byLabel.set(label, [c]);
  }
  // The two sentinel names are shared across dimensions — a bucket
  // literally named '(Unknown)' sinks last too. Ordering-only collision;
  // acceptable (same class as the reference's sink names).
  const isSink = (label: string) =>
    label === UNASSIGNED_GROUP_LABEL || label === UNKNOWN_GROUP;
  const named = [...byLabel.entries()].filter(([label]) => !isSink(label));
  const sinks = [...byLabel.entries()].filter(([label]) => isSink(label));
  named.sort(([la, ca], [lb, cb]) =>
    dimension === PositionGroupDimension.CAP_TIER
      ? marketCapTierRank(ca[0].capTier ?? undefined) -
        marketCapTierRank(cb[0].capTier ?? undefined)
      : la.localeCompare(lb),
  );
  return [...named, ...sinks].map(([label, groupCards]) => ({
    key: `${dimension}:${label}`,
    label,
    cards: groupCards,
  }));
}

// ---------------------------------------------------------------------------
// Order classification
// ---------------------------------------------------------------------------

export interface ClassifiedCardOrders {
  /** Orders the protected badge counts on — sell-side protective stops. */
  stopOrders: BrokerOrder[];
  /** Everything else resting on the symbol (limits, markets, terminal). */
  otherOrders: BrokerOrder[];
}

/** Split a position's live orders into protective stops vs everything else
 *  through the same `isStopLossProtecting` predicate the card badge uses —
 *  the Orders popup and the badge can never disagree. Long-only like the
 *  badge: a sell stop resting on a shorted symbol is not protection.
 *  Callers must pass only this symbol's orders — the function does not
 *  symbol-filter (card.openOrders is already symbol-scoped). */
export function classifyCardOrders(
  orders: BrokerOrder[],
  position: Pick<EquityPosition, 'symbol' | 'quantity'>,
): ClassifiedCardOrders {
  const held = [{ symbol: position.symbol, quantity: position.quantity }];
  const isStop = (o: BrokerOrder) => isStopLossProtecting(o, held);
  const stopOrders: BrokerOrder[] = [];
  const otherOrders: BrokerOrder[] = [];
  for (const o of orders) (isStop(o) ? stopOrders : otherOrders).push(o);
  return { stopOrders, otherOrders };
}
