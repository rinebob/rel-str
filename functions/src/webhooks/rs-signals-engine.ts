import { RsDirection, PositionState } from '../types/signal.types';
import { detectDailySignalsForPairDay } from './rs-signal-detector';
import { RsEventKind, type RsEvent, type RsSample, type RsThresholds } from './webhooks-config';

/**
 * Minimal shared RS engine.
 *
 * This helper encapsulates the FSM that walks a sequence of daily RS samples
 * and emits logical events (HOLD / OPEN / CLOSE) based on RS crossings.
 *
 * It is intentionally pure and IO-free so it can be used by both the live
 * pipeline (processPairLive) and historical backfills (rs-signal-history.backfill).
 */

/**
 * Walk an ordered list of RS samples and emit HOLD/OPEN/CLOSE events.
 *
 * This mirrors the state machine used in backfillSignalsHistory, but without
 * any Firestore writes. Callers are responsible for mapping the resulting
 * events into concrete writes (signals, positions, signals-daily, etc.).
 */
export function detectRsEvents(samples: RsSample[], thresholds: RsThresholds): RsEvent[] {
  const events: RsEvent[] = [];
  if (samples.length < 2) return events;

  let state: PositionState = PositionState.FLAT;
  let openedDay: string | undefined;
  let direction: RsDirection | undefined;

  for (let i = 1; i < samples.length; i++) {
    const y = samples[i - 1];
    const t = samples[i];

    const detection = detectDailySignalsForPairDay(y.rsNorm, t.rsNorm, {
      openLong: thresholds.openLong,
      closeLong: thresholds.closeLong,
      openShort: thresholds.openShort,
      closeShort: thresholds.closeShort,
    });

    const crossedOpenLong = detection.open?.direction === RsDirection.LONG;
    const crossedOpenShort = detection.open?.direction === RsDirection.SHORT;
    const crossedCloseLong = detection.close?.direction === RsDirection.LONG;
    const crossedCloseShort = detection.close?.direction === RsDirection.SHORT;

    // HOLD-FIRST semantics: if something was open yesterday and it does not
    // close today, we record a HOLD for today.
    const willCloseToday =
      (state === PositionState.LONG && crossedCloseLong) ||
      (state === PositionState.SHORT && crossedCloseShort);

    if (state !== PositionState.FLAT && openedDay && openedDay !== t.day && !willCloseToday) {
      events.push({ kind: RsEventKind.HOLD, day: t.day, direction });
    }

    // CLOSE first
    if (state === PositionState.LONG && crossedCloseLong) {
      events.push({ kind: RsEventKind.CLOSE, day: t.day, direction: RsDirection.LONG });
      state = PositionState.FLAT;
      openedDay = undefined;
      direction = undefined;
    } else if (state === PositionState.SHORT && crossedCloseShort) {
      events.push({ kind: RsEventKind.CLOSE, day: t.day, direction: RsDirection.SHORT });
      state = PositionState.FLAT;
      openedDay = undefined;
      direction = undefined;
    }

    // OPEN next (only if flat)
    if (state === PositionState.FLAT && crossedOpenLong) {
      events.push({ kind: RsEventKind.OPEN, day: t.day, direction: RsDirection.LONG });
      state = PositionState.LONG;
      openedDay = t.day;
      direction = RsDirection.LONG;
    } else if (state === PositionState.FLAT && crossedOpenShort) {
      events.push({ kind: RsEventKind.OPEN, day: t.day, direction: RsDirection.SHORT });
      state = PositionState.SHORT;
      openedDay = t.day;
      direction = RsDirection.SHORT;
    }
  }

  return events;
}
