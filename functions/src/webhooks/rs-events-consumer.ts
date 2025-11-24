import { RsDirection, RsSource } from '../types/signal.types';
import { writePairSignalOpen, finalizePairSignalClose, openRootPositionTimeline, closeRootPositionTimeline } from './positions-manager';

export interface RsOpenWriteEvent {
  kind: 'OPEN';
  pair: string;        // BASE-SYMBOL
  baseline: string;
  symbol: string;
  day: string;         // YYYY-MM-DD
  timestamp: number;   // epoch ms
  direction: RsDirection;
  rsYesterday: number;
  rsToday: number;
  price: number;       // entry/exit price at this event
  positionId?: string; // optional explicit positionId (used by backfill/live when precomputed)
}

export interface RsCloseWriteEvent {
  kind: 'CLOSE';
  pair: string;        // BASE-SYMBOL
  baseline: string;
  symbol: string;
  day: string;         // YYYY-MM-DD
  timestamp: number;   // epoch ms
  direction: RsDirection;
  rsYesterday: number;
  rsToday: number;
  price: number;       // entry/exit price at this event
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
    if (ev.kind === 'OPEN') {
      const d = new Date(ev.timestamp);
      const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
      const positionId = (ev.positionId && ev.positionId.trim().length > 0)
        ? ev.positionId
        : `${ev.day.replace(/-/g, '')}-${dow.toUpperCase()}-${ev.pair}-${ev.direction}`;

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
          source: RsSource.POST,
          rsYesterday: ev.rsYesterday,
          rsToday: ev.rsToday,
          openPrice: ev.price,
        },
      } as any);

      await openRootPositionTimeline({
        positionId,
        pair: ev.pair,
        baseline: ev.baseline,
        symbol: ev.symbol,
        direction: ev.direction,
        day: ev.day,
        timestamp: ev.timestamp,
        price: ev.price,
        rs: ev.rsToday,
      });
    } else if (ev.kind === 'CLOSE') {
      await finalizePairSignalClose(ev.pair, ev.positionId, ev.day, {
        baseline: ev.baseline,
        symbol: ev.symbol,
        direction: ev.direction,
        exitPrice: ev.price,
        closed: {
          day: ev.day,
          t: ev.timestamp,
          source: RsSource.POST,
          rsYesterday: ev.rsYesterday,
          rsToday: ev.rsToday,
          closePrice: ev.price,
        },
      } as any);

      await closeRootPositionTimeline({
        positionId: ev.positionId,
        day: ev.day,
        timestamp: ev.timestamp,
        price: ev.price,
        rs: ev.rsToday,
      });
    }
  }
}
