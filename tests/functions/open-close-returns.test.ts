/**
 * Unit tests for open-close-returns.ts — the pure return computation module.
 *
 * Tests both computeOpenCloseReturns and computeDailyReturnMetrics with
 * synthetic OHLCV bars that have known prices, so all returns, P&L, equity,
 * and metrics are deterministic. Expected values are hand-calculated literals,
 * not recomputed formulas.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeOpenCloseReturns,
  computeDailyReturnMetrics,
} from '../../functions/src/st-cloud-function/backtest/open-close-returns';
import type { OHLCV } from '../../functions/src/st-cloud-function/strategies/base-strategy';

// ─── Helpers ────────────────────────────────────────────────────────────────

function bar(date: string, open: number, close: number, high?: number, low?: number): OHLCV {
  return {
    date,
    open,
    close,
    high: high ?? Math.max(open, close),
    low: low ?? Math.min(open, close),
  };
}

/** Tolerance for floating-point comparisons. */
const TOL = 1e-6;

/**
 * Assert that two numbers are approximately equal (within tol).
 * Throws an AssertionError with actual/expected values on failure.
 */
function assertApprox(actual: number, expected: number, tol = TOL, label?: string): void {
  if (Math.abs(actual - expected) >= tol) {
    assert.fail(
      `${label ? label + ': ' : ''}expected ~${expected}, got ${actual} (diff ${actual - expected}, tol ${tol})`,
    );
  }
}

// ─── Shared fixtures for computeDailyReturnMetrics ──────────────────────────

// Coherent fixture: dailyPnl matches equity curve changes.
// initialEquity = 100000
// Day 1: pnl +500,  equity 100500
// Day 2: pnl -200,  equity 100300
// Day 3: pnl +300,  equity 100600
// Day 4: pnl -100,  equity 100500
const FIXTURE_PNL = [500, -200, 300, -100];
const FIXTURE_EQUITY = [
  { date: 'd0', equity: 100_000 },  // initial seed
  { date: 'd1', equity: 100_500 },
  { date: 'd2', equity: 100_300 },
  { date: 'd3', equity: 100_600 },
  { date: 'd4', equity: 100_500 },
];
const FIXTURE_INITIAL = 100_000;

// ─── computeOpenCloseReturns ────────────────────────────────────────────────

