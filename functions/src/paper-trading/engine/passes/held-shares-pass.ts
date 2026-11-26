/**
 *
 * Held-shares mark pass — position-grain sweep (#1714) over every ASSIGNED
 * trade except signal-owned ones (the signal machinery marks those).
 * Selection needs no instance, so held positions on legacy zombie docs and
 * STOPPED instances mark alongside manage positions, each priced against
 * its own symbol's close.
 *
 * The position's current value tracks the underlying's closing price (not
 * the strike), and unrealized P&L is computed against the per-share cost
 * basis (the strike price at assignment).
 *
 * PRD story 8: unrealizedPnl = (currentClose - strikePrice) × 100 × quantity,
 * where quantity is in contracts and ×100 is shares per contract.
 *
 * Tested directly with injected dependencies (see held-shares-pass.test.ts),
 * mirroring the runMarkPass / runSettlementPass seam pattern.
 */

import { PaperTradeSource } from '@paper-trading/contracts';
import type { PaperTrade } from '@paper-trading/contracts';
import {
  listAssignedTrades,
  markHeldSharesPosition,
} from '../position-repository';
import { tradeToPosition } from '../trade-adapter';
import type { Position, DailyUpdate } from '../types';
import { getUnderlyingCloseForDate } from '../options-strategy-market-data';
import type { UnderlyingCloseReader } from '../options-strategy-market-data';
import { SHARES_PER_CONTRACT } from '../types';
import { createLogger } from '../logging';

const logger = createLogger('HeldSharesPass');

// ── Types ──────────────────────────────────────────────────────────────────

export interface HeldSharesMarkResult {
  positionId: string;
  underlyingClose: number;
  currentValue: number;
  unrealizedPnl: number;
  markedAt: string;
}

export interface HeldSharesMarkPassResult {
  date: string;
  marked: HeldSharesMarkResult[];
  errors: { positionId: string; error: string }[];
}

export interface HeldSharesMarkPassDependencies {
  listAssignedTrades?: () => Promise<PaperTrade[]>;
  getUnderlyingClose?: UnderlyingCloseReader;
  markHeldSharesPosition?: (
    positionId: string,
    update: { unrealizedPnl: number; currentValueAsOf: string },
    dailyUpdate: DailyUpdate,
  ) => Promise<void>;
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function runHeldSharesMarkPass(
  date: string,
  deps: HeldSharesMarkPassDependencies,
): Promise<HeldSharesMarkPassResult> {
  const listHeld = deps.listAssignedTrades ?? listAssignedTrades;
  const getClose = deps.getUnderlyingClose ?? getUnderlyingCloseForDate;
  const mark = deps.markHeldSharesPosition ?? markHeldSharesPosition;

  const marked: HeldSharesMarkResult[] = [];
  const errors: { positionId: string; error: string }[] = [];

  // Same disjointness as settlement — signal-source ASSIGNED positions
  // belong to the signal machinery; an injected lister can't leak them.
  const heldTrades = (await listHeld()).filter(
    (t) => t.source !== PaperTradeSource.SIGNAL,
  );
  if (heldTrades.length === 0) {
    logger.info('No held-shares positions');
    return { date, marked, errors };
  }

  for (const trade of heldTrades) {
    // Adapter inside the try — a malformed ASSIGNED doc lands in errors[]
    // rather than aborting the sweep.
    let pos: Position;
    try {
      pos = tradeToPosition(trade);
      if (!pos.shares) {
        errors.push({
          positionId: pos.id,
          error: 'ASSIGNED_HOLDING_SHARES position missing shares record',
        });
        continue;
      }

      const underlyingClose = await getClose(pos.symbol, date);
      if (
        underlyingClose === null ||
        !Number.isFinite(underlyingClose) ||
        underlyingClose <= 0
      ) {
        errors.push({
          positionId: pos.id,
          error: `No usable underlying closing bar for ${pos.symbol}/${date} — symbol-data sync may have failed`,
        });
        continue;
      }

      const { quantity, costBasis } = pos.shares;
      const currentValue = underlyingClose * SHARES_PER_CONTRACT * quantity;
      const unrealizedPnl =
        (underlyingClose - costBasis) * SHARES_PER_CONTRACT * quantity;
      const markedAt = new Date().toISOString();

      // currentValue stays a Position-view value — the doc write only
      // persists unrealizedPnl + lastMarkedAt (Position convention).
      await mark(
        pos.id,
        {
          currentValueAsOf: markedAt,
          unrealizedPnl,
        },
        { date, underlyingClose },
      );

      marked.push({
        positionId: pos.id,
        underlyingClose,
        currentValue,
        unrealizedPnl,
        markedAt,
      });
    } catch (err) {
      errors.push({
        positionId: trade.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info(
    `Marked ${marked.length} held-shares position(s), ${errors.length} error(s) for ${date}`,
  );
  return { date, marked, errors };
}
