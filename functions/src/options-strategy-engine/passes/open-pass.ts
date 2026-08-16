/**
 * @topic #108 — Options Position Strategy Engine
 *
 * Next-day open pass for the hybrid options quote provider.
 *
 * Reads the prior night's `daily-analysis/{date}` document, looks up the
 * current underlying price, selects the nearest grid point from the overnight
 * delta simulation, records the actual overnight move, and opens a position
 * if no existing open position is found for the same strategy instance.
 */

import type {
  OvernightDeltaSimulation,
  OvernightDeltaGridPoint,
  StrategyInstanceConfig,
} from '@options-strategy-engine/contracts';
import { parseOccContractId } from '@options/common';
import { TradeSide } from '@common';
import { db } from '../../firebase-admin-init';
import { OPTIONS_STRATEGY_INSTANCES_COLLECTION } from '../collections';
import {
  buildLegId,
  listOpenPositions,
  createPosition,
} from '../position-repository';
import { incrementStatsOnOpen } from '../stats-repository';
import type { Position, PositionLeg, RawQuote } from '../types';
import { PositionStatus } from '../types';
import { createLogger } from '../logging';

const logger = createLogger('OpenPass');

// ── Types ──────────────────────────────────────────────────────────────────

export interface OpenPassResult {
  contractID: string;
  baseUnderlyingPrice: number;
  currentUnderlyingPrice: number;
  actualOvernightMovePct: number;
  nearestGridPoint: OvernightDeltaGridPoint;
  positionId: string | null;
  skipped: boolean;
  skipReason: 'existing_position' | 'max_overnight_move_exceeded' | null;
  recordedAt: string;
}

export type DailyAnalysisReader = (
  instanceId: string,
  date: string,
) => Promise<OvernightDeltaSimulation | null>;

export type OpenPassResultWriter = (
  instanceId: string,
  date: string,
  result: OpenPassResult,
) => Promise<void>;

export interface OpenPassDependencies {
  readDailyAnalysis?: DailyAnalysisReader;
  listOpenPositions?: (instanceId: string) => Promise<Position[]>;
  createPosition?: (
    position: Omit<Position, 'id'>,
    legs: PositionLeg[],
    rawQuote: RawQuote,
  ) => Promise<Position>;
  writeOpenPassResult?: OpenPassResultWriter;
}

// ── Default readers/writers ─────────────────────────────────────────────────

function createDefaultDailyAnalysisReader(): DailyAnalysisReader {
  return async (instanceId, date) => {
    const snap = await db
      .collection(OPTIONS_STRATEGY_INSTANCES_COLLECTION)
      .doc(instanceId)
      .collection('daily-analysis')
      .doc(date)
      .get();
    if (!snap.exists) {
      return null;
    }
    const data = snap.data() as { overnightDeltaSimulation?: OvernightDeltaSimulation };
    return data.overnightDeltaSimulation ?? null;
  };
}

