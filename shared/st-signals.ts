/**
 * @topic #984 — ST Firestore Reorg (tasks #998/#999)
 *
 * Canonical `st-signals` occurrence shape — one doc per
 * {symbol, barDate, signalType} (`{SYM}_{barDate}_{signalType}` doc id),
 * upserted across intraday, post, and nightly rediscovery. Single source for
 * BE (functions) and FE (Angular) via the `@st/signals` path alias.
 */
import { TradeSide } from './common';

/** barStatus-derived lifecycle — INTERIM intraday, CONFIRMED at bar close. */
export type StSignalStatus = 'INTERIM' | 'CONFIRMED';
export const ST_SIGNAL_STATUSES: readonly StSignalStatus[] = ['INTERIM', 'CONFIRMED'];

export type StSignalTimeframe = 'D' | 'W' | 'M';
export const ST_SIGNAL_TIMEFRAMES: readonly StSignalTimeframe[] = ['D', 'W', 'M'];

/**
 * Normalize a legacy signal direction to TradeSide. Legacy signal entries
 * persist 'LONG'/'SHORT' (uppercase, StSignalDirection); st- docs use the
 * canonical lowercase TradeSide values. Anything else → null.
 */
export function normalizeStSignalDirection(v: string | TradeSide | null | undefined): TradeSide | null {
  const raw = String(v ?? '').trim().toLowerCase();
  if (raw === 'long') return TradeSide.LONG;
  if (raw === 'short') return TradeSide.SHORT;
  return null;
}

/**
 * barStatus → StSignalStatus. barStatus is authoritative for interim vs
 * historical: 1 → CONFIRMED (period closed); -1, 0, or undefined → INTERIM.
 * Canonical single source — signal-persister delegates here.
 */
export function stSignalStatusFromBarStatus(barStatus: -1 | 0 | 1 | undefined): StSignalStatus {
  return barStatus === 1 ? 'CONFIRMED' : 'INTERIM';
}

/**
 * Canonical signal occurrence doc (`st-signals/{SYM}_{barDate}_{signalType}`).
 *
 * Timestamps are ISO strings at the shared layer (BE writers stamp
 * FieldValue server-side; the read shape here is what FE/BE consumers see).
 */
export interface StSignal {
  // ── identity (doc id components) ──
  symbol: string;
  signalType: string;
  barDate: string;                // YYYY-MM-DD bar the signal fired on
  /** Market date of the run that first detected this occurrence. */
  marketDate: string;
  /** 'long' | 'short' — NOTE: legacy StSignalEntry.direction persists
   *  'LONG'/'SHORT'; writers must map through normalizeStSignalDirection. */
  direction: TradeSide;
  timeframe: StSignalTimeframe;
  /** Signal payload — scalar indicator values captured at fire time
   *  (matches signalIndicators on PaperTrade). */
  indicators: Record<string, number | string | null>;
  status: StSignalStatus;
  // ── provenance ──
  /** Run that first wrote this occurrence. */
  sourceRunId: string;
  /** Every run that (re)discovered this occurrence. */
  runIds: string[];
  // ── downstream lineage ──
  /** st-order-tickets doc ids minted from this signal. */
  ticketIds: string[];
  /** st-position-groups doc ids built from this signal's tickets. */
  positionGroupIds: string[];
  createdAt: string;
  updatedAt: string;
}
