/**
 * Savant Trader Order Intent Service
 *
 * Firestore CRUD for durable order intents at savant-trader/data/order-intents.
 * Mirrors the OccurrenceDecisionService pattern: requireUserId + injection context.
 */
import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  deleteField,
} from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { Collection } from '../../../core/common/constants';
import { requireUserId } from './firestore-helpers';
import {
  OrderIntent,
  OrderIntentStatus,
} from './order-intent.types';

/**
 * Statuses that should not be loaded on page hydration.
 * FILLED and FAILED orders are loaded so users can place stop losses, retry,
 * or reconcile an ambiguous broker result. Only CANCELLED is excluded.
 */
const EXCLUDED_STATUSES: OrderIntentStatus[] = [
  OrderIntentStatus.CANCELLED,
];

/**
 * Recursively remove `undefined` values from an object so Firestore's
 * WriteBatch does not reject the write. Firestore treats `undefined` as
 * an unsupported field value (unlike `null`, which is valid).
 */
function stripUndefined<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripUndefined) as T;
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (value === undefined) continue;
    cleaned[key] = typeof value === 'object' ? stripUndefined(value) : value;
  }
  return cleaned as T;
}

@Injectable({ providedIn: 'root' })
export class OrderIntentService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(EnvironmentInjector);

  private readonly intentsCollection = collection(this.firestore, Collection.ST_ORDER_INTENTS);

  /** Create a new order intent document. */
  createIntent(intent: OrderIntent): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const docRef = doc(this.firestore, Collection.ST_ORDER_INTENTS, intent.id);
        await writeBatch(this.firestore)
          .set(docRef, stripUndefined({ ...intent, userId }))
          .commit();
      })),
      map(() => undefined)
    );
  }

  /** Merge-update an existing intent. The instrumentType discriminant cannot be changed. */
  updateIntent(id: string, partial: Partial<Omit<OrderIntent, 'instrumentType'>>): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() => runInInjectionContext(this.injector, async () => {
        const docRef = doc(this.firestore, Collection.ST_ORDER_INTENTS, id);
        const nowIso = new Date().toISOString();
        const updateData = stripUndefined({ ...partial, updatedAt: nowIso }) as Record<string, unknown>;
        // `undefined` is stripped for normal fields, but an explicitly cleared
        // optional field must be deleted from the existing Firestore document.
        if ('error' in partial && partial.error === undefined) {
          updateData['error'] = deleteField();
        }
        await writeBatch(this.firestore)
          .update(docRef, updateData)
          .commit();
      })),
      map(() => undefined)
    );
  }

  /** Delete an intent document. */
  deleteIntent(id: string): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() => runInInjectionContext(this.injector, async () => {
        const docRef = doc(this.firestore, Collection.ST_ORDER_INTENTS, id);
        await writeBatch(this.firestore)
          .delete(docRef)
          .commit();
      })),
      map(() => undefined)
    );
  }

  /**
   * One-time migration for the legacy synthetic SCHB stop-loss document ID.
   * The copy and delete are committed atomically; the Robinhood order is untouched.
   */
  migrateLegacyStopLossIntent(): Observable<void> {
    const oldId = 'broker-position-SCHB-SL';
    const newId = 'SCHB-STOP_LOSS-260904-FRI-0851PT';
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() => runInInjectionContext(this.injector, async () => {
        const oldRef = doc(this.firestore, Collection.ST_ORDER_INTENTS, oldId);
        const newRef = doc(this.firestore, Collection.ST_ORDER_INTENTS, newId);
        const oldSnapshot = await getDoc(oldRef);
        if (!oldSnapshot.exists()) return;
        const existing = oldSnapshot.data() as Record<string, unknown>;
        const newSnapshot = await getDoc(newRef);
        if (newSnapshot.exists()) {
          await writeBatch(this.firestore).delete(oldRef).commit();
          return;
        }
        await writeBatch(this.firestore)
          .set(newRef, { ...existing, id: newId, updatedAt: new Date().toISOString() })
          .delete(oldRef)
          .commit();
      })),
      map(() => undefined),
    );
  }

  /** Recover the known KMEM fractional-close response that predates nested-order parsing. */
  recoverKnownKmemFractionalClose(): Observable<void> {
    const brokerOrder = {
      id: '6a9c4835-9ea0-4ff7-83b7-1a70851a67b0',
      instrumentId: '85210018-1426-4160-9225-167674b1eb51',
      symbol: 'KMEM',
      side: 'sell',
      type: 'market',
      state: 'queued',
      quantity: '0.107278',
      cumulativeQuantity: '0.000000',
      price: null,
      stopPrice: null,
      fees: '0.000000',
      dollarBasedAmount: null,
      timeInForce: 'gfd',
      marketHours: 'regular_hours',
      trigger: 'immediate',
      placedAgent: 'agentic',
      createdAt: '2026-09-05T16:49:58.018217Z',
      lastTransactionAt: '2026-09-05T16:49:58.018217Z',
      executions: [],
    };
    return this.loadAllIntents().pipe(
      take(1),
      switchMap((intents) => {
        const intent = intents.find((candidate) =>
          candidate.sourceRef?.type === 'fractional_close' &&
          'symbol' in candidate && candidate.symbol === 'KMEM' &&
          candidate.quantity === '0.107278',
        );
        if (!intent) return of(undefined);
        return this.updateIntent(intent.id, {
          status: OrderIntentStatus.QUEUED,
          error: undefined,
          result: {
            ...intent.result,
            orderId: brokerOrder.id,
            state: brokerOrder.state,
            filledQuantity: brokerOrder.cumulativeQuantity,
            brokerOrder,
          },
          updatedAt: new Date().toISOString(),
        });
      }),
      map(() => undefined),
    );
  }

  /** Load all active intents for the current user, including FILLED (for stop loss placement). */
  loadAllIntents(): Observable<OrderIntent[]> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => {
        const q = query(
          this.intentsCollection,
          where('userId', '==', userId),
          where('status', 'not-in', EXCLUDED_STATUSES)
        );
        return from(getDocs(q)).pipe(
          map((snapshot) =>
            snapshot.docs.map((d) => d.data() as OrderIntent)
          )
        );
      })
    );
  }

  /** Load a single intent by id, or null if not found. */
  loadIntent(id: string): Observable<OrderIntent | null> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() => runInInjectionContext(this.injector, async () => {
        const docRef = doc(this.firestore, Collection.ST_ORDER_INTENTS, id);
        const snap = await getDoc(docRef);
        return snap.exists() ? (snap.data() as OrderIntent) : null;
      })),
      map((intent) => intent ?? null)
    );
  }
}
