// Frontend models for RsSignalHistory
export type RsDirection = 'long' | 'short';
export type RsSource = 'pre' | 'post';

export enum RsPositionStatus { OPEN = 'open', CLOSED = 'closed' }

export interface RsPositionOpened {
  day: string; // YYYY-MM-DD (UTC)
  t: number;
  source: RsSource;
  price: number;
  basePrice: number;
  rsYesterday: number;
  rsToday: number;
}

export interface RsPositionClosed extends RsPositionOpened {
  day: string; // YYYY-MM-DD (UTC)
  t: number;
  closePrice: number; // explicit closing price
  change: number;
  pctChange: number;
}

export interface AppPnl {
  openedPrice: number;
  closedPrice?: number;
  change?: number;
  pctChange?: number;
  sourceOpen: RsSource;
  sourceClose?: RsSource;
}

export interface RsPositionDoc {
  pair: string;
  baseline: string;
  symbol: string;
  direction: RsDirection;
  positionId: string; // {PAIR}_{YYYYMMDD}_{DOW}_{direction}
  opened: RsPositionOpened;
  closed?: RsPositionClosed;
  appPnl?: AppPnl;
  status: RsPositionStatus;
}

export interface UserTradeSide {
  price?: number;
  day?: string;
  dow?: string;
  t?: number;
  note?: string;
}

export interface ActualPnl {
  openedPrice?: number;
  closedPrice?: number;
  openedDay?: string;
  closedDay?: string;
  change?: number;
  pctChange?: number;
}

export interface AppSnapshot {
  openedPrice?: number;
  closedPrice?: number;
  sourceOpen?: RsSource;
  sourceClose?: RsSource;
  takenAt?: number;
}

export interface UserTradeOverlay {
  positionId: string;
  executed: boolean;
  // Preferred field names
  open?: UserTradeSide;
  close?: UserTradeSide;
  // Back-compat aliases
  opened?: UserTradeSide;
  closed?: UserTradeSide;
  actualPnl?: ActualPnl;
  appSnapshot?: AppSnapshot;
}

// Callable DTOs (FE-facing)
export interface GetPositionWithActualsResponse { position?: RsPositionDoc; user?: UserTradeOverlay }
export interface GetPairSignalsWithActualsResponse { items: Array<{ position: RsPositionDoc; user?: UserTradeOverlay }> }
