/**
 * @topic #137 — Strategy Manager (task #1712)
 *
 * Unified position-grain mark pass for open option positions.
 *
 * Selection — every OPEN trade carrying at least one option leg
 * (`isOpenOptionPosition`, shared/options-position-math #1710): era-agnostic
 * (legacy + manage docs share the PaperTrade shape), source-agnostic, no
 * instance enumeration — a manage trade marks on the same 30-minute timer
 * as a legacy strategy position.
 *
 * Marking — each OPTION leg is quoted by its own contractID and carries its
 * own `lastMark`; legs are batched per side so the quotes' `side` stamps
 * stay honest. Non-option legs (a covered call's shares) contribute their
 * stored `lastMark` — equity marking stays on the signal passes.
 *
 * Valuation — `netMarkValue` (signed liquidation space) → `currentValue`;
 * `unrealizedPnl = signedEntryPremium + netMark`, posture-free. A missing
 * mark on any leg makes the position unpriceable — it's skipped with an
 * error, never zero-filled.
 *
 * `marks[date].mark` stays in the legacy order-level EXIT-PRICE space that
 * eval/settlement/live-snapshot readers consume —
 * `orderPriceForLiquidationValue(netMark, order, legs)`: for a SHORT order
 * the cost to buy back, for a LONG order the proceeds to sell — identical
 * to the old pass's leg-quote stamp for the legacy single-leg corpus.
 * Raw-quote convention is unchanged too: one doc per position per market
 * date, carrying the whole leg-quote array.
 *
 * Per-position error isolation: quote calls run per position (a single
 * missing contract can't take down a whole batch), and a write failure on
 * one position doesn't block the rest.
 */

import type { OptionQuote } from '@options-strategy-engine/contracts';
import { TradeSide } from '@common';
import type { PaperTrade } from '@paper-trading/contracts';
import {
  isOpenOptionPosition,
  netMarkValue,
  signedEntryPremium,
  unrealizedPnl,
  type NetMarkLegInput,
} from '@options/position-math';
import {
  listOpenOptionTrades,
  markPositionLegs,
} from '../position-repository';
import { orderPriceForLiquidationValue } from '../../ledger';
import type { PositionMarkUpdate, RawQuote } from '../types';
import { createLogger } from '../logging';
import { normalizeMarketDate } from '../../../common/pt-date-utils';

const logger = createLogger('MarkPass');

