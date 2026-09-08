/**
 * Savant Trader Order Ticket Service
 *
 * Firestore CRUD for durable order tickets at savant-trader/data/order-intents.
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
import { Observable, from } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { Collection } from '../../../core/common/constants';
import { requireUserId } from './firestore-helpers';
import {
  OrderTicket,
  OrderTicketStatus,
} from './order-ticket.types';

/**
 * Statuses that should not be loaded on page hydration.
 * FILLED and FAILED orders are loaded so users can place stop losses, retry,
 * or reconcile an ambiguous broker result. Only CANCELLED is excluded.
 */
const EXCLUDED_STATUSES: OrderTicketStatus[] = [
  OrderTicketStatus.CANCELLED,
];

/**
 * Recursively remove `undefined` values from an object so Firestore's
 * WriteBatch does not reject the write. Firestore treats `undefined` as
 * an unsupported field value (unlike `null`, which is valid).
 *
 * Firestore sentinel values (DeleteField, ServerTimestamp, etc.) are
 * passed through unchanged — they carry a `_methodName` property that
 * the SDK recognizes by reference, so we must not clone them.
 */
function stripUndefined<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  // Pass Firestore sentinel values through unchanged.
  if (obj && typeof obj === 'object' && '_methodName' in obj) return obj;
  if (Array.isArray(obj)) return obj.map(stripUndefined) as T;
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (value === undefined) continue;
    cleaned[key] = typeof value === 'object' ? stripUndefined(value) : value;
  }
  return cleaned as T;
}

@Injectable({ providedIn: 'root' })
export class OrderTicketService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(EnvironmentInjector);

  private readonly ticketsCollection = collection(this.firestore, Collection.ST_ORDER_INTENTS);

  /** Create a new order ticket document. */
  createTicket(ticket: OrderTicket): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const docRef = doc(this.firestore, Collection.ST_ORDER_INTENTS, ticket.id);
        await writeBatch(this.firestore)
          .set(docRef, stripUndefined({ ...ticket, userId }))
          .commit();
      })),
      map(() => undefined)
    );
  }

  /** Merge-update an existing ticket. The instrumentType discriminant cannot be changed.
   *  Any field with value `undefined` in the partial is deleted from Firestore via deleteField(). */
  updateTicket(id: string, partial: Partial<Omit<OrderTicket, 'instrumentType'>>): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() => runInInjectionContext(this.injector, async () => {
        const docRef = doc(this.firestore, Collection.ST_ORDER_INTENTS, id);
        const nowIso = new Date().toISOString();
        // Any explicitly-undefined field in the partial means "delete this field
        // from Firestore." stripUndefined would silently drop it, leaving the
        // stale value behind. Convert those to deleteField() sentinels first.
        const withDeletions: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(partial)) {
          withDeletions[key] = value === undefined ? deleteField() : value;
        }
        withDeletions['updatedAt'] = nowIso;
        const updateData = stripUndefined(withDeletions) as Record<string, unknown>;
        await writeBatch(this.firestore)
          .update(docRef, updateData)
          .commit();
      })),
      map(() => undefined)
    );
  }

  /** Delete a ticket document. */
  deleteTicket(id: string): Observable<void> {
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

  /** Load all active tickets for the current user, including FILLED (for stop loss placement). */
  loadAllTickets(): Observable<OrderTicket[]> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => {
        const q = query(
          this.ticketsCollection,
          where('userId', '==', userId),
          where('status', 'not-in', EXCLUDED_STATUSES)
        );
        return from(getDocs(q)).pipe(
          map((snapshot) =>
            snapshot.docs.map((d) => d.data() as OrderTicket)
          )
        );
      })
    );
  }

  /** Load a single ticket by id, or null if not found. */
  loadTicket(id: string): Observable<OrderTicket | null> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() => runInInjectionContext(this.injector, async () => {
        const docRef = doc(this.firestore, Collection.ST_ORDER_INTENTS, id);
        const snap = await getDoc(docRef);
        return snap.exists() ? (snap.data() as OrderTicket) : null;
      })),
      map((ticket) => ticket ?? null)
    );
  }
}
