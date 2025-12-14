import { Interval, RsDirection } from '../types/signal.types';
import { RsEventKind } from './webhooks-config';
import type { RsOpenWriteEvent, RsCloseWriteEvent } from './rs-events-consumer';

export interface OpenWriteArgs {
  pair: string;
  baseline: string;
  symbol: string;
  day: string;           // YYYY-MM-DD
  timestamp: number;     // epoch ms
  direction: RsDirection;
  rsYesterday: number;
  rsToday: number;
  rsNormYesterday: number;
  rsNormToday: number;
  price: number;
  interval: Interval;
  positionId?: string;
}

export function buildOpenWriteEvent(args: OpenWriteArgs): RsOpenWriteEvent {
  return {
    kind: RsEventKind.OPEN,
    pair: args.pair,
    baseline: args.baseline,
    symbol: args.symbol,
    day: args.day,
    timestamp: args.timestamp,
    direction: args.direction,
    rsYesterday: args.rsYesterday,
    rsToday: args.rsToday,
    rsNormYesterday: args.rsNormYesterday,
    rsNormToday: args.rsNormToday,
    price: args.price,
    interval: args.interval,
    positionId: args.positionId,
  };
}

export interface CloseWriteArgs {
  pair: string;
  baseline: string;
  symbol: string;
  day: string;           // YYYY-MM-DD
  timestamp: number;     // epoch ms
  direction: RsDirection;
  rsYesterday: number;
  rsToday: number;
  rsNormYesterday: number;
  rsNormToday: number;
  price: number;
  interval: Interval;
  positionId: string;
}

export function buildCloseWriteEvent(args: CloseWriteArgs): RsCloseWriteEvent {
  return {
    kind: RsEventKind.CLOSE,
    pair: args.pair,
    baseline: args.baseline,
    symbol: args.symbol,
    day: args.day,
    timestamp: args.timestamp,
    direction: args.direction,
    rsYesterday: args.rsYesterday,
    rsToday: args.rsToday,
    rsNormYesterday: args.rsNormYesterday,
    rsNormToday: args.rsNormToday,
    price: args.price,
    interval: args.interval,
    positionId: args.positionId,
  };
}
