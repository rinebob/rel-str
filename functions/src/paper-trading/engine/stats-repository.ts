/**
 * @topic #553 — Paper Trading Infra (task #562)
 *
 * Stats rollup repository — same API the engine passes/callables have always
 * used, backed by `paper-trading/stats/items/stats-{scope}` docs with an
 * embedded `equityCurve` array instead of the legacy
 * `options-strategy-stats/{scope}` + `equity-curve/` subcollection.
 */

import { PaperTradingKind } from '@paper-trading/contracts';
import type { PaperStats } from '@paper-trading/contracts';
import { buildStatsId } from '@paper-trading/ids';
import { db } from '../../firebase-admin-init';
import { paperDocRef } from '../collections';
import { computeMaxDrawdown, computeStatsFromPositions } from './stats-utils';
import type {
  EquityCurvePoint,
  Position,
  StrategyStats,
} from './types';

// ── Dependencies (for testability) ──────────────────────────────────────────

export interface StatsRepositoryDependencies {
  /** Read the existing equity-curve points for a scope (sorted oldest-first). */
  getExistingEquityCurve: (scope: string) => Promise<EquityCurvePoint[]>;
  /** Atomically write the stats doc and equity-curve point for a scope. */
  writeStatsAtomically: (
    scope: string,
    stats: StrategyStats,
    point: EquityCurvePoint,
  ) => Promise<void>;
}

// ── References ────────────────────────────────────────────────────────────────

export function statsDocRef(scope: string) {
  return paperDocRef(db, PaperTradingKind.STATS, buildStatsId(scope));
}

// ── Shape adapter ─────────────────────────────────────────────────────────────

function paperStatsToLegacy(stats: PaperStats): StrategyStats {
  return {
    scope: stats.scope,
    totalPremiumCollected: stats.totalPremiumCollected ?? 0,
    totalRealizedPnl: stats.totalRealizedPnl,
    totalUnrealizedPnl: stats.totalUnrealizedPnl,
    openPositionCount: stats.openTradeCount,
    closedPositionCount: stats.closedTradeCount,
    assignedCount: stats.assignedCount ?? 0,
    expiredWorthlessCount: stats.expiredWorthlessCount ?? 0,
    maxDrawdown: stats.maxDrawdown,
    lastUpdated: stats.updatedAt,
  };
}

function legacyToPaperStats(stats: StrategyStats, now: string): Omit<PaperStats, 'id' | 'equityCurve'> {
  return {
    kind: PaperTradingKind.STATS,
    scope: stats.scope,
    totalRealizedPnl: stats.totalRealizedPnl,
    totalUnrealizedPnl: stats.totalUnrealizedPnl,
    openTradeCount: stats.openPositionCount,
    closedTradeCount: stats.closedPositionCount,
    maxDrawdown: stats.maxDrawdown,
    totalPremiumCollected: stats.totalPremiumCollected,
    assignedCount: stats.assignedCount,
    expiredWorthlessCount: stats.expiredWorthlessCount,
    createdAt: now,
    updatedAt: stats.lastUpdated ?? now,
  };
}

async function readStatsDoc(scope: string): Promise<PaperStats | null> {
  const snap = await statsDocRef(scope).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as object) } as PaperStats;
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getStats(
  scope: string,
  deps: { readStatsDoc: (scope: string) => Promise<StrategyStats | null> },
): Promise<StrategyStats | null> {
  return deps.readStatsDoc(scope);
}

