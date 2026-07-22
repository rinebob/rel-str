/**
 * Backtest runtime types shared by the orchestrator, worker, and simulator.
 */

import type { StrategyConfig } from '../strategies/base-strategy';
import type { OptionType } from '../../types/partner';

/** Backtest run type. */
export type BacktestRunType = 'allData' | 'expandingWindow';

/** Report tier stored by the user. */
export type BacktestReportTier = 'summary' | 'full';

/** Cloud Task payload for one symbol+strategy+param set. */
export interface BacktestPermutationPayload {
  runId: string;
  permutationId: string;
  symbol: string;
  strategyId: string;
  config: StrategyConfig;
  runType: BacktestRunType;
  initialCash: number;
  reportTier: BacktestReportTier;
  /** Optional walk-forward window sizes in calendar days. */
  inSampleDays?: number;
  outOfSampleDays?: number;
  rollStepDays?: number;
}

/** Why a simulated trade was closed. */
export enum BacktestExitReason {
  TARGET_GAIN = 'targetGain',
  STOP_LOSS = 'stopLoss',
  TRAILING_STOP = 'trailingStop',
  MAX_HOLD_DAYS = 'maxHoldDays',
  MISSING_DATA = 'missingData',
  END_OF_DATA = 'endOfData',
}

/** One closed leg of a backtest trade. */
export interface BacktestTradeLeg {
  kind: 'option' | 'underlying';
  side: 'long' | 'short';
  quantity: number;
  multiplier: number;
  entryMark: number;
  exitMark: number;
  optionType?: OptionType;
  strike?: string;
  expiration?: string;
  contractId?: string;
  pnl: number;
}

/** One completed trade emitted by the simulator. */
export interface BacktestTrade {
  entryDate: string;
  exitDate: string;
  symbol: string;
  strategyId: string;
  config: StrategyConfig;
  entryUnderlying: number;
  exitUnderlying: number;
  entryMark: number;
  exitMark: number;
  quantity: number;
  side: 'long' | 'short';
  optionType?: OptionType;
  strike?: string;
  expiration?: string;
  contractId?: string;
  /** True when the trade was an equity/underlying position rather than an option. */
  isUnderlying?: boolean;
  pnl: number;
  returnPct: number;
  exitReason: BacktestExitReason;
  daysHeld: number;
  notes?: string[];
  /** Per-leg detail for multi-leg spreads. */
  legs?: BacktestTradeLeg[];
}

/** One daily equity-curve point. */
export interface BacktestEquityPoint {
  date: string;
  cash: number;
  equity: number;
  openPositions: number;
}

/** One underlying close price point for charting. */
export interface BacktestPricePoint {
  date: string;
  close: number;
}

/** TradeStation-style performance metrics. */
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

/** Summary result persisted to Firestore. */
export interface BacktestPermutationSummary {
  runId: string;
  permutationId: string;
  symbol: string;
  strategyId: string;
  config: StrategyConfig;
  status: 'pending' | 'running' | 'success' | 'failed';
  runType: BacktestRunType;
  reportTier: BacktestReportTier;
  initialCash: number;
  finalEquity: number;
  totalReturnPct: number;
  metrics: BacktestMetrics;
  equityCurve: BacktestEquityPoint[];
  tradeCount: number;
  notes?: string[];
  error?: string;
  startedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  completedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
}

/** Full report extends summary with every trade and underlying price series. */
export interface BacktestPermutationFull extends BacktestPermutationSummary {
  trades: BacktestTrade[];
  underlyingBars?: BacktestPricePoint[];
}

/** Run document shape stored under backtest-runs/{runId}. */
export interface BacktestRun {
  runId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  symbols: string[];
  strategyId: string;
  runType: BacktestRunType;
  initialCash: number;
  reportTier: BacktestReportTier;
  totalPermutations: number;
  completedPermutations: number;
  failedPermutations: number;
  archived?: boolean;
  qualityDesignation?: string;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  startedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  completedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  error?: string;
}
