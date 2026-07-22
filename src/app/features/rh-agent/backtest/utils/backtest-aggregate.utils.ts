/**
 * Backtest aggregate metrics utilities.
 *
 * Pure helpers for computing run-level aggregate metrics from a set of
 * permutations. Used by BacktestRunSummaryComponent.
 */
import type { BacktestPermutationUi } from '../common/backtest.types';

export interface RunAggregateMetrics {
  meanTotalReturnPct: number;
  minTotalReturnPct: number;
  maxTotalReturnPct: number;
  meanCalmarRatio: number;
  meanSharpeRatio: number;
  meanMaxDrawdownPct: number;
  totalTradeCount: number;
  successCount: number;
  failedCount: number;
  runningCount: number;
  pendingCount: number;
  exitReasonCounts: Record<string, number>;
}

function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Compute a mean of a numeric array, guarding against empty input. */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

/**
 * Compute run-level aggregate metrics from permutations.
 *
 * Ignores failed/running permutations for return and metric averages,
 * but still counts them in status counts.
 */
export function computeRunAggregates(permutations: BacktestPermutationUi[]): RunAggregateMetrics {
  const successValues = permutations.filter((p) => p.status === 'success');
  const completedValues = permutations.filter((p) => p.status === 'success' || p.status === 'failed');

  const totalReturnPcts = successValues.map((p) => safeNumber(p.totalReturnPct));
  const calmarRatios = successValues.map((p) => safeNumber(p.metrics?.calmarRatio));
  const sharpeRatios = successValues.map((p) => safeNumber(p.metrics?.sharpeRatio));
  const maxDrawdownPcts = successValues.map((p) => safeNumber(p.metrics?.maxDrawdownPct));

  const exitReasonCounts: Record<string, number> = {};
  permutations.forEach((p) => {
    (p.trades ?? []).forEach((trade) => {
      const reason = trade.exitReason || 'unknown';
      exitReasonCounts[reason] = (exitReasonCounts[reason] ?? 0) + 1;
    });
  });

  return {
    meanTotalReturnPct: totalReturnPcts.length > 0 ? mean(totalReturnPcts) : 0,
    minTotalReturnPct: totalReturnPcts.length > 0 ? Math.min(...totalReturnPcts) : 0,
    maxTotalReturnPct: totalReturnPcts.length > 0 ? Math.max(...totalReturnPcts) : 0,
    meanCalmarRatio: calmarRatios.length > 0 ? mean(calmarRatios) : 0,
    meanSharpeRatio: sharpeRatios.length > 0 ? mean(sharpeRatios) : 0,
    meanMaxDrawdownPct: maxDrawdownPcts.length > 0 ? mean(maxDrawdownPcts) : 0,
    totalTradeCount: completedValues.reduce((acc, p) => acc + safeNumber(p.tradeCount), 0),
    successCount: permutations.filter((p) => p.status === 'success').length,
    failedCount: permutations.filter((p) => p.status === 'failed').length,
    runningCount: permutations.filter((p) => p.status === 'running').length,
    pendingCount: permutations.filter((p) => p.status === 'pending').length,
    exitReasonCounts,
  };
}

