/**
 * @topic #137 — Strategy Builder UI
 *
 * Shared TypeScript contracts for the hybrid options quote provider.
 */

import { OptionType, OptionQuoteSource, PositionSpreadType, StrategyFrequency } from './options-common';
import { TradeSide } from './common';

/**
 * Core option contract identifiers used for OCC → broker instrument
 * resolution. Smaller than a full `OptionQuote` because resolution only
 * needs the contract's static identity.
 */
export interface OptionContractRef {
  contractID: string;          // OCC option ID, e.g. SPY250817P00770000
  symbol: string;              // Underlying symbol, e.g. SPY
  expiration: string;          // ISO date, e.g. 2025-08-17
  strike: number;
  type: OptionType;            // CALL | PUT
}

/**
 * Normalized option quote shape consumed by the strategy engine.
 *
 * This is intentionally source-agnostic; each provider maps its upstream
 * response into this shape so the engine operates on one interface.
 */
export interface OptionQuote extends OptionContractRef {
  side: TradeSide;             // LONG | SHORT — engine position side, not the option type
  mark: number;                // Canonical mark used for P&L
  bid?: number;
  ask?: number;
  last?: number;
  volume?: number;
  openInterest?: number;
  impliedVolatility?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  rho?: number;                // Optional; included when upstream provides it
  source: OptionQuoteSource;   // AV_EOD | RH_MCP | AV_REALTIME
  asOf: string;                // ISO timestamp the quote represents
  interpolatedClose?: boolean; // True when close.price was interpolated by upstream
}

/**
 * OCC → Robinhood MCP instrument map entry.
 *
 * Stored in `options-rh-instrument-map/{occId}` and used by the RH MCP
 * quote provider to resolve OCC IDs to RH instrument UUIDs at mark time.
 */
export interface OccRhInstrumentMapEntry {
  occId: string;            // Document ID; also the key returned by parseOccContractId
  instrumentId: string;     // RH option instrument UUID
  chainId: string;          // RH option chain UUID
  chainSymbol: string;      // Underlying symbol, e.g. SPY
  expiration: string;       // ISO date, e.g. 2025-08-17
  strike: number;
  type: OptionType;         // CALL | PUT
  firstTradedDate?: string; // Derived: first calendar date this contract appears in our observed data, not a native RH field
  createdAt: string;        // ISO timestamp when this map entry was written
  expiresAt: string;        // ISO timestamp used for TTL / deletion scheduling
}

/**
 * A single point in the overnight underlying-price simulation grid.
 */
export interface OvernightDeltaGridPoint {
  underlyingMovePct: number; // e.g. -0.025 for -2.5%
  underlyingPrice: number;
  delta: number;
  mark: number;
  theta: number;
}

/**
 * Black-Scholes overnight simulation stored on the strategy instance's
 * daily-analysis document.
 */
export interface OvernightDeltaSimulation {
  baseUnderlyingPrice: number;     // Prior-session underlying close
  baseContractID: string;          // OCC ID selected from EOD data
  rangePct: number;                // Configured grid radius (default: 0.025 = ±2.5%)
  stepPct: number;                 // Configured grid step (default: 0.005 = 0.5%)
  grid: OvernightDeltaGridPoint[];
  computedAt: string;              // ISO timestamp
}

// ── Strategy instance phase ─────────────────────────────────────────────────

/**
 * A single phase in a strategy instance's lifecycle (e.g., phase 1 = CSP,
 * phase 2 = covered call for the wheel). The open pass uses the first phase
 * to select options; the settlement pass transitions between phases.
 */
export interface StrategyInstancePhase {
  spreadType: PositionSpreadType;
  targetDelta: number;
  dteMin: number;
  dteMax: number;
}

// ── Exit policy ─────────────────────────────────────────────────────────────

