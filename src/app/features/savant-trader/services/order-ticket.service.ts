/**
 * Savant Trader Order Ticket Service
 *
 * Firestore CRUD for durable order tickets at st-order-tickets — the
 * canonical universal ticket root (#984/#1015). The FE keeps its legacy
 * OrderTicket domain type; order-ticket-st-mapper translates it to and
 * from the StOrderTicket doc schema (mode/origin/terms/state) at this
 * boundary.
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
import { Observable, from } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { ST_ORDER_TICKETS_ROOT } from '@st/collections';
import type { StOrderTicket, StTicketFillSummary, StTicketState } from '@st/order-tickets';
import { requireUserId } from './firestore-helpers';
import {
  fromStOrderTicket,
  stDocId,
  toStOrderTicket,
  toStTicketPatch,
} from './order-ticket-st-mapper';
import {
  OrderTicket,
  OrderTicketPatch,
  OrderTicketStatus,
} from './order-ticket.types';

/**
 * Canonical states excluded from page hydration.
 * FILLED orders are excluded — they are represented by broker positions.
 * CANCELLED orders are loaded so the user can requeue recent cancellations;
 * old cancelled orders are filtered out in memory by the page.
 */
const EXCLUDED_STATES: StTicketState[] = ['filled'];

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

  private readonly ticketsCollection = collection(this.firestore, ST_ORDER_TICKETS_ROOT);

  /** Create a new order ticket document. */
  createTicket(ticket: OrderTicket): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const stDoc = toStOrderTicket(ticket, userId);
        const docRef = doc(this.firestore, ST_ORDER_TICKETS_ROOT, stDoc.id);
        await writeBatch(this.firestore)
          .set(docRef, stripUndefined(stDoc))
          .commit();
      })),
      map(() => undefined)
    );
  }

  /** Merge-update an existing ticket. The instrumentType discriminant cannot be changed.
   *  Any field with value `undefined` in the partial is deleted from Firestore via deleteField(). */
  updateTicket(id: string, partial: OrderTicketPatch): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() => runInInjectionContext(this.injector, async () => {
        const docRef = doc(this.firestore, ST_ORDER_TICKETS_ROOT, stDocId(id));
        const nowIso = new Date().toISOString();
        // toStTicketPatch converts explicitly-undefined fields to
        // deleteField() sentinels on their canonical paths — a dropped
        // stale value can't survive the migration boundary.
        const updateData = stripUndefined(toStTicketPatch(partial, nowIso));
        // An explicit `updatedAt: undefined` lands as a deleteField
        // sentinel — updatedAt is audit-required, so the stamp always
        // wins over an accidental delete.
        const stamped = updateData['updatedAt'];
        updateData['updatedAt'] =
          stamped === undefined ||
          (stamped !== null && typeof stamped === 'object' && '_methodName' in stamped)
            ? nowIso
            : stamped;
        await writeBatch(this.firestore)
          .update(docRef, updateData)
          .commit();
      })),
      map(() => undefined)
    );
  }

  /** Batch-update terminal status on multiple tickets in a single Firestore
   *  writeBatch. Used by reconciliation to avoid N independent commits.
   *  `fillSummary`/`lastError` are required by the canonical audit for
   *  FILLED/FAILED docs respectively — reconciliation supplies them from
   *  the RH order snapshot. */
  batchUpdateTerminalStatus(updates: Array<{
    id: string;
    status: OrderTicketStatus;
    terminalAt: string;
    fillSummary?: StTicketFillSummary;
    lastError?: { category: string; message: string };
  }>): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() => runInInjectionContext(this.injector, async () => {
        if (updates.length === 0) return;
        const batch = writeBatch(this.firestore);
        for (const { id, status, terminalAt, fillSummary, lastError } of updates) {
          const docRef = doc(this.firestore, ST_ORDER_TICKETS_ROOT, stDocId(id));
          const statePatch = toStTicketPatch({ status }, terminalAt);
          batch.update(docRef, {
            ...statePatch,
            terminalAt,
            // Mirror the BE writer's terminal stamps (markFilled /
            // markCancelled) so the doc reads the same regardless of writer.
            ...(status === OrderTicketStatus.FILLED ? { filledAt: terminalAt } : {}),
            ...(status === OrderTicketStatus.CANCELLED ? { cancelledAt: terminalAt } : {}),
            ...(fillSummary ? { fillSummary } : {}),
            ...(lastError ? { lastError } : {}),
            updatedAt: new Date().toISOString(),
          });
        }
        await batch.commit();
      })),
      map(() => undefined)
    );
  }

  /** Delete a ticket document. */
  deleteTicket(id: string): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() => runInInjectionContext(this.injector, async () => {
        const docRef = doc(this.firestore, ST_ORDER_TICKETS_ROOT, stDocId(id));
        await writeBatch(this.firestore)
          .delete(docRef)
          .commit();
      })),
      map(() => undefined)
    );
  }

  /** Load all active tickets for the current user.
   *  FILLED is excluded (filled orders are represented by broker positions).
   *  CANCELLED is loaded so recent cancellations can be requeued. */
  loadAllTickets(): Observable<OrderTicket[]> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => {
        // `not-in` excludes docs missing `state` entirely (Firestore
        // semantics) — malformed canonical docs fail closed/invisible
        // rather than hydrating with a bogus status; the #1002 audit
        // surfaces them.
        const q = query(
          this.ticketsCollection,
          where('userId', '==', userId),
          where('state', 'not-in', EXCLUDED_STATES)
        );
        return from(getDocs(q)).pipe(
          map((snapshot) =>
            snapshot.docs.map((d) => fromStOrderTicket(d.data() as StOrderTicket))
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
        const docRef = doc(this.firestore, ST_ORDER_TICKETS_ROOT, stDocId(id));
        const snap = await getDoc(docRef);
        return snap.exists() ? fromStOrderTicket(snap.data() as StOrderTicket) : null;
      })),
      map((ticket) => ticket ?? null)
    );
  }
}
