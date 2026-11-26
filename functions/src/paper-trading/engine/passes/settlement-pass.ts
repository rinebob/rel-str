/**
 *
 * Settlement pass (#1714) — position-grain sweep over every OPEN option-leg
 * trade, no instance enumeration. Selection reuses the unified mark pass's
 * `listOpenOptionTrades` (era-agnostic — legacy zombie docs and trades on
 * STOPPED instances settle on the same nightly run) minus `source=SIGNAL`:
 * signalSettlementPass owns signal trades globally (#720), so the two
 * passes stay disjoint by source.
 *
 * A position settles when its LAST option leg expires on or before the run
 * date (`<=` keeps the #724 missed-night retry — a skipped or mismatched
 * night settles late instead of leaving the trade OPEN forever). Each
 * leg's outcome is decided at its OWN expiration-day close, walking back
 * to the last trading day when the expiration has no bar (weekend/holiday
 * expirations), never before the leg's open — a persistent miss stays a
 * per-position error.
 *
 * Leg outcome rule: ITM at its expiration close → ASSIGNED, OTM/ATM →
 * EXPIRED_WORTHLESS (PUT: close < strike; CALL: close > strike — #1714
 * lifts the PUT-only restriction). A wired BrokerageOutcomeChecker
 * overrides the local computation, but only for single-option-leg
 * positions — the broker verdict has no per-leg granularity (#728).
 *
 * Position outcome = net share delivery across assigned legs: short puts
 * and long calls deliver +shares, long puts and short calls −shares.
 * Net long → ASSIGNED_HOLDING_SHARES at the cash-weighted strike basis
 * (total strike cash paid per net contract). Net flat → EXPIRED_WORTHLESS
 * (a fully-ITM credit spread resolves both legs but holds no shares).
 * Net short is an error — uncovered call assignment would book a
 * short-share position the model can't hold (synthetic CC lifecycle is
 * future scope).
 *
 * The pass is triggered from `checkSyncRunCompletion` in
 * `symbol-data-sync.ts` after all nightly closing bars are guaranteed to be
 * in Firestore, so there is no "deferred" state — if a closing bar is
 * missing, that's an error.
 */

import { OptionType } from '@options/common';
import { TradeSide } from '@common';
import { PaperTradeSource } from '@paper-trading/contracts';
import type { PaperTrade, PaperTradeLeg } from '@paper-trading/contracts';
import {
  listOpenOptionTrades,
  markPositionSettled,
} from '../position-repository';
import { paperLegToPositionLeg, tradeToPosition } from '../trade-adapter';
import type {
  Position,
  PositionLeg,
  DailyUpdate,
  SettlementData,
  LegOutcomeUpdate,
} from '../types';
import { LegOutcome, PositionStatus, SHARES_PER_CONTRACT } from '../types';
import {
  getUnderlyingCloseForDate,
  getUnderlyingCloseOnOrBefore,
  SETTLE_CLOSE_LOOKBACK_DAYS,
} from '../options-strategy-market-data';
import type { UnderlyingCloseReader } from '../options-strategy-market-data';
import { createLogger } from '../logging';

const logger = createLogger('SettlementPass');

type OptionLeg = Extract<PaperTradeLeg, { kind: 'option' }>;

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
  date: string;
  settled: SettlementPassPositionResult[];
  skippedNotExpired: number;
  errors: { positionId: string; error: string }[];
}

// Canonical definition lives in options-strategy-market-data.ts; re-export
// keeps the options-strategy-engine shim surfacing it unchanged.
export type { UnderlyingCloseReader };

