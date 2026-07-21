/**
 * Backtest simulator core.
 *
 * Replays daily bars, evaluates the strategy each day, fetches historical option
 * chains on demand, enters/exits positions, and emits an equity curve and trade
 * list. Multi-leg spreads are treated as a single trade with simultaneous entry
 * and exit for all legs.
 */

import { logger } from 'firebase-functions/v2';

import type { StrategyAdapter, StrategyConfig, StrategyInput, StrategyOutput, OHLCV } from '../strategies/base-strategy';
import type { HistoricalOptionContract, OptionType } from '../../types/partner';
import { selectOptionContract, selectOptionSpread } from '../strategies/option-contract-selection';
import type { OptionSpreadLegSelection } from '../strategies/option-contract-selection';
import type { OptionsChainCache } from './backtest-data-loader';
import { computeMetrics } from './backtest-metrics';
import type { BacktestEquityPoint, BacktestTrade, BacktestMetrics } from './backtest-types';

interface PositionLeg {
  contract: HistoricalOptionContract;
  contractId?: string;
  optionType: OptionType;
  strike?: string;
  expiration?: string;
  side: 'long' | 'short';
  quantity: number;
  entryMark: number;
  lastMark: number;
}

interface OpenPosition {
  id: number;
  entryDate: string;
  entryUnderlying: number;
  legs: PositionLeg[];
  entryValue: number;
  daysHeld: number;
  targetGainPct: number;
  stopLossPct: number;
  maxHoldDays: number;
  notes: string[];
}

interface EntryMetadata {
  optionLegs?: OptionSpreadLegSelection[];
  exit?: Partial<StrategyConfig>;
}

function calendarDaysBetween(fromDate: string, toDate: string): number {
  const [y1, m1, d1] = fromDate.split('-').map(Number);
  const [y2, m2, d2] = toDate.split('-').map(Number);
  if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return NaN;
  const from = Date.UTC(y1, m1 - 1, d1);
  const to = Date.UTC(y2, m2 - 1, d2);
  if (Number.isNaN(from) || Number.isNaN(to)) return NaN;
  return Math.round((to - from) / 86_400_000);
}

function sideMultiplier(side: 'long' | 'short'): number {
  return side === 'long' ? 1 : -1;
}

