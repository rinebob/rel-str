/**
 * ST Signal Types and Payloads
 *
 * Signal directions, signal types, signal statuses, and the document shapes
 * used to store signals in Firestore.
 */

// Explicit type imports — the FirebaseFirestore global namespace is ambient
// under functions/tsconfig but not under the jest spec tsconfig, so modules
// that transitively reach this file must not rely on it.
import type { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { StSignalStatus } from '@st/signals';

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
 * Canonical definition: @st/signals (shared/st-signals.ts) — re-exported here
 * for the legacy signal-entry surface (#984).
 */
export type { StSignalStatus };

/**
 * Individual signal entry stored in the signals map of a run-ids or signal-history doc.
 */
export interface StSignalEntry {
  signalType: StSignalType | string;
  timeframe: 'D' | 'W' | 'M';
  direction: StSignalDirection;
  status: StSignalStatus;
  barDate: string;               // YYYY-MM-DD — the bar that triggered (doc ID)
  marketDate: string;            // YYYY-MM-DD — run date (may differ from barDate for W/M)
  indicators: Record<string, number | string | null>;
}

/**
 * Signal history doc stored under savant-trader/data/symbol-meta/{SYMBOL}/signal-history/{date}.
 * Canonical EOD record — written only by the nightly run for CONFIRMED signals.
 * One doc per symbol per date; signals intended as a map keyed by signalType,
 * but prod writers emit literal flattened `signals.{type}` top-level fields —
 * always read via signalEntriesFromDoc.
 */
export interface StSignalHistoryDoc {
  symbol: string;
  date: string;                  // YYYY-MM-DD — doc ID; for weekly signals: the week-open (Monday bar date)
  updatedAt: Timestamp | FieldValue;
  canonicalizedAt: Timestamp | FieldValue;
  /** Optional: prod writers emit literal flattened `signals.{type}` top-level
   *  fields instead of this nested map — always read via signalEntriesFromDoc. */
  signals?: Record<string, StSignalEntry & { sourceRunId: string }>;
}

/**
 * Run-id doc stored under savant-trader/data/symbol-meta/{SYMBOL}/run-ids/{runId}.
 * One doc per run; all signals produced by that run intended as a map keyed by
 * signalType — but prod writers emit literal flattened `signals.{type}`
 * top-level fields; always read via signalEntriesFromDoc.
 * This is the real-time / intraday path. Nightly runs also write here before writing to signal-history.
 */
export interface StRunIdDoc {
  symbol: string;
  runId: string;                 // doc ID — the agent run that produced these signals
  marketDate: string;            // YYYY-MM-DD — calendar date of the run
  startedAt: string;             // ISO timestamp — distinguishes 8AM vs 10AM vs 12PM PDR runs
  updatedAt: Timestamp | FieldValue;
  /** Optional: prod writers emit literal flattened `signals.{type}` top-level
   *  fields instead of this nested map — always read via signalEntriesFromDoc. */
  signals?: Record<string, StSignalEntry>;
}

/**
 * Pull signal entries out of a signal-bearing doc (`run-ids`,
 * `signal-history`, `signal-dates`) in BOTH observed prod shapes:
 * literal flattened top-level `signals.{type}` fields (dotted keys
 * survive `set(merge)` verbatim — all current writers emit this) and a
 * nested `signals` map (e.g. signal-dates docs). Flattened wins on key
 * collision; values that aren't entry-shaped are ignored. This is the
 * canonical read boundary — never read `.signals` directly (#931).
 */
export function signalEntriesFromDoc(
  data: Record<string, unknown>,
): Record<string, StSignalEntry> {
  const out: Record<string, StSignalEntry> = {};
  const isEntry = (v: unknown): v is StSignalEntry =>
    typeof v === 'object' && v !== null && 'barDate' in v && 'direction' in v;
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('signals.') && isEntry(value)) {
      out[key.slice('signals.'.length)] = value;
    }
  }
  const nested = data['signals'];
  if (typeof nested === 'object' && nested !== null) {
    for (const [type, value] of Object.entries(nested as Record<string, unknown>)) {
      if (isEntry(value)) out[type] ??= value;
    }
  }
  return out;
}
