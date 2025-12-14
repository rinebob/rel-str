import type { ActivityEvent, Interval } from '../types/signal.types';
import { ActivityEventKind, ActivityEventState, RsDirection } from '../types/signal.types';
import type { RsWriteEvent } from './rs-events-consumer';
import { RsEventKind } from './webhooks-config';
import type { RsSample } from './webhooks-config';

export interface GenerateActivityArgs {
  pairId: string;
  baseline: string;
  symbol: string;
  interval: Interval;
  samples: RsSample[];
  writes: RsWriteEvent[];
}

export function generateActivityFromWrites(args: GenerateActivityArgs): ActivityEvent[] {
  const { baseline, symbol, interval, samples, writes } = args;

  if (!samples.length || !writes.length) {
    return [];
  }

  const writesByPosition = new Map<string, RsWriteEvent[]>();
  for (const w of writes) {
    if (!w.positionId) continue;
    const list = writesByPosition.get(w.positionId) ?? [];
    list.push(w);
    writesByPosition.set(w.positionId, list);
  }

  if (writesByPosition.size === 0) {
    return [];
  }

  const samplesByDay = new Map<string, RsSample>();
  for (const s of samples) {
    samplesByDay.set(s.day, s);
  }
  const orderedDays = [...samplesByDay.keys()].sort();

  const events: ActivityEvent[] = [];

  for (const [positionId, posWrites] of writesByPosition.entries()) {
    posWrites.sort((a, b) => a.timestamp - b.timestamp);
    const openWrite = posWrites.find((w) => w.kind === RsEventKind.OPEN);
    if (!openWrite) continue;
    const closeWrite = posWrites.find((w) => w.kind === RsEventKind.CLOSE);

    const direction = openWrite.direction as RsDirection;
    const openDay = openWrite.day;
    const closeDay = closeWrite?.day;

    const activeDays = orderedDays.filter((d) => {
      if (d < openDay) return false;
      if (closeDay && d > closeDay) return false;
      return true;
    });

    for (const day of activeDays) {
      const sample = samplesByDay.get(day);
      if (!sample) continue;

      const idx = samples.findIndex((s) => s.day === day);
      const prev = idx > 0 ? samples[idx - 1] : undefined;
      const prevRsRaw = prev?.rsRaw;
      const prevRsNorm = prev?.rsNorm;

      const rsRaw = sample.rsRaw;
      const rsNorm = sample.rsNorm;
      if (!Number.isFinite(rsRaw) || !Number.isFinite(rsNorm)) continue;

      const dow = new Date(`${day}T00:00:00Z`)
        .toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
        .toUpperCase();

      let kind: ActivityEventKind;
      if (closeDay && day === closeDay) {
        kind = ActivityEventKind.CLOSE;
      } else if (day === openDay) {
        kind = ActivityEventKind.OPEN;
      } else {
        kind = ActivityEventKind.HOLD;
      }

      events.push({
        kind,
        interval,
        day,
        dow,
        positionId,
        baseline,
        symbol,
        direction,
        rsRaw,
        rsNorm,
        prevRsRaw,
        prevRsNorm,
        state: ActivityEventState.PREVIEW,
        signalId: undefined,
      });
    }
  }

  return events;
}
