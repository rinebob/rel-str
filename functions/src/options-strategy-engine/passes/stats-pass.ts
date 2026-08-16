/**
 * @topic #108 — Options Position Strategy Engine
 *
 * Stats pass — recomputes per-instance and ALL-scope stats from positions,
 * writing stats docs + equity-curve points. Called after settlement + held-shares
 * passes complete in the nightly schedule.
 */

import { db } from '../../firebase-admin-init';
import { OPTIONS_STRATEGY_POSITIONS_COLLECTION } from '../collections';
import { listPositionsByInstance } from '../position-repository';
import type { Position } from '../types';
import { recomputeStats, defaultStatsDeps } from '../stats-repository';

// ── Dependencies (for testability) ──────────────────────────────────────────

export interface StatsPassDependencies {
  /** List all positions for a given instance (any status). */
  listPositionsByInstance: (instanceId: string) => Promise<Position[]>;
  /** List all positions across all instances (for the ALL scope). */
  listAllPositions: () => Promise<Position[]>;
  /** Recompute stats for a scope (delegates to stats-repository). */
  recomputeStats: (
    scope: string,
    date: string,
    positions: Position[],
  ) => Promise<void>;
}

// ── Result ───────────────────────────────────────────────────────────────────

export interface StatsPassResult {
  /** Scopes that were written (per-instance first, then ALL). */
  scopesWritten: string[];
}

// ── Pass ──────────────────────────────────────────────────────────────────────

/**
 * Run the stats pass for a single instance on a given date.
 *
 * Writes two scopes:
 * 1. Per-instance (scope = instanceId) — stats from that instance's positions only.
 * 2. ALL — stats from all positions across all instances.
 *
 * If the per-instance recompute throws, the ALL scope is not attempted
 * (fail-fast — the caller can retry the whole pass).
 */
export async function runStatsPass(
  instanceId: string,
  date: string,
  deps: StatsPassDependencies,
): Promise<StatsPassResult> {
  const scopesWritten: string[] = [];

  // Per-instance scope
  const instancePositions = await deps.listPositionsByInstance(instanceId);
  await deps.recomputeStats(instanceId, date, instancePositions);
  scopesWritten.push(instanceId);

  // ALL scope
  const allPositions = await deps.listAllPositions();
  await deps.recomputeStats('ALL', date, allPositions);
  scopesWritten.push('ALL');

  return { scopesWritten };
}

// ── Default Firestore-backed dependencies ────────────────────────────────────

export function createDefaultStatsPassDeps(): StatsPassDependencies {
  return {
    listPositionsByInstance,
    listAllPositions: async () => {
      const snap = await db.collection(OPTIONS_STRATEGY_POSITIONS_COLLECTION).get();
      return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Position, 'id'>) }));
    },
    recomputeStats: async (scope: string, date: string, positions: Position[]) => {
      await recomputeStats(scope, date, positions, defaultStatsDeps);
    },
  };
}
