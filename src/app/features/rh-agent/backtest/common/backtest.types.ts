/**
 * Backtest UI types.
 *
 * UI-facing mirrors of the backend `backtest-runs` and `backtest-permutations`
 * collections. Stored in the `backtest/` sub-feature so the `rh-agent` root
 * does not accumulate new directories.
 */

export type BacktestRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type BacktestPermutationStatus = 'pending' | 'running' | 'success' | 'failed';
export type BacktestReportTier = 'summary' | 'full';
export type BacktestRunType = 'allData' | 'expandingWindow';

export type BacktestStatusFilter = 'all' | BacktestRunStatus;
export type BacktestDateFilter = 'all' | 'today' | '7d' | '30d';

// Phase 2 supports createdAt and status. Phase 3 will add aggregate-metric sorts:
// 'totalReturnPct' | 'calmarRatio' | 'tradeCount' once run aggregates are computed.
export type BacktestSortBy = 'createdAt' | 'status';
export type BacktestSortDirection = 'asc' | 'desc';

export interface BacktestRunUi {
  runId: string;
  status: BacktestRunStatus;
  symbols: string[];
  strategyId: string;
  runType: BacktestRunType;
  initialCash: number;
  reportTier: BacktestReportTier;
  totalPermutations: number;
  completedPermutations: number;
  failedPermutations: number;
  config?: Record<string, unknown>;
  qualityDesignation?: string;
  archived?: boolean;
  createdAtIso: string;
  updatedAtIso?: string;
  startedAtIso?: string;
  completedAtIso?: string;
  error?: string;
}

export interface BacktestPermutationUi {
  permutationId: string;
  runId: string;
  symbol: string;
  strategyId: string;
  config: Record<string, unknown>;
  status: BacktestPermutationStatus;
  runType: BacktestRunType;
  initialCash: number;
  finalEquity: number;
  totalReturnPct: number;
  metrics: BacktestMetrics;
  equityCurve: BacktestEquityPoint[];
  tradeCount: number;
  notes?: string[];
  error?: string;
  startedAtIso?: string;
  completedAtIso?: string;
  trades?: BacktestTradeUi[];
}

export interface BacktestTradeUi {
  entryDate: string;
  exitDate: string;
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  entryUnderlying: number;
  exitUnderlying: number;
  entryMark: number;
  exitMark: number;
  pnl: number;
  returnPct: number;
  exitReason: string;
  daysHeld: number;
  isUnderlying?: boolean;
  optionType?: string;
  strike?: string;
  expiration?: string;
  contractId?: string;
  legs?: BacktestTradeLegUi[];
  notes?: string[];
}

export interface BacktestTradeLegUi {
  kind: 'option' | 'underlying';
  side: 'long' | 'short';
  quantity: number;
  multiplier: number;
  entryMark: number;
  exitMark: number;
  pnl: number;
  optionType?: string;
  strike?: string;
  expiration?: string;
  contractId?: string;
}

export interface BacktestEquityPoint {
  date: string;
  cash: number;
  equity: number;
  openPositions: number;
}

export interface BacktestMetrics {
  totalNetProfit: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  percentProfitable: number;
  winLossRatio: number;
  averageTrade: number;
  averageWin: number;
  averageLoss: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  calmarRatio: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
}

export interface BacktestStrategyConfigField {
  type: 'integer' | 'number' | 'string' | 'boolean';
  min?: number;
  max?: number;
  step?: number;
  enum?: unknown[];
  description?: string;
}

export interface BacktestStrategyMetadata {
  id: string;
  name: string;
  description: string;
  category: string;
  defaultConfig: Record<string, unknown>;
  configSchema?: Record<string, BacktestStrategyConfigField>;
  minBarsRequired: number;
  supportedTimeframes: string[];
}

export interface StartBacktestRequest {
  symbols: string[];
  strategyId: string;
  config?: Record<string, unknown>;
  runType?: BacktestRunType;
  initialCash?: number;
  reportTier?: BacktestReportTier;
}

export interface StartBacktestResponse {
  runId: string;
  enqueued: number;
  failed: number;
  total: number;
}
