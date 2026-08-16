/**
 * @topic #108 — Options Position Strategy Engine
 *
 * Firestore read/write helpers for the options strategy stats rollup.
 *
 * Writes stats docs and equity-curve points to the
 * `options-strategy-stats/{scope}` collection, with max drawdown computed
 * from the full equity-curve series.
 */

import { db } from '../firebase-admin-init';
import { OPTIONS_STRATEGY_STATS_COLLECTION } from './collections';
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
  return db.collection(OPTIONS_STRATEGY_STATS_COLLECTION).doc(scope);
}

export function equityCurveCollectionRef(scope: string) {
  return statsDocRef(scope).collection('equity-curve');
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
 * and append (or overwrite) an equity-curve point for the given date.
 *
 * Steps:
 * 1. Read existing equity-curve points for the scope.
 * 2. Compute stats from positions (premium, realized, unrealized, counts).
 * 3. Compute today's cumulative P&L = totalRealizedPnl + totalUnrealizedPnl.
 * 4. Merge today's point into the existing curve (replace if same date).
 * 5. Compute max drawdown from the merged curve.
 * 6. Write stats doc + equity-curve point.
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
    const snap = await equityCurveCollectionRef(scope).orderBy('date').get();
    return snap.docs.map((doc) => doc.data() as EquityCurvePoint);
  },
  writeStatsAtomically: async (
    scope: string,
    stats: StrategyStats,
    point: EquityCurvePoint,
  ) => {
    const batch = db.batch();
    batch.set(statsDocRef(scope), stats, { merge: true });
    batch.set(equityCurveCollectionRef(scope).doc(point.date), point, { merge: true });
    await batch.commit();
  },
};

// ── Incremental update (open pass) ───────────────────────────────────────────

/**
 * Incrementally update stats when a new position is opened — increments
 * `totalPremiumCollected` and `openPositionCount` for both the per-instance
 * and ALL scopes. Uses a Firestore transaction so the increment is atomic
 * and consistent across concurrent opens.
 *
 * Per IMPL line 101: "updated incrementally by the open pass for
 * premium/position counts". The nightly pass does the full recompute
 * (realized/unrealized P&L, max drawdown, equity-curve point); this
 * incremental update keeps the stats doc roughly current between nightly
 * recomputes so the dashboard doesn't show stale counts during the day.
 */
export async function incrementStatsOnOpen(
  instanceId: string,
  premiumCollected: number,
): Promise<void> {
  for (const scope of [instanceId, 'ALL']) {
    await db.runTransaction(async (tx) => {
      const ref = statsDocRef(scope);
      const snap = await tx.get(ref);
      const existing = snap.data() as Partial<StrategyStats> | undefined;
      tx.set(
        ref,
        {
          scope,
          totalPremiumCollected:
            (existing?.totalPremiumCollected ?? 0) + premiumCollected,
          openPositionCount: (existing?.openPositionCount ?? 0) + 1,
          totalRealizedPnl: existing?.totalRealizedPnl ?? 0,
          totalUnrealizedPnl: existing?.totalUnrealizedPnl ?? 0,
          closedPositionCount: existing?.closedPositionCount ?? 0,
          assignedCount: existing?.assignedCount ?? 0,
          expiredWorthlessCount: existing?.expiredWorthlessCount ?? 0,
          maxDrawdown: existing?.maxDrawdown ?? 0,
          lastUpdated: new Date().toISOString(),
        },
        { merge: true },
      );
    });
  }
}
