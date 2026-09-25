/**
 * @topic #553 — Paper Trading Infra (task #562)
 *
 * Position view repository — same API surface the engine passes have always
 * used (`getPosition`, `listOpenPositions`, `markPosition`, …) but backed by
 * `paper-trading/trades/items` + `paper-trading/raw-quotes/items` instead of
 * the legacy `options-strategy-positions` tree.
 *
 * The trade doc is authoritative; `Position` is a derived view produced by
 * `engine/trade-adapter.ts`. New opens go through the ledger
 * (`applyEntryFill`) so the paper account cash/equity/counts update in the
 * same transaction that creates the trade.
 */

import { OptionQuoteSource } from '@options/common';
import { TradeSide } from '@common';
import { PaperTradeSource, PaperTradingKind, PaperTradeStatus } from '@paper-trading/contracts';
import type { PaperAccount, PaperMark, PaperTrade } from '@paper-trading/contracts';
import { buildAccountId, buildRawQuoteId } from '@paper-trading/ids';
import { db } from '../../firebase-admin-init';
import { paperDocRef, paperItemsRef } from '../collections';
import { applyEntryFill, positionValue, signedCashDelta } from '../ledger';
import { ledgerDeps } from '../repository';
import { createLogger } from './logging';
import {
  LEGACY_GOVERNING_VARIANT,
  expressionForLeg,
  legacyToPaperStatus,
  paperLegToPositionLeg,
  positionLegToPaper,
  rawQuoteToDoc,
  tradeToPosition,
} from './trade-adapter';
import { getInstance } from './strategy-instance-repository';
import type {
  DailyUpdate,
  Position,
  PositionLeg,
  RawQuote,
  SettlementData,
  LegOutcomeUpdate,
} from './types';
import { PositionStatus, SHARES_PER_CONTRACT } from './types';

const logger = createLogger('PositionRepository');

// ── ID helpers ───────────────────────────────────────────────────────────────

export {
  buildLegId,
  buildPositionId,
  findPrimaryLeg,
} from './position-ids';
export type { PositionIdConfig } from './position-ids';

// ── Internals ────────────────────────────────────────────────────────────────

function tradeRef(tradeId: string) {
  return paperDocRef(db, PaperTradingKind.TRADE, tradeId);
}

async function readTrade(tradeId: string): Promise<PaperTrade | null> {
  const snap = await tradeRef(tradeId).get();
  if (!snap.exists) return null;
  const doc = { id: snap.id, ...(snap.data() as object) } as PaperTrade;
  return doc.kind === PaperTradingKind.TRADE ? doc : null;
}

async function queryTrades(
  filters: Array<{ field: string; value: string }>,
): Promise<PaperTrade[]> {
  let q: FirebaseFirestore.Query = paperItemsRef(db, PaperTradingKind.TRADE);
  for (const f of filters) {
    q = q.where(f.field, '==', f.value);
  }
  const snap = await q.get();
  return snap.docs.map(
    (doc) => ({ id: doc.id, ...(doc.data() as object) }) as PaperTrade,
  );
}

// ── Read ─────────────────────────────────────────────────────────────────────

export async function getPosition(positionId: string): Promise<Position | null> {
  const trade = await readTrade(positionId);
  return trade ? tradeToPosition(trade) : null;
}

export async function listOpenPositions(instanceId?: string): Promise<Position[]> {
  const filters = [
    { field: 'status', value: PaperTradeStatus.OPEN },
    { field: 'source', value: PaperTradeSource.STRATEGY },
    ...(instanceId ? [{ field: 'strategyInstanceId', value: instanceId }] : []),
  ];
  const trades = await queryTrades(filters);
  return trades.map(tradeToPosition);
}

export async function getLegs(positionId: string): Promise<PositionLeg[]> {
  const trade = await readTrade(positionId);
  return trade ? trade.legs.map(paperLegToPositionLeg) : [];
}

export async function listPositionsByInstance(instanceId: string): Promise<Position[]> {
  const trades = await queryTrades([
    { field: 'strategyInstanceId', value: instanceId },
    { field: 'source', value: PaperTradeSource.STRATEGY },
  ]);
  return trades
    .map(tradeToPosition)
    .sort((a, b) => b.openDate.localeCompare(a.openDate));
}

/** All strategy positions, newest first (legs embedded — no N+1). */
export async function listAllPositions(instanceId?: string): Promise<Position[]> {
  const filters = [
    { field: 'source', value: PaperTradeSource.STRATEGY },
    ...(instanceId ? [{ field: 'strategyInstanceId', value: instanceId }] : []),
  ];
  const trades = await queryTrades(filters);
  return trades
    .map((t) => ({ ...tradeToPosition(t), legs: t.legs.map(paperLegToPositionLeg) }))
    .sort((a, b) => b.openDate.localeCompare(a.openDate));
}

export async function listHeldSharesPositions(
  instanceId?: string,
): Promise<Position[]> {
  const filters = [
    { field: 'status', value: PaperTradeStatus.ASSIGNED },
    { field: 'source', value: PaperTradeSource.STRATEGY },
    ...(instanceId ? [{ field: 'strategyInstanceId', value: instanceId }] : []),
  ];
  const trades = await queryTrades(filters);
  return trades.map(tradeToPosition);
}

