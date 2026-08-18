/**
 * @topic #108 — Options Position Strategy Engine
 * @topic #137 — Strategy Builder UI
 *
 * Firestore-backed strategy instance repository. Replaces the hardcoded
 * STRATEGY_INSTANCES array so instances can be created and managed through the
 * Strategy Builder UI.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { db } from '../firebase-admin-init';
import { OPTIONS_STRATEGY_INSTANCES_COLLECTION } from './collections';
import type { StrategyInstanceConfig } from '@options-strategy-engine/contracts';
import { LifecycleState } from '@options-strategy-engine/contracts';
import { OptionType, PositionSpreadType, StrategyFrequency } from '@options/common';
import { TradeSide } from '@common';
import { createLogger } from './logging';

const log = createLogger('StrategyInstanceRepository');

// ── Timestamp normalization ─────────────────────────────────────────────────

function isTimestampLike(value: unknown): value is { toDate: () => Date } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  );
}

function normalizeTimestamp(value: unknown): string {
  if (value === null || value === undefined) {
    return new Date().toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  if (isTimestampLike(value)) {
    return value.toDate().toISOString();
  }
  return String(value);
}

function isTimestampOrString(value: unknown): boolean {
  return typeof value === 'string' || isTimestampLike(value);
}

// ── Validation ──────────────────────────────────────────────────────────────

const VALID_LIFECYCLE_STATES: readonly string[] = [
  LifecycleState.ACTIVE,
  LifecycleState.PAUSED,
  LifecycleState.STOPPED,
];
const VALID_OPTION_TYPES: readonly string[] = [OptionType.CALL, OptionType.PUT];
const VALID_SIDES: readonly string[] = [TradeSide.LONG, TradeSide.SHORT];
const VALID_FREQUENCIES: readonly string[] = [
  StrategyFrequency.DAILY,
  StrategyFrequency.WEEKLY,
];

function hasPhaseShape(value: unknown): value is { spreadType: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).spreadType === 'string'
  );
}

/**
 * Validate the raw Firestore document shape. Enforces the required fields on
 * `StrategyInstanceConfig` while leaving optional tuning knobs (deltaTolerance,
 * overnightGridRangePct, etc.) and the optional marketRegime field unchecked.
 */
function isValidInstance(id: string, data: unknown): data is StrategyInstanceConfig {
  const d = data as Record<string, unknown>;

  if (typeof d?.symbol !== 'string' || d.symbol.length === 0) {
    log.warn(`Instance ${id} skipped: missing or empty symbol`);
    return false;
  }

  if (!VALID_OPTION_TYPES.includes(d?.optionType as string)) {
    log.warn(`Instance ${id} skipped: invalid optionType ${String(d?.optionType)}`);
    return false;
  }

  if (!VALID_SIDES.includes(d?.side as string)) {
    log.warn(`Instance ${id} skipped: invalid side ${String(d?.side)}`);
    return false;
  }

  if (
    !Array.isArray(d?.phases) ||
    d.phases.length === 0 ||
    !d.phases.every(hasPhaseShape)
  ) {
    log.warn(`Instance ${id} skipped: missing or malformed phases`);
    return false;
  }

  // The current pass implementation reads flat fields directly for single-phase
  // strategies (CASH_SECURED_PUT / COVERED_CALL). Multi-leg strategies added in
  // future work may derive these from phases and relax this check.
  const firstSpreadType = (d.phases[0] as Record<string, unknown>).spreadType as string;
  const isSinglePhase =
    firstSpreadType === PositionSpreadType.CASH_SECURED_PUT ||
    firstSpreadType === PositionSpreadType.COVERED_CALL;

  if (isSinglePhase) {
    if (typeof d?.targetDelta !== 'number') {
      log.warn(`Instance ${id} skipped: missing or non-numeric targetDelta`);
      return false;
    }
    if (typeof d?.dteMin !== 'number') {
      log.warn(`Instance ${id} skipped: missing or non-numeric dteMin`);
      return false;
    }
    if (typeof d?.dteMax !== 'number') {
      log.warn(`Instance ${id} skipped: missing or non-numeric dteMax`);
      return false;
    }
  }

  if (!VALID_FREQUENCIES.includes(d?.frequency as string)) {
    log.warn(`Instance ${id} skipped: invalid frequency ${String(d?.frequency)}`);
    return false;
  }

  if (typeof d?.openTimePT !== 'string' || d.openTimePT.length === 0) {
    log.warn(`Instance ${id} skipped: missing or empty openTimePT`);
    return false;
  }

  if (!Array.isArray(d?.exitPolicies)) {
    log.warn(`Instance ${id} skipped: malformed exitPolicies`);
    return false;
  }

  if (!VALID_LIFECYCLE_STATES.includes(d?.lifecycleState as string)) {
    log.warn(`Instance ${id} skipped: invalid lifecycleState ${String(d?.lifecycleState)}`);
    return false;
  }

  if (typeof d?.userId !== 'string' || d.userId.length === 0) {
    log.warn(`Instance ${id} skipped: missing or empty userId`);
    return false;
  }

  if (!isTimestampOrString(d?.createdAt)) {
    log.warn(`Instance ${id} skipped: missing or invalid createdAt`);
    return false;
  }

  if (!isTimestampOrString(d?.updatedAt)) {
    log.warn(`Instance ${id} skipped: missing or invalid updatedAt`);
    return false;
  }

  return true;
}

