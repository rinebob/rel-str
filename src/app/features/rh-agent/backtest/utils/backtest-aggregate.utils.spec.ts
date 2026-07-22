/**
 * Unit tests for backtest aggregate metric utilities.
 */
import type { BacktestPermutationUi, BacktestTradeUi } from '../common/backtest.types';
import { computeRunAggregates } from './backtest-aggregate.utils';

const BASE_METRICS = {
  totalNetProfit: 1000,
  grossProfit: 2000,
  grossLoss: 1000,
  profitFactor: 2,
  percentProfitable: 50,
  winLossRatio: 1.5,
  averageTrade: 100,
  averageWin: 200,
  averageLoss: 100,
  maxDrawdown: 500,
  maxDrawdownPct: 10,
  sharpeRatio: 1.2,
  calmarRatio: 0.9,
  tradeCount: 5,
  winCount: 3,
  lossCount: 2,
} satisfies BacktestPermutationUi['metrics'];

function makePermutation(partial: Partial<BacktestPermutationUi> = {}): BacktestPermutationUi {
  return {
    permutationId: 'p1',
    runId: 'r1',
    symbol: 'SPY',
    strategyId: 'leap-drop',
    config: {},
    status: 'success',
    runType: 'allData',
    initialCash: 10000,
    finalEquity: 11000,
    totalReturnPct: 10,
    metrics: { ...BASE_METRICS },
    equityCurve: [],
    tradeCount: 5,
    ...partial,
  };
}

function makeTrade(exitReason: string): BacktestTradeUi {
  return {
    entryDate: '2026-01-01',
    exitDate: '2026-01-02',
    symbol: 'SPY',
    side: 'long',
    quantity: 1,
    entryUnderlying: 100,
    exitUnderlying: 110,
    entryMark: 100,
    exitMark: 110,
    pnl: 10,
    returnPct: 10,
    exitReason,
    daysHeld: 1,
  };
}

describe('computeRunAggregates', () => {
  it('returns zeroed metrics for an empty permutation list', () => {
    const result = computeRunAggregates([]);

    expect(result.meanTotalReturnPct).toBe(0);
    expect(result.minTotalReturnPct).toBe(0);
    expect(result.maxTotalReturnPct).toBe(0);
    expect(result.meanCalmarRatio).toBe(0);
    expect(result.meanSharpeRatio).toBe(0);
    expect(result.meanMaxDrawdownPct).toBe(0);
    expect(result.totalTradeCount).toBe(0);
    expect(result.successCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(result.runningCount).toBe(0);
    expect(result.pendingCount).toBe(0);
    expect(result.exitReasonCounts).toEqual({});
  });

  it('averages return and metric values from successful permutations only', () => {
    const permutations: BacktestPermutationUi[] = [
      makePermutation({ totalReturnPct: 10, metrics: { ...BASE_METRICS, calmarRatio: 1, sharpeRatio: 1, maxDrawdownPct: 5 } }),
      makePermutation({ totalReturnPct: 20, metrics: { ...BASE_METRICS, calmarRatio: 3, sharpeRatio: 2, maxDrawdownPct: 15 } }),
    ];

    const result = computeRunAggregates(permutations);

    expect(result.meanTotalReturnPct).toBe(15);
    expect(result.minTotalReturnPct).toBe(10);
    expect(result.maxTotalReturnPct).toBe(20);
    expect(result.meanCalmarRatio).toBe(2);
    expect(result.meanSharpeRatio).toBe(1.5);
    expect(result.meanMaxDrawdownPct).toBe(10);
    expect(result.totalTradeCount).toBe(10);
    expect(result.successCount).toBe(2);
  });

  it('counts failed permutations in status totals but excludes them from averages and min/max', () => {
    const permutations: BacktestPermutationUi[] = [
      makePermutation({ totalReturnPct: 10, status: 'success' }),
      makePermutation({ totalReturnPct: -99, status: 'failed', metrics: { ...BASE_METRICS, calmarRatio: NaN, sharpeRatio: NaN, maxDrawdownPct: NaN } }),
    ];

    const result = computeRunAggregates(permutations);

    expect(result.successCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.meanTotalReturnPct).toBe(10);
    expect(result.minTotalReturnPct).toBe(10);
    expect(result.maxTotalReturnPct).toBe(10);
    expect(result.meanCalmarRatio).toBe(0.9);
  });

  it('treats all-failed permutation lists as zeroed averages', () => {
    const permutations: BacktestPermutationUi[] = [
      makePermutation({ status: 'failed', totalReturnPct: -10 }),
      makePermutation({ status: 'failed', totalReturnPct: -20 }),
    ];

    const result = computeRunAggregates(permutations);

    expect(result.meanTotalReturnPct).toBe(0);
    expect(result.minTotalReturnPct).toBe(0);
    expect(result.maxTotalReturnPct).toBe(0);
    expect(result.successCount).toBe(0);
    expect(result.failedCount).toBe(2);
  });

  it('guards against NaN metric values from failed permutations', () => {
    const permutations: BacktestPermutationUi[] = [
      makePermutation({
        status: 'failed',
        totalReturnPct: NaN,
        metrics: { ...BASE_METRICS, calmarRatio: NaN, sharpeRatio: NaN, maxDrawdownPct: NaN },
      }),
    ];

    const result = computeRunAggregates(permutations);

    expect(result.meanTotalReturnPct).toBe(0);
    expect(result.meanCalmarRatio).toBe(0);
    expect(result.meanSharpeRatio).toBe(0);
    expect(result.meanMaxDrawdownPct).toBe(0);
    expect(result.totalTradeCount).toBe(5);
  });

  it('counts exit reasons across all permutations', () => {
    const permutations: BacktestPermutationUi[] = [
      makePermutation({ trades: [makeTrade('target'), makeTrade('stop')] }),
      makePermutation({ trades: [makeTrade('target'), makeTrade('target')] }),
    ];

    const result = computeRunAggregates(permutations);

    expect(result.exitReasonCounts).toEqual({ target: 3, stop: 1 });
  });

  it('counts running and pending permutations only in status totals', () => {
    const permutations: BacktestPermutationUi[] = [
      makePermutation({ status: 'running', totalReturnPct: 5 }),
      makePermutation({ status: 'pending' }),
      makePermutation({ status: 'success', totalReturnPct: 10 }),
    ];

    const result = computeRunAggregates(permutations);

    expect(result.runningCount).toBe(1);
    expect(result.pendingCount).toBe(1);
    expect(result.successCount).toBe(1);
    expect(result.meanTotalReturnPct).toBe(10);
  });
});
