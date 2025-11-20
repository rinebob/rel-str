// Shared frontend model for Firestore `positions` projection

export enum PositionSide {
  LONG = 'LONG',
  SHORT = 'SHORT',
}

export enum PositionStatus {
  OPEN = 'open',
  CLOSED = 'closed',
}

export interface PositionDoc {
  // Identity / routing
  positionId: string;
  pair?: string;       // e.g. SPY-AAPL
  baseline?: string;
  symbol?: string;
  status?: PositionStatus;
  side?: PositionSide;

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
