/**
 *
 * Settlement pass — settles OPEN positions whose primary leg expires on the
 * run date. Queries Robinhood for the actual outcome (assignment, expiration,
 * or cash settlement) rather than computing it locally from the underlying
 * close.
 *
 * The pass is triggered from `checkSyncRunCompletion` in
 * `symbol-data-sync.ts` after all nightly closing bars are guaranteed to be
 * in Firestore, so there is no "deferred" state — if a closing bar is
 * missing, that's an error.
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

export interface SettlementPassResult {
  instanceId: string;
  date: string;
  settled: SettlementPassPositionResult[];
  errors: { positionId: string; error: string }[];
}

export type UnderlyingCloseReader = (
  symbol: string,
  date: string,
) => Promise<number | null>;

/**
 * Queries Robinhood for the actual outcome of an expired option position.
 * Returns whether the position was assigned (shares delivered) or expired
 * worthless.
 *
 * Implementation should:
 * 1. Call `get_equity_positions` to check if shares of the underlying were
 *    delivered (assignment).
 * 2. Call `get_option_positions` to check if the option position still exists
 *    (if gone with no shares, it expired worthless).
 * 3. Call `get_accounts` / `get_realized_pnl` to detect cash settlement
 *    (large debit).
 */
export interface BrokerageOutcomeChecker {
  (
    config: StrategyInstanceConfig,
    leg: PositionLeg,
    position: Position,
  ): Promise<{ assigned: boolean; sharesQuantity?: number }>;
}

export interface SettlementPassDependencies {
  listOpenPositions?: (instanceId: string) => Promise<Position[]>;
  getLegs?: (positionId: string) => Promise<PositionLeg[]>;
  getUnderlyingClose?: UnderlyingCloseReader;
  checkBrokerageOutcome?: BrokerageOutcomeChecker;
  markPositionSettled?: (
    positionId: string,
    settlement: SettlementData,
    legOutcomes: LegOutcomeUpdate[],
    dailyUpdate?: DailyUpdate,
  ) => Promise<void>;
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
  const checkOutcome = deps.checkBrokerageOutcome;
  const settle = deps.markPositionSettled ?? markPositionSettled;

  const settled: SettlementPassPositionResult[] = [];
  const errors: { positionId: string; error: string }[] = [];

  const openPositions = await listOpen(instanceId);
  if (openPositions.length === 0) {
    logger.info(`No open positions for ${instanceId}`);
    return { instanceId, date, settled, errors };
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
        throw new Error(
          `Settlement for ${leg.type} legs not implemented`,
        );
      }

      if (!getClose) {
        throw new Error('Settlement pass: getUnderlyingClose is required');
      }
      const underlyingClose = await getClose(config.symbol, date);
      if (underlyingClose === null) {
        throw new Error(
          `No underlying closing bar for ${config.symbol}/${date} — symbol-data sync may have failed`,
        );
      }

      // Query RH for the actual outcome instead of computing it locally.
      let assigned = false;
      let sharesQuantity = 1;
      if (checkOutcome) {
        const outcome = await checkOutcome(config, leg, pos);
        assigned = outcome.assigned;
        if (outcome.sharesQuantity !== undefined) {
          sharesQuantity = outcome.sharesQuantity;
        }
      } else {
        logger.warn(
          `No brokerage outcome checker provided for ${pos.id} — skipping RH query`,
        );
      }

      const settledAt = new Date().toISOString();
      const dailyUpdate: DailyUpdate = {
        date,
        underlyingClose,
      };

      if (!assigned) {
        // Expired worthless — retain full premium.
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
        // Assigned — take delivery of shares at the strike price.
        const currentValue = underlyingClose * SHARES_PER_CONTRACT * sharesQuantity;
        const unrealizedPnl =
          (underlyingClose - leg.strike) * SHARES_PER_CONTRACT * sharesQuantity;
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
            shares: { quantity: sharesQuantity, costBasis: leg.strike },
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
    `Settled ${settled.length}, ${errors.length} error(s) for ${instanceId}/${date}`,
  );
  return { instanceId, date, settled, errors };
}
