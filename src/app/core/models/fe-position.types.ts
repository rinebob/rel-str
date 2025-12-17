// Shared frontend model for Firestore `positions` projection

import { BarsInterval } from '../models/partner.types';

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

  // RS values from backend timeline
  rsRaw?: number;
  rsNorm?: number;

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

  interval: BarsInterval;
  direction: PositionDirection;

  // Price timeline
  entry: PriceDatum;
  updates: PriceDatum[];
  exit?: PriceDatum;

  // Aggregated PnL
  netPnL?: number;
  netPercentReturn?: number;

  // Live flat snapshot fields for OPEN positions (written by backend helpers)
  currentPrice?: number;
  currentChange?: number;
  currentPctChange?: number;
  rawChange?: number;
  rawPctChange?: number;
  lastUpdateDay?: string;
  currentRs?: number;
}

export interface PositionDoc extends BackendPositionDoc {
  // Entry / open (flattened view for UI)
  entryPrice?: number;
  entryDay?: string;        // YYYY-MM-DD (ET-aligned)
  entryIso?: string;        // ISO 8601
  entryTimestamp?: number;  // epoch ms (ET)

  // Current snapshot for OPEN/HOLD (flattened)
  currentPrice?: number;
  currentChange?: number;
  currentPctChange?: number;
  rawChange?: number;
  rawPctChange?: number;
  lastUpdateDay?: string;   // YYYY-MM-DD
  currentRs?: number;       // canonical RS while OPEN

  // Exit / close (flattened)
  exitPrice?: number;
  exitDay?: string;         // YYYY-MM-DD
  exitIso?: string;         // ISO 8601
  exitTimestamp?: number;   // epoch ms (ET)
  percentReturn?: number;
  exitRs?: number;          // canonical RS on close
}
