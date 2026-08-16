/**
 * @topic #108 — Options Position Strategy Engine
 *
 * Settlement pass — settles OPEN positions whose primary leg expires on the
 * run date. For the phase-1 cash-secured-put (short PUT) strategy, a position
 * is assigned when the underlying closes at or below `strike - 0.01` (the OCC
 * $0.01 auto-exercise threshold) and expires worthless otherwise.
 *
 * Tested directly with injected dependencies (see settlement-pass.test.ts),
 * mirroring the runMarkPass seam pattern.
 */

import type { StrategyInstanceConfig } from '@options-strategy-engine/contracts';
import { OptionType } from '@options/common';
import {
  listOpenPositions,
  getLegs,
  markPositionSettled,
  findPrimaryLeg,
} from '../position-repository';
import type {
  Position,
  PositionLeg,
  DailyUpdate,
  SettlementData,
  LegOutcomeUpdate,
} from '../types';
import { LegOutcome, PositionStatus, SHARES_PER_CONTRACT } from '../types';
import { createLogger } from '../logging';

const logger = createLogger('SettlementPass');

/** Per-share auto-exercise threshold (OCC rule). */
const AUTO_EXERCISE_THRESHOLD = 0.01;

// ── Types ──────────────────────────────────────────────────────────────────

export interface SettlementPassPositionResult {
  positionId: string;
  outcome: PositionStatus.EXPIRED_WORTHLESS | PositionStatus.ASSIGNED_HOLDING_SHARES;
  strike: number;
  underlyingClose: number;
  currentValue: number;
  unrealizedPnl: number;
  settledAt: string;
}

export interface SettlementPassDeferred {
  positionId: string;
  reason: string;
}

export interface SettlementPassResult {
  instanceId: string;
  date: string;
  settled: SettlementPassPositionResult[];
  deferred: SettlementPassDeferred[];
  errors: { positionId: string; error: string }[];
}

export type UnderlyingCloseReader = (
  symbol: string,
  date: string,
) => Promise<number | null>;

export interface SettlementPassDependencies {
  listOpenPositions?: (instanceId: string) => Promise<Position[]>;
  getLegs?: (positionId: string) => Promise<PositionLeg[]>;
  getUnderlyingClose?: UnderlyingCloseReader;
  markPositionSettled?: (
    positionId: string,
    settlement: SettlementData,
    legOutcomes: LegOutcomeUpdate[],
    dailyUpdate?: DailyUpdate,
  ) => Promise<void>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * For a short PUT, the position is assigned (auto-exercised) when the
 * underlying closes at or below `strike - 0.01` on the position's expiration
 * day. This helper is only evaluated by the settlement pass on expiration;
 * early assignment is explicitly out of scope (see PRD "Limitations"). Returns
 * true when assigned.
 */
export function isShortPutAssigned(
  strike: number,
  underlyingClose: number,
): boolean {
  return underlyingClose <= strike - AUTO_EXERCISE_THRESHOLD;
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function runSettlementPass(
  instanceId: string,
  date: string,
  config: StrategyInstanceConfig,
  deps: SettlementPassDependencies = {},
): Promise<SettlementPassResult> {
  const listOpen = deps.listOpenPositions ?? listOpenPositions;
  const getLegsForPosition = deps.getLegs ?? getLegs;
  const getClose = deps.getUnderlyingClose;
  const settle = deps.markPositionSettled ?? markPositionSettled;

  const settled: SettlementPassPositionResult[] = [];
  const deferred: SettlementPassDeferred[] = [];
  const errors: { positionId: string; error: string }[] = [];

  const openPositions = await listOpen(instanceId);
  if (openPositions.length === 0) {
    logger.info(`No open positions for ${instanceId}`);
    return { instanceId, date, settled, deferred, errors };
  }

  for (const pos of openPositions) {
    try {
      const legs = await getLegsForPosition(pos.id);
      const leg = findPrimaryLeg(legs);
      if (!leg || leg.expiration !== date) {
        // Not expiring on the run date — leave for a future pass.
        continue;
      }

      if (leg.type !== OptionType.PUT) {
        deferred.push({
          positionId: pos.id,
          reason: `Settlement for ${leg.type} legs not implemented in phase 1`,
        });
        continue;
      }

      if (!getClose) {
        throw new Error('Settlement pass: getUnderlyingClose is required');
      }
      const underlyingClose = await getClose(config.symbol, date);
      if (underlyingClose === null) {
        deferred.push({
          positionId: pos.id,
          reason: `No underlying closing bar for ${config.symbol}/${date}`,
        });
        continue;
      }

      const settledAt = new Date().toISOString();
      const dailyUpdate: DailyUpdate = {
        date,
        underlyingClose,
      };

      if (!isShortPutAssigned(leg.strike, underlyingClose)) {
        // OTM — expire worthless, retain full premium.
        const unrealizedPnl = pos.premiumCollected;
        await settle(
          pos.id,
          {
            status: PositionStatus.EXPIRED_WORTHLESS,
            currentValue: 0,
            currentValueAsOf: settledAt,
            unrealizedPnl,
          },
          [{ legId: leg.id, outcome: LegOutcome.EXPIRED_WORTHLESS, closeDate: date }],
          dailyUpdate,
        );

        settled.push({
          positionId: pos.id,
          outcome: PositionStatus.EXPIRED_WORTHLESS,
          strike: leg.strike,
          underlyingClose,
          currentValue: 0,
          unrealizedPnl,
          settledAt,
        });
      } else {
        // ITM — assigned, take delivery of shares at the strike price.
        // quantity is in contracts (1 this phase); ×100 is shares per contract.
        // PRD story 8: unrealizedPnl = (close - strike) × 100 × quantity.
        const quantity = 1;
        const currentValue = underlyingClose * SHARES_PER_CONTRACT * quantity;
        const unrealizedPnl =
          (underlyingClose - leg.strike) * SHARES_PER_CONTRACT * quantity;
        await settle(
          pos.id,
          {
            status: PositionStatus.ASSIGNED_HOLDING_SHARES,
            currentValue,
            currentValueAsOf: settledAt,
            unrealizedPnl,
            assignment: {
              strikePrice: leg.strike,
              underlyingCloseAtExpiration: underlyingClose,
              assignedAt: date,
            },
            shares: { quantity, costBasis: leg.strike },
          },
          [{ legId: leg.id, outcome: LegOutcome.ASSIGNED, closeDate: date }],
          dailyUpdate,
        );

        settled.push({
          positionId: pos.id,
          outcome: PositionStatus.ASSIGNED_HOLDING_SHARES,
          strike: leg.strike,
          underlyingClose,
          currentValue,
          unrealizedPnl,
          settledAt,
        });
      }
    } catch (err) {
      errors.push({
        positionId: pos.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info(
    `Settled ${settled.length}, deferred ${deferred.length}, ${errors.length} error(s) for ${instanceId}/${date}`,
  );
  return { instanceId, date, settled, deferred, errors };
}
