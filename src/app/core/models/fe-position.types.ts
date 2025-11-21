// Shared frontend model for Firestore `positions` projection

export enum PositionDirection {
  LONG = 'LONG',
  SHORT = 'SHORT',
}

export enum PositionStatus {
  OPEN = 'open',
  CLOSED = 'closed',
}

export enum PriceDatumRole {
  ENTRY = 'entry',
  UPDATE = 'update',
  EXIT = 'exit',
}

export interface PriceDatum {
  role: PriceDatumRole;

  day: string;           // YYYY-MM-DD (ET-aligned)
  timestamp: number;     // epoch ms

  price: number;
  rs?: number;

  // PRE covers intraday/pre-close; POST for EOD
  source?: 'pre' | 'post';

  // PnL metrics vs entry
  pnl: number;
  pct: number;
}

export interface BackendPositionDoc {
  // Identity / routing (strict backend contract)
  positionId: string;
  pair: string;       // e.g. SPY-AAPL
  baseline: string;
  symbol: string;
  status: PositionStatus;
  direction: PositionDirection;

  // Price timeline
  entry: PriceDatum;
  updates: PriceDatum[];
  exit?: PriceDatum;

  // Aggregated PnL
  netPnL?: number;
  netPercentReturn?: number;
  percentReturn?: number;
  exitRs?: number;          // canonical RS on close

  // Housekeeping (Firestore timestamps)
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PositionDoc {
  // Identity / routing (more permissive FE view)
  positionId: string;
  pair?: string;       // e.g. SPY-AAPL
  baseline?: string;
  symbol?: string;
  status?: PositionStatus;
  direction?: PositionDirection;

  // Entry / open
  entryPrice?: number;
  entryDay?: string;        // YYYY-MM-DD (ET-aligned)
  entryIso?: string;        // ISO 8601
  entryTimestamp?: number;  // epoch ms (ET)

  // Current snapshot for OPEN/HOLD
  currentPrice?: number;
  currentChange?: number;
  currentPctChange?: number;
  lastUpdateDay?: string;   // YYYY-MM-DD
  currentRs?: number;       // canonical RS while OPEN

  // Exit / close
  exitPrice?: number;
  exitDay?: string;         // YYYY-MM-DD
  exitIso?: string;         // ISO 8601
  exitTimestamp?: number;   // epoch ms (ET)
  netPnL?: number;
  percentReturn?: number;
  exitRs?: number;          // canonical RS on close

  // Housekeeping (Firestore timestamps)
  createdAt?: unknown;
  updatedAt?: unknown;
}
