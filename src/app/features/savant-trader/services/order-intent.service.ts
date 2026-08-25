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
} from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { Collection } from '../../../core/common/constants';
import { requireUserId } from './firestore-helpers';
import {
  OrderIntent,
  OrderIntentStatus,
} from './order-intent.types';

/** Terminal statuses that should not be loaded on page hydration. */
const TERMINAL_STATUSES: OrderIntentStatus[] = [
  OrderIntentStatus.FILLED,
  OrderIntentStatus.FAILED,
  OrderIntentStatus.CANCELLED,
];

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
          .set(docRef, { ...intent, userId })
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
        await writeBatch(this.firestore)
          .update(docRef, { ...partial, updatedAt: nowIso })
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

  /** Load all non-terminal intents for the current user. Firestore `not-in` supports up to 10 values. */
  loadAllIntents(): Observable<OrderIntent[]> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => {
        const q = query(
          this.intentsCollection,
          where('userId', '==', userId),
          where('status', 'not-in', TERMINAL_STATUSES)
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
