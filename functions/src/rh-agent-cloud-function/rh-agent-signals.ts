/**
 * RH Agent Signal Types and Payloads
 *
 * Signal directions, signal types, signal statuses, and the document shapes
 * used to store signals in Firestore.
 */

/**
 * Signal direction — whether the signal is a long or short entry.
 */
export enum StSignalDirection {
  LONG  = 'LONG',
  SHORT = 'SHORT',
}

/**
 * All known signal types produced by ST strategies.
 * Format: {TIMEFRAME}_{STRATEGY}_{VERSION}_{DIRECTION}
 */
export enum StSignalType {
  D_ST_TREND_RIDER_V1_LONG       = 'D_ST_TREND_RIDER_V1_LONG',
  D_ST_TREND_RIDER_V1_SHORT      = 'D_ST_TREND_RIDER_V1_SHORT',
  D_ST_TREND_RIDER_V2_LONG       = 'D_ST_TREND_RIDER_V2_LONG',
  D_ST_TREND_RIDER_V2_SHORT      = 'D_ST_TREND_RIDER_V2_SHORT',
  W_ST_TREND_RIDER_V1_LONG       = 'W_ST_TREND_RIDER_V1_LONG',
  W_ST_TREND_RIDER_V1_SHORT      = 'W_ST_TREND_RIDER_V1_SHORT',
  W_ST_TREND_RIDER_V2_LONG       = 'W_ST_TREND_RIDER_V2_LONG',
  W_ST_TREND_RIDER_V2_SHORT      = 'W_ST_TREND_RIDER_V2_SHORT',
}

/**
 * Signal status — INTERIM for open W/M periods, CONFIRMED once the period closes.
 * Daily signals are INTERIM during intraday runs, CONFIRMED on the nightly run.
 */
export type RhAgentSignalStatus = 'INTERIM' | 'CONFIRMED';

/**
 * Individual signal entry stored in the signals map of a run-ids or signal-history doc.
 */
export interface RhAgentSignalEntry {
  signalType: StSignalType | string;
  timeframe: 'D' | 'W';
  direction: StSignalDirection;
  status: RhAgentSignalStatus;
  barDate: string;               // YYYY-MM-DD — the bar that triggered (doc ID)
  marketDate: string;            // YYYY-MM-DD — run date (may differ from barDate for W)
  indicators: Record<string, number | string | null>;
}

/**
 * Signal history doc stored under rh-agent-symbols/{SYMBOL}/signal-history/{date}.
 * Canonical EOD record — written only by the nightly run for CONFIRMED signals.
 * One doc per symbol per date; signals stored as a map keyed by signalType.
 */
export interface RhAgentSignalHistoryDoc {
  symbol: string;
  date: string;                  // YYYY-MM-DD — doc ID; for weekly signals: the week-open (Monday bar date)
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  canonicalizedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  signals: Record<string, RhAgentSignalEntry & { sourceRunId: string }>;
}

/**
 * Run-id doc stored under rh-agent-symbols/{SYMBOL}/run-ids/{runId}.
 * One doc per run; all signals produced by that run stored as a map keyed by signalType.
 * This is the real-time / intraday path. Nightly runs also write here before writing to signal-history.
 */
export interface RhAgentRunIdDoc {
  symbol: string;
  runId: string;                 // doc ID — the agent run that produced these signals
  marketDate: string;            // YYYY-MM-DD — calendar date of the run
  startedAt: string;             // ISO timestamp — distinguishes 8AM vs 10AM vs 12PM PDR runs
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  signals: Record<string, RhAgentSignalEntry>;
}
