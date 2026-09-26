/**
 * @topic #553 — Paper Trading Infra (task #562)
 *
 * Position ↔ PaperTrade converters. The engine passes keep operating on the
 * legacy `Position`/`PositionLeg` view; this module adapts that view to the
 * `paper-trading/trades/items` documents so storage is fully on the new
 * collections while pass internals stay unchanged.
 *
 * Value conventions (from the engine):
 * - leg `premium`/`lastMark` are per-contract option prices (×100 = dollars)
 * - `currentValue` = lastMark × 100 × quantity (dollars)
 * - `premiumCollected` = entry mark × 100 for SHORT, 0 for LONG
 * - `capitalRequired` = strike × 100 for SHORT, entry mark × 100 for LONG
 */

import { OptionType, OptionQuoteSource } from '@options/common';
import { TradeSide } from '@common';
import {
  PaperTradeSource,
  PaperTradeStatus,
  PaperTradingKind,
  type PaperFill,
  type PaperMark,
  type PaperTrade,
  type PaperTradeLeg,
  type RawQuoteDoc,
} from '@paper-trading/contracts';
import type { DailyUpdate, Position, PositionLeg, RawQuote } from './types';
import { LegOutcome, PositionStatus, SHARES_PER_CONTRACT } from './types';

/** Governing-variant sentinel for engine-produced/migrated trades — real
 *  variants are seeded by the exit engine (Phase 3). */
export const LEGACY_GOVERNING_VARIANT = 'none';

// ── Status mapping ──────────────────────────────────────────────────────────

export function legacyToPaperStatus(s: PositionStatus): PaperTradeStatus {
  switch (s) {
    case PositionStatus.OPEN:
    case PositionStatus.COVERED_CALL_OPEN:
      return PaperTradeStatus.OPEN;
    case PositionStatus.EXPIRED_WORTHLESS:
      return PaperTradeStatus.EXPIRED;
    case PositionStatus.ASSIGNED_HOLDING_SHARES:
      return PaperTradeStatus.ASSIGNED;
    case PositionStatus.CLOSED:
      return PaperTradeStatus.CLOSED;
  }
}

export function paperToLegacyStatus(s: PaperTradeStatus): PositionStatus {
  switch (s) {
    case PaperTradeStatus.OPEN:
    case PaperTradeStatus.PENDING:
      return PositionStatus.OPEN;
    case PaperTradeStatus.EXPIRED:
      return PositionStatus.EXPIRED_WORTHLESS;
    case PaperTradeStatus.ASSIGNED:
      return PositionStatus.ASSIGNED_HOLDING_SHARES;
    case PaperTradeStatus.CLOSED:
      return PositionStatus.CLOSED;
  }
}

// ── Legs ────────────────────────────────────────────────────────────────────

export function positionLegToPaper(leg: PositionLeg): PaperTradeLeg {
  return {
    kind: 'option',
    id: leg.id,
    contractID: leg.contractID ?? '',
    type: leg.type,
    side: leg.side,
    strike: leg.strike,
    expiration: leg.expiration,
    quantity: 1,
    multiplier: SHARES_PER_CONTRACT,
    entryMark: leg.premium,
    lastMark: leg.premium,
    openDate: leg.openDate,
    ...(leg.closeDate ? { closeDate: leg.closeDate } : {}),
    ...(leg.outcome ? { outcome: leg.outcome } : {}),
  };
}

export function paperLegToPositionLeg(leg: PaperTradeLeg): PositionLeg {
  return {
    id: leg.id ?? '',
    type: leg.kind === 'option' ? leg.type : OptionType.CALL,
    side: leg.side,
    strike: leg.kind === 'option' ? leg.strike : 0,
    expiration: leg.kind === 'option' ? leg.expiration : '',
    openDate: leg.openDate ?? '',
    ...(leg.kind === 'option' && leg.contractID ? { contractID: leg.contractID } : {}),
    ...(leg.closeDate ? { closeDate: leg.closeDate } : {}),
    premium: leg.entryMark,
    ...(leg.outcome ? { outcome: leg.outcome as LegOutcome } : {}),
  };
}

// ── Expression ──────────────────────────────────────────────────────────────

/** Single-leg strategy code for an option type + side (CSP/CC). */
export function stratType(optionType: OptionType, side: TradeSide): string {
  if (side === TradeSide.SHORT && optionType === OptionType.PUT) return 'CSP';
  if (side === TradeSide.LONG && optionType === OptionType.CALL) return 'CC';
  return 'UNK';
}

/** Spread expression for a single-leg engine trade. */
export function expressionForLeg(leg: PaperTradeLeg): string {
  if (leg.kind !== 'option') return 'EQ';
  return stratType(leg.type, leg.side);
}

// ── Position → PaperTrade (migration + ledger seeding) ─────────────────────

/**
 * Reconstruct a `PaperTrade` from a legacy position + its subcollection docs.
 * Used by the migration script and by tests — fills are synthesized from the
 * position's premium/mark fields (no real fill records existed).
 */
