/**
 * Backtest Firestore converter.
 *
 * Pure helper that converts Firestore `DocumentData` snapshots into the
 * UI-facing `BacktestRunUi` and `BacktestPermutationUi` shapes.
 */

import type { BacktestEquityPoint, BacktestPermutationUi, BacktestPricePointUi, BacktestRunUi, BacktestTradeUi, BacktestTradeLegUi } from '../common/backtest.types';

type TimestampLike = { toDate: () => Date } | Date | string | number | undefined;

function toIso(ts: TimestampLike): string | undefined {
  if (!ts) return undefined;
  if (typeof ts === 'object' && 'toDate' in ts && typeof ts.toDate === 'function') {
    return ts.toDate().toISOString();
  }
  if (ts instanceof Date) return ts.toISOString();
  if (typeof ts === 'string') return ts;
  if (typeof ts === 'number') return new Date(ts).toISOString();
  return undefined;
}

export function convertBacktestRunDoc(id: string, data: Record<string, unknown>): BacktestRunUi {
  return {
    runId: id,
    status: String(data['status'] ?? 'pending') as BacktestRunUi['status'],
    symbols: Array.isArray(data['symbols']) ? data['symbols'].map((s) => String(s).toUpperCase()) : [],
    strategyId: String(data['strategyId'] ?? ''),
    runType: (data['runType'] as BacktestRunUi['runType']) ?? 'allData',
    initialCash: Number(data['initialCash'] ?? 0),
    reportTier: (data['reportTier'] as BacktestRunUi['reportTier']) ?? 'summary',
    totalPermutations: Number(data['totalPermutations'] ?? 0),
    completedPermutations: Number(data['completedPermutations'] ?? 0),
    failedPermutations: Number(data['failedPermutations'] ?? 0),
    config: (data['config'] as Record<string, unknown>) ?? undefined,
    qualityDesignation: data['qualityDesignation'] ? String(data['qualityDesignation']) : undefined,
    archived: data['archived'] === true,
    createdAtIso: toIso(data['createdAt'] as TimestampLike) ?? '',
    updatedAtIso: toIso(data['updatedAt'] as TimestampLike),
    startedAtIso: toIso(data['startedAt'] as TimestampLike),
    completedAtIso: toIso(data['completedAt'] as TimestampLike),
    error: data['error'] ? String(data['error']) : undefined,
  };
}

export function convertBacktestPermutationDoc(id: string, data: Record<string, unknown>): BacktestPermutationUi {
  return {
    permutationId: id,
    runId: String(data['runId'] ?? ''),
    symbol: String(data['symbol'] ?? ''),
    strategyId: String(data['strategyId'] ?? ''),
    config: (data['config'] as Record<string, unknown>) ?? {},
    status: String(data['status'] ?? 'pending') as BacktestPermutationUi['status'],
    runType: (data['runType'] as BacktestPermutationUi['runType']) ?? 'allData',
    initialCash: Number(data['initialCash'] ?? 0),
    finalEquity: Number(data['finalEquity'] ?? 0),
    totalReturnPct: Number(data['totalReturnPct'] ?? 0),
    metrics: (data['metrics'] as BacktestPermutationUi['metrics']) ?? {
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
    equityCurve: Array.isArray(data['equityCurve']) ? data['equityCurve'].map(convertBacktestEquityPoint) : [],
    tradeCount: Number(data['tradeCount'] ?? 0),
    reportTier: (data['reportTier'] as BacktestPermutationUi['reportTier']) ?? 'summary',
    notes: Array.isArray(data['notes']) ? data['notes'].map((n) => String(n)) : undefined,
    error: data['error'] ? String(data['error']) : undefined,
    startedAtIso: toIso(data['startedAt'] as TimestampLike),
    completedAtIso: toIso(data['completedAt'] as TimestampLike),
    trades: Array.isArray(data['trades']) ? data['trades'].map(convertBacktestTrade) : undefined,
    underlyingBars: Array.isArray(data['underlyingBars']) ? data['underlyingBars'].map(convertBacktestPricePoint) : undefined,
  };
}

function convertBacktestEquityPoint(data: unknown): BacktestEquityPoint {
  const p = (data ?? {}) as Record<string, unknown>;
  return {
    date: toIso(p['date'] as TimestampLike) ?? '',
    cash: Number(p['cash'] ?? 0),
    equity: Number(p['equity'] ?? 0),
    openPositions: Number(p['openPositions'] ?? 0),
  };
}

function convertBacktestPricePoint(data: unknown): BacktestPricePointUi {
  const p = (data ?? {}) as Record<string, unknown>;
  return {
    date: toIso(p['date'] as TimestampLike) ?? '',
    close: Number(p['close'] ?? 0),
  };
}

function convertBacktestTrade(data: unknown): BacktestTradeUi {
  const t = (data ?? {}) as Record<string, unknown>;
  return {
    entryDate: toIso(t['entryDate'] as TimestampLike) ?? '',
    exitDate: toIso(t['exitDate'] as TimestampLike) ?? '',
    symbol: String(t['symbol'] ?? ''),
    side: (t['side'] as BacktestTradeUi['side']) ?? 'long',
    quantity: Number(t['quantity'] ?? 0),
    entryUnderlying: Number(t['entryUnderlying'] ?? 0),
    exitUnderlying: Number(t['exitUnderlying'] ?? 0),
    entryMark: Number(t['entryMark'] ?? 0),
    exitMark: Number(t['exitMark'] ?? 0),
    pnl: Number(t['pnl'] ?? 0),
    returnPct: Number(t['returnPct'] ?? 0),
    exitReason: String(t['exitReason'] ?? ''),
    daysHeld: Number(t['daysHeld'] ?? 0),
    isUnderlying: t['isUnderlying'] === true,
    optionType: t['optionType'] ? String(t['optionType']) : undefined,
    strike: t['strike'] ? String(t['strike']) : undefined,
    expiration: t['expiration'] ? String(t['expiration']) : undefined,
    contractId: t['contractId'] ? String(t['contractId']) : undefined,
    legs: Array.isArray(t['legs']) ? t['legs'].map(convertBacktestTradeLeg) : undefined,
    notes: Array.isArray(t['notes']) ? t['notes'].map((n) => String(n)) : undefined,
  };
}

function convertBacktestTradeLeg(data: unknown): BacktestTradeLegUi {
  const l = (data ?? {}) as Record<string, unknown>;
  return {
    kind: (l['kind'] as BacktestTradeLegUi['kind']) ?? 'option',
    side: (l['side'] as BacktestTradeLegUi['side']) ?? 'long',
    quantity: Number(l['quantity'] ?? 0),
    multiplier: Number(l['multiplier'] ?? 1),
    entryMark: Number(l['entryMark'] ?? 0),
    exitMark: Number(l['exitMark'] ?? 0),
    pnl: Number(l['pnl'] ?? 0),
    optionType: l['optionType'] ? String(l['optionType']) : undefined,
    strike: l['strike'] ? String(l['strike']) : undefined,
    expiration: l['expiration'] ? String(l['expiration']) : undefined,
    contractId: l['contractId'] ? String(l['contractId']) : undefined,
  };
}