export async function getEquityCurve(
  scope: string,
  deps: { readEquityCurve: (scope: string) => Promise<EquityCurvePoint[]> },
): Promise<EquityCurvePoint[]> {
  const points = await deps.readEquityCurve(scope);
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

// ── Recompute ─────────────────────────────────────────────────────────────────

/**
 * Recompute stats for a scope from a list of positions, write the stats doc,
 * and merge the day's equity-curve point into the doc's embedded curve.
 */
export async function recomputeStats(
  scope: string,
  date: string,
  positions: Position[],
  deps: StatsRepositoryDependencies,
): Promise<void> {
  const existingCurve = await deps.getExistingEquityCurve(scope);

  const stats = computeStatsFromPositions(positions, scope, date);
  const cumulativePnl = stats.totalRealizedPnl + stats.totalUnrealizedPnl;

  // Merge today's point into the existing curve (replace if same date exists).
  const mergedCurve = [
    ...existingCurve.filter((p) => p.date !== date),
    { date, cumulativePnl },
  ].sort((a, b) => a.date.localeCompare(b.date));

  stats.maxDrawdown = computeMaxDrawdown(mergedCurve);

  await deps.writeStatsAtomically(scope, stats, { date, cumulativePnl });
}

// ── Default Firestore implementations ────────────────────────────────────────

export const defaultStatsDeps: StatsRepositoryDependencies = {
  getExistingEquityCurve: async (scope: string) => {
    const stats = await readStatsDoc(scope);
    return (stats?.equityCurve ?? []).map((p) => ({ date: p.date, cumulativePnl: p.cumulativePnl }));
  },
  writeStatsAtomically: async (
    scope: string,
    stats: StrategyStats,
    point: EquityCurvePoint,
  ) => {
    const now = new Date().toISOString();
    const ref = statsDocRef(scope);
    await db.runTransaction(async (txn) => {
      const snap = await txn.get(ref);
      const existing = snap.exists
        ? (snap.data() as Partial<PaperStats>)
        : undefined;
      const curve = [
        ...(existing?.equityCurve ?? []).filter((p) => p.date !== point.date),
        point,
      ].sort((a, b) => a.date.localeCompare(b.date));
      txn.set(
        ref,
        {
          ...legacyToPaperStats(stats, now),
          equityCurve: curve,
          createdAt: existing?.createdAt ?? now,
        },
        { merge: true },
      );
    });
  },
};

/**
 * Default Firestore reader for the stats doc. Used by callables that need
 * to read stats without the full recompute deps.
 */
export async function defaultReadStatsDoc(scope: string): Promise<StrategyStats | null> {
  const stats = await readStatsDoc(scope);
  return stats ? paperStatsToLegacy(stats) : null;
}

// ── Incremental update (open pass) ───────────────────────────────────────────

/**
 * Incrementally update stats when a new position is opened — increments
 * `totalPremiumCollected` and `openPositionCount` for both the per-instance
 * and ALL scopes. Uses a Firestore transaction so the increment is atomic
 * and consistent across concurrent opens.
 */
export async function incrementStatsOnOpen(
  instanceId: string,
  premiumCollected: number,
): Promise<void> {
  const now = new Date().toISOString();
  // One transaction for both scopes — a partial failure can't leave the
  // per-instance and ALL scopes diverged. (Reads must precede writes.)
  await db.runTransaction(async (tx) => {
    const refs = [instanceId, 'ALL'].map((scope) => statsDocRef(scope));
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
    for (const [i, scope] of [instanceId, 'ALL'].entries()) {
      const existing = snaps[i].exists
        ? (snaps[i].data() as Partial<PaperStats>)
        : undefined;
      tx.set(refs[i],
        {
          kind: PaperTradingKind.STATS,
          scope,
          totalPremiumCollected:
            (existing?.totalPremiumCollected ?? 0) + premiumCollected,
          openTradeCount: (existing?.openTradeCount ?? 0) + 1,
          totalRealizedPnl: existing?.totalRealizedPnl ?? 0,
          totalUnrealizedPnl: existing?.totalUnrealizedPnl ?? 0,
          closedTradeCount: existing?.closedTradeCount ?? 0,
          assignedCount: existing?.assignedCount ?? 0,
          expiredWorthlessCount: existing?.expiredWorthlessCount ?? 0,
          maxDrawdown: existing?.maxDrawdown ?? 0,
          equityCurve: existing?.equityCurve ?? [],
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        },
        { merge: true },
      );
    }
  });
}
