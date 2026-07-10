/**
 * RH Agent Shared Cross-Cutting Types
 *
 * Small types used across multiple RH Agent cloud function modules that don't
 * belong to a single domain (signals, runs, or opportunities).
 */

import { RhAgentTriggeredBy } from './rh-agent-runs';

/**
 * Cloud Task payload for symbol analysis job.
 */
export interface SymbolJobPayload {
  runId: string;
  symbol: string;
  marketDate: string;    // YYYY-MM-DD
  runStartedAt: string;  // ISO timestamp — when the run started; written to run-ids docs for distinguishability
  triggeredBy?: RhAgentTriggeredBy;  // Source of the run; 'nightly' enables signal-history writes
}
