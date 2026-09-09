/**
 * Open-Close Long strategy return computation.
 *
 * Pure module — no Firestore, no I/O. Takes daily OHLCV bars and computes
 * two mechanical daily-return strategies:
 *
 * - Strat 1 (Intraday): (close - open) / open — buy at open, sell at close.
 * - Strat 2 (Overnight): (open - priorClose) / priorClose — buy at close,
 *   sell at next day's open.
 *
 * Produces per-day records with both strategies' returns, fixed-amount P&L,
 * compounded equity, and aggregate BacktestMetrics for each strategy.
 *
 * Metrics are derived from the compounded equity curve so that all fields
 * (totalNetProfit, profitFactor, maxDrawdown, sharpeRatio, calmarRatio)
 * describe a single coherent pass. Fixed-amount totals are preserved
 * separately in intradayFixedTotalPnl / overnightFixedTotalPnl.
 */

import type { BacktestMetrics } from './backtest-types';
import type { OHLCV } from '../strategies/base-strategy';
import { computeMetricsCore } from './backtest-metrics';

// =============================================================================
// TYPES
// =============================================================================

/** One day's record with both strategies' returns, P&L, and equity. */
export interface OpenCloseDailyRecord {
  date: string;
  open: number | null;
  close: number | null;
  priorClose: number | null;
  /** Strat 1: (close - open) / open. null when skipped. */
  intradayReturn: number | null;
  /** Strat 2: (open - priorClose) / priorClose. null when skipped. */
  overnightReturn: number | null;
  /** Fixed-amount P&L for Strat 1 on this day. */
  intradayFixedPnl: number | null;
  /** Fixed-amount P&L for Strat 2 on this day. */
  overnightFixedPnl: number | null;
  /** Running compounded equity for Strat 1. */
  intradayCompoundedEquity: number | null;
  /** Running compounded equity for Strat 2. */
  overnightCompoundedEquity: number | null;
  /** True when this day was skipped for one or both strategies. */
  skipped: boolean;
  /** Reason(s) for skipping, if applicable. */
  skipReason?: string;
}

/** Aggregated result for one symbol. */
export interface OpenCloseSymbolResult {
  symbol: string;
  dateRange: { first: string; last: string };
  barCount: number;
  skippedCount: number;
  dailyRecords: OpenCloseDailyRecord[];
  intradayMetrics: BacktestMetrics;
  overnightMetrics: BacktestMetrics;
  intradayFixedTotalPnl: number;
  overnightFixedTotalPnl: number;
  intradayCompoundedFinalEquity: number;
  overnightCompoundedFinalEquity: number;
}

// =============================================================================
// HELPERS
// =============================================================================