// ── Write ──────────────────────────────────────────────────────────────────────

/**
 * Create a position — goes through `applyEntryFill` so the paper account's
 * cash/equity/openTradeCount update in the same transaction as the trade doc.
 * The instance doc supplies the account userId.
 */
export async function createPosition(
  position: Omit<Position, 'id'>,
  legs: PositionLeg[],
  rawQuote: RawQuote,
  positionId?: string,
): Promise<Position> {
  const id = positionId ?? `${position.instanceId}-${position.openDate}`;
  const instance = await getInstance(position.instanceId);
  if (!instance) {
    throw new Error(`createPosition: instance ${position.instanceId} not found`);
  }
  const now = new Date().toISOString();
  const paperLegs = legs.map(positionLegToPaper);

  const { trade } = await applyEntryFill(
    {
      userId: instance.userId,
      tradeId: id,
      order: {
        side: paperLegs[0]?.side ?? TradeSide.SHORT,
        type: 'MARKET',
        quantity: 1,
      },
      legs: paperLegs,
      fill: {
        fillId: `entry-${id}`,
        role: 'entry',
        date: position.openDate,
        price: paperLegs[0]?.entryMark ?? 0,
        quantity: 1,
        quoteSource: OptionQuoteSource.RH_MCP,
      },
      dims: {
        source: PaperTradeSource.STRATEGY,
        symbol: position.symbol,
        expression: paperLegs.length ? expressionForLeg(paperLegs[0]) : 'UNK',
        governingVariant: LEGACY_GOVERNING_VARIANT,
        strategyInstanceId: position.instanceId,
      },
      tradeOverrides: {
        capitalRequired: position.capitalRequired,
        lastMarkedAt: position.currentValueAsOf,
      },
      now,
    },
    ledgerDeps(db),
  );

  await writeRawQuote(id, rawQuote);
  return tradeToPosition(trade);
}

export async function writeRawQuote(
  positionId: string,
  rawQuote: RawQuote,
): Promise<void> {
  const now = new Date().toISOString();
  const doc = rawQuoteToDoc(
    positionId,
    rawQuote,
    buildRawQuoteId(positionId, new Date(`${rawQuote.date}T00:00:00Z`)),
    now,
  );
  const { id: _id, ...data } = doc;
  await paperDocRef(db, PaperTradingKind.RAW_QUOTE, doc.id).set(data, { merge: true });
}

/**
 * Mark pass write: stamp the per-contract mark on the trade's marks map and
 * each leg's lastMark, refresh lastMarkedAt + unrealizedPnl, and persist the
 * raw quote — all in one transaction.
 *
 * Single-leg only: the order-level mark is stamped onto every leg's
 * `lastMark` (same limitation as `applyExitFill`) — a multi-leg expression
 * would need per-leg marks.
 */
export async function markPosition(
  positionId: string,
  update: Partial<Position>,
  rawQuote: RawQuote,
): Promise<void> {
  const mark = (update.currentValue ?? 0) / SHARES_PER_CONTRACT;
  const now = new Date().toISOString();
  const rqDoc = rawQuoteToDoc(
    positionId,
    rawQuote,
    buildRawQuoteId(positionId, new Date(`${rawQuote.date}T00:00:00Z`)),
    now,
  );
  const { id: _rq, ...rqData } = rqDoc;

  await db.runTransaction(async (txn) => {
    const ref = tradeRef(positionId);
    const snap = await txn.get(ref);
    if (!snap.exists) {
      throw new Error(`position ${positionId} not found`);
    }
    const trade = snap.data() as PaperTrade;
    const marks = { ...(trade.marks ?? {}) };
    marks[rawQuote.date] = {
      ...marks[rawQuote.date],
      mark,
    } as PaperMark;
    txn.update(ref, {
      legs: trade.legs.map((leg) => ({ ...leg, lastMark: mark })),
      marks,
      unrealizedPnl: update.unrealizedPnl ?? trade.unrealizedPnl,
      lastMarkedAt: update.currentValueAsOf ?? now,
      updatedAt: now,
    });
    txn.set(paperDocRef(db, PaperTradingKind.RAW_QUOTE, rqDoc.id), rqData, { merge: true });
  });
}

// ── Settlement helpers ───────────────────────────────────────────────────────

