// Frontend models for RsSignalHistory
import { PositionDoc, PositionDirection } from './fe-position.types';

export type RsSource = 'pre' | 'post';

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

type RsSignalIdentity = Pick<PositionDoc, 'positionId' | 'pair' | 'baseline' | 'symbol' | 'status' | 'currentRs' | 'exitRs'>;

export interface RsSignalDoc extends RsSignalIdentity {
  direction: PositionDirection;
  opened: RsPositionOpened;
  closed?: RsPositionClosed;
  appPnl?: AppPnl;
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
export interface GetPositionWithActualsResponse { position?: RsSignalDoc; user?: UserTradeOverlay }
export interface GetPairSignalsWithActualsResponse { items: Array<{ position: RsSignalDoc; user?: UserTradeOverlay }> }