function marketValue(legs: PositionLeg[], marks: Map<number, number>): number | null {
  let value = 0;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const mark = marks.get(i);
    if (mark === undefined) return null;
    value += sideMultiplier(leg.side) * mark * 100 * leg.quantity;
  }
  return value;
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
    };

    let outputs: StrategyOutput[];
    try {
      const raw = strategy.execute(strategyInput, config);
      outputs = Array.isArray(raw) ? raw : [raw];
    } catch (error: unknown) {
      notes.push(`Strategy execution failed on ${todayStr}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    // Fetch today's option chain once for exits and possible entry.
    const chain = await optionsCache.getChain(todayStr);

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
          exitResult.reason ?? 'missingData',
          exitResult.marks,
          chain,
        );
        cash += closed.cashFlow;
        closedTrades.push(closed.trade);
      } else {
        // Update lastMark for each leg from today's chain.
        for (let li = 0; li < position.legs.length; li++) {
          const leg = position.legs[li];
          const currentMark = findMarkForContract(chain, leg.contractId, leg.optionType, leg.expiration, leg.strike);
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
        cash -= entry.cashOutflow;
        openPositions.push(entry.position);
      }
    }

    // 3. Record equity curve point for today.
    const todaysPositionValue = computeOpenPositionValue(openPositions, chain, notes);
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
    const lastChain = await optionsCache.getChain(lastBar.date as string);
    const remaining = openPositions.splice(0, openPositions.length);
    for (const position of remaining) {
      const closed = await closePosition(
        symbol,
        strategy.metadata.id,
        config,
        position,
        lastBar,
        'endOfData',
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

type CloseReason = 'targetGain' | 'stopLoss' | 'maxHoldDays' | 'missingData' | 'endOfData';

interface ExitEvaluation {
  exit: boolean;
  reason?: CloseReason;
  marks?: Map<number, number>;
}

function evaluateExit(
  position: OpenPosition,
  today: OHLCV,
  chain: HistoricalOptionContract[],
): ExitEvaluation {
  const daysHeld = calendarDaysBetween(position.entryDate, today.date as string);
  if (!Number.isNaN(daysHeld) && daysHeld >= 0) {
    position.daysHeld = daysHeld;
  }

  const marks = new Map<number, number>();
  for (let i = 0; i < position.legs.length; i++) {
    const leg = position.legs[i];
    const mark = findMarkForContract(chain, leg.contractId, leg.optionType, leg.expiration, leg.strike);
    if (mark === undefined) {
      // If max hold reached, force close using the last known mark.
      if (position.daysHeld >= position.maxHoldDays && Number.isFinite(leg.lastMark)) {
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

  if (pnlPct >= position.targetGainPct) {
    return { exit: true, reason: 'targetGain', marks };
  }
  if (pnlPct <= -position.stopLossPct) {
    return { exit: true, reason: 'stopLoss', marks };
  }
  if (position.daysHeld >= position.maxHoldDays) {
    return { exit: true, reason: 'maxHoldDays', marks };
  }

  return { exit: false };
}

function findMarkForContract(
  chain: HistoricalOptionContract[],
  contractId?: string,
  optionType?: OptionType,
  expiration?: string,
  strike?: string,
): number | undefined {
  if (contractId) {
    const byId = chain.find((c) => c.contractID === contractId);
    if (byId?.mark) {
      const n = Number(byId.mark);
      return Number.isNaN(n) ? undefined : n;
    }
  }
  // Fallback: match by type + expiration + strike if contractId is missing.
  const match = chain.find(
    (c) =>
      c.type === optionType &&
      c.expiration === expiration &&
      c.strike === strike,
  );
  if (match?.mark) {
    const n = Number(match.mark);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

interface PositionEntry {
  position: OpenPosition;
  cashOutflow: number;
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
  const meta = (output.metadata as EntryMetadata | undefined) ?? {};
  const optionLegs = meta.optionLegs;
  if (!Array.isArray(optionLegs) || optionLegs.length === 0) {
    notes.push(`Signal on ${todayStr} has no optionLegs metadata`);
    return null;
  }

  let selectedLegs: { contract: HistoricalOptionContract; dte: number; mark?: number; side: 'long' | 'short'; quantity: number }[] | null = null;

  if (optionLegs.length === 1) {
    const leg = optionLegs[0];
    const selected = selectOptionContract(todayStr, chain, leg.criteria);
    if (!selected || selected.mark === undefined) {
      notes.push(`Could not select option contract on ${todayStr} for ${output.signalType}`);
      return null;
    }
    selectedLegs = [{
      contract: selected.contract,
      dte: selected.dte,
      mark: selected.mark,
      side: leg.side ?? 'long',
      quantity: leg.quantity ?? 1,
    }];
  } else {
    const spreadLegs: OptionSpreadLegSelection[] = optionLegs.map((l) => ({
      side: l.side ?? 'long',
      quantity: l.quantity ?? 1,
      criteria: l.criteria,
    }));
    const result = selectOptionSpread(todayStr, chain, spreadLegs);
    if (!result) {
      notes.push(`Could not select spread on ${todayStr} for ${output.signalType}`);
      return null;
    }
    selectedLegs = result.map((r, i) => ({
      contract: r.contract,
      dte: r.dte,
      mark: r.mark,
      side: spreadLegs[i].side,
      quantity: spreadLegs[i].quantity ?? 1,
    }));
  }

  const positionLegs: PositionLeg[] = [];
  let cashOutflow = 0;
  for (const selected of selectedLegs) {
    if (selected.mark === undefined) continue;
    const legEntryValue = sideMultiplier(selected.side) * selected.mark * 100 * selected.quantity;
    positionLegs.push({
      contract: selected.contract,
      contractId: selected.contract.contractID,
      optionType: selected.contract.type as OptionType,
      strike: selected.contract.strike,
      expiration: selected.contract.expiration,
      side: selected.side,
      quantity: selected.quantity,
      entryMark: selected.mark,
      lastMark: selected.mark,
    });
    cashOutflow += -legEntryValue; // cash change on entry (long = outflow, short = inflow)
  }

  if (positionLegs.length === 0) {
    notes.push(`Selected contract(s) had no usable mark on ${todayStr}`);
    return null;
  }

  const entryValue = positionLegs.reduce(
    (sum, leg) => sum + sideMultiplier(leg.side) * leg.entryMark * 100 * leg.quantity,
    0,
  );

  const exitConfig = meta.exit ?? config;

  const position: OpenPosition = {
    id: tradeId,
    entryDate: todayStr,
    entryUnderlying: today.close ?? 0,
    legs: positionLegs,
    entryValue,
    daysHeld: 0,
    targetGainPct: Number(exitConfig?.targetGainPct ?? 1.0),
    stopLossPct: Number(exitConfig?.stopLossPct ?? 0.5),
    maxHoldDays: Number(exitConfig?.maxHoldDays ?? 252),
    notes: [],
  };

  return { position, cashOutflow };
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
  reason: CloseReason,
  marks: Map<number, number> | undefined,
  chain: HistoricalOptionContract[],
): CloseResult {
  const todayStr = today.date as string;

  const finalMarks = new Map<number, number>();
  for (let i = 0; i < position.legs.length; i++) {
    const leg = position.legs[i];
    let mark = marks?.get(i);
    if (mark === undefined) {
      mark = findMarkForContract(chain, leg.contractId, leg.optionType, leg.expiration, leg.strike);
    }
    if (mark === undefined) {
      mark = Number.isFinite(leg.lastMark) ? leg.lastMark : leg.entryMark;
      position.notes.push(`Used last known mark (${mark.toFixed(2)}) for exit on ${todayStr}`);
    }
    finalMarks.set(i, mark);
  }

  let pnl = 0;
  let cashFlow = 0;
  const firstLeg = position.legs[0];
  const exitMark = finalMarks.get(0) ?? firstLeg.lastMark;

  for (let i = 0; i < position.legs.length; i++) {
    const leg = position.legs[i];
    const mark = finalMarks.get(i) ?? leg.lastMark;
    const legPnl = sideMultiplier(leg.side) * (mark - leg.entryMark) * 100 * leg.quantity;
    pnl += legPnl;
    cashFlow += sideMultiplier(leg.side) * mark * 100 * leg.quantity;
  }

  const entryMarkForPct = firstLeg?.entryMark ?? 0;
  const returnPct = entryMarkForPct === 0 ? 0 : (pnl / (entryMarkForPct * 100 * firstLeg.quantity));

  const daysHeld = calendarDaysBetween(position.entryDate, todayStr);

  const trade: BacktestTrade = {
    entryDate: position.entryDate,
    exitDate: todayStr,
    symbol,
    strategyId,
    config,
    entryUnderlying: position.entryUnderlying,
    exitUnderlying: today.close ?? 0,
    entryMark: firstLeg.entryMark,
    exitMark,
    quantity: firstLeg.quantity,
    side: firstLeg.side,
    optionType: firstLeg.optionType,
    strike: firstLeg.strike,
    expiration: firstLeg.expiration,
    contractId: firstLeg.contractId,
    pnl,
    returnPct,
    exitReason: reason,
    daysHeld: Number.isNaN(daysHeld) ? 0 : daysHeld,
    notes: position.notes.length > 0 ? position.notes : undefined,
  };

  return { trade, cashFlow };
}

function computeOpenPositionValue(
  positions: OpenPosition[],
  chain: HistoricalOptionContract[],
  notes: string[],
): number {
  let value = 0;
  for (const position of positions) {
    const marks = new Map<number, number>();
    let complete = true;
    for (let i = 0; i < position.legs.length; i++) {
      const leg = position.legs[i];
      const mark = findMarkForContract(chain, leg.contractId, leg.optionType, leg.expiration, leg.strike);
      if (mark === undefined) {
        complete = false;
        break;
      }
      marks.set(i, mark);
    }
    const mv = complete ? marketValue(position.legs, marks) : null;
    if (mv === null) {
      notes.push(`Could not mark open position from ${position.entryDate} on ${chain[0]?.date}`);
      continue;
    }
    value += mv;
  }
  return value;
}