export async function markPositionSettled(
  positionId: string,
  settlement: SettlementData,
  legOutcomes: LegOutcomeUpdate[],
  dailyUpdate?: DailyUpdate,
): Promise<void> {
  const now = new Date().toISOString();
  await db.runTransaction(async (txn) => {
    // All reads before all writes: trade → instance → account.
    const ref = tradeRef(positionId);
    const snap = await txn.get(ref);
    if (!snap.exists) {
      throw new Error(`position ${positionId} not found`);
    }
    const trade = snap.data() as PaperTrade;
    if (trade.status !== PaperTradeStatus.OPEN && trade.status !== PaperTradeStatus.ASSIGNED) {
      throw new Error(`position ${positionId} is not open (status ${trade.status}) — settlement is not idempotent-safe on terminal trades`);
    }

    const instRef = trade.strategyInstanceId
      ? paperDocRef(db, PaperTradingKind.INSTANCE, trade.strategyInstanceId)
      : null;
    const instSnap = instRef ? await txn.get(instRef) : null;
    const instUserId = instSnap?.exists
      ? (instSnap.data() as { userId?: string }).userId
      : undefined;
    const acctRef = instUserId
      ? paperDocRef(db, PaperTradingKind.ACCOUNT, buildAccountId(instUserId))
      : null;
    const acctSnap = acctRef ? await txn.get(acctRef) : null;

    const outcomeByLegId = new Map(legOutcomes.map((o) => [o.legId, o]));
    const legs = trade.legs.map((leg) => {
      const outcome = outcomeByLegId.get(leg.id ?? '');
      return outcome
        ? { ...leg, outcome: outcome.outcome, closeDate: outcome.closeDate, lastMark: 0 }
        : leg;
    });

    const marks = { ...(trade.marks ?? {}) };
    if (dailyUpdate) {
      marks[dailyUpdate.date] = {
        ...marks[dailyUpdate.date],
        underlyingClose: dailyUpdate.underlyingClose,
        ...(dailyUpdate.markPrice !== undefined ? { mark: dailyUpdate.markPrice } : {}),
      };
    }

    const expired = settlement.status === PositionStatus.EXPIRED_WORTHLESS;
    // Premium is realized income whenever the option expires — worthless or
    // by assignment (same convention as migrated trade docs and the account).
    // signedCashDelta is signed by order side: +premium for SHORT, −cost for LONG.
    const entryFill = trade.fills.find((f) => f.role === 'entry');
    const premium = entryFill
      ? signedCashDelta(entryFill, trade.order.side, trade.legs)
      : 0;
    // Liquidation value carried before the close (short legs negative).
    const markedValue = positionValue(trade.legs);
    // Assignment: shares delivered at strike → cash debit + share value added.
    const cashDelta = expired
      ? 0
      : -(settlement.assignment?.strikePrice ?? 0) *
        SHARES_PER_CONTRACT *
        (settlement.shares?.quantity ?? 0);
    const shareValue = expired
      ? 0
      : (dailyUpdate?.underlyingClose ?? settlement.assignment?.strikePrice ?? 0) *
        SHARES_PER_CONTRACT *
        (settlement.shares?.quantity ?? 0);

    txn.update(ref, {
      status: legacyToPaperStatus(settlement.status),
      legacyStatus: settlement.status,
      legs,
      marks,
      // Ledger convention: unrealized is 0 once the position is closed;
      // assignment keeps share P&L unrealized while the position stays open.
      unrealizedPnl: expired ? 0 : settlement.unrealizedPnl,
      realizedPnl: trade.realizedPnl + premium,
      lastMarkedAt: settlement.currentValueAsOf,
      ...(settlement.assignment ? { assignment: settlement.assignment } : {}),
      ...(settlement.shares ? { shares: settlement.shares } : {}),
      updatedAt: now,
    });

    // Account bookkeeping mirrors applyExitFill: cash/equity/counts change in
    // the same txn as the close. Missing account → warn, don't fail the close.
    if (acctSnap?.exists) {
      const acct = acctSnap.data() as PaperAccount;
      txn.update(acctSnap.ref, {
        cash: acct.cash + cashDelta,
        equity: acct.equity + cashDelta - markedValue + shareValue,
        realizedPnl: acct.realizedPnl + premium,
        ...(expired
          ? { openTradeCount: Math.max(0, acct.openTradeCount - 1) }
          : {}),
        updatedAt: now,
      });
    } else {
      // Missing instance doc, userId, or account — surface all of them.
      logger.warn(`settlement skipped account bookkeeping (position ${positionId}, instance ${trade.strategyInstanceId ?? 'none'}, user ${instUserId ?? 'none'})`);
    }
  });
}

/** Atomically update a held-shares position's mark + daily-update. */
export async function markHeldSharesPosition(
  positionId: string,
  update: Partial<Position>,
  dailyUpdate: DailyUpdate,
): Promise<void> {
  const now = new Date().toISOString();
  await db.runTransaction(async (txn) => {
    const ref = tradeRef(positionId);
    const snap = await txn.get(ref);
    if (!snap.exists) {
      throw new Error(`position ${positionId} not found`);
    }
    const trade = snap.data() as PaperTrade;
    const marks = { ...(trade.marks ?? {}) };
    marks[dailyUpdate.date] = {
      ...marks[dailyUpdate.date],
      underlyingClose: dailyUpdate.underlyingClose,
      ...(dailyUpdate.markPrice !== undefined ? { mark: dailyUpdate.markPrice } : {}),
    };
    txn.update(ref, {
      marks,
      unrealizedPnl: update.unrealizedPnl ?? trade.unrealizedPnl,
      lastMarkedAt: update.currentValueAsOf ?? now,
      updatedAt: now,
    });
  });
}
