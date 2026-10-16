/**
 * @topic #553 — Paper Trading Infra (task #983)
 *
 * Signal-trade EOD close stamp. The intraday mark pass
 * (`runSignalMarkPass` under `optionsMarkPass`) overwrites the same
 * `marks[ptDate]` key all day, so a signal trade's persisted daily mark
 * is whatever the final ~1 PM PT pass stamped — an RH quote that can
 * diverge from the official close. This nightly pass supersedes it:
 * for each OPEN signal trade with share legs it writes the SDS daily
 * close (`getUnderlyingCloseForDate` — the same source settlement uses)
 * into `marks[date]` ahead of the exit eval pass, so trailing-stop eval
 * and the canonical daily mark both see the official close.
 *
 * Scope notes:
 * - Share legs only: for a share leg the order-level mark IS the
 *   underlying close. Option-leg signal trades are skipped — their mark
 *   is premium, not underlying price (unexpired options keep intraday
 *   marks; expired ones settle via `runSignalSettlementPass`).
 * - No SDS bar for the date (holiday, data delay) → skip: the intraday
 *   mark stands rather than being blanked.
 * - `unrealizedPnl` is recomputed against the close so the doc's EOD
 *   state is internally consistent; the raw-quote audit doc carries
 *   `pass: 'eod-close'` so a non-RH-sourced mark stays attributable.
 */
import type { Firestore } from 'firebase-admin/firestore';
import type { PaperTrade } from '@paper-trading/contracts';
import { PaperTradeSource, PaperTradeStatus } from '@paper-trading/contracts';
import {
  getUnderlyingCloseForDate,
  type UnderlyingCloseReader,
} from '../engine/options-strategy-market-data';
import { listTrades, markSignalTrade } from '../repository';
import { computeExitPnl } from '../ledger';
import { createLogger } from '../engine/logging';
import type { RawQuote } from '../engine/types';

const logger = createLogger('SignalEodClosePass');

export interface SignalEodClosePassSummary {
  marketDate: string;
  stamped: number;
  /** Skipped for reasons other than a missing close: non-share legs,
   *  no legs, or the trade left OPEN between listing and write. */
  skipped: number;
  /** No SDS bar for marketDate — intraday mark left standing. */
  skippedNoClose: number;
  errors: { tradeId: string; error: string }[];
}

export interface SignalEodClosePassDeps {
  /** OPEN signal-source trades. */
  listOpenSignalTrades(): Promise<PaperTrade[]>;
  /** Underlying close for a specific trading date (SDS daily bars). */
  getUnderlyingClose: UnderlyingCloseReader;
  /** `markSignalTrade` — writes marks[date] + lastMark + unrealizedPnl +
   *  the raw-quote audit doc in one txn; false if the trade left OPEN. */
  markTrade(
    tradeId: string,
    update: {
      mark: number;
      underlyingClose?: number;
      unrealizedPnl?: number;
      asOf: string;
    },
    rawQuote: RawQuote,
  ): Promise<boolean>;
  now(): Date;
}

export async function runSignalEodClosePass(
  marketDate: string,
  deps: SignalEodClosePassDeps,
): Promise<SignalEodClosePassSummary> {
  const asOf = deps.now().toISOString();
  const summary: SignalEodClosePassSummary = {
    marketDate,
    stamped: 0,
    skipped: 0,
    skippedNoClose: 0,
    errors: [],
  };

  const trades = await deps.listOpenSignalTrades();
  if (!trades.length) {
    logger.info(`Signal EOD close pass for ${marketDate}: no open signal trades`);
    return summary;
  }

  const skip = (tradeId: string, why: string) => {
    summary.skipped++;
    logger.warn(`${tradeId}: ${why} — EOD close not stamped`);
  };

  for (const trade of trades) {
    try {
      if (!trade.legs.length) {
        skip(trade.id, 'no legs');
        continue;
      }
      if (trade.legs.some((l) => l.kind !== 'share')) {
        skip(trade.id, 'non-share legs — underlying close is not the order mark');
        continue;
      }
      const close = await deps.getUnderlyingClose(trade.symbol, marketDate);
      if (close === null || !Number.isFinite(close)) {
        summary.skippedNoClose++;
        continue;
      }
      const entry = trade.fills.find((f) => f.role === 'entry');
      const wrote = await deps.markTrade(
        trade.id,
        {
          mark: close,
          underlyingClose: close,
          unrealizedPnl: entry
            ? computeExitPnl(entry, close, trade.order.side, trade.legs)
            : undefined,
          asOf,
        },
        {
          date: marketDate,
          rawResponse: {
            mark: close,
            source: 'sds-daily-close',
            pass: 'eod-close',
          },
        },
      );
      if (!wrote) {
        skip(trade.id, 'no longer OPEN');
        continue;
      }
      summary.stamped++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ tradeId: trade.id, error: message });
      logger.warn(`${trade.id}: EOD close stamp failed — ${message}`);
    }
  }

  logger.info(
    `Signal EOD close pass for ${marketDate}: stamped=${summary.stamped} ` +
      `skipped=${summary.skipped} noClose=${summary.skippedNoClose} ` +
      `errors=${summary.errors.length}`,
  );
  return summary;
}

/** Prod deps — SDS closes + the shared mark-signal-trade write seam. */
export function defaultSignalEodCloseDeps(
  firestoreDb: Firestore,
): SignalEodClosePassDeps {
  return {
    listOpenSignalTrades: () =>
      listTrades(firestoreDb, {
        status: PaperTradeStatus.OPEN,
        source: PaperTradeSource.SIGNAL,
      }),
    getUnderlyingClose: getUnderlyingCloseForDate,
    markTrade: (tradeId, update, rawQuote) =>
      markSignalTrade(firestoreDb, tradeId, update, rawQuote),
    now: () => new Date(),
  };
}
