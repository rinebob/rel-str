/**
 * RH Agent Shared Cross-Cutting Types
 *
 * Small types used across multiple RH Agent cloud function modules that don't
 * belong to a single domain (signals, runs, or opportunities).
 */

import { RhAgentTriggeredBy } from './rh-agent-runs';

/**
 * Intraday snapshot data from SavantAPI partnerIntradaySnapshotV2 endpoint.
 */
export interface IntradaySnapshot {
  symbol: string;
  ip: number;      // Latest intraday price
  ipc: number;     // Intraday change %
  io: number;      // Epoch ms timestamp
  it: string;      // Time string (e.g., "10:30")
  ic: number;      // Intraday change $
}

/**
 * Cloud Task payload for symbol analysis job.
 */
export interface SymbolJobPayload {
  runId: string;
  symbol: string;
  marketDate: string;    // YYYY-MM-DD
  runStartedAt: string;  // ISO timestamp — when the run started; written to run-ids docs for distinguishability
  triggeredBy?: RhAgentTriggeredBy;  // Source of the run; 'nightly' enables signal-history writes
  intraday?: IntradaySnapshot;  // Intraday data from trigger's bulk fetch
}
