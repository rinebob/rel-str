/**
 * @topic #108 — Options Position Strategy Engine
 *
 * Firestore read/write helpers for options strategy positions and their
 * subcollections (legs, daily-updates, raw-quotes).
 */

import { db } from '../firebase-admin-init';
import {
  OPTIONS_STRATEGY_POSITIONS_COLLECTION,
} from './collections';
import { OptionType } from '@options/common';
import type {
  DailyUpdate,
  Position,
  PositionLeg,
  RawQuote,
  SettlementData,
  LegOutcomeUpdate,
} from './types';

// ── ID helpers ───────────────────────────────────────────────────────────────

export function buildPositionId(instanceId: string, openDate: string): string {
  return `${instanceId}-${openDate}`;
}

export function buildLegId(
  type: OptionType,
  strike: number,
  expiration: string,
): string {
  const normalizedStrike = strike.toFixed(2);
  const typeLabel = type === OptionType.CALL ? 'CALL' : 'PUT';
  return `${typeLabel}-${normalizedStrike}-${expiration}`;
}

// ── Leg helpers ──────────────────────────────────────────────────────────────

/** Find the primary leg (the one with a contractID) from a position's legs. */
export function findPrimaryLeg(legs: PositionLeg[]): PositionLeg | undefined {
  return legs.find((leg) => leg.contractID);
}

// ── References ───────────────────────────────────────────────────────────────

export function positionDocRef(positionId: string) {
  return db.collection(OPTIONS_STRATEGY_POSITIONS_COLLECTION).doc(positionId);
}

export function legsCollectionRef(positionId: string) {
  return positionDocRef(positionId).collection('legs');
}

export function dailyUpdatesCollectionRef(positionId: string) {
  return positionDocRef(positionId).collection('daily-updates');
}

export function rawQuotesCollectionRef(positionId: string) {
  return positionDocRef(positionId).collection('raw-quotes');
}

// ── Read ─────────────────────────────────────────────────────────────────────

export async function getPosition(positionId: string): Promise<Position | null> {
  const snap = await positionDocRef(positionId).get();
  if (!snap.exists) {
    return null;
  }
  return { id: snap.id, ...(snap.data() as Omit<Position, 'id'>) };
}

export async function listOpenPositions(instanceId?: string): Promise<Position[]> {
  let query = db
    .collection(OPTIONS_STRATEGY_POSITIONS_COLLECTION)
    .where('status', '==', 'OPEN');

  if (instanceId) {
    query = query.where('instanceId', '==', instanceId);
  }

  const snap = await query.get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Position, 'id'>) }));
}

export async function getLegs(positionId: string): Promise<PositionLeg[]> {
  const snap = await legsCollectionRef(positionId).get();
  return snap.docs.map((doc) => doc.data() as PositionLeg);
}

export async function listPositionsByInstance(instanceId: string): Promise<Position[]> {
  const snap = await db
    .collection(OPTIONS_STRATEGY_POSITIONS_COLLECTION)
    .where('instanceId', '==', instanceId)
    .orderBy('openDate', 'desc')
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Position, 'id'>) }));
}

export async function listHeldSharesPositions(
  instanceId?: string,
): Promise<Position[]> {
  let query = db
    .collection(OPTIONS_STRATEGY_POSITIONS_COLLECTION)
    .where('status', '==', 'ASSIGNED_HOLDING_SHARES');

  if (instanceId) {
    query = query.where('instanceId', '==', instanceId);
  }

  const snap = await query.get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Position, 'id'>) }));
}

// ── Write ──────────────────────────────────────────────────────────────────────

export async function createPosition(
  position: Omit<Position, 'id'>,
  legs: PositionLeg[],
  rawQuote: RawQuote,
): Promise<Position> {
  const positionId = buildPositionId(position.instanceId, position.openDate);
  const positionRef = positionDocRef(positionId);

  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(positionRef);
    if (existing.exists) {
      throw new Error(`Position ${positionId} already exists`);
    }

    transaction.set(positionRef, position);

    for (const leg of legs) {
      const legRef = legsCollectionRef(positionId).doc(leg.id);
      transaction.set(legRef, leg);
    }

    const rawQuoteRef = rawQuotesCollectionRef(positionId).doc(rawQuote.date);
    transaction.set(rawQuoteRef, rawQuote);
  });

  return { id: positionId, ...position };
}

export async function updatePosition(
  positionId: string,
  update: Partial<Position>,
): Promise<void> {
  await positionDocRef(positionId).update(update);
}

export async function writeDailyUpdate(
  positionId: string,
  dailyUpdate: DailyUpdate,
): Promise<void> {
  const ref = dailyUpdatesCollectionRef(positionId).doc(dailyUpdate.date);
  await ref.set(dailyUpdate, { merge: true });
}

export async function writeRawQuote(
  positionId: string,
  rawQuote: RawQuote,
): Promise<void> {
  const ref = rawQuotesCollectionRef(positionId).doc(rawQuote.date);
  await ref.set(rawQuote, { merge: true });
}

export async function markPosition(
  positionId: string,
  update: Partial<Position>,
  rawQuote: RawQuote,
): Promise<void> {
  const batch = db.batch();
  batch.update(positionDocRef(positionId), update);
  batch.set(rawQuotesCollectionRef(positionId).doc(rawQuote.date), rawQuote, { merge: true });
  await batch.commit();
}

// ── Settlement helpers ───────────────────────────────────────────────────────

export async function markPositionSettled(
  positionId: string,
  settlement: SettlementData,
  legOutcomes: LegOutcomeUpdate[],
  dailyUpdate?: DailyUpdate,
): Promise<void> {
  const positionRef = positionDocRef(positionId);

  await db.runTransaction(async (transaction) => {
    transaction.update(positionRef, {
      status: settlement.status,
      currentValue: settlement.currentValue,
      currentValueAsOf: settlement.currentValueAsOf,
      unrealizedPnl: settlement.unrealizedPnl,
      ...(settlement.assignment ? { assignment: settlement.assignment } : {}),
      ...(settlement.shares ? { shares: settlement.shares } : {}),
    });

    for (const { legId, outcome, closeDate } of legOutcomes) {
      const legRef = legsCollectionRef(positionId).doc(legId);
      transaction.update(legRef, { outcome, closeDate });
    }

    if (dailyUpdate) {
      const dailyUpdateRef = dailyUpdatesCollectionRef(positionId).doc(dailyUpdate.date);
      transaction.set(dailyUpdateRef, dailyUpdate, { merge: true });
    }
  });
}

/**
 * Atomically update a held-shares position's mark and write its daily-update
 * record in a single batch — mirrors the `markPosition` pattern.
 */
export async function markHeldSharesPosition(
  positionId: string,
  update: Partial<Position>,
  dailyUpdate: DailyUpdate,
): Promise<void> {
  const batch = db.batch();
  batch.update(positionDocRef(positionId), update);
  batch.set(dailyUpdatesCollectionRef(positionId).doc(dailyUpdate.date), dailyUpdate, { merge: true });
  await batch.commit();
}
