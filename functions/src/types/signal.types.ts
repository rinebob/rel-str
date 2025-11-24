// types/rs-signal.types.ts
// Canonical types for RS signals and related backend contracts

// Prefer importing these enums for value safety instead of scattering string literals.
export enum RsDirection { LONG = 'long', SHORT = 'short' }
export enum RsSource { PRE = 'pre', POST = 'post' }

// Internal processing state for generators/readers that implement a simple FSM.
export enum PositionState { FLAT = 'flat', LONG = 'long', SHORT = 'short' }

// Shared price snapshot for positions/signals over time.
export enum PriceDatumRole { ENTRY = 'entry', UPDATE = 'update', EXIT = 'exit' }

export interface PriceDatum {
  // Role within the position lifecycle
  role: PriceDatumRole;

  // Time
  day: string;        // YYYY-MM-DD (ET-aligned trading day)
  timestamp: number;  // epoch ms

  // Price + RS at this moment
  price: number;
  rs?: number;

  // Source of this sample (PRE covers intraday / pre-close; POST for EOD)
  source?: RsSource;

  // PnL metrics vs the original entry at this moment
  pnl: number;        // absolute PnL
  pct: number;        // percentage return
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

  // Time of the signal (decision time, ET-aligned)
  day: string;               // YYYY-MM-DD
  timestamp: number;         // epoch ms

  // RS / price context at signal time
  price: number;             // target price at signal
  rs: number;               // RS at signal
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

export enum DailySignalType {
  OPEN = 'open',   // canonical open signal event for the position
  CLOSE = 'close', // canonical close signal event for the position
  HOLD = 'hold',   // no new signal today; position remained open on this day
}

export interface DailySignal {
  signalId: string;
  positionId: string;
  type: DailySignalType;
  // For root signals-daily mirror entries this will be populated; per-pair docs may omit it.
  pair?: string;
}

export interface SignalsDailyDoc {
  // Canonical trading day for this document (YYYY-MM-DD, ET-aligned)
  date: string;

  newOpens: DailySignal[];
  holds: DailySignal[];
  newCloses: DailySignal[];
}

export interface PnLTotals { count: number; sum: number; sumPct: number }

// Callable DTOs
export interface GetPairSignalsRequest { baseline: string; symbol: string; limit?: number; source?: RsSource; type?: 'open' | 'close' }
export interface GetPairSignalsResponse { opens: BeOpenSignalDoc[]; closes: BeCloseSignalDoc[] }

export interface GetDailySignalsRequest { day?: string; fromDay?: string; toDay?: string; limitDays?: number; all?: boolean }
export interface GetDailySignalsResponse { days: SignalsDailyDoc[] }

export interface GetPnLSummaryRequest { from: string; to: string; type: 'app' | 'actual'; uid?: string }
export interface GetPnLSummaryResponse { range: { from: string; to: string }; type: 'app' | 'actual'; uid?: string; totals: { long: PnLTotals; short: PnLTotals; total: PnLTotals } }

export interface UpdatePositionActualsRequest { positionId: string; executed: boolean; openedPrice?: number; closedPrice?: number; openedTime?: number; closedTime?: number; noteOpen?: string; noteClose?: string }
export interface UpdatePositionActualsResponse { ok: boolean; positionId: string }