/**
 * Post-open exit/management policy. Decoupled from spread type so any
 * strategy can combine any set of policies. Evaluated in array order —
 * first match wins.
 *
 * v1: ROLL and EXIT_AND_REPLACE are config-only (stored but not enforced
 * by the BE). Enforcement arrives in Topic #139.
 */
export enum ExitPolicy {
  HOLD_TO_EXPIRATION = 'HOLD_TO_EXPIRATION',
  WHEEL_IF_ASSIGNED = 'WHEEL_IF_ASSIGNED',
  CLOSE_AT_TARGET_GAIN = 'CLOSE_AT_TARGET_GAIN',
  CLOSE_AT_DTE_THRESHOLD = 'CLOSE_AT_DTE_THRESHOLD',
  TRAILING_STOP = 'TRAILING_STOP',
  STOP_LOSS = 'STOP_LOSS',
  HOLD_SHARES_IF_ASSIGNED = 'HOLD_SHARES_IF_ASSIGNED',
  ROLL = 'ROLL',
  EXIT_AND_REPLACE = 'EXIT_AND_REPLACE',
}

/**
 * A single exit policy entry with its optional parameters.
 * Only the fields relevant to the selected `policy` are populated.
 */
export interface ExitPolicyConfig {
  policy: ExitPolicy;
  targetGainPct?: number;
  dteExitThreshold?: number;
  stopLossPct?: number;
  trailingStopPct?: number;
  rollDteThreshold?: number;
  rollTargetDelta?: number;
}

// ── Lifecycle state ─────────────────────────────────────────────────────────

/**
 * Three-state lifecycle for strategy instances.
 *
 * - ACTIVE: passes process this instance normally (open new positions, manage existing)
 * - PAUSED: no new positions opened; existing positions are still managed (marked, settled)
 * - STOPPED: no new positions; existing positions are still managed until they close
 *           (v1: STOPPED behaves identically to PAUSED)
 */
export enum LifecycleState {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  STOPPED = 'STOPPED',
}

// ── Market regime filter ────────────────────────────────────────────────────

/**
 * Trend-based market regime filter. v1: config stored only, not enforced by BE.
 * Volatility regime (volatile/calm) deferred until a volatility source is identified.
 */
export enum MarketRegime {
  BULL = 'BULL',
  BEAR = 'BEAR',
  NEUTRAL = 'NEUTRAL',
}

// ── Unified strategy instance config ────────────────────────────────────────

/**
 * Canonical strategy instance config stored on `options-strategy-instances/{instanceId}`.
 *
 * Used by both BE (registry, passes) and FE (Strategy Builder UI CRUD).
 *
 * Two field groups serve different strategy shapes:
 * - **Flat fields** (`optionType`, `side`, `targetDelta`, `dteMin`, `dteMax`):
 *   the config for single-phase strategies. Passes read these directly.
 * - **`phases` array**: the source of truth for multi-phase (wheel) strategies.
 *   For wheel strategies, `phases[0]` mirrors the flat fields and subsequent
 *   phases describe later legs (e.g., covered call after assignment).
 *
 * When exit policy enforcement arrives in Topic #139, passes will also read
 * `exitPolicies` directly.
 */
export interface StrategyInstanceConfig {
  id: string;
  symbol: string;
  // Single-phase config (consumed by pass functions)
  optionType: OptionType;
  side: TradeSide;
  targetDelta?: number;
  dteMin?: number;
  dteMax?: number;
  // Multi-phase config (wheel strategies; phases[0] mirrors flat fields)
  phases: StrategyInstancePhase[];
  // Instance-level config
  frequency: StrategyFrequency;
  openTimePT: string;
  exitPolicies: ExitPolicyConfig[];
  lifecycleState: LifecycleState;
  marketRegime?: MarketRegime;
  userId: string;
  // Pass-level tuning knobs
  deltaTolerance?: number;
  overnightGridRangePct?: number;
  overnightGridStepPct?: number;
  maxOvernightMovePct?: number | null;
  createdAt: string;
  updatedAt: string;
}
