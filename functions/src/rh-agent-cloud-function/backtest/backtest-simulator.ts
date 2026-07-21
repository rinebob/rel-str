/**
 * Backtest simulator core.
 *
 * Replays daily bars, evaluates the strategy each day, fetches historical option
 * chains on demand, enters/exits positions, and emits an equity curve and trade
 * list. Multi-leg spreads are treated as a single trade with simultaneous entry
 * and exit for all legs.
 */

import { logger } from 'firebase-functions/v2';

import type { StrategyAdapter, StrategyConfig, StrategyInput, StrategyOutput, StrategyOutputMetadata, ExitConfig, OHLCV, UnderlyingPositionSelection } from '../strategies/base-strategy';
import type { HistoricalOptionContract } from '../../types/partner';
import { selectOptionContract, selectOptionSpread, daysBetween } from '../strategies/option-contract-selection';
import type { OptionSpreadLegSelection } from '../strategies/option-contract-selection';
import type { OptionsChainCache } from './backtest-data-loader';
import { computeMetrics } from './backtest-metrics';
import type { BacktestEquityPoint, BacktestTrade, BacktestTradeLeg, BacktestMetrics } from './backtest-types';
import { BacktestExitReason } from './backtest-types';

interface BasePositionLeg {
  side: 'long' | 'short';
  quantity: number;
  /** Option multiplier. 100 for standard options, 1 for underlying shares. */
  multiplier: number;
  entryMark: number;
  lastMark: number;
}

interface OptionPositionLeg extends BasePositionLeg {
  kind: 'option';
  contract: HistoricalOptionContract;
}

interface UnderlyingPositionLeg extends BasePositionLeg {
  kind: 'underlying';
}

type PositionLeg = OptionPositionLeg | UnderlyingPositionLeg;

interface OpenPosition {
  id: number;
  entryDate: string;
  entryUnderlying: number;
  legs: PositionLeg[];
  entryValue: number;
  daysHeld: number;
  /** Highest pnlPct observed for this position; used for trailing stop. */
  maxPnlPct: number;
  targetGainPct?: number;
  stopLossPct: number;
  trailingStopPct?: number;
  maxHoldDays: number;
  notes: string[];
}


function sideMultiplier(side: 'long' | 'short'): number {
  return side === 'long' ? 1 : -1;
}

/** Compute the signed entry value for a set of legs (cash flow sign is the opposite). */
function entryValueOfLegs(legs: PositionLeg[]): number {
  return legs.reduce(
    (sum, leg) => sum + sideMultiplier(leg.side) * leg.entryMark * leg.multiplier * leg.quantity,
    0,
  );
}

function marketValue(legs: PositionLeg[], marks: Map<number, number>): number | null {
  let value = 0;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const mark = marks.get(i);
    if (mark === undefined) return null;
    value += sideMultiplier(leg.side) * mark * leg.multiplier * leg.quantity;
  }
  return value;
}

/** Return the mark for a single leg on the current day, or undefined if no mark is available. */
function getLegMark(leg: PositionLeg, today: OHLCV, chain: HistoricalOptionContract[]): number | undefined {
  if (leg.kind === 'underlying') {
    return Number.isFinite(today.close) ? (today.close as number) : undefined;
  }
  return findMarkForContract(leg.contract, chain);
}