function normalizeInstance(id: string, data: unknown): StrategyInstanceConfig | null {
  if (!isValidInstance(id, data)) {
    return null;
  }

  const instance = data as StrategyInstanceConfig;
  const raw = data as unknown as Record<string, unknown>;
  return {
    ...instance,
    id,
    createdAt: normalizeTimestamp(raw.createdAt),
    updatedAt: normalizeTimestamp(raw.updatedAt),
  };
}

// ── Collection reference ────────────────────────────────────────────────────

function instancesCollection(firestoreDb: Firestore = db) {
  return firestoreDb.collection(OPTIONS_STRATEGY_INSTANCES_COLLECTION);
}

// ── Read ────────────────────────────────────────────────────────────────────

function normalizeAndFilter(
  docs: Array<{ id: string; data: () => unknown }>,
): StrategyInstanceConfig[] {
  return docs
    .map((doc) => normalizeInstance(doc.id, doc.data()))
    .filter((instance): instance is StrategyInstanceConfig => instance !== null);
}

export async function listActiveInstances(
  firestoreDb: Firestore = db,
): Promise<StrategyInstanceConfig[]> {
  const snap = await instancesCollection(firestoreDb)
    .where('lifecycleState', '==', LifecycleState.ACTIVE)
    .get();
  return normalizeAndFilter(snap.docs);
}

/**
 * List all instances that should still be managed (marked, settled) regardless
 * of whether new positions are being opened. This includes ACTIVE, PAUSED, and
 * STOPPED instances so existing positions continue to be managed.
 */
export async function listManageableInstances(
  firestoreDb: Firestore = db,
): Promise<StrategyInstanceConfig[]> {
  const snap = await instancesCollection(firestoreDb)
    .where('lifecycleState', 'in', [
      LifecycleState.ACTIVE,
      LifecycleState.PAUSED,
      LifecycleState.STOPPED,
    ])
    .get();
  return normalizeAndFilter(snap.docs);
}

export async function listAllInstances(
  firestoreDb: Firestore = db,
): Promise<StrategyInstanceConfig[]> {
  const snap = await instancesCollection(firestoreDb).get();
  return normalizeAndFilter(snap.docs);
}

export async function getInstance(
  id: string,
  firestoreDb: Firestore = db,
): Promise<StrategyInstanceConfig | null> {
  const snap = await instancesCollection(firestoreDb).doc(id).get();
  if (!snap.exists) {
    return null;
  }
  return normalizeInstance(snap.id, snap.data());
}