export interface BatchQuoteProvider {
  getQuotes(contractIDs: string[], side: TradeSide): Promise<OptionQuote[]>;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface MarkPassPositionResult {
  positionId: string;
  contractIDs: string[];
  /** Signed liquidation value in dollars — the Position view's currentValue. */
  netMark: number;
  /** Order-level exit price (eval space) — stamped on `marks[date].mark`. */
  mark: number;
  unrealizedPnl: number;
  interpolatedClose: boolean;
  asOf: string;
}

export interface MarkPassResult {
  markedAt: string;
  positions: MarkPassPositionResult[];
  errors: { positionId: string; contractID?: string; error: string }[];
}

export interface MarkPassDependencies {
  listOpenOptionTrades?: () => Promise<PaperTrade[]>;
  quoteProvider?: BatchQuoteProvider;
  markPositionLegs?: (
    positionId: string,
    update: PositionMarkUpdate,
    rawQuote: RawQuote,
  ) => Promise<void>;
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function runMarkPass(
  deps: MarkPassDependencies = {},
): Promise<MarkPassResult> {
  const listTrades = deps.listOpenOptionTrades ?? listOpenOptionTrades;
  const provider = deps.quoteProvider;
  const markLegs = deps.markPositionLegs ?? markPositionLegs;

  const markedAt = new Date().toISOString();
  const positions: MarkPassPositionResult[] = [];
  const errors: MarkPassResult['errors'] = [];

  if (!provider) {
    throw new Error('Mark pass: quoteProvider is required');
  }

  const trades = (await listTrades()).filter(isOpenOptionPosition);
  if (trades.length === 0) {
    logger.info('No open option positions');
    return { markedAt, positions, errors };
  }

  for (const trade of trades) {
    const optionLegs = trade.legs.filter((l) => l.kind === 'option');
    try {
      const noId = optionLegs.find((l) => !l.contractID);
      if (noId) {
        throw new Error(`Option leg ${noId.id ?? '(unnamed)'} missing contractID`);
      }

      // Quote the option legs, grouped by leg side so each quote's `side`
      // stamp stays honest. Per-position calls: one missing contract fails
      // only this position.
      const sideGroups = [TradeSide.SHORT, TradeSide.LONG]
        .map((side) => ({
          side,
          ids: [
            ...new Set(
              optionLegs
                .filter((l) => l.side === side)
                .map((l) => l.contractID),
            ),
          ],
        }))
        .filter((g) => g.ids.length > 0);
      const quotes = (
        await Promise.all(
          sideGroups.map((g) => provider.getQuotes(g.ids, g.side)),
        )
      ).flat();
      const quoteByContract = new Map(quotes.map((q) => [q.contractID, q]));

      const legMarks: Record<string, number> = {};
      const markInputs: NetMarkLegInput[] = [];
      for (const leg of trade.legs) {
        if (leg.kind === 'option') {
          const quote = quoteByContract.get(leg.contractID);
          if (!quote) {
            const err = new Error(
              `No quote returned for contract ${leg.contractID}`,
            ) as Error & { contractID?: string };
            err.contractID = leg.contractID;
            throw err;
          }
          legMarks[leg.contractID] = quote.mark;
          markInputs.push({
            side: leg.side,
            mark: quote.mark,
            multiplier: leg.multiplier,
            quantity: leg.quantity,
          });
        } else {
          // Non-option legs ride their stored mark — equity marking belongs
          // to the signal passes.
          markInputs.push({
            side: leg.side,
            mark: leg.lastMark,
            multiplier: leg.multiplier,
            quantity: leg.quantity,
          });
        }
      }

      const netMark = netMarkValue(markInputs);
      if (netMark === undefined) {
        throw new Error('Unpriceable position — missing leg mark');
      }
      const premium = signedEntryPremium(
        trade.legs.map((l) => ({
          side: l.side,
          mark: l.entryMark,
          multiplier: l.multiplier,
          quantity: l.quantity,
        })),
      );
      if (premium === undefined) {
        throw new Error('Unpriceable position — missing entry mark');
      }
      const pnl = unrealizedPnl(premium, netMark);
      // marks[] lives in the order-level exit-price space eval/settlement
      // readers consume — the canonical liquidation→price conversion
      // (SHORT order: cost to buy back; LONG order: proceeds to sell).
      const mark = orderPriceForLiquidationValue(
        netMark,
        trade.order,
        trade.legs,
      );
      const asOf = quotes
        .map((q) => q.asOf)
        .reduce((a, b) => (a > b ? a : b), '');

      // marks[] keys are PT market dates (eval/settlement read them that
      // way) — normalize the UTC observation timestamp to its PT calendar
      // date so a post-UTC-midnight mark doesn't land under tomorrow's key.
      const rawQuote: RawQuote = {
        date: normalizeMarketDate(markedAt),
        rawResponse: quotes,
      };
      await markLegs(
        trade.id,
        {
          legMarks,
          mark,
          unrealizedPnl: pnl,
          currentValueAsOf: asOf,
        },
        rawQuote,
      );

      positions.push({
        positionId: trade.id,
        contractIDs: optionLegs.map((l) => l.contractID),
        netMark,
        mark,
        unrealizedPnl: pnl,
        interpolatedClose: quotes.some((q) => q.interpolatedClose ?? false),
        asOf,
      });
    } catch (err) {
      const contractID = (err as { contractID?: string }).contractID;
      errors.push({
        positionId: trade.id,
        ...(contractID !== undefined ? { contractID } : {}),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info(
    `Marked ${positions.length} position(s), ${errors.length} error(s)`,
  );
  return { markedAt, positions, errors };
}
