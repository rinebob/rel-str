/**
 * @topic #553 — Paper Trading Infra (task #720)
 *
 * Signal-trade settlement pass. The engine settlement pass iterates
 * strategy instances (`listOpenPositions` filters `source=STRATEGY`), so
 * signal-accepted option trades (`source=SIGNAL`, no instance) could never
 * expire — once the contract delisted, quotes 404'd and the governing
 * `trailing-{pct}` run generated `skipsNoMark` forever.
 *
 * For each OPEN signal trade whose option legs have ALL expired
 * (`expiration <= marketDate`) this pass resolves the outcome from the
 * underlying close on the expiration date (SDS daily bars — the same
 * source the engine settlement pass uses):
 *
 *   - all legs OTM → `markPositionSettled(EXPIRED_WORTHLESS)` — premium
 *     fully realized, governing run exits at 0.
 *   - any leg ITM → cash settlement at net intrinsic via `applyExitFill`
 *     (+ governing run finalized EXITED, same shape as the manual close).
 *     Paper trades never touch the broker, so assignment is modeled as an
 *     intrinsic buyback — a real ASSIGNED_HOLDING_SHARES state would have
 *     no mark path and re-zombie the trade.
 *
 * Share-only signal trades carry no expiration and are not candidates.
 * Mixed share+option legs and multi-leg option trades are errors (not
 * silently half-settled) — no signal producer emits those today; the
 * intrinsic math prices every leg at the settle close, which is only
 * honest for same-expiration legs.
 * The underlying close walks back up to `SETTLE_LOOKBACK_DAYS` from the
 * expiration — weekend/holiday expirations have no bar on the date
 * itself. Still-missing bars (untracked symbol, SDS outage) stay an
 * error: the trade remains eligible next night (`expiration <=`, not
 * `===`), loud rather than silently dropped.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type { PaperTrade, VariantRun } from '@paper-trading/contracts';
import { PaperTradeSource, PaperTradeStatus } from '@paper-trading/contracts';
import { OptionQuoteSource, OptionType } from '@options/common';
import { TradeSide } from '@common';
import {
  applyExitFill,
  computeExitPnl,
  orderPriceForLiquidationValue,
} from '../ledger';
import type { ApplyFillResult, ExitFillInput } from '../ledger';
import {
  ledgerDeps,
  listTrades,
  updateVariantRun,
} from '../repository';
import {
  markPositionSettled,
} from '../engine/position-repository';
import type {
  DailyUpdate,
  LegOutcomeUpdate,
  SettlementData,
} from '../engine/types';
import { LegOutcome, PositionStatus } from '../engine/types';
import { getUnderlyingCloseForDate } from '../engine/options-strategy-market-data';
import { calendarDaysBetween } from '../../common/pt-date-utils';
import { createLogger } from '../engine/logging';

const logger = createLogger('SignalSettlementPass');

/** Lookback window for the settle-date underlying close — covers a Friday
 *  expiration's SDS bar being the last trading day of a holiday weekend. */
const SETTLE_LOOKBACK_DAYS = 7;

export interface SignalSettlementPassSummary {
  marketDate: string;
  settled: number;
  /** OPEN signal trades not yet due (at least one option leg unexpired). */
  skipped: number;
  errors: { tradeId: string; error: string }[];
}

export interface SignalSettlementPassDeps {
  listOpenSignalTrades(): Promise<PaperTrade[]>;
  /** Underlying close for a specific trading date (SDS daily bars). */
  getUnderlyingClose(symbol: string, date: string): Promise<number | null>;
  /** `markPositionSettled` — the worthless-expiry ledger seam. */
  settleExpired(
    tradeId: string,
    settlement: SettlementData,
    legOutcomes: LegOutcomeUpdate[],
    dailyUpdate: DailyUpdate,
  ): Promise<void>;
  /** `applyExitFill` — the cash-settlement ledger seam for ITM legs. */
  applyExit(input: ExitFillInput): Promise<ApplyFillResult>;
  /** `updateVariantRun` — finalizes the governing run post-close. */
  updateRun(tradeId: string, run: VariantRun): Promise<void>;
  now(): Date;
}

