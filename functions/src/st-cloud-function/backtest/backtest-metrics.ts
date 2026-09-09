/**
 * Backtest performance metrics.
 *
 * Computes a TradeStation-style initial subset from the equity curve and
 * closed trade list.
 */

import type { BacktestEquityPoint, BacktestMetrics, BacktestTrade } from './backtest-types';
import { safeDiv, stdDev, TRADING_DAYS_PER_YEAR } from './backtest-math-helpers';

/**
 * Shared metrics core — computes BacktestMetrics from a P&L series and an
 * equity curve. Both computeMetrics (trade-based) and computeDailyReturnMetrics
 * (return-based) delegate to this.
 *
 * The equity curve should include the initial-cash point as its first element
 * so the first daily return is included in the Sharpe calculation.
 */
export function computeMetricsCore(
  pnlSeries: number[],
  equityCurve: { date: string; equity: number }[],
  initialCash: number,
): BacktestMetrics {
  const tradeCount = pnlSeries.length;

  const wins = pnlSeries.filter((p) => p > 0);
  const losses = pnlSeries.filter((p) => p < 0);
  const winCount = wins.length;
  const lossCount = losses.length;

  const grossProfit = wins.reduce((s, p) => s + p, 0);
  const grossLoss = Math.abs(losses.reduce((s, p) => s + p, 0));

  const totalNetProfit = pnlSeries.reduce((s, p) => s + p, 0);

  const averageTrade = safeDiv(totalNetProfit, tradeCount);
  const averageWin = safeDiv(grossProfit, winCount);
  const averageLoss = safeDiv(grossLoss, lossCount);

  const profitFactor = safeDiv(grossProfit, grossLoss);
  const percentProfitable = tradeCount === 0 ? 0 : (winCount / tradeCount) * 100;
  const winLossRatio = safeDiv(averageWin, averageLoss);

  // Max drawdown from equity curve.
  let peak = initialCash;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  for (const point of equityCurve) {
    if (point.equity > peak) {
      peak = point.equity;
    }
    const drawdown = peak - point.equity;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPct = safeDiv(drawdown, peak) * 100;
    }
  }

  // Sharpe ratio from daily returns derived from equity curve.
  let sharpeRatio = 0;
  if (equityCurve.length >= 2) {
    const dailyReturns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const prev = equityCurve[i - 1].equity;
      const curr = equityCurve[i].equity;
      if (prev > 0 && Number.isFinite(curr)) {
        dailyReturns.push(curr / prev - 1);
      }
    }
    const meanReturn = dailyReturns.reduce((s, v) => s + v, 0) / Math.max(1, dailyReturns.length);
    const sd = stdDev(dailyReturns);
    sharpeRatio = sd === 0 ? 0 : (meanReturn / sd) * Math.sqrt(TRADING_DAYS_PER_YEAR);
  }

  // Calmar ratio = total return / max drawdown.
  const totalReturn = safeDiv(totalNetProfit, initialCash);
  const calmarRatio = maxDrawdown === 0 ? 0 : totalReturn / (maxDrawdown / initialCash);

  return {
    totalNetProfit,
    grossProfit,
    grossLoss,
    profitFactor,
    percentProfitable,
    winLossRatio,
    averageTrade,
    averageWin,
    averageLoss,
    maxDrawdown,
    maxDrawdownPct,
    sharpeRatio,
    calmarRatio,
    tradeCount,
    winCount,
    lossCount,
  };
}

/**
 * Compute metrics from closed trades and an equity curve.
 *
 * Maps closed-trade P&L to a P&L series and delegates to computeMetricsCore.
 */
export function computeMetrics(
  initialCash: number,
  equityCurve: BacktestEquityPoint[],
  closedTrades: BacktestTrade[],
): BacktestMetrics {
  const pnlSeries = closedTrades.map((t) => t.pnl);
  return computeMetricsCore(pnlSeries, equityCurve, initialCash);
}
