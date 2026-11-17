/**
 * @topic #137 — STRAT-MANAGE, Thread #1510 (OpsStrat Manage Page Overhaul)
 * @task #1539 — BE: Manage instance reader + open-pass rework
 *
 * Firestore reader for the manage-domain `ManageInstance` shape
 * (`shared/manage-instance-contracts.ts`, #1538). Manage instances live on
 * the same `st-strategy-instances` root as legacy `StrategyInstanceConfig`
 * docs — "reused root, new schema" — but carry `runState`/`trigger`/
 * `mode`/`stopType`/embedded `variant` instead of `lifecycleState`/
 * `phases`/`openTimePT`.
 *
 * The noon-PT open pass queries `runState == 'ACTIVE'` and partitions by
 * `trigger`. Legacy-shape docs cannot match that query (no `runState`
 * field), so the collection-wide "skip with a warning" adapter only bites
 * on docs that carry `runState` but fail the rest of the shape check —
 * half-written or hand-edited docs, which are exactly the cases worth a
 * warn instead of a crash.
 *
 * `maxOpenPositions` is NOT a `ManageInstance` field — the PRD's ladder
 * lets concurrent positions accumulate uncapped by default. A
 * console-edited cap is still honored when present (same convention as
 * the legacy repo's #1247 handling): valid non-negative int or warned +
 * dropped.
 */

import type { CollectionReference, Firestore } from 'firebase-admin/firestore';
import { db } from '../../firebase-admin-init';
import { ST_STRATEGY_INSTANCES_ROOT } from '../../common/st-collections';
import {
  INSTANCE_MODES,
  INSTANCE_RUN_STATES,
  INSTANCE_TRIGGERS,
  isValidModeStopType,
  type InstanceTrigger,
  type ManageInstance,
} from '@manage/instance-contracts';
import { OptionType } from '@options/common';
import { TradeSide } from '@common';
import { createLogger } from './logging';

const log = createLogger('ManageInstanceReader');

/**
 * A ManageInstance plus the optional console-edited cap — not a
 * `ManageInstance` field, so it rides a wrapper rather than mutating the
 * contract type.
 */
export interface RunnableManageInstance extends ManageInstance {
  maxOpenPositions?: number;
}

export interface ActiveManageInstances {
  daily: RunnableManageInstance[];
  signal: RunnableManageInstance[];
}

// ── Validation ──────────────────────────────────────────────────────────────

function isTimestampOrString(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    (typeof value === 'object' &&
      value !== null &&
      typeof (value as { toDate?: unknown }).toDate === 'function')
  );
}

function normalizeTimestamp(value: unknown): string {
  // Caller guarantees isTimestampOrString — string or {toDate} only.
  if (typeof value === 'string') return value;
  return (value as { toDate: () => Date }).toDate().toISOString();
}

function invalidLegReason(leg: Record<string, unknown>): string | null {
  if (leg == null || typeof leg !== 'object') return 'variant leg is not an object';
  if (leg.kind === 'stock') {
    return typeof leg.side === 'string' ? null : 'stock leg missing side';
  }
  if (leg.kind === 'option') {
    if (leg.type !== OptionType.CALL && leg.type !== OptionType.PUT) {
      return `option leg invalid type ${String(leg.type)}`;
    }
    if (leg.side !== TradeSide.LONG && leg.side !== TradeSide.SHORT) {
      return `option leg invalid side ${String(leg.side)}`;
    }
    if (
      typeof leg.targetDelta !== 'number' ||
      !Number.isFinite(leg.targetDelta) ||
      Math.abs(leg.targetDelta) <= 0
    ) {
      return `option leg invalid targetDelta ${String(leg.targetDelta)}`;
    }
    if (
      typeof leg.dte !== 'number' ||
      !Number.isInteger(leg.dte) ||
      leg.dte <= 0
    ) {
      return `option leg invalid dte ${String(leg.dte)}`;
    }
    return null;
  }
  return `variant leg unknown kind ${String(leg.kind)}`;
}

/**
 * Shape-check a raw doc body into a RunnableManageInstance. Returns null
 * (with a warn) on any malformed field — a bad doc must never crash the
 * pass nor silently reinterpret its fields.
 */
