// types/position.types.ts
// Canonical types for root positions documents in Firestore.

import type { RsDirection, RsPositionStatus, PriceDatum } from './signal.types';

export interface BePositionDoc {
  // Identity & routing
  positionId: string;
  pair: string;
  baseline: string;
  symbol: string;
  direction: RsDirection; // LONG | SHORT
  status: RsPositionStatus;   // 'open' | 'closed'

  // Price timeline
  entry: PriceDatum;          // role = ENTRY, pnl=0, pct=0
  updates: PriceDatum[];      // role = UPDATE
  exit?: PriceDatum;          // role = EXIT

  // Aggregated PnL for the position
  netPnL?: number;
  netPercentReturn?: number;
}
