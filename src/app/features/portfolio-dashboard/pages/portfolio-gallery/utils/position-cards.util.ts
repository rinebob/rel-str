/**
 * Position-gallery card view-model and pure mapping utilities (#926/#950).
 *
 * `PositionCard` is deliberately separate from the signal gallery's
 * `GalleryCard` — positions and signals never mix (#926 PRD). The join
 * consumes only existing pipeline data: `EquityPositionWithPnL` from
 * PortfolioDashboardStore, equity quotes, live broker orders, StSymbolProfile
 * metadata, and resolved allocation bucket names.
 */
import {
  BrokerOrder,
  EquityQuote,
} from '../../../../../core/robinhood-mcp/types/robinhood-mcp.types';
import type { StSymbolProfile } from '../../../../savant-trader/services/types';
import { SymbolListFilter } from '../../../../savant-trader/common/constants';
import { isStopLossProtecting } from '../../../utils/portfolio-pnl.util';
import { shouldShowInListFilter } from '../../../../savant-trader/utils/utils';
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
    const dayChange =
      marketPrice !== null && previousClose !== null ? marketPrice - previousClose : null;
    const dayChangePct =
      dayChange !== null && previousClose !== null && previousClose !== 0
        ? (dayChange / previousClose) * 100
        : null;
    const quantity = p.quantity ?? 0;
    const cardOrders = liveOrders.filter(
      (o) => o.instrumentType === 'equity' && o.symbol === p.symbol,
    );
    // isStopLossProtecting is sell-side/long-only — a sell stop resting on
    // a shorted symbol is not protection, so shorts never read protected.
    const stopOrder =
      quantity > 0 ? (cardOrders.find((o) => isStopLossProtecting(o, [p])) ?? null) : null;
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