/** Intrinsic value of one option leg against the underlying close. */
function intrinsic(
  leg: Extract<PaperTrade['legs'][number], { kind: 'option' }>,
  underlyingClose: number,
): number {
  return Math.max(
    0,
    leg.type === OptionType.PUT
      ? leg.strike - underlyingClose
      : underlyingClose - leg.strike,
  );
}

export async function runSignalSettlementPass(
  marketDate: string,
  deps: SignalSettlementPassDeps,
): Promise<SignalSettlementPassSummary> {
  const now = deps.now().toISOString();
  const summary: SignalSettlementPassSummary = {
    marketDate,
    settled: 0,
    skipped: 0,
    errors: [],
  };

  const trades = await deps.listOpenSignalTrades();
  for (const trade of trades) {
    try {
      if (!trade.legs.length) {
        throw new Error('no legs — cannot settle a leg-less trade');
      }
      const optionLegs = trade.legs.filter((l) => l.kind === 'option');
      if (optionLegs.length === 0) {
        continue; // share-only signal trades never expire — not candidates
      }
      if (optionLegs.length !== trade.legs.length) {
        throw new Error(
          'mixed share+option signal trade — settlement not supported',
        );
      }
      if (optionLegs.length > 1) {
        // No signal producer emits multi-leg trades today; intrinsic is
        // priced at one settle close, which is dishonest for mixed
        // expirations — fail loud instead of mispricing.
        throw new Error(
          'multi-leg signal trade — settlement not supported',
        );
      }
      const unexpired = optionLegs.filter((l) => l.expiration > marketDate);
      if (unexpired.length > 0) {
        summary.skipped++;
        continue;
      }
      // Both settle paths post account bookkeeping to the owner's account;
      // a missing userId must fail here, not skip bookkeeping inside the
      // write and leave trade/account diverged.
      if (!trade.userId) {
        throw new Error('no userId on trade — cannot resolve account');
      }
      const settleDate = optionLegs[0].expiration;
      const entryFill = trade.fills.find((f) => f.role === 'entry');

      // Settle at the expiration-day close when it exists; otherwise walk
      // back to the most recent trading day (weekend/holiday expirations
      // have no bar on the date itself), never past the entry date — a
      // close from before the trade existed is a stale basis. Only a
      // persistent miss — untracked symbol or SDS outage — stays a nightly
      // error.
      const close = await settleClose(
        trade.symbol,
        settleDate,
        deps,
        entryFill?.date,
      );
      if (!close) {
        throw new Error(
          `no underlying close for ${trade.symbol} within ` +
            `${SETTLE_LOOKBACK_DAYS}d of ${settleDate} — symbol-data sync ` +
            'may have failed; trade stays eligible next pass',
        );
      }
      const underlyingClose = close.price;
      // Dates carry the observed close's trading day — honest when the
      // expiration itself fell on a non-trading day.
      const closeDate = close.date;

      const allOtm = optionLegs.every(
        (l) => intrinsic(l, underlyingClose) === 0,
      );

      if (allOtm) {
        // Worthless expiry — the engine settlement seam realizes the full
        // premium and exits the governing run at 0. `unrealizedPnl` is
        // ignored for expired trades (the seam writes 0); pass it as such.
        await deps.settleExpired(
          trade.id,
          {
            status: PositionStatus.EXPIRED_WORTHLESS,
            currentValue: 0,
            currentValueAsOf: now,
            unrealizedPnl: 0,
          },
          optionLegs.map((l) => ({
            legId: l.id ?? '',
            outcome: LegOutcome.EXPIRED_WORTHLESS,
            closeDate,
          })),
          { date: closeDate, underlyingClose },
        );
        summary.settled++;
        continue;
      }

      // Any ITM leg → cash settle at the net intrinsic order price via the
      // shared liquidation-price convention (see orderPriceForLiquidationValue).
      let value = 0;
      for (const leg of optionLegs) {
        value +=
          (leg.side === TradeSide.SHORT ? -1 : 1) *
          intrinsic(leg, underlyingClose) *
          leg.quantity *
          leg.multiplier;
      }
      const exitPrice = orderPriceForLiquidationValue(
        value,
        trade.order,
        trade.legs,
      );
      if (!Number.isFinite(exitPrice) || exitPrice < 0) {
        throw new Error(
          `invalid intrinsic exit price ${exitPrice} for ${trade.id}`,
        );
      }

      const result = await deps.applyExit({
        userId: trade.userId,
        tradeId: trade.id,
        fill: {
          fillId: `exit-${trade.id}-expiry-${settleDate}`,
          role: 'exit',
          date: closeDate,
          price: exitPrice,
          quantity: trade.order.quantity,
          // Provenance note: not a real quote — the price is intrinsic
          // derived from the SDS daily bar. No better enum value exists.
          quoteSource: OptionQuoteSource.AV_EOD,
        },
        now,
      });

      // Finalize the governing run (same shape as the manual close
      // handler; a failure here is backfilled by the eval pass).
      const governing = result.trade.variantRuns.find(
        (r) => r.governing && r.state === 'ACTIVE',
      );
      if (governing) {
        try {
          await deps.updateRun(trade.id, {
            ...governing,
            state: 'EXITED',
            exitEvent: {
              date: closeDate,
              price: exitPrice,
              pnl: entryFill
                ? computeExitPnl(
                    entryFill,
                    exitPrice,
                    trade.order.side,
                    trade.legs,
                  )
                : 0,
              daysHeld: entryFill
                ? calendarDaysBetween(entryFill.date, closeDate)
                : 0,
            },
          });
        } catch (err) {
          logger.warn(
            `run finalize failed post-settlement on ${trade.id} — eval pass backfills: ${err}`,
          );
        }
      }
      summary.settled++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ tradeId: trade.id, error: message });
      logger.warn(`${trade.id}: settlement failed — ${message}`);
    }
  }

  logger.info(
    `Signal settlement pass for ${marketDate}: settled=${summary.settled} ` +
      `skipped=${summary.skipped} errors=${summary.errors.length}`,
  );
  return summary;
}