describe('computeOpenCloseReturns', () => {
  describe('intraday return (Strat 1)', () => {
    it('computes positive intraday return correctly', () => {
      const bars = [
        bar('2020-01-01', 100, 100),
        bar('2020-01-02', 100, 105),
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      // (105 - 100) / 100 = 0.05
      assertApprox(result.dailyRecords[1].intradayReturn!, 0.05);
    });

    it('computes negative intraday return correctly', () => {
      const bars = [
        bar('2020-01-01', 100, 100),
        bar('2020-01-02', 100, 95),
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      // (95 - 100) / 100 = -0.05
      assertApprox(result.dailyRecords[1].intradayReturn!, -0.05);
    });
  });

  describe('overnight return (Strat 2)', () => {
    it('computes positive overnight return correctly', () => {
      const bars = [
        bar('2020-01-01', 100, 100),
        bar('2020-01-02', 103, 105),
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      // (103 - 100) / 100 = 0.03
      assertApprox(result.dailyRecords[1].overnightReturn!, 0.03);
    });

    it('computes negative overnight return correctly', () => {
      const bars = [
        bar('2020-01-01', 100, 100),
        bar('2020-01-02', 97, 105),
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      // (97 - 100) / 100 = -0.03
      assertApprox(result.dailyRecords[1].overnightReturn!, -0.03);
    });
  });

  describe('first day edge case', () => {
    it('has no overnight return on the first day (no prior close)', () => {
      const bars = [bar('2020-01-01', 100, 105)];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      const day1 = result.dailyRecords[0];
      assert.strictEqual(day1.overnightReturn, null);
      assert.strictEqual(day1.skipped, true);
      assert.ok(day1.skipReason?.includes('no prior close'));
    });

    it('still computes intraday return on the first day', () => {
      const bars = [bar('2020-01-01', 100, 105)];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      assertApprox(result.dailyRecords[0].intradayReturn!, 0.05);
    });
  });

  describe('missing data handling', () => {
    it('skips both strategies when open is missing (zero)', () => {
      const bars = [
        bar('2020-01-01', 100, 100),
        bar('2020-01-02', 0, 105),
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      const day2 = result.dailyRecords[1];
      assert.strictEqual(day2.intradayReturn, null);
      assert.strictEqual(day2.overnightReturn, null);
      assert.strictEqual(day2.skipped, true);
      assert.ok(day2.skipReason?.includes('open'));
    });

    it('skips intraday when close is missing (zero)', () => {
      const bars = [
        bar('2020-01-01', 100, 100),
        bar('2020-01-02', 105, 0),
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      const day2 = result.dailyRecords[1];
      assert.strictEqual(day2.intradayReturn, null);
      assert.ok(day2.skipReason?.includes('close'));
    });

    it('skips overnight on day N+1 when day N close is missing', () => {
      const bars = [
        bar('2020-01-01', 100, 100),
        bar('2020-01-02', 105, 0),   // close missing
        bar('2020-01-03', 102, 108),  // overnight needs day 2 close, which is 0
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      const day3 = result.dailyRecords[2];
      assert.strictEqual(day3.overnightReturn, null);
      assert.ok(day3.skipReason?.includes('prior close'));
    });

    it('tracks skipped count correctly', () => {
      const bars = [
        bar('2020-01-01', 100, 100),  // skipped (first day, no overnight)
        bar('2020-01-02', 0, 105),    // skipped (missing open)
        bar('2020-01-03', 102, 108),  // valid
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      assert.strictEqual(result.skippedCount, 2);
    });

    it('skips days with NaN open', () => {
      const bars = [
        bar('2020-01-01', 100, 100),
        { date: '2020-01-02', open: NaN, close: 105 },
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      assert.strictEqual(result.dailyRecords[1].intradayReturn, null);
      assert.strictEqual(result.dailyRecords[1].skipped, true);
    });

    it('skips days with Infinity close', () => {
      const bars = [
        bar('2020-01-01', 100, 100),
        { date: '2020-01-02', open: 105, close: Infinity },
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      assert.strictEqual(result.dailyRecords[1].intradayReturn, null);
    });

    it('skips days with negative open', () => {
      const bars = [
        bar('2020-01-01', 100, 100),
        { date: '2020-01-02', open: -5, close: 105 },
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      assert.strictEqual(result.dailyRecords[1].intradayReturn, null);
    });

    it('stores null for invalid prices in daily records', () => {
      const bars = [
        bar('2020-01-01', 100, 100),
        { date: '2020-01-02', open: 0, close: 105 },
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      assert.strictEqual(result.dailyRecords[1].open, null);
    });
  });

  describe('all bars skipped', () => {
    it('handles all-invalid bars with zero metrics', () => {
      const bars = [
        { date: '2020-01-01', open: 0, close: 0 },
        { date: '2020-01-02', open: 0, close: 0 },
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      assert.strictEqual(result.skippedCount, 2);
      assert.strictEqual(result.intradayFixedTotalPnl, 0);
      assert.strictEqual(result.overnightFixedTotalPnl, 0);
      assert.strictEqual(result.intradayMetrics.tradeCount, 0);
      assert.strictEqual(result.overnightMetrics.tradeCount, 0);
    });
  });

  describe('fixed-amount P&L', () => {
    it('computes intraday fixed-amount P&L correctly', () => {
      const bars = [
        bar('2020-01-01', 100, 100),
        bar('2020-01-02', 100, 105),
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      // 100000 * 0.05 = 5000
      assertApprox(result.dailyRecords[1].intradayFixedPnl!, 5000);
    });

    it('computes overnight fixed-amount P&L correctly', () => {
      const bars = [
        bar('2020-01-01', 100, 100),
        bar('2020-01-02', 103, 105),
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      // 100000 * 0.03 = 3000
      assertApprox(result.dailyRecords[1].overnightFixedPnl!, 3000);
    });

    it('sums intraday fixed-amount totals correctly', () => {
      const bars = [
        bar('2020-01-01', 100, 100),  // intraday return 0, P&L 0
        bar('2020-01-02', 100, 105),  // intraday return 0.05, P&L 5000
        bar('2020-01-03', 105, 110),  // intraday return ~0.0476, P&L ~4761.90
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      // 0 + 5000 + 4761.904... = 9761.904...
      assertApprox(result.intradayFixedTotalPnl, 9761.904761, 0.01);
    });

    it('sums overnight fixed-amount totals correctly', () => {
      const bars = [
        bar('2020-01-01', 100, 100),
        bar('2020-01-02', 103, 105),  // overnight: (103-100)/100 = 0.03, P&L 3000
        bar('2020-01-03', 105, 108),  // overnight: (105-105)/105 = 0, P&L 0
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      // 3000 + 0 = 3000
      assertApprox(result.overnightFixedTotalPnl, 3000);
    });
  });

  describe('compounded equity', () => {
    it('compounds intraday equity correctly across two days', () => {
      const bars = [
        bar('2020-01-01', 100, 100),
        bar('2020-01-02', 100, 105),    // return 0.05
        bar('2020-01-03', 105, 108.15), // return 0.03
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      // Day 2: 100000 * 1.05 = 105000
      assertApprox(result.dailyRecords[1].intradayCompoundedEquity!, 105000);
      // Day 3: 105000 * 1.03 = 108150
      assertApprox(result.dailyRecords[2].intradayCompoundedEquity!, 108150);
    });

    it('compounds overnight equity correctly', () => {
      const bars = [
        bar('2020-01-01', 100, 100),
        bar('2020-01-02', 103, 105),  // overnight return 0.03
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      // 100000 * 1.03 = 103000
      assertApprox(result.dailyRecords[1].overnightCompoundedEquity!, 103000);
    });

    it('reports intraday final compounded equity', () => {
      const bars = [
        bar('2020-01-01', 100, 100),
        bar('2020-01-02', 100, 105),
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      // 100000 -> 100000 (day 1, 0 return) -> 105000 (day 2, 0.05 return)
      assertApprox(result.intradayCompoundedFinalEquity, 105000);
    });

    it('reports overnight final compounded equity', () => {
      const bars = [
        bar('2020-01-01', 100, 100),
        bar('2020-01-02', 103, 105),
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      // 100000 -> 103000
      assertApprox(result.overnightCompoundedFinalEquity, 103000);
    });
  });

  describe('date range and bar count', () => {
    it('reports correct date range and bar count', () => {
      const bars = [
        bar('2020-01-01', 100, 100),
        bar('2020-01-02', 100, 105),
        bar('2020-01-03', 105, 108),
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      assert.strictEqual(result.barCount, 3);
      assert.strictEqual(result.dateRange.first, '2020-01-01');
      assert.strictEqual(result.dateRange.last, '2020-01-03');
    });
  });

  describe('empty input', () => {
    it('handles empty bars without crashing', () => {
      const result = computeOpenCloseReturns([], 100_000, 100_000, 'TEST');

      assert.strictEqual(result.barCount, 0);
      assert.strictEqual(result.dailyRecords.length, 0);
      assert.strictEqual(result.skippedCount, 0);
      assert.strictEqual(result.intradayFixedTotalPnl, 0);
      assert.strictEqual(result.overnightFixedTotalPnl, 0);
      assertApprox(result.intradayCompoundedFinalEquity, 100_000);
      assertApprox(result.overnightCompoundedFinalEquity, 100_000);
    });
  });

  describe('metrics coherence', () => {
    it('intraday metrics totalNetProfit matches compounded equity change', () => {
      const bars = [
        bar('2020-01-01', 100, 100),
        bar('2020-01-02', 100, 105),  // return 0.05
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      // Compounded: 100000 -> 100000 -> 105000. Net change = 5000.
      assertApprox(result.intradayMetrics.totalNetProfit, 5000);
    });

    it('overnight metrics totalNetProfit matches compounded equity change', () => {
      const bars = [
        bar('2020-01-01', 100, 100),
        bar('2020-01-02', 103, 105),  // overnight return 0.03
      ];
      const result = computeOpenCloseReturns(bars, 100_000, 100_000, 'TEST');

      // Compounded: 100000 -> 103000. Net change = 3000.
      assertApprox(result.overnightMetrics.totalNetProfit, 3000);
    });
  });

  describe('full metrics through pipeline (integration)', () => {
    // Multi-day fixture with mixed returns for hand-calculated metrics.
    // Day 1: open=100, close=100  → intraday 0%,    overnight skip
    // Day 2: open=110, close=99   → intraday -10%,  overnight +10%
    // Day 3: open=89.1, close=98.01→ intraday +10%,  overnight -10%
    //
    // Intraday compounded equity: 100000 → 100000 → 90000 → 99000
    //   daily P&L: [0, -10000, 9000]
    //   totalNetProfit = -1000, grossProfit = 9000, grossLoss = 10000
    //   profitFactor = 0.9, winCount = 1, lossCount = 1, tradeCount = 3
    //   percentProfitable = 33.333%, averageTrade = -333.333
    //   averageWin = 9000, averageLoss = 10000, winLossRatio = 0.9
    //   maxDrawdown = 10000 (peak 100000 → trough 90000), maxDrawdownPct = 10
    //   totalReturn = -0.01, calmar = -0.01 / 0.1 = -0.1
    //
    // Overnight compounded equity: 100000 → 100000 → 110000 → 99000
    //   daily P&L: [10000, -11000]
    //   totalNetProfit = -1000, grossProfit = 10000, grossLoss = 11000
    //   profitFactor = 0.909090..., winCount = 1, lossCount = 1, tradeCount = 2
    //   percentProfitable = 50, averageTrade = -500
    //   averageWin = 10000, averageLoss = 11000, winLossRatio = 0.909090...
    //   maxDrawdown = 11000 (peak 110000 → trough 99000), maxDrawdownPct = 10
    //   totalReturn = -0.01, calmar = -0.01 / 0.11 = -0.090909...

    const integrationBars = [
      bar('2020-01-01', 100, 100),
      bar('2020-01-02', 110, 99),
      bar('2020-01-03', 89.1, 98.01),
    ];

    it('intraday metrics: full BacktestMetrics through pipeline', () => {
      const result = computeOpenCloseReturns(integrationBars, 100_000, 100_000, 'TEST');
      const m = result.intradayMetrics;

      assert.strictEqual(m.tradeCount, 3);
      assert.strictEqual(m.winCount, 1);
      assert.strictEqual(m.lossCount, 1);
      assertApprox(m.totalNetProfit, -1000);
      assertApprox(m.grossProfit, 9000);
      assertApprox(m.grossLoss, 10000);
      assertApprox(m.profitFactor, 0.9);
      assertApprox(m.percentProfitable, 33.333333, 1e-4);
      assertApprox(m.averageTrade, -333.333333, 1e-4);
      assertApprox(m.averageWin, 9000);
      assertApprox(m.averageLoss, 10000);
      assertApprox(m.winLossRatio, 0.9);
      assertApprox(m.maxDrawdown, 10000);
      assertApprox(m.maxDrawdownPct, 10);
      assertApprox(m.calmarRatio, -0.1);
      assert.ok(Number.isFinite(m.sharpeRatio));
    });

    it('overnight metrics: full BacktestMetrics through pipeline', () => {
      const result = computeOpenCloseReturns(integrationBars, 100_000, 100_000, 'TEST');
      const m = result.overnightMetrics;

      assert.strictEqual(m.tradeCount, 2);
      assert.strictEqual(m.winCount, 1);
      assert.strictEqual(m.lossCount, 1);
      assertApprox(m.totalNetProfit, -1000);
      assertApprox(m.grossProfit, 10000);
      assertApprox(m.grossLoss, 11000);
      assertApprox(m.profitFactor, 0.909090, 1e-4);
      assertApprox(m.percentProfitable, 50);
      assertApprox(m.averageTrade, -500);
      assertApprox(m.averageWin, 10000);
      assertApprox(m.averageLoss, 11000);
      assertApprox(m.winLossRatio, 0.909090, 1e-4);
      assertApprox(m.maxDrawdown, 11000);
      assertApprox(m.maxDrawdownPct, 10);
      assertApprox(m.calmarRatio, -0.090909, 1e-4);
      assert.ok(Number.isFinite(m.sharpeRatio));
    });
  });

  describe('input validation', () => {
    it('throws RangeError for non-positive fixedAmount', () => {
      assert.throws(
        () => computeOpenCloseReturns([bar('2020-01-01', 100, 105)], 0, 100_000, 'TEST'),
        RangeError,
      );
      assert.throws(
        () => computeOpenCloseReturns([bar('2020-01-01', 100, 105)], -100, 100_000, 'TEST'),
        RangeError,
      );
    });

    it('throws RangeError for non-positive initialEquity', () => {
      assert.throws(
        () => computeOpenCloseReturns([bar('2020-01-01', 100, 105)], 100_000, 0, 'TEST'),
        RangeError,
      );
      assert.throws(
        () => computeOpenCloseReturns([bar('2020-01-01', 100, 105)], 100_000, -50, 'TEST'),
        RangeError,
      );
    });

    it('throws RangeError for NaN fixedAmount', () => {
      assert.throws(
        () => computeOpenCloseReturns([bar('2020-01-01', 100, 105)], NaN, 100_000, 'TEST'),
        RangeError,
      );
    });

    it('throws RangeError for Infinity fixedAmount', () => {
      assert.throws(
        () => computeOpenCloseReturns([bar('2020-01-01', 100, 105)], Infinity, 100_000, 'TEST'),
        RangeError,
      );
      assert.throws(
        () => computeOpenCloseReturns([bar('2020-01-01', 100, 105)], -Infinity, 100_000, 'TEST'),
        RangeError,
      );
    });

    it('throws RangeError for NaN initialEquity', () => {
      assert.throws(
        () => computeOpenCloseReturns([bar('2020-01-01', 100, 105)], 100_000, NaN, 'TEST'),
        RangeError,
      );
    });

    it('throws RangeError for Infinity initialEquity', () => {
      assert.throws(
        () => computeOpenCloseReturns([bar('2020-01-01', 100, 105)], 100_000, Infinity, 'TEST'),
        RangeError,
      );
      assert.throws(
        () => computeOpenCloseReturns([bar('2020-01-01', 100, 105)], 100_000, -Infinity, 'TEST'),
        RangeError,
      );
    });
  });
});

// ─── computeDailyReturnMetrics ──────────────────────────────────────────────

describe('computeDailyReturnMetrics', () => {
  it('computes win/loss counts correctly', () => {
    const metrics = computeDailyReturnMetrics(FIXTURE_PNL, FIXTURE_EQUITY, FIXTURE_INITIAL);

    assert.strictEqual(metrics.tradeCount, 4);
    assert.strictEqual(metrics.winCount, 2);
    assert.strictEqual(metrics.lossCount, 2);
  });

  it('computes gross profit and loss correctly', () => {
    const metrics = computeDailyReturnMetrics(FIXTURE_PNL, FIXTURE_EQUITY, FIXTURE_INITIAL);

    // Hand: 500+300=800, |-200|+|-100|=300
    assertApprox(metrics.grossProfit, 800);
    assertApprox(metrics.grossLoss, 300);
  });

  it('computes profit factor correctly', () => {
    const metrics = computeDailyReturnMetrics(FIXTURE_PNL, FIXTURE_EQUITY, FIXTURE_INITIAL);

    // Hand: 800/300 = 2.6667
    assertApprox(metrics.profitFactor, 2.66667, 1e-4);
  });

  it('computes percent profitable correctly', () => {
    const metrics = computeDailyReturnMetrics(FIXTURE_PNL, FIXTURE_EQUITY, FIXTURE_INITIAL);

    // Hand: 2/4 * 100 = 50
    assertApprox(metrics.percentProfitable, 50);
  });

  it('computes total net profit correctly', () => {
    const metrics = computeDailyReturnMetrics(FIXTURE_PNL, FIXTURE_EQUITY, FIXTURE_INITIAL);

    // Hand: 500-200+300-100 = 500
    assertApprox(metrics.totalNetProfit, 500);
  });

  it('computes average trade, win, and loss correctly', () => {
    const metrics = computeDailyReturnMetrics(FIXTURE_PNL, FIXTURE_EQUITY, FIXTURE_INITIAL);

    // Hand: avgTrade = 500/4 = 125, avgWin = 800/2 = 400, avgLoss = 300/2 = 150
    assertApprox(metrics.averageTrade, 125);
    assertApprox(metrics.averageWin, 400);
    assertApprox(metrics.averageLoss, 150);
  });

  it('computes win/loss ratio correctly', () => {
    const metrics = computeDailyReturnMetrics(FIXTURE_PNL, FIXTURE_EQUITY, FIXTURE_INITIAL);

    // Hand: 400/150 = 2.6667
    assertApprox(metrics.winLossRatio, 2.66667, 1e-4);
  });

  it('computes max drawdown from equity curve', () => {
    const metrics = computeDailyReturnMetrics(FIXTURE_PNL, FIXTURE_EQUITY, FIXTURE_INITIAL);

    // Hand: peak 100500 at d1, trough 100300 at d2, dd = 200.
    // Later peak 100600 at d3, trough 100500 at d4, dd = 100. Max = 200.
    assertApprox(metrics.maxDrawdown, 200);
    // maxDrawdownPct = 200/100500 * 100 = 0.199005%
    assertApprox(metrics.maxDrawdownPct, 0.199005, 1e-4);
  });

  it('computes Calmar ratio matching backtest-metrics.ts convention', () => {
    const metrics = computeDailyReturnMetrics(FIXTURE_PNL, FIXTURE_EQUITY, FIXTURE_INITIAL);

    // Hand: totalReturn = 500/100000 = 0.005
    // calmar = totalReturn / (maxDrawdown / initialEquity) = 0.005 / (200/100000) = 0.005/0.002 = 2.5
    assertApprox(metrics.calmarRatio, 2.5);
  });

  it('computes Sharpe ratio with varying returns (hand-calculated)', () => {
    // Equity curve produces returns [0.01, 0.02, -0.01, 0.03] from 5 points
    // (initial seed + 4 daily points).
    const equityCurve = [
      { date: 'd0', equity: 100_000 },
      { date: 'd1', equity: 101_000 },     // return 0.01
      { date: 'd2', equity: 103_020 },     // return 0.02
      { date: 'd3', equity: 101_989.8 },   // return -0.01
      { date: 'd4', equity: 105_049.494 }, // return 0.03
    ];
    const pnl = [1000, 2020, -1030.2, 3059.694];
    const metrics = computeDailyReturnMetrics(pnl, equityCurve, 100_000);

    // Hand-calculated:
    // mean = (0.01 + 0.02 - 0.01 + 0.03) / 4 = 0.0125
    // pop. variance = (0.00000625 + 0.00005625 + 0.00050625 + 0.00030625) / 4 = 0.00021875
    // pop. stdDev = sqrt(0.00021875) = 0.0147916
    // Sharpe = (0.0125 / 0.0147916) * sqrt(252) = 0.84515 * 15.8745 = 13.4164
    assert.ok(metrics.sharpeRatio > 13.4 && metrics.sharpeRatio < 13.5);
  });

  it('returns Sharpe = 0 for constant returns (zero stdDev)', () => {
    // All daily returns are exactly 0 → stdDev = 0 → Sharpe = 0.
    const equityCurve = [
      { date: 'd0', equity: 100_000 },
      { date: 'd1', equity: 100_000 },
      { date: 'd2', equity: 100_000 },
    ];
    const pnl = [0, 0];
    const metrics = computeDailyReturnMetrics(pnl, equityCurve, 100_000);

    assert.strictEqual(metrics.sharpeRatio, 0);
  });

  it('handles all-wins (profitFactor = 0 via safeDiv, matching existing convention)', () => {
    const pnl = [500, 300, 200];
    const equityCurve = [
      { date: 'd0', equity: 100_000 },
      { date: 'd1', equity: 100_500 },
      { date: 'd2', equity: 100_800 },
      { date: 'd3', equity: 101_000 },
    ];
    const metrics = computeDailyReturnMetrics(pnl, equityCurve, 100_000);

    assert.strictEqual(metrics.winCount, 3);
    assert.strictEqual(metrics.lossCount, 0);
    assert.strictEqual(metrics.percentProfitable, 100);
    // safeDiv(1000, 0) = 0 — matches backtest-metrics.ts convention.
    assert.strictEqual(metrics.profitFactor, 0);
  });

  it('handles empty input without crashing', () => {
    const metrics = computeDailyReturnMetrics([], [], 100_000);

    assert.strictEqual(metrics.tradeCount, 0);
    assert.strictEqual(metrics.winCount, 0);
    assert.strictEqual(metrics.lossCount, 0);
    assert.strictEqual(metrics.totalNetProfit, 0);
    assert.strictEqual(metrics.profitFactor, 0);
    assert.strictEqual(metrics.percentProfitable, 0);
    assert.strictEqual(metrics.maxDrawdown, 0);
    assert.strictEqual(metrics.sharpeRatio, 0);
    assert.strictEqual(metrics.calmarRatio, 0);
    assert.strictEqual(metrics.averageTrade, 0);
    assert.strictEqual(metrics.averageWin, 0);
    assert.strictEqual(metrics.averageLoss, 0);
    assert.strictEqual(metrics.winLossRatio, 0);
  });
});
