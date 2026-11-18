/**
 * @topic #553 — Paper Trading Infra (task #562)
 * @task #1565 — legacy read path retired; this module owns the nightly
 * recompute write path only.
 *
 * Stats rollup repository — backed by
 * `st-paper-trading/stats/items/stats-{scope}` docs with an embedded
 * `equityCurve` array. Reads happen through `paper-trading/repository.ts`
 * (`getStats(db, statsId)`) — the legacy `StrategyStats` shape here is only
 * the intermediate form `computeStatsFromPositions` produces for the
 * write path.
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

// ── Shape adapter (write side) ────────────────────────────────────────────────

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

// Incremental stats updates live in `./stats-increments.ts` (#1563) —
// the ledger seam fires blind FieldValue.increment merge-sets post-commit;
// this module owns only the nightly recompute.
