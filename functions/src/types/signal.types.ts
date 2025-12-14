// types/rs-signal.types.ts
// Canonical types for RS signals and related backend contracts

// Prefer importing these enums for value safety instead of scattering string literals.
export enum RsDirection { LONG = 'long', SHORT = 'short' }
export enum RsSource { PRE = 'pre', POST = 'post' }

// Standardized intervals for RS processing and signals.
export enum Interval {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
}

// Logical activity kinds for Signals Activity docs.
export enum ActivityEventKind {
  OPEN = 'OPEN',
  HOLD = 'HOLD',
  CLOSE = 'CLOSE',
}

// Lifecycle state of an activity event.
export enum ActivityEventState {
  PREVIEW = 'PREVIEW',
  FINAL = 'FINAL',
  ABANDONED = 'ABANDONED',
}

// Internal processing state for generators/readers that implement a simple FSM.
export enum PositionState { FLAT = 'flat', LONG = 'long', SHORT = 'short' }

// Shared price snapshot for positions/signals over time.
export enum PriceDatumRole { ENTRY = 'entry', UPDATE = 'update', EXIT = 'exit' }

export interface PriceDatum {
  // Role within the position lifecycle
  role: PriceDatumRole;

  // Time
  day: string;        // YYYY-MM-DD (ET-aligned trading day)
  dow?: string;       // 3-letter UTC weekday code (e.g. MON)
  timestamp: number;  // epoch ms

  // Price + RS at this moment
  price: number;
  rsRaw: number;
  rsNorm: number;

  // Source of this sample (PRE covers intraday / pre-close; POST for EOD)
  source?: RsSource;

  // PnL metrics vs the original entry at this moment
  pnl: number;        // absolute PnL
  pct: number;        // percentage return

  // Day-over-day change metrics vs the previous price datum in the timeline
  ch: number;   // absolute change in price vs previous datum
  cp: number;   // percent change vs previous datum

  // Previous RS values
  prevRsRaw?: number;
  prevRsNorm?: number;
}

export interface RsPositionOpened {
  day: string; // YYYY-MM-DD (UTC)
  t: number;   // epoch ms
  source: RsSource;
  openPrice: number;
  basePrice: number;
  rsYesterday: number;
  rsToday: number;
}

// Closed may occur on a different day/time; include explicit closePrice for clarity
export interface RsPositionClosed extends RsPositionOpened {
    day: string; // YYYY-MM-DD (UTC)
    t: number;   // epoch ms
    closePrice: number; // explicit closing price 
  change: number;    // closePrice - opened.openPrice
  pctChange: number; // (change / opened.openPrice) * 100
}


export enum RsPositionStatus { OPEN = 'open', CLOSED = 'closed' }

export interface RsPositionDoc {
  pair: string;        // BASE-SYMBOL
  baseline: string;
  symbol: string;
  direction: RsDirection;
  positionId: string;  // {PAIR}_{YYYYMMDD}_{DOW}_{direction}
  opened: RsPositionOpened;
  closed?: RsPositionClosed;
  status: RsPositionStatus;
  // RS projections for UI/read models
  currentRs?: number;  // latest RS while position is OPEN
  exitRs?: number;     // RS on the close day while CLOSED
  createdAt: unknown;  // Firestore Timestamp
  updatedAt: unknown;  // Firestore Timestamp
}

// Canonical RS signal event contracts.
// These will back the /pairs-data/{PAIR}/signals/{YEAR}/opens|closes collections.

export interface BeSignalBase {

  // Identity
  signalId: string;          // Firestore doc id, e.g. 20250106-MON-QQQ-AAPL-SHORT

  // Pair routing
  baseline: string;          // e.g. QQQ
  symbol: string;            // e.g. AAPL

  // Classification
  direction: RsDirection; // LONG | SHORT

  // Interval for this signal (DAILY | WEEKLY | MONTHLY).
  interval: Interval;

  // Time of the signal (decision time, ET-aligned)
  day: string;               // YYYY-MM-DD
  dow?: string;              // 3-letter UTC weekday code (e.g. MON)
  timestamp: number;         // epoch ms

  // RS / price context at signal time
  price: number;             // target price at signal
  rsRaw: number;               // RS at signal (raw or normalized depending on pipeline)
  rsNorm: number;           // normalized RS used for thresholds/visuals
  prevRs: number;           // yesterday's RS value.  will need to do a lookup
  source: RsSource;      // POST for canonical signals (per docs)
}

export interface BeOpenSignalDoc extends BeSignalBase {
  // Foreign key to the position this open creates/updates
  positionId: string;
}

export interface BeCloseSignalDoc extends BeSignalBase {
  // Linkage to state and paired event
  positionId: string;        // the position being closed
  openSignalId: string;      // the corresponding opening signal id
}

export type BeSignalDoc = BeOpenSignalDoc | BeCloseSignalDoc;

// Signals Activity model (multi-interval, preview/final/abandoned states).

export interface ActivityEvent {
  // Classification
  kind: ActivityEventKind;
  interval: Interval;

  // Canonical trading day for this event (YYYY-MM-DD, ET-aligned)
  day: string;
  dow: string; // 3-letter UTC weekday code (e.g. MON)

  // Routing
  positionId: string;
  baseline: string;
  symbol: string;

  // Direction and RS snapshot at the event moment
  direction: RsDirection;
  rsRaw: number;
  rsNorm: number;
  prevRsRaw?: number;
  prevRsNorm?: number;

  // Lifecycle state within the activity stream
  state: ActivityEventState;

  // Optional linkage to canonical signal docs (once finalized)
  signalId?: string;
}

export interface SignalsActivityDoc {
  // Canonical trading day for this document (YYYY-MM-DD, ET-aligned)
  date: string;

  // Flat array of events for this day (per-pair or root-aggregated, depending on collection).
  events: ActivityEvent[];
}

export interface PnLTotals { count: number; sum: number; sumPct: number }

// Callable DTOs
export interface GetPairSignalsRequest { baseline: string; symbol: string; limit?: number; source?: RsSource; type?: 'open' | 'close' }
export interface GetPairSignalsResponse { opens: BeOpenSignalDoc[]; closes: BeCloseSignalDoc[] }

export interface GetPnLSummaryRequest { from: string; to: string; type: 'app' | 'actual'; uid?: string }
export interface GetPnLSummaryResponse { range: { from: string; to: string }; type: 'app' | 'actual'; uid?: string; totals: { long: PnLTotals; short: PnLTotals; total: PnLTotals } }

export interface UpdatePositionActualsRequest { positionId: string; executed: boolean; openedPrice?: number; closedPrice?: number; openedTime?: number; closedTime?: number; noteOpen?: string; noteClose?: string }
export interface UpdatePositionActualsResponse { ok: boolean; positionId: string }