function createDefaultOpenPassResultWriter(): OpenPassResultWriter {
  return async (instanceId, date, result) => {
    await db
      .collection(OPTIONS_STRATEGY_INSTANCES_COLLECTION)
      .doc(instanceId)
      .collection('daily-analysis')
      .doc(date)
      .set({ openPassResult: result }, { merge: true });
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function findNearestGridPoint(
  grid: OvernightDeltaGridPoint[],
  targetPrice: number,
): OvernightDeltaGridPoint {
  return grid.reduce((nearest, point) => {
    const diff = Math.abs(point.underlyingPrice - targetPrice);
    const nearestDiff = Math.abs(nearest.underlyingPrice - targetPrice);
    return diff < nearestDiff ? point : nearest;
  }, grid[0]);
}

function buildOpenPassResult(
  simulation: OvernightDeltaSimulation,
  currentUnderlyingPrice: number,
  actualOvernightMovePct: number,
  nearestGridPoint: OvernightDeltaGridPoint,
  positionId: string | null,
  skipped: boolean,
  skipReason: OpenPassResult['skipReason'],
): OpenPassResult {
  return {
    contractID: simulation.baseContractID,
    baseUnderlyingPrice: simulation.baseUnderlyingPrice,
    currentUnderlyingPrice,
    actualOvernightMovePct,
    nearestGridPoint,
    positionId,
    skipped,
    skipReason,
    recordedAt: new Date().toISOString(),
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function runOpenPass(
  instanceId: string,
  date: string,
  config: StrategyInstanceConfig,
  currentUnderlyingPrice: number,
  deps: OpenPassDependencies = {},
): Promise<OpenPassResult | null> {
  const readDailyAnalysis =
    deps.readDailyAnalysis ?? createDefaultDailyAnalysisReader();
  const listOpen = deps.listOpenPositions ?? listOpenPositions;
  const create = deps.createPosition ?? createPosition;
  const writeResult =
    deps.writeOpenPassResult ?? createDefaultOpenPassResultWriter();

  // 1. Read the prior night's simulation
  const simulation = await readDailyAnalysis(instanceId, date);
  if (!simulation) {
    logger.info(`No daily-analysis found for ${instanceId}/${date}`);
    return null;
  }

  // 2. Compute actual overnight move
  const actualMovePct =
    (currentUnderlyingPrice - simulation.baseUnderlyingPrice) /
    simulation.baseUnderlyingPrice;

  // 3. Find nearest grid point
  const nearestGridPoint = findNearestGridPoint(
    simulation.grid,
    currentUnderlyingPrice,
  );

  // 4. Check for existing open positions
  const openPositions = await listOpen(instanceId);
  if (openPositions.length > 0) {
    const result = buildOpenPassResult(
      simulation,
      currentUnderlyingPrice,
      actualMovePct,
      nearestGridPoint,
      null,
      true,
      'existing_position',
    );
    await writeResult(instanceId, date, result);
    logger.info(
      `Skipped ${instanceId}/${date}: existing open position found`,
    );
    return result;
  }

  // 5. maxOvernightMovePct filter (disabled by default)
  if (
    config.maxOvernightMovePct !== undefined &&
    config.maxOvernightMovePct !== null &&
    Math.abs(actualMovePct) > config.maxOvernightMovePct
  ) {
    const result = buildOpenPassResult(
      simulation,
      currentUnderlyingPrice,
      actualMovePct,
      nearestGridPoint,
      null,
      true,
      'max_overnight_move_exceeded',
    );
    await writeResult(instanceId, date, result);
    logger.info(
      `Skipped ${instanceId}/${date}: overnight move ${(actualMovePct * 100).toFixed(2)}% exceeds max ${config.maxOvernightMovePct * 100}%`,
    );
    return result;
  }

  // 6. Parse contract ID for leg details
  const parsed = parseOccContractId(simulation.baseContractID);
  if (!parsed) {
    throw new Error(
      `Open pass: cannot parse contract ID ${simulation.baseContractID}`,
    );
  }

  // 7. Create position
  const mark = nearestGridPoint.mark;
  const premiumCollected =
    config.side === TradeSide.SHORT ? mark * 100 : 0;
  const capitalRequired =
    config.side === TradeSide.SHORT
      ? parsed.strike * 100
      : mark * 100;

  const position: Omit<Position, 'id'> = {
    instanceId,
    symbol: config.symbol,
    status: PositionStatus.OPEN,
    premiumCollected,
    capitalRequired,
    openDate: date,
    currentValue: mark * 100,
    currentValueAsOf: new Date().toISOString(),
    unrealizedPnl: 0,
  };

  const leg: PositionLeg = {
    id: buildLegId(parsed.optionType, parsed.strike, parsed.expiration),
    type: parsed.optionType,
    side: config.side,
    strike: parsed.strike,
    expiration: parsed.expiration,
    openDate: date,
    contractID: simulation.baseContractID,
    premium: mark,
  };

  const rawQuote: RawQuote = {
    date,
    rawResponse: {
      source: 'overnight_simulation',
      mark,
      gridPoint: nearestGridPoint,
    },
  };

  const created = await create(position, [leg], rawQuote);

  // 8. Incrementally update stats (premium + open count) for per-instance + ALL
  await incrementStatsOnOpen(instanceId, premiumCollected);

  // 9. Write result and return
  const result = buildOpenPassResult(
    simulation,
    currentUnderlyingPrice,
    actualMovePct,
    nearestGridPoint,
    created.id,
    false,
    null,
  );
  await writeResult(instanceId, date, result);
  logger.info(
    `Opened position ${created.id} for ${instanceId}/${date}`,
  );
  return result;
}
