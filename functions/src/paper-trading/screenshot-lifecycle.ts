/**
 * @topic #746 — On-demand Screenshot Capture (task #847)
 *
 * Engine/paper-trade hooks for the order-lifecycle capture: the ledger
 * seams (`applyEntryFill`, `applyPendingFill`, `applyExitFill`) and
 * `markPositionSettled` fire a lifecycle capture on the trade doc they
 * just committed.
 *
 * - The carrier is the trade doc itself (`engine-position` kind) — the
 *   `capturedEvents` dedup ledger lands next to the lifecycle fields.
 * - `groupId` is `cohortId` for signal trades (all expressions of one
 *   cohort group under it) and the trade id for engine positions.
 * - `refId` falls through to the intake default `{positionId}-{event}`.
 *
 * This module stays import-light: the capture pipeline (admin init, resvg,
 * data loaders) is loaded lazily inside `makeTradeLifecycleHook` on first
 * fire, so pass modules and their tsx suites pay nothing at import time.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { CaptureEvent, PositionType } from '@screenshot-capture/contracts';
import {
  PaperTradingKind,
  type PaperTrade,
  type PaperTradeLeg,
} from '@paper-trading/contracts';
import { paperTradingDocPath } from '@paper-trading/ids';
import { enginePositionCarrier } from '../screenshot-capture/tracking';
import type {
  LifecycleCaptureDeps,
  LifecycleCaptureInput,
} from '../screenshot-capture/lifecycle-capture';
import type { LedgerDeps } from './ledger';
import { ledgerDeps } from './repository';
import { PositionStatus } from './engine/types';
import { createLogger } from './engine/logging';

const logger = createLogger('ScreenshotLifecycle');

// ── Position-type mapping ───────────────────────────────────────────────────

/**
 * Leg shape → strategy tag (`positionTypeFor` per the IMPL doc). The chart
 * is always the underlying; this tag rides the storage path so spread and
 * option captures are distinguishable from share captures. Coarse on
 * purpose: 1 option leg → single; ≥2 option legs with one expiry →
 * vertical; mixed expirations → calendar; shares-only → stock.
 */
export function positionTypeForLegs(legs: PaperTradeLeg[]): PositionType {
  const options = legs.filter((leg) => leg.kind === 'option');
  if (options.length === 0) return PositionType.STOCK;
  if (options.length === 1) return PositionType.OPTION_SINGLE;
  const expirations = new Set(options.map((leg) => leg.expiration));
  return expirations.size === 1
    ? PositionType.VERTICAL_DEBIT_SPREAD
    : PositionType.CALENDAR;
}

/** Settlement statuses that end the option position — ASSIGNED fires too
 *  (PRD decision #1: the option position ended even though shares remain). */
const SETTLEMENT_CAPTURE_STATUSES: ReadonlySet<PositionStatus> = new Set([
  PositionStatus.CLOSED,
  PositionStatus.EXPIRED_WORTHLESS,
  PositionStatus.ASSIGNED_HOLDING_SHARES,
]);

export function settlementCapturesPositionClosed(status: PositionStatus): boolean {
  return SETTLEMENT_CAPTURE_STATUSES.has(status);
}

// ── Intake input ────────────────────────────────────────────────────────────

/** Input the intake needs — the trade doc supplies everything. */
export function lifecycleInputFor(
  trade: PaperTrade,
  event: CaptureEvent,
): LifecycleCaptureInput {
  return {
    positionId: trade.id,
    groupId: trade.cohortId ?? trade.id,
    event,
    symbol: trade.symbol,
    positionType: positionTypeForLegs(trade.legs),
    carrier: enginePositionCarrier(paperTradingDocPath(PaperTradingKind.TRADE, trade.id)),
  };
}

// ── Hook + wiring ───────────────────────────────────────────────────────────

export type TradeLifecycleHook = (
  trade: PaperTrade,
  event: CaptureEvent,
) => Promise<void>;

/**
 * The `onTradeLifecycle` dep for `LedgerDeps` — await-with-cap (the cap
 * lives inside `captureLifecycleEvent`), swallow-and-log: a capture failure
 * resolves `{status:'failed'}` and only an input-building bug could throw,
 * which this layer still contains. Passes never fail on capture.
 *
 * The capture pipeline is imported on first fire — `ledgerDeps` fakes and
 * test suites that never fire a lifecycle event never load it.
 */
export function makeTradeLifecycleHook(db: Firestore): TradeLifecycleHook {
  let intake: typeof import('../screenshot-capture/lifecycle-capture') | undefined;
  let deps: LifecycleCaptureDeps | undefined;
  return async (trade, event) => {
    try {
      intake ??= await import('../screenshot-capture/lifecycle-capture');
      deps ??= intake.createLifecycleCaptureDeps(db);
      const outcome = await intake.captureLifecycleEvent(lifecycleInputFor(trade, event), deps);
      if (outcome.status === 'failed') {
        logger.error(
          `lifecycle capture failed for trade ${trade.id} ${event}: ${outcome.error}`,
        );
      }
    } catch (err) {
      logger.error(
        `lifecycle capture threw for trade ${trade.id} ${event}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  };
}

/**
 * Production ledger deps with the lifecycle hook attached — the fill and
 * settlement call sites pass these so `applyEntryFill`, `applyPendingFill`,
 * and `applyExitFill` fire captures at the committed write seam. Plain
 * `ledgerDeps(db)` stays hook-free for tests and non-lifecycle callers.
 */
export function ledgerDepsWithCapture(db: Firestore): LedgerDeps {
  return { ...ledgerDeps(db), onTradeLifecycle: makeTradeLifecycleHook(db) };
}