/**
 * Queries Robinhood for the actual outcome of an expired option position.
 * Returns whether the position was assigned (shares delivered) or expired
 * worthless. Consulted only for single-option-leg positions — the broker
 * verdict has no per-leg granularity, so multi-leg outcomes are always
 * computed locally.
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
    position: Position,
    leg: PositionLeg,
  ): Promise<{ assigned: boolean; contractsQuantity?: number }>;
}

export interface SettlementPassDependencies {
  listOpenOptionTrades?: () => Promise<PaperTrade[]>;
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
  date: string,
  deps: SettlementPassDependencies = {},
): Promise<SettlementPassResult> {
  const listTrades = deps.listOpenOptionTrades ?? listOpenOptionTrades;
  const getClose = deps.getUnderlyingClose ?? getUnderlyingCloseForDate;
  const checkOutcome = deps.checkBrokerageOutcome;
  const settle = deps.markPositionSettled ?? markPositionSettled;

  const settled: SettlementPassPositionResult[] = [];
  const errors: { positionId: string; error: string }[] = [];
  let skippedNotExpired = 0;

  // Signal trades are owned by signalSettlementPass (#720) — everything
  // else (STRATEGY, MANUAL, legacy docs missing `source`) sweeps in here.
  const trades = (await listTrades()).filter(
    (t) => t.source !== PaperTradeSource.SIGNAL,
  );
  if (trades.length === 0) {
    logger.info('No open option trades to settle');
    return { date, settled, skippedNotExpired, errors };
  }

  for (const trade of trades) {
    // The adapter maps the position view inside the try — a malformed doc
    // (the zombie population this sweep targets) lands in errors[] rather
    // than aborting the whole run.
    let pos: Position;
    try {
      pos = tradeToPosition(trade);
      const optionLegs = trade.legs.filter(
        (l): l is OptionLeg => l.kind === 'option',
      );
      // A mixed share+option doc still settles its option legs — the share
      // leg keeps no outcome (producers don't emit mixed docs today).
      if (optionLegs.length === 0) {
        continue;
      }

      // Last-leg rule: the position settles only when every option leg has
      // expired — a calendar/diagonal's earlier expirations don't close it.
      const lastExpiry = optionLegs.reduce(
        (m, l) => (l.expiration > m ? l.expiration : m),
        '',
      );
      if (lastExpiry > date) {
        skippedNotExpired++;
        continue;
      }

      const checkerVerdict =
        checkOutcome && optionLegs.length === 1
          ? await checkOutcome(pos, paperLegToPositionLeg(optionLegs[0]))
          : undefined;
      if (!checkerVerdict) {
        // One warn per position per run — prod never wires a checker
        // (#728 left it unconnected), so per-leg warns are nightly spam.
        logger.warn(
          `No brokerage outcome checker for ${pos.id} — outcomes computed ` +
            `locally from expiration closes`,
        );
      }

      const legOutcomes: LegOutcomeUpdate[] = [];
      let netContracts = 0;
      // Total strike cash of the net delivered shares — signed the same way
      // as netContracts, so costBasis = deliveredCash / netContracts.
      let deliveredCash = 0;
      // Net order-level intrinsic (per contract unit) for the variant-run
      // exit price: legs matching the order side contribute +intrinsic,
      // opposing legs −intrinsic — cost-to-close for SHORT orders,
      // proceeds for LONG. Priced at each leg's own expiration close.
      let orderExitUnits = 0;
      let settlingClose: { date: string; price: number } | undefined;
      let settlingStrike = 0;

      for (const leg of optionLegs) {
        if (!leg.expiration) {
          throw new Error(
            `malformed option leg on ${pos.id} (id ${leg.id ?? '?'}) — ` +
              `no expiration`,
          );
        }
        // Price each leg at ITS expiration-day close, walking back over
        // non-trading days, never before the leg opened — a pre-open close
        // is a stale basis. `||` not `??` — adapters emit openDate '' for
        // migrated docs; '' would silently disable the floor.
        const minDate = leg.openDate || pos.openDate;
        if (!minDate) {
          throw new Error(
            `position ${pos.id} has no leg/position open date — cannot bound ` +
              `the settlement close walk-back`,
          );
        }
        const close = await getUnderlyingCloseOnOrBefore(
          pos.symbol,
          leg.expiration,
          { reader: getClose, minDate },
        );
        if (!close) {
          throw new Error(
            `No underlying closing bar for ${pos.symbol} within ` +
              `${SETTLE_CLOSE_LOOKBACK_DAYS}d of ${leg.expiration} ` +
              `(leg ${leg.id ?? '?'}) — symbol-data sync may have failed`,
          );
        }

        let assigned =
          leg.type === OptionType.PUT
            ? close.price < leg.strike
            : close.price > leg.strike;
        let quantity = leg.quantity;
        if (checkerVerdict) {
          assigned = checkerVerdict.assigned;
          if (checkerVerdict.contractsQuantity !== undefined) {
            quantity = checkerVerdict.contractsQuantity;
          }
        }

        legOutcomes.push({
          legId: leg.id ?? '',
          outcome: assigned ? LegOutcome.ASSIGNED : LegOutcome.EXPIRED_WORTHLESS,
          closeDate: close.date,
        });
        // Order-side legs carry the position's liability/proceeds; legs on
        // the other side offset them. Worthless legs contribute 0 intrinsic.
        const legIntrinsic =
          leg.type === OptionType.PUT
            ? Math.max(0, leg.strike - close.price)
            : Math.max(0, close.price - leg.strike);
        orderExitUnits +=
          (leg.side === trade.order.side ? 1 : -1) * legIntrinsic * leg.quantity;
        if (assigned) {
          // Share-delivery sign: puts deliver +shares to the SHORT side and
          // −shares to the LONG side; calls mirror (− short / + long).
          const sign =
            (leg.side === TradeSide.SHORT ? 1 : -1) *
            (leg.type === OptionType.PUT ? 1 : -1);
          netContracts += sign * quantity;
          deliveredCash += sign * leg.strike * quantity;
        }
        if (leg.expiration === lastExpiry) {
          settlingClose = close;
          settlingStrike = leg.strike;
        }
      }

      if (netContracts < 0) {
        throw new Error(
          `Net short share delivery for ${pos.id} — uncovered call ` +
            `assignment books shares the model can't hold (synthetic ` +
            `covered-call lifecycle is not built)`,
        );
      }

      const settledAt = new Date().toISOString();
      // The last-expiring leg's close drives the position-level stamp. A
      // leg at lastExpiry provably exists and its close either resolved or
      // threw above — settlingClose can't be unset; assert so a future
      // refactor can't silently stamp a 0 close.
      if (!settlingClose) {
        throw new Error(`no close resolved for last-expiring leg on ${pos.id}`);
      }
      const underlyingClose = settlingClose.price;
      const closeDate = settlingClose.date;
      const dailyUpdate: DailyUpdate = { date: closeDate, underlyingClose };
      // Per-unit order exit price — the order's net intrinsic at settlement
      // (0 when every leg expired worthless). The governing variant run
      // books its exit at this, so a max-loss spread can't stamp a
      // fabricated max-profit exit (#1714).
      const orderExitPrice = Math.max(
        0,
        orderExitUnits / (trade.order.quantity || 1),
      );

      if (netContracts === 0) {
        // Expired flat — all legs resolved worthless or into offsetting
        // deliveries. Offsetting deliveries still move strike cash
        // (deliveryCash) — the ledger books the differential, not zero.
        const unrealizedPnl = pos.premiumCollected;
        await settle(
          pos.id,
          {
            status: PositionStatus.EXPIRED_WORTHLESS,
            currentValue: 0,
            currentValueAsOf: settledAt,
            unrealizedPnl,
            deliveryCash: deliveredCash,
            orderExitPrice,
          },
          legOutcomes,
          dailyUpdate,
        );
        settled.push({
          positionId: pos.id,
          outcome: PositionStatus.EXPIRED_WORTHLESS,
          strike: settlingStrike,
          underlyingClose,
          currentValue: 0,
          unrealizedPnl,
          settledAt,
        });
      } else {
        // Net long delivery — hold shares at the cash-weighted basis.
        const costBasis = deliveredCash / netContracts;
        const currentValue = underlyingClose * SHARES_PER_CONTRACT * netContracts;
        const unrealizedPnl =
          (underlyingClose - costBasis) * SHARES_PER_CONTRACT * netContracts;
        await settle(
          pos.id,
          {
            status: PositionStatus.ASSIGNED_HOLDING_SHARES,
            currentValue,
            currentValueAsOf: settledAt,
            unrealizedPnl,
            assignment: {
              strikePrice: costBasis,
              underlyingCloseAtExpiration: underlyingClose,
              assignedAt: closeDate,
            },
            shares: { quantity: netContracts, costBasis },
            deliveryCash: deliveredCash,
            orderExitPrice,
          },
          legOutcomes,
          dailyUpdate,
        );
        settled.push({
          positionId: pos.id,
          outcome: PositionStatus.ASSIGNED_HOLDING_SHARES,
          strike: settlingStrike,
          underlyingClose,
          currentValue,
          unrealizedPnl,
          settledAt,
        });
      }
    } catch (err) {
      errors.push({
        positionId: trade.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info(
    `Settled ${settled.length}, skipped-not-expired ${skippedNotExpired}, ${errors.length} error(s) for ${date}`,
  );
  return { date, settled, skippedNotExpired, errors };
}