export function normalizeManageInstance(
  id: string,
  data: unknown,
): RunnableManageInstance | null {
  const d = data as Record<string, unknown> | null;
  if (d === null || typeof d !== 'object') {
    log.warn(`Manage instance ${id} skipped: non-object doc`);
    return null;
  }

  if (d.deletedAt !== undefined && d.deletedAt !== null) {
    // Soft-deleted — filtered silently, not a warning (it's a valid state).
    return null;
  }

  if (typeof d.symbol !== 'string' || d.symbol.length === 0) {
    log.warn(`Manage instance ${id} skipped: missing or empty symbol`);
    return null;
  }

  if (
    !INSTANCE_RUN_STATES.includes(d.runState as ManageInstance['runState'])
  ) {
    log.warn(
      `Manage instance ${id} skipped: invalid runState ${String(d.runState)}`,
    );
    return null;
  }

  if (
    !INSTANCE_MODES.includes(d.mode as ManageInstance['mode'])
  ) {
    log.warn(
      `Manage instance ${id} skipped: invalid mode ${String(d.mode)}`,
    );
    return null;
  }

  if (
    !INSTANCE_TRIGGERS.includes(d.trigger as ManageInstance['trigger'])
  ) {
    log.warn(
      `Manage instance ${id} skipped: invalid trigger ${String(d.trigger)}`,
    );
    return null;
  }

  const stopType =
    typeof d.stopType === 'string' ? d.stopType.trim().toUpperCase() : '';
  if (
    !isValidModeStopType(d.mode as ManageInstance['mode'], stopType)
  ) {
    log.warn(
      `Manage instance ${id} skipped: mode/stopType invariant violated ` +
        `(${String(d.mode)}/${String(d.stopType)})`,
    );
    return null;
  }

  const variant = d.variant as { legs?: unknown } | null | undefined;
  if (
    variant == null ||
    typeof variant !== 'object' ||
    !Array.isArray(variant.legs) ||
    variant.legs.length === 0
  ) {
    log.warn(
      `Manage instance ${id} skipped: missing or empty variant.legs`,
    );
    return null;
  }
  for (const leg of variant.legs as Record<string, unknown>[]) {
    const why = invalidLegReason(leg);
    if (why) {
      log.warn(`Manage instance ${id} skipped: ${why}`);
      return null;
    }
  }

  if (typeof d.userId !== 'string' || d.userId.length === 0) {
    log.warn(`Manage instance ${id} skipped: missing or empty userId`);
    return null;
  }

  if (!isTimestampOrString(d.createdAt) || !isTimestampOrString(d.updatedAt)) {
    log.warn(`Manage instance ${id} skipped: invalid createdAt/updatedAt`);
    return null;
  }

  // Optional console-edited cap (#1247 convention — warn + drop on malformed,
  // 0 = explicit uncapped is valid).
  const { maxOpenPositions: rawMaxOpen, ...rest } = d;
  const maxOpenPositions =
    typeof rawMaxOpen === 'number' &&
    Number.isInteger(rawMaxOpen) &&
    rawMaxOpen >= 0
      ? rawMaxOpen
      : undefined;
  if (rawMaxOpen !== undefined && maxOpenPositions === undefined) {
    log.warn(
      `Manage instance ${id}: invalid maxOpenPositions ${String(rawMaxOpen)} — treating as uncapped`,
    );
  }

  return {
    ...(rest as unknown as ManageInstance),
    id,
    symbol: (d.symbol as string).trim().toUpperCase(),
    stopType: stopType as ManageInstance['stopType'],
    createdAt: normalizeTimestamp(d.createdAt),
    updatedAt: normalizeTimestamp(d.updatedAt),
    ...(maxOpenPositions !== undefined ? { maxOpenPositions } : {}),
  };
}

// ── Reads ───────────────────────────────────────────────────────────────────

function instancesCollection(firestoreDb: Firestore): CollectionReference {
  return firestoreDb.collection(ST_STRATEGY_INSTANCES_ROOT);
}

/**
 * ACTIVE manage instances partitioned by trigger. The `runState` equality
 * filter keeps legacy `StrategyInstanceConfig` docs out entirely — they
 * carry no `runState` field, so they never reach the validator.
 */
export async function listActiveManageInstances(
  firestoreDb: Firestore = db,
): Promise<ActiveManageInstances> {
  const snap = await instancesCollection(firestoreDb)
    .where('runState', '==', 'ACTIVE')
    .get();
  const out: ActiveManageInstances = { daily: [], signal: [] };
  for (const doc of snap.docs) {
    const inst = normalizeManageInstance(doc.id, doc.data());
    if (inst === null) continue;
    // v1 executes paper only — a console-flipped real-mode instance must
    // not mint paper trades under a real-mode id (same gate as the legacy
    // reader's isRunnablePaperInstance).
    if (inst.mode !== 'paper') {
      log.warn(`Manage instance ${inst.id} skipped: mode '${inst.mode}' — v1 runs paper only`);
      continue;
    }
    out[inst.trigger as InstanceTrigger].push(inst);
  }
  return out;
}

/** Single-doc read — config callers that already hold an instanceId. */
export async function getManageInstance(
  id: string,
  firestoreDb: Firestore = db,
): Promise<RunnableManageInstance | null> {
  const snap = await instancesCollection(firestoreDb).doc(id).get();
  return snap.exists ? normalizeManageInstance(snap.id, snap.data()) : null;
}
