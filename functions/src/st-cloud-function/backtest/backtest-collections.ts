/**
 * Backtest Firestore collection names.
 *
 * - st-backtest-runs: one job document per orchestrator invocation
 *   (was `backtest-runs` — renamed in #1007; the legacy root keeps a
 *   mirror-populated shadow for FE reads until its service re-point).
 * - st-backtest-permutations: one result document per symbol+strategy+
 *   param set (was `backtest-permutations`).
 *
 * Legacy literals live in `backtest-mirror.ts` — scripts/mirror only.
 */

import {
  ST_BACKTEST_PERMUTATIONS_ROOT,
  ST_BACKTEST_RUNS_ROOT,
} from '../../common/st-collections';

/** Root collection for backtest job/run metadata and progress. */
export const BACKTEST_RUNS_COLLECTION = ST_BACKTEST_RUNS_ROOT;

/** Root collection for individual backtest permutation results. */
export const BACKTEST_PERMUTATIONS_COLLECTION = ST_BACKTEST_PERMUTATIONS_ROOT;

/** Permutation status values. */
export enum BacktestPermutationStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
}

/** Overall run status values. */
export enum BacktestRunStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}
