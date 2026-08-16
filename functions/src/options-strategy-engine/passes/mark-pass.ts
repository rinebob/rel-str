/**
 *
 * Periodic mark pass for open options strategy positions.
 *
 * Lists open positions for a strategy instance, batches their contract IDs
 * through the RH MCP quote provider, writes raw quotes to each position's
 * subcollection, and updates unrealized P&L.
 */

import type {
  OptionQuote,
  StrategyInstanceConfig,
} from '@options-strategy-engine/contracts';
import { TradeSide } from '@common';
import {
  listOpenPositions,
  getLegs,
  markPosition,
} from '../position-repository';
import type { Position, PositionLeg, RawQuote } from '../types';
import { createLogger } from '../logging';

const logger = createLogger('MarkPass');

export interface BatchQuoteProvider {
  getQuotes(contractIDs: string[], side: TradeSide): Promise<OptionQuote[]>;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface MarkPassPositionResult {
  positionId: string;
  contractID: string;
  mark: number;
  currentValue: number;
  unrealizedPnl: number;
  interpolatedClose: boolean;
  asOf: string;
}

export interface MarkPassResult {
  instanceId: string;
  markedAt: string;
  positions: MarkPassPositionResult[];
  errors: { positionId: string; contractID: string; error: string }[];
}

export interface MarkPassDependencies {
  listOpenPositions?: (instanceId: string) => Promise<Position[]>;
  getLegs?: (positionId: string) => Promise<PositionLeg[]>;
  quoteProvider?: BatchQuoteProvider;
  markPosition?: (positionId: string, update: Partial<Position>, rawQuote: RawQuote) => Promise<void>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function computeUnrealizedPnl(
  side: TradeSide,
  premiumCollected: number,
  capitalRequired: number,
  currentMark: number,
): number {
  const currentValue = currentMark * 100;
  if (side === TradeSide.SHORT) {
    return premiumCollected - currentValue;
  }
  return currentValue - capitalRequired;
}

function findPrimaryLeg(legs: PositionLeg[]): PositionLeg | undefined {
  return legs.find((leg) => leg.contractID);
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function runMarkPass(
  instanceId: string,
  config: StrategyInstanceConfig,
  deps: MarkPassDependencies = {},
): Promise<MarkPassResult> {
  const listOpen = deps.listOpenPositions ?? listOpenPositions;
  const getLegsForPosition = deps.getLegs ?? getLegs;
  const provider = deps.quoteProvider;
  const mark = deps.markPosition ?? markPosition;

  const markedAt = new Date().toISOString();
  const positions: MarkPassPositionResult[] = [];
  const errors: { positionId: string; contractID: string; error: string }[] = [];

  if (!provider) {
    throw new Error('Mark pass: quoteProvider is required');
  }

  // 1. List open positions
  const openPositions = await listOpen(instanceId);
  if (openPositions.length === 0) {
    logger.info(`No open positions for ${instanceId}`);
    return { instanceId, markedAt, positions, errors };
  }

  // 2. Gather contract IDs from legs (parallel fetch)
  const legsResults = await Promise.all(
    openPositions.map((pos) => getLegsForPosition(pos.id).then((legs) => ({ pos, legs }))),
  );
  const positionToContract = new Map<string, string>();
  for (const { pos, legs } of legsResults) {
    const leg = findPrimaryLeg(legs);
    if (leg?.contractID) {
      positionToContract.set(pos.id, leg.contractID);
    } else {
      errors.push({
        positionId: pos.id,
        contractID: '',
        error: 'No leg with contractID found',
      });
    }
  }

  if (positionToContract.size === 0) {
    return { instanceId, markedAt, positions, errors };
  }

  // 3. Fetch quotes (provider handles batching internally)
  const contractIDs = Array.from(positionToContract.values());
  const quotes: OptionQuote[] = [];
  try {
    const results = await provider.getQuotes(contractIDs, config.side);
    quotes.push(...results);
  } catch (err) {
    // If batch fails, record error for all positions
    for (const [posId, contractID] of positionToContract) {
      errors.push({
        positionId: posId,
        contractID,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { instanceId, markedAt, positions, errors };
  }

  // 4. Process each quote
  const quoteByContract = new Map(quotes.map((q) => [q.contractID, q]));
  for (const pos of openPositions) {
    const contractID = positionToContract.get(pos.id);
    if (!contractID) continue;

    const quote = quoteByContract.get(contractID);
    if (!quote) {
      errors.push({
        positionId: pos.id,
        contractID,
        error: 'No quote returned for contract',
      });
      continue;
    }

    const currentValue = quote.mark * 100;
    const unrealizedPnl = computeUnrealizedPnl(
      config.side,
      pos.premiumCollected,
      pos.capitalRequired,
      quote.mark,
    );

    // 5. Atomically write raw quote and update position P&L
    const rawQuote: RawQuote = {
      date: markedAt.slice(0, 10),
      rawResponse: quote,
    };
    await mark(pos.id, {
      currentValue,
      currentValueAsOf: quote.asOf,
      unrealizedPnl,
    }, rawQuote);

    positions.push({
      positionId: pos.id,
      contractID,
      mark: quote.mark,
      currentValue,
      unrealizedPnl,
      interpolatedClose: quote.interpolatedClose ?? false,
      asOf: quote.asOf,
    });
  }

  logger.info(
    `Marked ${positions.length} position(s) for ${instanceId}, ${errors.length} error(s)`,
  );
  return { instanceId, markedAt, positions, errors };
}