/**
 * Underlying close for the settle date, walking back up to
 * `SETTLE_LOOKBACK_DAYS` calendar days when the expiration has no bar
 * (weekend/holiday expirations). Returns null only when nothing exists
 * in the window — a persistent miss stays a nightly error.
 */
async function settleClose(
  symbol: string,
  settleDate: string,
  deps: SignalSettlementPassDeps,
  minDate?: string,
): Promise<{ date: string; price: number } | null> {
  for (let back = 0; back <= SETTLE_LOOKBACK_DAYS; back++) {
    const d = new Date(`${settleDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - back);
    const date = d.toISOString().slice(0, 10);
    if (minDate && date < minDate) break; // a pre-entry close is a stale basis
    const price = await deps.getUnderlyingClose(symbol, date);
    if (price !== null && Number.isFinite(price) && price > 0) {
      return { date, price };
    }
  }
  return null;
}

/**
 * Prod deps — SDS closes + the engine/ledger write seams.
 * Note: `settleExpired` wraps `markPositionSettled`, which opens its own
 * transaction on the module-global Firestore — `firestoreDb` is honored
 * by every other dep but not that one (same instance in prod).
 */
export function defaultSignalSettlementDeps(
  firestoreDb: Firestore,
): SignalSettlementPassDeps {
  return {
    listOpenSignalTrades: () =>
      listTrades(firestoreDb, {
        status: PaperTradeStatus.OPEN,
        source: PaperTradeSource.SIGNAL,
      }),
    getUnderlyingClose: getUnderlyingCloseForDate,
    settleExpired: (tradeId, settlement, legOutcomes, dailyUpdate) =>
      markPositionSettled(tradeId, settlement, legOutcomes, dailyUpdate),
    applyExit: (input) => applyExitFill(input, ledgerDeps(firestoreDb)),
    updateRun: (tradeId, run) =>
      updateVariantRun(firestoreDb, tradeId, run, new Date().toISOString()),
    now: () => new Date(),
  };
}
