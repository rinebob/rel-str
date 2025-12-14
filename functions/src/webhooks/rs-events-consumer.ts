import { RsDirection, Interval } from '../types/signal.types';
import { RsEventKind } from './webhooks-config';
import { writePairSignalOpen, finalizePairSignalClose, openRootPositionTimeline, closeRootPositionTimeline } from './positions-manager';

export interface RsOpenWriteEvent {
  kind: RsEventKind.OPEN;
  pair: string;        // BASE-SYMBOL
  baseline: string;
  symbol: string;
  day: string;         // YYYY-MM-DD
  timestamp: number;   // epoch ms
  direction: RsDirection;
  rsYesterday: number;
  rsToday: number;
  rsNormYesterday: number;
  rsNormToday: number;
  price: number;       // entry/exit price at this event
  interval?: Interval; // DAILY | WEEKLY | MONTHLY (defaults to DAILY)
  positionId?: string; // optional explicit positionId (used by backfill/live when precomputed)
}

export interface RsCloseWriteEvent {
  kind: RsEventKind.CLOSE;
  pair: string;        // BASE-SYMBOL
  baseline: string;
  symbol: string;
  day: string;         // YYYY-MM-DD
  timestamp: number;   // epoch ms
  direction: RsDirection;
  rsYesterday: number;
  rsToday: number;
   rsNormYesterday: number;
   rsNormToday: number;
  price: number;       // entry/exit price at this event
  interval?: Interval; // DAILY | WEEKLY | MONTHLY (defaults to DAILY)
  positionId: string;  // existing open position id to be closed
}

export type RsWriteEvent = RsOpenWriteEvent | RsCloseWriteEvent;

/**
 * Shared consumer that maps OPEN/CLOSE RS events into Firestore writes
 * for canonical signals and root positions timeline. This helper is used
 * by both live and backfill paths to keep the write logic in sync.
 */
export async function applyRsEventsForPair(events: RsWriteEvent[]): Promise<void> {
  for (const ev of events) {
    if (ev.kind === RsEventKind.OPEN) {
      const interval = ev.interval ?? Interval.DAILY;
      const positionId = ev.positionId;
      if (!positionId || positionId.trim().length === 0) {
        throw new Error('applyRsEventsForPair: positionId is required for OPEN events');
      }

      await writePairSignalOpen(ev.pair, positionId, ev.day, {
        baseline: ev.baseline,
        symbol: ev.symbol,
        direction: ev.direction,
        entryDay: ev.day,
        entryTimestamp: ev.timestamp,
        entryPrice: ev.price,
        opened: {
          day: ev.day,
          t: ev.timestamp,
          rsYesterday: ev.rsYesterday,
          rsToday: ev.rsToday,
          rsNormYesterday: ev.rsNormYesterday,
          rsNormToday: ev.rsNormToday,
          openPrice: ev.price,
        },
      }, interval);

      await openRootPositionTimeline({
        positionId,
        pair: ev.pair,
        baseline: ev.baseline,
        symbol: ev.symbol,
        direction: ev.direction,
        day: ev.day,
        timestamp: ev.timestamp,
        price: ev.price,
        rsRaw: ev.rsToday,
        rsNorm: ev.rsNormToday,
        prevRsRaw: ev.rsYesterday,
        prevRsNorm: ev.rsNormYesterday,
        interval,
      });
    } else if (ev.kind === RsEventKind.CLOSE) {
      const interval = ev.interval ?? Interval.DAILY;
      if (!ev.positionId || ev.positionId.trim().length === 0) {
        throw new Error('applyRsEventsForPair: positionId is required for CLOSE events');
      }

      await finalizePairSignalClose(ev.pair, ev.positionId, ev.day, {
        baseline: ev.baseline,
        symbol: ev.symbol,
        direction: ev.direction,
        exitPrice: ev.price,
        closed: {
          day: ev.day,
          t: ev.timestamp,
          rsYesterday: ev.rsYesterday,
          rsToday: ev.rsToday,
          rsNormYesterday: ev.rsNormYesterday,
          rsNormToday: ev.rsNormToday,
          closePrice: ev.price,
        },
      }, interval);

      await closeRootPositionTimeline({
        positionId: ev.positionId,
        day: ev.day,
        timestamp: ev.timestamp,
        price: ev.price,
        rsRaw: ev.rsToday,
        rsNorm: ev.rsNormToday,
        prevRsRaw: ev.rsYesterday,
        prevRsNorm: ev.rsNormYesterday,
      });
    }
  }
}