function isValidPrice(value: number | undefined | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Resolve the date string from an OHLCV bar's alias fields. */
function getBarDate(bar: OHLCV): string {
  return bar.date ?? bar.d ?? bar.t ?? '';
}

/** Resolve the open price from an OHLCV bar's alias fields. */
function getBarOpen(bar: OHLCV): number | undefined {
  return bar.open ?? bar.o;
}

/** Resolve the close price from an OHLCV bar's alias fields. */
function getBarClose(bar: OHLCV): number | undefined {
  return bar.close ?? bar.c;
}

// =============================================================================
// METRICS
// =============================================================================

/**
 * Compute BacktestMetrics from daily P&L amounts and an equity curve.
 *
 * Thin wrapper around computeMetricsCore (shared with backtest-metrics.ts).
 * Both `dailyPnl` and `equityCurve` must describe the SAME pass (e.g. both
 * compounded). Each daily P&L entry is treated as one "trade" (win = positive,
 * loss = negative). Max drawdown and Sharpe are derived from the equity curve.
 *
 * The equity curve should include the initial-equity point as its first
 * element so the first daily return is included in the Sharpe calculation.
 */
export function computeDailyReturnMetrics(
  dailyPnl: number[],
  equityCurve: { date: string; equity: number }[],
  initialEquity: number,
): BacktestMetrics {
  return computeMetricsCore(dailyPnl, equityCurve, initialEquity);
}

// =============================================================================
// MAIN COMPUTATION
// =============================================================================

/**
 * Compute both open-close strategies' daily returns, fixed-amount P&L,
 * compounded equity curves, and metrics for a single symbol.
 *
 * @param bars         Daily OHLCV bars, sorted oldest to newest.
 * @param fixedAmount  Dollar amount invested per day in the fixed-amount pass.
 * @param initialEquity  Starting equity for the compounded pass.
 * @param symbol       Symbol identifier for the result.
 */
export function computeOpenCloseReturns(
  bars: OHLCV[],
  fixedAmount: number,
  initialEquity: number,
  symbol = '',
): OpenCloseSymbolResult {
  if (!(fixedAmount > 0) || !Number.isFinite(fixedAmount)) {
    throw new RangeError('fixedAmount must be a positive finite number');
  }
  if (!(initialEquity > 0) || !Number.isFinite(initialEquity)) {
    throw new RangeError('initialEquity must be a positive finite number');
  }

  const dailyRecords: OpenCloseDailyRecord[] = [];
  let skippedCount = 0;

  let intradayEquity = initialEquity;
  let overnightEquity = initialEquity;

  // Compounded daily P&L for metrics (coherent with equity curve).
  const intradayCompPnl: number[] = [];
  const overnightCompPnl: number[] = [];

  // Equity curves seeded with initial-equity point so first daily return
  // is included in Sharpe calculation.
  const intradayEquityCurve: { date: string; equity: number }[] = [];
  const overnightEquityCurve: { date: string; equity: number }[] = [];
  const firstDate = bars.length > 0 ? getBarDate(bars[0]) : '';
  if (bars.length > 0) {
    intradayEquityCurve.push({ date: firstDate, equity: initialEquity });
    overnightEquityCurve.push({ date: firstDate, equity: initialEquity });
  }

  let intradayFixedTotalPnl = 0;
  let overnightFixedTotalPnl = 0;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const date = getBarDate(bar);
    const open = getBarOpen(bar);
    const close = getBarClose(bar);
    const priorBar = i > 0 ? bars[i - 1] : null;
    const priorClose = priorBar ? getBarClose(priorBar) : null;

    const skipReasons = new Set<string>();

    // Strat 1: intraday return (close - open) / open
    let intradayReturn: number | null = null;
    let intradayFixedPnl: number | null = null;
    let intradayCompEquity: number | null = null;

    if (!isValidPrice(open)) {
      skipReasons.add('missing or invalid open');
    } else if (!isValidPrice(close)) {
      skipReasons.add('missing or invalid close');
    } else {
      intradayReturn = (close - open) / open;
      intradayFixedPnl = fixedAmount * intradayReturn;
      intradayFixedTotalPnl += intradayFixedPnl;

      const priorEquity = intradayEquity;
      intradayEquity = intradayEquity * (1 + intradayReturn);
      intradayCompEquity = intradayEquity;
      intradayCompPnl.push(intradayEquity - priorEquity);
      intradayEquityCurve.push({ date, equity: intradayEquity });
    }

    // Strat 2: overnight return (open - priorClose) / priorClose
    let overnightReturn: number | null = null;
    let overnightFixedPnl: number | null = null;
    let overnightCompEquity: number | null = null;

    if (i === 0) {
      skipReasons.add('no prior close for first day');
    } else if (!isValidPrice(priorClose)) {
      skipReasons.add('missing or invalid prior close');
    } else if (!isValidPrice(open)) {
      skipReasons.add('missing or invalid open');
    } else {
      overnightReturn = (open - priorClose) / priorClose;
      overnightFixedPnl = fixedAmount * overnightReturn;
      overnightFixedTotalPnl += overnightFixedPnl;

      const priorEquity = overnightEquity;
      overnightEquity = overnightEquity * (1 + overnightReturn);
      overnightCompEquity = overnightEquity;
      overnightCompPnl.push(overnightEquity - priorEquity);
      overnightEquityCurve.push({ date, equity: overnightEquity });
    }

    const skipped = intradayReturn === null || overnightReturn === null;
    if (skipped) {
      skippedCount++;
    }

    dailyRecords.push({
      date,
      open: isValidPrice(open) ? open : null,
      close: isValidPrice(close) ? close : null,
      priorClose: isValidPrice(priorClose) ? priorClose : null,
      intradayReturn,
      overnightReturn,
      intradayFixedPnl,
      overnightFixedPnl,
      intradayCompoundedEquity: intradayCompEquity,
      overnightCompoundedEquity: overnightCompEquity,
      skipped,
      skipReason: skipReasons.size > 0 ? [...skipReasons].join('; ') : undefined,
    });
  }

  const intradayMetrics = computeDailyReturnMetrics(intradayCompPnl, intradayEquityCurve, initialEquity);
  const overnightMetrics = computeDailyReturnMetrics(overnightCompPnl, overnightEquityCurve, initialEquity);

  return {
    symbol,
    dateRange: {
      first: bars.length > 0 ? getBarDate(bars[0]) : '',
      last: bars.length > 0 ? getBarDate(bars[bars.length - 1]) : '',
    },
    barCount: bars.length,
    skippedCount,
    dailyRecords,
    intradayMetrics,
    overnightMetrics,
    intradayFixedTotalPnl,
    overnightFixedTotalPnl,
    intradayCompoundedFinalEquity: intradayEquity,
    overnightCompoundedFinalEquity: overnightEquity,
  };
}