function findMarkForContract(
  contract: HistoricalOptionContract,
  chain: HistoricalOptionContract[],
): number | undefined {
  if (contract.contractID) {
    const byId = chain.find((c) => c.contractID === contract.contractID);
    if (byId?.mark) {
      const n = Number(byId.mark);
      return Number.isNaN(n) ? undefined : n;
    }
  }
  // Fallback: match by type + expiration + strike if contractId is missing.
  const match = chain.find(
    (c) =>
      c.type === contract.type &&
      c.expiration === contract.expiration &&
      c.strike === contract.strike,
  );
  if (match?.mark) {
    const n = Number(match.mark);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

export interface BacktestSimulationResult {
  metrics: BacktestMetrics;
  equityCurve: BacktestEquityPoint[];
  trades: BacktestTrade[];
  finalEquity: number;
  finalCash: number;
  notes: string[];
}

/**
 * Run a backtest over all available daily bars for a single symbol+strategy+param set.
 */
export async function runBacktestSimulation(
  symbol: string,
  strategy: StrategyAdapter,
  config: StrategyConfig,
  dailyBars: OHLCV[],
  optionsCache: OptionsChainCache,
  initialCash: number,
  weeklyBars: OHLCV[] = [],
  monthlyBars: OHLCV[] = [],
): Promise<BacktestSimulationResult> {
  logger.info('backtest_simulator_start', { symbol, strategy: strategy.metadata.id, bars: dailyBars.length, initialCash });

  const notes: string[] = [];
  const openPositions: OpenPosition[] = [];
  const closedTrades: BacktestTrade[] = [];
  const equityCurve: BacktestEquityPoint[] = [];

  let cash = initialCash;
  let tradeSequence = 0;

  const maxConcurrentPositions = Math.max(0, Number(config.maxConcurrentPositions ?? 0));

  const minBars = Math.max(2, strategy.metadata.minBarsRequired ?? 2);
  if (dailyBars.length < minBars) {
    const msg = `Insufficient bars: ${dailyBars.length} < ${minBars}`;
    notes.push(msg);
    return emptyResult(initialCash, notes);
  }

  for (let i = minBars - 1; i < dailyBars.length; i++) {
    const today = dailyBars[i];
    const todayStr = today.date as string;
    const barsUpToToday = dailyBars.slice(0, i + 1);

    const strategyInput: StrategyInput = {
      symbol,
      marketDate: todayStr,
      bars: barsUpToToday,
      weeklyBars,
      monthlyBars,
    };

    let outputs: StrategyOutput[];
    try {
      const raw = strategy.execute(strategyInput, config);
      outputs = Array.isArray(raw) ? raw : [raw];
    } catch (error: unknown) {
      notes.push(`Strategy execution failed on ${todayStr}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const hasOpenOptionPositions = openPositions.some((p) => p.legs.some((l) => l.kind === 'option'));
    const hasOptionEntrySignal = outputs.some(
      (o) => o.action && Array.isArray(o.metadata?.optionLegs) && o.metadata.optionLegs.length > 0,
    );
    // Only fetch the option chain if an option position needs marking or an option entry may fire.
    const needsOptionChain = hasOpenOptionPositions || hasOptionEntrySignal;
    const chain = needsOptionChain ? await optionsCache.getChain(todayStr) : [];

    // 1. Evaluate open positions first (exit at today's close).
    const stillOpen: OpenPosition[] = [];
    for (const position of openPositions) {
      const exitResult = evaluateExit(position, today, chain);
      if (exitResult.exit) {
        const closed = await closePosition(
          symbol,
          strategy.metadata.id,
          config,
          position,
          today,
          exitResult.reason ?? BacktestExitReason.MISSING_DATA,
          exitResult.marks,
          chain,
        );
        cash += closed.cashFlow;
        closedTrades.push(closed.trade);
      } else {
        // Update lastMark for each leg from today's chain or underlying close.
        for (let li = 0; li < position.legs.length; li++) {
          const leg = position.legs[li];
          const currentMark = getLegMark(leg, today, chain);
          if (currentMark !== undefined) {
            leg.lastMark = currentMark;
          }
        }
        stillOpen.push(position);
      }
    }
    openPositions.length = 0;
    openPositions.push(...stillOpen);

    // 2. Evaluate new entries at today's close.
    for (const output of outputs) {
      if (!output.action) continue;

      const canEnter = maxConcurrentPositions === 0 || openPositions.length < maxConcurrentPositions;
      if (!canEnter) {
        notes.push(`Max concurrent positions reached on ${todayStr}; skipped ${output.signalType}`);
        continue;
      }

      const entry = await tryEnterPosition(
        symbol,
        strategy.metadata.id,
        output,
        config,
        today,
        chain,
        tradeSequence,
        notes,
      );
      if (entry) {
        tradeSequence++;
        cash += entry.cashFlow;
        openPositions.push(entry.position);
      }
    }

    // 3. Record equity curve point for today.
    const todaysPositionValue = computeOpenPositionValue(openPositions, chain, today, notes);
    const equity = cash + todaysPositionValue;
    equityCurve.push({
      date: todayStr,
      cash,
      equity,
      openPositions: openPositions.length,
    });

    // Periodically log progress.
    if ((i + 1) % 100 === 0 || i === dailyBars.length - 1) {
      logger.info('backtest_simulator_progress', {
        symbol,
        strategy: strategy.metadata.id,
        date: todayStr,
        progress: `${i + 1}/${dailyBars.length}`,
        openPositions: openPositions.length,
        closedTrades: closedTrades.length,
        equity,
      });
    }
  }

  // Close any remaining open positions at the last available mark.
  const lastBar = dailyBars[dailyBars.length - 1];
  if (lastBar && openPositions.length > 0) {
    const lastChainNeedsOptions = openPositions.some((p) => p.legs.some((l) => l.kind === 'option'));
    const lastChain = lastChainNeedsOptions ? await optionsCache.getChain(lastBar.date as string) : [];
    const remaining = openPositions.splice(0, openPositions.length);
    for (const position of remaining) {
      const closed = await closePosition(
        symbol,
        strategy.metadata.id,
        config,
        position,
        lastBar,
        BacktestExitReason.END_OF_DATA,
        undefined,
        lastChain,
      );
      cash += closed.cashFlow;
      closedTrades.push(closed.trade);
    }
  }

  const finalEquity = cash;
  const metrics = computeMetrics(initialCash, equityCurve, closedTrades);

  logger.info('backtest_simulator_complete', {
    symbol,
    strategy: strategy.metadata.id,
    trades: closedTrades.length,
    finalEquity,
    maxDrawdown: metrics.maxDrawdown,
    calmarRatio: metrics.calmarRatio,
    fetchedDates: optionsCache.fetchedDates,
  });

  return {
    metrics,
    equityCurve,
    trades: closedTrades,
    finalEquity,
    finalCash: cash,
    notes,
  };
}

function emptyResult(initialCash: number, notes: string[]): BacktestSimulationResult {
  return {
    metrics: {
      totalNetProfit: 0,
      grossProfit: 0,
      grossLoss: 0,
      profitFactor: 0,
      percentProfitable: 0,
      winLossRatio: 0,
      averageTrade: 0,
      averageWin: 0,
      averageLoss: 0,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      sharpeRatio: 0,
      calmarRatio: 0,
      tradeCount: 0,
      winCount: 0,
      lossCount: 0,
    },
    equityCurve: [{ date: '', cash: initialCash, equity: initialCash, openPositions: 0 }],
    trades: [],
    finalEquity: initialCash,
    finalCash: initialCash,
    notes,
  };
}

interface ExitEvaluation {
  exit: boolean;
  reason?: BacktestExitReason;
  marks?: Map<number, number>;
}

function evaluateExit(
  position: OpenPosition,
  today: OHLCV,
  chain: HistoricalOptionContract[],
): ExitEvaluation {
  const daysHeld = daysBetween(position.entryDate, today.date as string) ?? NaN;
  if (!Number.isNaN(daysHeld) && daysHeld >= 0) {
    position.daysHeld = daysHeld;
  }

  const marks = new Map<number, number>();
  for (let i = 0; i < position.legs.length; i++) {
    const leg = position.legs[i];
    const mark = getLegMark(leg, today, chain);
    if (mark === undefined) {
      // If max hold reached, force close using the last known mark.
      if (position.maxHoldDays > 0 && position.daysHeld >= position.maxHoldDays && Number.isFinite(leg.lastMark)) {
        marks.set(i, leg.lastMark);
        continue;
      }
      return { exit: false };
    }
    marks.set(i, mark);
  }

  const currentValue = marketValue(position.legs, marks);
  if (currentValue === null) return { exit: false };

  // Percent profit/loss relative to net entry value (works for long, short, and spreads).
  const pnlPct = position.entryValue === 0 ? 0 : (currentValue - position.entryValue) / Math.abs(position.entryValue);

  // Update running high watermark for trailing stop.
  position.maxPnlPct = Math.max(position.maxPnlPct, pnlPct);

  if (position.targetGainPct !== undefined && pnlPct >= position.targetGainPct) {
    return { exit: true, reason: BacktestExitReason.TARGET_GAIN, marks };
  }
  if (
    position.trailingStopPct !== undefined &&
    position.trailingStopPct > 0 &&
    position.maxPnlPct > 0 &&
    pnlPct <= position.maxPnlPct - position.trailingStopPct
  ) {
    return { exit: true, reason: BacktestExitReason.TRAILING_STOP, marks };
  }
  if (position.stopLossPct > 0 && pnlPct <= -position.stopLossPct) {
    return { exit: true, reason: BacktestExitReason.STOP_LOSS, marks };
  }
  if (position.maxHoldDays > 0 && position.daysHeld >= position.maxHoldDays) {
    return { exit: true, reason: BacktestExitReason.MAX_HOLD_DAYS, marks };
  }

  return { exit: false };
}

interface PositionEntry {
  position: OpenPosition;
  cashFlow: number;
}

function buildUnderlyingLegs(
  today: OHLCV,
  underlying: UnderlyingPositionSelection,
  notes: string[],
): UnderlyingPositionLeg[] | null {
  if (!Number.isFinite(today.close) || (today.close as number) <= 0) {
    notes.push(`No valid close price on ${today.date as string} for underlying entry`);
    return null;
  }
  const close = today.close as number;
  const side = underlying.side ?? 'long';
  const quantity = underlying.quantity ?? 1;
  return [{ kind: 'underlying', side, quantity, multiplier: 1, entryMark: close, lastMark: close }];
}

function buildOptionLegs(
  marketDate: string,
  chain: HistoricalOptionContract[],
  optionLegs: OptionSpreadLegSelection[],
  signalType: string,
  notes: string[],
): OptionPositionLeg[] | null {
  const spreadLegs: OptionSpreadLegSelection[] = optionLegs.map((l) => ({
    side: l.side ?? 'long',
    quantity: l.quantity ?? 1,
    criteria: l.criteria,
  }));

  const legs: OptionPositionLeg[] = [];

  if (spreadLegs.length === 1) {
    const result = selectOptionContract(marketDate, chain, spreadLegs[0].criteria);
    if (!result || result.mark === undefined) {
      notes.push(`Could not select option contract on ${marketDate} for ${signalType}`);
      return null;
    }
    const side = spreadLegs[0].side;
    const quantity = spreadLegs[0].quantity ?? 1;
    legs.push({
      kind: 'option',
      contract: result.contract,
      side,
      quantity,
      multiplier: 100,
      entryMark: result.mark,
      lastMark: result.mark,
    });
  } else {
    const result = selectOptionSpread(marketDate, chain, spreadLegs);
    if (!result) {
      notes.push(`Could not select spread on ${marketDate} for ${signalType}`);
      return null;
    }
    for (let i = 0; i < result.length; i++) {
      const r = result[i];
      if (r.mark === undefined) {
        notes.push(`Selected contract(s) had no usable mark on ${marketDate}`);
        return null;
      }
      legs.push({
        kind: 'option',
        contract: r.contract,
        side: r.side,
        quantity: r.quantity,
        multiplier: 100,
        entryMark: r.mark,
        lastMark: r.mark,
      });
    }
  }

  return legs;
}

async function tryEnterPosition(
  symbol: string,
  strategyId: string,
  output: StrategyOutput,
  config: StrategyConfig,
  today: OHLCV,
  chain: HistoricalOptionContract[],
  tradeId: number,
  notes: string[],
): Promise<PositionEntry | null> {
  const todayStr = today.date as string;
  const meta: StrategyOutputMetadata = output.metadata ?? {};
  const optionLegs = meta.optionLegs;
  const underlying = meta.underlyingPosition;

  if (!underlying && (!Array.isArray(optionLegs) || optionLegs.length === 0)) {
    notes.push(`Signal on ${todayStr} has no optionLegs or underlyingPosition metadata`);
    return null;
  }

  let legs: PositionLeg[] | null = null;
  if (underlying) {
    legs = buildUnderlyingLegs(today, underlying, notes);
  } else if (Array.isArray(optionLegs)) {
    legs = buildOptionLegs(todayStr, chain, optionLegs, output.signalType, notes);
  }

  if (!legs || legs.length === 0) return null;

  const entryValue = entryValueOfLegs(legs);
  const cashFlow = -entryValue;

  const exitConfig: ExitConfig = meta.exit ?? (config as ExitConfig);
  const targetGainPctRaw = exitConfig?.targetGainPct;
  const trailingStopPctRaw = exitConfig?.trailingStopPct;

  const stopLossPctRaw = exitConfig?.stopLossPct;
  const maxHoldDaysRaw = exitConfig?.maxHoldDays;

  const position: OpenPosition = {
    id: tradeId,
    entryDate: todayStr,
    entryUnderlying: Number.isFinite(today.close) ? (today.close as number) : 0,
    legs,
    entryValue,
    daysHeld: 0,
    maxPnlPct: 0,
    targetGainPct: Number.isFinite(Number(targetGainPctRaw)) ? Number(targetGainPctRaw) : undefined,
    stopLossPct: Number.isFinite(Number(stopLossPctRaw)) ? Number(stopLossPctRaw) : 0,
    trailingStopPct: Number.isFinite(Number(trailingStopPctRaw)) ? Number(trailingStopPctRaw) : undefined,
    maxHoldDays: Number.isFinite(Number(maxHoldDaysRaw)) ? Number(maxHoldDaysRaw) : 0,
    notes: [],
  };

  return { position, cashFlow };
}

interface CloseResult {
  trade: BacktestTrade;
  cashFlow: number;
}

function closePosition(
  symbol: string,
  strategyId: string,
  config: StrategyConfig,
  position: OpenPosition,
  today: OHLCV,
  reason: BacktestExitReason,
  marks: Map<number, number> | undefined,
  chain: HistoricalOptionContract[],
): CloseResult {
  const todayStr = today.date as string;

  const finalMarks = new Map<number, number>();
  for (let i = 0; i < position.legs.length; i++) {
    const leg = position.legs[i];
    let mark = marks?.get(i);
    if (mark === undefined) {
      mark = getLegMark(leg, today, chain);
    }
    if (mark === undefined) {
      mark = Number.isFinite(leg.lastMark) ? leg.lastMark : leg.entryMark;
      position.notes.push(`Used last known mark (${mark.toFixed(2)}) for exit on ${todayStr}`);
    }
    finalMarks.set(i, mark);
  }

  let pnl = 0;
  let cashFlow = 0;
  const tradeLegs: BacktestTradeLeg[] = [];

  for (let i = 0; i < position.legs.length; i++) {
    const leg = position.legs[i];
    const mark = finalMarks.get(i) ?? leg.lastMark;
    const legPnl = sideMultiplier(leg.side) * (mark - leg.entryMark) * leg.multiplier * leg.quantity;
    pnl += legPnl;
    cashFlow += sideMultiplier(leg.side) * mark * leg.multiplier * leg.quantity;

    tradeLegs.push({
      kind: leg.kind,
      side: leg.side,
      quantity: leg.quantity,
      multiplier: leg.multiplier,
      entryMark: leg.entryMark,
      exitMark: mark,
      optionType: leg.kind === 'option' ? leg.contract.type : undefined,
      strike: leg.kind === 'option' ? leg.contract.strike : undefined,
      expiration: leg.kind === 'option' ? leg.contract.expiration : undefined,
      contractId: leg.kind === 'option' ? leg.contract.contractID : undefined,
      pnl: legPnl,
    });
  }

  const firstLeg = tradeLegs[0];
  const returnPct = position.entryValue === 0 ? 0 : pnl / Math.abs(position.entryValue);
  const daysHeld = daysBetween(position.entryDate, todayStr) ?? NaN;

  const trade: BacktestTrade = {
    entryDate: position.entryDate,
    exitDate: todayStr,
    symbol,
    strategyId,
    config,
    entryUnderlying: position.entryUnderlying,
    exitUnderlying: Number.isFinite(today.close) ? (today.close as number) : 0,
    entryMark: firstLeg.entryMark,
    exitMark: firstLeg.exitMark,
    quantity: firstLeg.quantity,
    side: firstLeg.side,
    optionType: firstLeg.optionType,
    strike: firstLeg.strike,
    expiration: firstLeg.expiration,
    contractId: firstLeg.contractId,
    isUnderlying: firstLeg.kind === 'underlying',
    pnl,
    returnPct,
    exitReason: reason,
    daysHeld: Number.isNaN(daysHeld) ? 0 : daysHeld,
    notes: position.notes.length > 0 ? position.notes : undefined,
    legs: tradeLegs,
  };

  return { trade, cashFlow };
}

function computeOpenPositionValue(
  positions: OpenPosition[],
  chain: HistoricalOptionContract[],
  today: OHLCV,
  notes: string[],
): number {
  let value = 0;
  for (const position of positions) {
    const marks = new Map<number, number>();
    let complete = true;
    for (let i = 0; i < position.legs.length; i++) {
      const leg = position.legs[i];
      const mark = getLegMark(leg, today, chain);
      if (mark === undefined) {
        complete = false;
        break;
      }
      marks.set(i, mark);
    }
    const mv = complete ? marketValue(position.legs, marks) : null;
    if (mv === null) {
      notes.push(`Could not mark open position from ${position.entryDate} on ${today.date as string}`);
      continue;
    }
    value += mv;
  }
  return value;
}
