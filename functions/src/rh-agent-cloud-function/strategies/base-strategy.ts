/**
 * Strategy Adapter Base Types
 *
 * Core interface contract that all strategies must implement.
 * Provides standardized I/O so the worker can execute any registered strategy.
 */

import { StSignalDirection } from '../rh-agent-signals';
import { IntradaySnapshot } from '../../common/rh-agent-shared-types';

// =============================================================================
// STRATEGY INPUT (What the worker provides to every strategy)
// =============================================================================

export interface StrategyInput {
  symbol: string;
  marketDate: string;
  bars: OHLCV[];
  weeklyBars?: OHLCV[];
  monthlyBars?: OHLCV[];
  intraday?: IntradaySnapshot;
  context?: StrategyContext;
}

export interface OHLCV {
  date?: string;
  t?: string;
  timestamp?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  c?: number;
  volume?: number;
}

export interface StrategyContext {
  marketRegime?: 'bull' | 'bear' | 'neutral' | 'volatile';
  sector?: string;
  timeframe?: string;
}

// =============================================================================
// STRATEGY OUTPUT (What every strategy must return)
// =============================================================================

export interface StrategyOutput {
  action: StSignalDirection | null;  // LONG/SHORT signal, or null for no action
  confidence: number;           // 0-100
  reason: string;               // Human-readable explanation
  signalType: string;           // e.g., 'D_ST_TREND_RIDER_V1_LONG'
  barDate: string;              // YYYY-MM-DD — date of the bar that fired (daily = marketDate, weekly = last weekly bar date)
  indicators?: Record<string, number | string | null>;
  metadata?: Record<string, any>;
  suggestedAmount?: number;
}

// =============================================================================
// STRATEGY ENUMS
// =============================================================================

/** All registered strategy identifiers. */
export enum StrategyId {
  ST_TREND_RIDER = 'st-trend-rider',
}

// =============================================================================
// STRATEGY CONFIG (Parameterization - stored in Firestore or defaults)
// =============================================================================

export interface StrategyConfig {
  [key: string]: any;
}

export interface ConfigSchemaField {
  type: 'integer' | 'number' | 'string' | 'boolean';
  min?: number;
  max?: number;
  enum?: any[];
  description?: string;
}

// =============================================================================
// STRATEGY METADATA (Registry uses this for discovery and documentation)
// =============================================================================

export interface StrategyMetadata {
  id: string;
  name: string;
  description: string;
  category: 'momentum' | 'mean-reversion' | 'breakout' | 'trend' | 'volatility' | 'composite';
  defaultConfig: StrategyConfig;
  minBarsRequired: number;
  supportedTimeframes: string[];
  version: string;
  author: string;
  configSchema?: Record<string, ConfigSchemaField>;
}

// =============================================================================
// STRATEGY ADAPTER (The contract every strategy file must export)
// =============================================================================

export interface StrategyAdapter {
  metadata: StrategyMetadata;
  execute(input: StrategyInput, config: StrategyConfig): StrategyOutput | StrategyOutput[];
}