export function positionToTrade(
  position: Position,
  legs: PositionLeg[],
  dailyUpdates: DailyUpdate[],
  governingVariant: string = LEGACY_GOVERNING_VARIANT,
): PaperTrade {
  const paperLegs = legs.map(positionLegToPaper);
  const entryFill: PaperFill = {
    fillId: `entry-${position.id}`,
    role: 'entry',
    date: position.openDate,
    // per-contract price: premiumCollected is mark×100 total
    price: position.premiumCollected > 0 ? position.premiumCollected / SHARES_PER_CONTRACT : 0,
    quantity: 1,
    quoteSource: OptionQuoteSource.RH_MCP,
  };

  const marks: Record<string, PaperMark> = {};
  for (const du of dailyUpdates) {
    marks[du.date] = {
      ...(du.markPrice !== undefined ? { mark: du.markPrice } : {}),
      ...(du.underlyingClose !== undefined ? { underlyingClose: du.underlyingClose } : {}),
    };
  }
  // Latest position mark — marks map only stores the per-contract price.
  const latestDate = position.currentValueAsOf?.slice(0, 10);
  if (latestDate) {
    const existing = marks[latestDate];
    marks[latestDate] = {
      ...existing,
      mark: position.currentValue / SHARES_PER_CONTRACT,
    };
  }

  // Stamp the latest mark onto legs — liquidation value (positionValue, used
  // by account equity) must reflect the most recent mark, not entry price.
  const markedDates = Object.keys(marks)
    .filter((d) => marks[d].mark !== undefined)
    .sort();
  const lastMark = markedDates.length ? marks[markedDates[markedDates.length - 1]].mark : undefined;
  const markedLegs = lastMark !== undefined
    ? paperLegs.map((l) => ({ ...l, lastMark }))
    : paperLegs;

  // Legacy realized semantics: expired worthless keeps the premium; CLOSED
  // carries its result in unrealizedPnl; assignment also realizes the premium.
  const realizedPnl =
    position.status === PositionStatus.EXPIRED_WORTHLESS
      ? position.premiumCollected
      : position.status === PositionStatus.CLOSED
        ? position.unrealizedPnl
        : position.status === PositionStatus.ASSIGNED_HOLDING_SHARES
          ? position.premiumCollected
          : 0;

  return {
    kind: PaperTradingKind.TRADE,
    id: position.id,
    status: legacyToPaperStatus(position.status),
    legacyStatus: position.status,
    source: PaperTradeSource.STRATEGY,
    symbol: position.symbol,
    expression: paperLegs.length ? expressionForLeg(paperLegs[0]) : 'UNK',
    governingVariant,
    strategyInstanceId: position.instanceId,
    order: {
      side: paperLegs[0]?.side ?? TradeSide.SHORT,
      type: 'MARKET',
      quantity: 1,
    },
    fills: [entryFill],
    legs: markedLegs,
    marks,
    variantRuns: [],
    variantKeys: [],
    realizedPnl,
    unrealizedPnl: position.unrealizedPnl,
    capitalRequired: position.capitalRequired,
    lastMarkedAt: position.currentValueAsOf,
    ...(position.assignment ? { assignment: position.assignment } : {}),
    ...(position.shares ? { shares: position.shares } : {}),
    createdAt: position.createdAt?.toDate?.().toISOString() ?? position.openDate,
    updatedAt: position.currentValueAsOf ?? position.openDate,
  };
}

// ── PaperTrade → Position (read adapter) ────────────────────────────────────

export function tradeToPosition(trade: PaperTrade): Position {
  const legs = trade.legs.map(paperLegToPositionLeg);
  const primary = legs.find((l) => l.contractID) ?? legs[0];
  const entryFill = trade.fills.find((f) => f.role === 'entry');
  const isShort = trade.order.side === TradeSide.SHORT;

  const currentValue = trade.legs.reduce(
    (sum, l) => sum + l.lastMark * l.multiplier * l.quantity,
    0,
  );

  return {
    id: trade.id,
    instanceId: trade.strategyInstanceId ?? '',
    symbol: trade.symbol,
    // Preserve statuses without a PaperTradeStatus equivalent (COVERED_CALL_OPEN).
    status:
      trade.legacyStatus &&
      (Object.values(PositionStatus) as string[]).includes(trade.legacyStatus)
        ? (trade.legacyStatus as PositionStatus)
        : paperToLegacyStatus(trade.status),
    premiumCollected: isShort && entryFill ? entryFill.price * SHARES_PER_CONTRACT : 0,
    capitalRequired:
      trade.capitalRequired ??
      (isShort && primary
        ? primary.strike * SHARES_PER_CONTRACT
        : (entryFill?.price ?? 0) * SHARES_PER_CONTRACT),
    openDate: entryFill?.date ?? trade.createdAt.slice(0, 10),
    currentValue,
    currentValueAsOf: trade.lastMarkedAt ?? trade.updatedAt,
    // Engine convention (stats-utils.ts): a CLOSED Position's realized P&L
    // rides in `unrealizedPnl`. Ledger exits write `realizedPnl` and zero
    // `unrealizedPnl`, so closed trades map realized here; open trades map
    // the mark-driven unrealized value.
    unrealizedPnl:
      trade.status === PaperTradeStatus.CLOSED
        ? trade.realizedPnl
        : trade.unrealizedPnl,
    ...(trade.assignment ? { assignment: trade.assignment } : {}),
    ...(trade.shares ? { shares: trade.shares } : {}),
  };
}

// ── Raw quote ────────────────────────────────────────────────────────────────

export function rawQuoteToDoc(
  tradeId: string,
  rawQuote: RawQuote,
  docId: string,
  now: string,
): RawQuoteDoc {
  return {
    kind: PaperTradingKind.RAW_QUOTE,
    id: docId,
    tradeId,
    date: rawQuote.date,
    rawResponse: rawQuote.rawResponse,
    createdAt: now,
    updatedAt: now,
  };
}
