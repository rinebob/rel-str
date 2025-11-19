// types/rs-signal-history.ts
// Canonical types for RsSignalHistory backend contracts

export type RsDirection = 'long' | 'short';
export type RsSource = 'pre' | 'post';

// Prefer importing these enums for value safety instead of scattering string literals.
export enum RsDirectionEnum { LONG = 'long', SHORT = 'short' }
export enum RsSourceEnum { PRE = 'pre', POST = 'post' }

// Internal processing state for generators/readers that implement a simple FSM.
export enum PositionState { FLAT = 'flat', LONG = 'long', SHORT = 'short' }

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

export interface DailyOpenEntry { positionId: string; direction: RsDirection }
export interface DailyCloseEntry extends DailyOpenEntry { change: number; pctChange: number }

export interface SignalsDailyDoc {
  newOpens: DailyOpenEntry[];
  holds: DailyOpenEntry[];
  newCloses: DailyCloseEntry[];
  pnlSummary?: { long: PnLTotals; short: PnLTotals; total: PnLTotals };
  appPnLSummary?: { long: PnLTotals; short: PnLTotals; total: PnLTotals };
  cumulativePnL?: { long: PnLTotals; short: PnLTotals; total: PnLTotals };
  updatedAt: unknown; // Firestore Timestamp
}

export interface PnLTotals { count: number; sum: number; sumPct: number }



// Callable DTOs
export interface GetPairSignalsRequest { baseline: string; symbol: string; limit?: number; source?: RsSource; type?: 'open' | 'close' }
export interface GetPairSignalsResponse { items: RsPositionDoc[] }

export interface GetDailySignalsRequest { day?: string; fromDay?: string; toDay?: string; limitDays?: number; all?: boolean }
export interface GetDailySignalsResponse { days: Array<{ day: string; items: SignalsDailyDoc }> }

export interface GetPnLSummaryRequest { from: string; to: string; type: 'app' | 'actual'; uid?: string }
export interface GetPnLSummaryResponse { range: { from: string; to: string }; type: 'app' | 'actual'; uid?: string; totals: { long: PnLTotals; short: PnLTotals; total: PnLTotals } }

export interface UpdatePositionActualsRequest { positionId: string; executed: boolean; openedPrice?: number; closedPrice?: number; openedTime?: number; closedTime?: number; noteOpen?: string; noteClose?: string }
export interface UpdatePositionActualsResponse { ok: boolean; positionId: string }


