/**
 * @topic #114 — Options Strategy Engine — Hybrid Quote Provider
 *
 * Shared TypeScript contracts for the hybrid options quote provider.
 */

import { OptionType, OptionQuoteSource } from './options-common';
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

/**
 * Configurable knobs for the hybrid options strategy instance.
 *
 * Stored on `options-strategy-instances/{instanceId}`.
 */
export interface StrategyInstanceConfig {
  symbol: string;
  optionType: OptionType;
  side: TradeSide;
  dteMin?: number;
  dteMax?: number;
  targetDelta?: number;
  deltaTolerance?: number;
  overnightGridRangePct?: number;  // default 0.025
  overnightGridStepPct?: number;   // default 0.005
  maxOvernightMovePct?: number | null; // disabled by default for data gathering
}
