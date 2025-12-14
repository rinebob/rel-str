import { db } from '../firebase-admin-init';
import {
  DAYS_SUBCOLLECTION,
  PAIRS_COLLECTION,
  SIGNALS_ACTIVITY_COLLECTION,
  SIGNALS_ACTIVITY_ROOT_COLLECTION,
} from './webhooks-config';
import type { ActivityEvent, Interval } from '../types/signal.types';
import { ActivityEventKind, ActivityEventState, RsDirection } from '../types/signal.types';

function getYearFromDay(day: string): string {
  return String(day).slice(0, 4);
}

function pairActivityDocRef(pairId: string, day: string) {
  const year = getYearFromDay(day);
  return db
    .collection(PAIRS_COLLECTION).doc(pairId)
    .collection(SIGNALS_ACTIVITY_COLLECTION).doc(year)
    .collection(DAYS_SUBCOLLECTION).doc(day);
}

function rootActivityDocRef(day: string) {
  const year = getYearFromDay(day);
  return db
    .collection(SIGNALS_ACTIVITY_ROOT_COLLECTION).doc(year)
    .collection(DAYS_SUBCOLLECTION).doc(day);
}

export async function upsertSignalsActivityForPair(
  pairId: string,
  day: string,
  events: ActivityEvent[],
): Promise<void> {
  const ref = pairActivityDocRef(pairId, day);
  await ref.set(
    {
      date: day,
      events,
      updatedAt: Date.now(),
    },
    { merge: true },
  );
}

export async function upsertSignalsActivityRoot(
  day: string,
  events: ActivityEvent[],
): Promise<void> {
  const ref = rootActivityDocRef(day);
  await ref.set(
    {
      date: day,
      events,
      updatedAt: Date.now(),
    },
    { merge: true },
  );
}

export interface ActivityEventBuildArgs {
  pairId: string;
  baseline: string;
  symbol: string;
  interval: Interval;
  day: string;
  direction: RsDirection;
  kind: ActivityEventKind;
  rsRaw: number;
  rsNorm: number;
  state: ActivityEventState;
  positionId: string;
  signalId?: string;
}

export function buildActivityEventFromDecision(args: ActivityEventBuildArgs): ActivityEvent {
  const dow = new Date(`${args.day}T00:00:00Z`)
    .toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
    .toUpperCase();
  return {
    kind: args.kind,
    interval: args.interval,
    day: args.day,
    dow,
    positionId: args.positionId,
    baseline: args.baseline,
    symbol: args.symbol,
    direction: args.direction,
    rsRaw: args.rsRaw,
    rsNorm: args.rsNorm,
    state: args.state,
    signalId: args.signalId,
  };
}

