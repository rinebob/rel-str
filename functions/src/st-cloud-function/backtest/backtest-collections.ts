/**
 * Backtest Firestore collection names.
 *
 * - backtest-runs: one job document per orchestrator invocation.
 * - backtest-permutations: one result document per symbol+strategy+param set.
 */

/** Root collection for backtest job/run metadata and progress. */
export const BACKTEST_RUNS_COLLECTION = 'backtest-runs';

/** Root collection for individual backtest permutation results. */
export const BACKTEST_PERMUTATIONS_COLLECTION = 'backtest-permutations';

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
