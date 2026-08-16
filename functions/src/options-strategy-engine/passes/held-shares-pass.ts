/**
 * @topic #108 — Options Position Strategy Engine
 *
 * Held-shares mark pass — daily marks for positions in
 * ASSIGNED_HOLDING_SHARES status. The position's current value tracks the
 * underlying's closing price (not the strike), and unrealized P&L is computed
 * against the per-share cost basis (the strike price at assignment).
 *
 * PRD story 8: unrealizedPnl = (currentClose - strikePrice) × 100 × quantity,
 * where quantity is in contracts and ×100 is shares per contract.
 *
 * Tested directly with injected dependencies (see held-shares-pass.test.ts),
 * mirroring the runMarkPass / runSettlementPass seam pattern.
 */

import type { StrategyInstanceConfig } from '@options-strategy-engine/contracts';
import {
  listHeldSharesPositions,
  markHeldSharesPosition,
} from '../position-repository';
import type { Position, DailyUpdate } from '../types';
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
  instanceId: string;
  date: string;
  marked: HeldSharesMarkResult[];
  deferred: { positionId: string; reason: string }[];
  errors: { positionId: string; error: string }[];
}

export interface HeldSharesMarkPassDependencies {
  listHeldSharesPositions?: (instanceId: string) => Promise<Position[]>;
  getUnderlyingClose: (symbol: string, date: string) => Promise<number | null>;
  markHeldSharesPosition?: (
    positionId: string,
    update: Partial<Position>,
    dailyUpdate: DailyUpdate,
  ) => Promise<void>;
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function runHeldSharesMarkPass(
  instanceId: string,
  date: string,
  config: StrategyInstanceConfig,
  deps: HeldSharesMarkPassDependencies,
): Promise<HeldSharesMarkPassResult> {
  const listHeld = deps.listHeldSharesPositions ?? listHeldSharesPositions;
  const getClose = deps.getUnderlyingClose;
  const mark = deps.markHeldSharesPosition ?? markHeldSharesPosition;

  const marked: HeldSharesMarkResult[] = [];
  const deferred: { positionId: string; reason: string }[] = [];
  const errors: { positionId: string; error: string }[] = [];

  const heldPositions = await listHeld(instanceId);
  if (heldPositions.length === 0) {
    logger.info(`No held-shares positions for ${instanceId}`);
    return { instanceId, date, marked, deferred, errors };
  }

  for (const pos of heldPositions) {
    try {
      if (!pos.shares) {
        errors.push({
          positionId: pos.id,
          error: 'ASSIGNED_HOLDING_SHARES position missing shares record',
        });
        continue;
      }

      const underlyingClose = await getClose(config.symbol, date);
      if (underlyingClose === null) {
        deferred.push({
          positionId: pos.id,
          reason: `No underlying closing bar for ${config.symbol}/${date}`,
        });
        continue;
      }

      const { quantity, costBasis } = pos.shares;
      const currentValue = underlyingClose * SHARES_PER_CONTRACT * quantity;
      const unrealizedPnl =
        (underlyingClose - costBasis) * SHARES_PER_CONTRACT * quantity;
      const markedAt = new Date().toISOString();

      await mark(
        pos.id,
        {
          currentValue,
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
        positionId: pos.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info(
    `Marked ${marked.length} held-shares position(s), deferred ${deferred.length}, ${errors.length} error(s) for ${instanceId}/${date}`,
  );
  return { instanceId, date, marked, deferred, errors };
}
