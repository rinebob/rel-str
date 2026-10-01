/**
 * @topic #553 — Paper Trading Infra (task #676)
 *
 * Signal-trade mark pass. The engine mark pass
 * (`runMarkPassForAllInstances`) only iterates strategy-instance trades —
 * signal-accepted trades (`source=SIGNAL`, no instance) never got marks,
 * so a governing `trailing-{pct}` run could never fire and every OPEN
 * signal trade became a permanent eval-pass `skipsNoMark` candidate.
 *
 * For each OPEN signal trade this pass computes the order-level mark with
 * the SAME liquidation-price seam the close callable uses
 * (`netExitBreakdown`: option legs via the RH MCP option provider, share
 * legs via `get_equity_quotes`) and writes `marks[ptDate].mark`, leg
 * `lastMark`s (single-leg only — see `markSignalTrade`), and
 * `unrealizedPnl` in one txn. Mark dates normalize to the PT calendar
 * date so a post-UTC-midnight mark can't land under tomorrow's key.
 *
 * An expired signal OPTION trade is settled nightly by
 * `runSignalSettlementPass` — an expired leg surfacing here means that
 * settlement failed (or hasn't run yet), so it records a per-trade
 * `errors[]` entry rather than a silent skip.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type { PaperTrade } from '@paper-trading/contracts';
import { PaperTradeSource, PaperTradeStatus } from '@paper-trading/contracts';
import { normalizeMarketDate } from '../../common/pt-date-utils';
import { listTrades, markSignalTrade } from '../repository';
import { computeExitPnl } from '../ledger';
import { netExitBreakdown } from '../callables';
import type { ClosePaperTradeDeps, NetExitLegQuote } from '../callables';
import { createLogger } from '../engine/logging';
import type { RawQuote } from '../engine/types';

const logger = createLogger('SignalMarkPass');

/** Order-level mark plus the per-leg quotes behind it (audit trail). */
export interface SignalMarkResult {
  mark: number;
  legs: NetExitLegQuote[];
}

export interface SignalMarkPassSummary {
  markedAt: string;
  marked: number;
  /** Trades whose mark couldn't be computed (no live quote, no legs,
   *  closed mid-pass). */
  skipped: number;
  /** Ids behind `skipped` — a permanently unquotable trade should be
   *  nameable from the log/summary, not just counted. */
  skippedTradeIds: string[];
  errors: { tradeId: string; error: string }[];
}

export interface SignalMarkPassDeps {
  /** OPEN signal-source trades. */
  listOpenSignalTrades(): Promise<PaperTrade[]>;
  /** Order-level signed liquidation mark — `netExitBreakdown` in prod. */
  netMark(trade: PaperTrade): Promise<SignalMarkResult | undefined>;
  /** Persist marks[date] + leg lastMark + unrealizedPnl + raw quote.
   *  Returns false when the trade left OPEN between listing and write. */
  markTrade(
    tradeId: string,
    update: { mark: number; unrealizedPnl?: number; asOf: string },
    rawQuote: RawQuote,
  ): Promise<boolean>;
  now(): Date;
}

export async function runSignalMarkPass(
  deps: SignalMarkPassDeps,
): Promise<SignalMarkPassSummary> {
  const markedAt = deps.now().toISOString();
  const markDate = normalizeMarketDate(markedAt);
  const summary: SignalMarkPassSummary = {
    markedAt,
    marked: 0,
    skipped: 0,
    skippedTradeIds: [],
    errors: [],
  };

  const trades = await deps.listOpenSignalTrades();
  if (!trades.length) {
    logger.info('No open signal-source trades');
    return summary;
  }

  const skip = (tradeId: string, why: string) => {
    summary.skipped++;
    summary.skippedTradeIds.push(tradeId);
    logger.warn(`${tradeId}: ${why} — mark skipped`);
  };

  for (const trade of trades) {
    try {
      // A leg-less OPEN trade would take `mark = 0` through
      // netExitBreakdown (0 value / qty = finite) — the close callable
      // guards this (`failed-precondition`); mirror it here or a 0 mark
      // would fire stops on a fabricated price.
      if (!trade.legs.length) {
        skip(trade.id, 'no legs');
        continue;
      }
      // Expired option legs are settled nightly by runSignalSettlementPass —
      // one reaching the mark pass means settlement failed (or hasn't run
      // yet), so record it as an error (visible) rather than a silent skip.
      const expired = trade.legs.find(
        (l) => l.kind === 'option' && l.expiration < markDate,
      );
      if (expired) {
        const err =
          `option leg expired ${expired.kind === 'option' ? expired.expiration : ''} ` +
          `— awaiting nightly settlement (or it failed)`;
        summary.errors.push({ tradeId: trade.id, error: err });
        logger.warn(`${trade.id}: ${err}`);
        continue;
      }
      const result = await deps.netMark(trade);
      if (!result || !Number.isFinite(result.mark)) {
        skip(trade.id, 'no live quote');
        continue;
      }
      const entry = trade.fills.find((f) => f.role === 'entry');
      const wrote = await deps.markTrade(
        trade.id,
        {
          mark: result.mark,
          unrealizedPnl: entry
            ? computeExitPnl(entry, result.mark, trade.order.side, trade.legs)
            : undefined,
          asOf: markedAt,
        },
        {
          date: markDate,
          rawResponse: {
            mark: result.mark,
            legs: result.legs,
            pass: 'signal-mark',
          },
        },
      );
      if (!wrote) {
        skip(trade.id, 'no longer OPEN');
        continue;
      }
      summary.marked++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ tradeId: trade.id, error: message });
      logger.warn(`${trade.id}: mark failed — ${message}`);
    }
  }

  logger.info(
    `Signal mark pass: marked=${summary.marked} skipped=${summary.skipped} ` +
      `errors=${summary.errors.length}`,
  );
  return summary;
}

/** Prod deps — same quote plumbing the close callable uses. */
export function defaultSignalMarkDeps(
  firestoreDb: Firestore,
  quoteDeps: Pick<ClosePaperTradeDeps, 'getOptionQuotes' | 'callTool'>,
): SignalMarkPassDeps {
  return {
    listOpenSignalTrades: () =>
      listTrades(firestoreDb, {
        status: PaperTradeStatus.OPEN,
        source: PaperTradeSource.SIGNAL,
      }),
    netMark: async (trade) => {
      const b = await netExitBreakdown(trade, quoteDeps);
      return b && { mark: b.orderMark, legs: b.legs };
    },
    markTrade: (tradeId, update, rawQuote) =>
      markSignalTrade(firestoreDb, tradeId, update, rawQuote),
    now: () => new Date(),
  };
}
