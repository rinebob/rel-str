/**
 * @topic #108 — Options Position Strategy Engine
 *
 * Firestore-backed strategy instance repository. Replaces the hardcoded
 * STRATEGY_INSTANCES array so instances can be created and managed through the
 * Strategy Builder UI.
 */

import type { CollectionReference, Firestore } from 'firebase-admin/firestore';
import { db } from '../../firebase-admin-init';
import { PaperTradingKind } from '@paper-trading/contracts';
import { paperItemsRef } from '../collections';
import { ST_STRATEGY_INSTANCES_ROOT } from '../../common/st-collections';
import type { StMode } from '@st/types';
import { ST_MODES } from '@st/types';
import type { StStrategyInstance } from '@st/strategy-instances';
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

  // Canonical fields (#984): validate when present; absent values are
  // normalized below (legacy docs predate them).
  if (d.mode !== undefined && !ST_MODES.includes(d.mode as StMode)) {
    log.warn(`Instance ${id} skipped: invalid mode ${String(d.mode)}`);
    return false;
  }

  if (d.enabled !== undefined && typeof d.enabled !== 'boolean') {
    log.warn(`Instance ${id} skipped: non-boolean enabled ${String(d.enabled)}`);
    return false;
  }

  return true;
}

function normalizeInstance(id: string, data: unknown): StStrategyInstance | null {
  if (!isValidInstance(id, data)) {
    return null;
  }

  const raw = data as unknown as Record<string, unknown>;
  // The anchor-era `kind` discriminator doesn't exist on the canonical shape —
  // strip it so every caller sees a uniform StStrategyInstance.
  const { kind: _kind, ...config } = raw;
  return {
    ...(config as unknown as StrategyInstanceConfig),
    id,
    mode: (raw.mode as StMode | undefined) ?? 'paper',
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    createdAt: normalizeTimestamp(raw.createdAt),
    updatedAt: normalizeTimestamp(raw.updatedAt),
  };
}

// ── Collection references ──────────────────────────────────────────────────

/** Subcollection name under each instance doc — nightly sims + open-pass results. */
export const STRATEGY_INSTANCE_DAILY_ANALYSIS_SUBCOLLECTION = 'daily-analysis';

/**
 * Canonical instance collection (`st-strategy-instances`).
 * Reads union with the legacy `paper-trading/instances/items` anchor — the FE
 * Strategy Builder still writes there until #1014, so a UI-created doc in the
 * soak window must not go invisible to the engine. On an id collision the
 * doc with the newer `updatedAt` wins (FE stamps it on every write, so a
 * post-migration UI edit/pause shadows the migrated copy — otherwise the
 * engine would keep trading a stopped instance); a tie goes to canonical.
 */
function instancesCollection(firestoreDb: Firestore = db): CollectionReference {
  return firestoreDb.collection(ST_STRATEGY_INSTANCES_ROOT);
}

function legacyInstancesCollection(firestoreDb: Firestore = db): CollectionReference {
  return paperItemsRef(firestoreDb, PaperTradingKind.INSTANCE);
}

/** Document ref for `st-strategy-instances/{instanceId}` (#1006). */
export function strategyInstanceRef(instanceId: string, firestoreDb: Firestore = db) {
  return instancesCollection(firestoreDb).doc(instanceId);
}

/**
 * `st-strategy-instances/{instanceId}/daily-analysis` — nightly sims +
 * open-pass results for the instance (#1006; was
 * `paper-trading/instances/items/{id}/daily-analysis`).
 */
export function strategyInstanceDailyAnalysisRef(instanceId: string, firestoreDb: Firestore = db) {
  return strategyInstanceRef(instanceId, firestoreDb).collection(
    STRATEGY_INSTANCE_DAILY_ANALYSIS_SUBCOLLECTION,
  );
}

// ── Read ────────────────────────────────────────────────────────────────────

/**
 * Runnable-instance filter — the paper engine consumes `mode:'paper'` docs
 * only, and `enabled:false` is the kill switch (wins over lifecycleState).
 * `getInstance` is exempt: it's a config read for callers that already hold
 * an instanceId (eval-pass, position resolution), not a firing surface.
 */
function isRunnablePaperInstance(i: StStrategyInstance): boolean {
  return i.enabled !== false && i.mode === 'paper';
}

/** Millis for a normalized ISO timestamp; unparseable sorts oldest. */
function tsMillis(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Union read across canonical + legacy collections, deduped by id —
 * newest `updatedAt` wins (see `instancesCollection` for why; tie →
 * canonical). Lifecycle filtering happens AFTER the merge: a per-collection
 * `where` would exclude a twin whose newer copy moved out of the queried
 * state (e.g. user pauses via the UI → anchor PAUSED newer, canonical ACTIVE
 * stale) and the stale copy would win by default.
 */
async function listInstances(
  lifecycleStates: readonly LifecycleState[] | null,
  firestoreDb: Firestore,
): Promise<StStrategyInstance[]> {
  const [canonical, legacy] = await Promise.all([
    instancesCollection(firestoreDb).get(),
    legacyInstancesCollection(firestoreDb).get(),
  ]);
  const byId = new Map<string, StStrategyInstance>();
  for (const snap of [legacy, canonical]) {
    for (const doc of snap.docs) {
      const instance = normalizeInstance(doc.id, doc.data());
      const prev = byId.get(doc.id);
      if (instance && (!prev || tsMillis(instance.updatedAt) >= tsMillis(prev.updatedAt))) {
        byId.set(doc.id, instance);
      }
    }
  }
  return [...byId.values()].filter(
    (i) =>
      isRunnablePaperInstance(i) &&
      (lifecycleStates === null || lifecycleStates.includes(i.lifecycleState)),
  );
}

export async function listActiveInstances(
  firestoreDb: Firestore = db,
): Promise<StStrategyInstance[]> {
  return listInstances([LifecycleState.ACTIVE], firestoreDb);
}

/**
 * List all instances that should still be managed (marked, settled) regardless
 * of whether new positions are being opened. This includes ACTIVE, PAUSED, and
 * STOPPED instances so existing positions continue to be managed.
 */
export async function listManageableInstances(
  firestoreDb: Firestore = db,
): Promise<StStrategyInstance[]> {
  return listInstances(
    [LifecycleState.ACTIVE, LifecycleState.PAUSED, LifecycleState.STOPPED],
    firestoreDb,
  );
}

/**
 * All *runnable* instances — still filtered by `isRunnablePaperInstance`
 * (mode/enabled), so `mode:'live'` or disabled docs are not listed. The
 * #1006 verify script uses this as its repo seam.
 */
export async function listRunnableInstances(
  firestoreDb: Firestore = db,
): Promise<StStrategyInstance[]> {
  return listInstances(null, firestoreDb);
}

export async function getInstance(
  id: string,
  firestoreDb: Firestore = db,
): Promise<StStrategyInstance | null> {
  const [canon, legacy] = await Promise.all([
    strategyInstanceRef(id, firestoreDb).get(),
    legacyInstancesCollection(firestoreDb).doc(id).get(),
  ]);
  // A malformed canonical doc falls back to its legacy twin rather than
  // shadowing it (same behavior as the union read).
  const c = canon.exists ? normalizeInstance(canon.id, canon.data()) : null;
  const l = legacy.exists ? normalizeInstance(legacy.id, legacy.data()) : null;
  if (!c || !l) {
    return c ?? l;
  }
  return tsMillis(l.updatedAt) > tsMillis(c.updatedAt) ? l : c;
}
