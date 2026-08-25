/**
 * Backtest performance metrics.
 *
 * Computes a TradeStation-style initial subset from the equity curve and
 * closed trade list.
 */

import type { BacktestEquityPoint, BacktestMetrics, BacktestTrade } from './backtest-types';

function safeDiv(a: number, b: number): number {
  return b === 0 || !Number.isFinite(b) ? 0 : a / b;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function computeMetrics(
  initialCash: number,
  equityCurve: BacktestEquityPoint[],
  closedTrades: BacktestTrade[],
): BacktestMetrics {
  const tradeCount = closedTrades.length;

  const wins = closedTrades.filter((t) => t.pnl > 0);
  const losses = closedTrades.filter((t) => t.pnl < 0);
  const winCount = wins.length;
  const lossCount = losses.length;

  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  const totalNetProfit = closedTrades.reduce((s, t) => s + t.pnl, 0);

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

  // Sharpe ratio from daily returns.
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
    sharpeRatio = sd === 0 ? 0 : (meanReturn / sd) * Math.sqrt(252);
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
