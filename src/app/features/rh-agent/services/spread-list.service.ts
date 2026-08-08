/**
 * @topic #77 — Spread Time Series Viewer (opened 2026-08-02)
 *
 * Firestore CRUD for spread list persistence.
 * Reads/writes spread-lists/{listId} directly.
 */
import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Firestore, collection, collectionData, doc, docData, setDoc, deleteDoc, getDoc, query, where, runTransaction } from '@angular/fire/firestore';
import { Observable, throwError, map } from 'rxjs';

import { Collection } from '../../../core/common/constants';
import type { SpreadDefinition, SpreadListDoc } from '@spread/contracts';

const RECENT_LIST_ID = 'recent';
const MAX_RECENT = 10;

@Injectable({ providedIn: 'root' })
export class SpreadListService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  private get userId(): string {
    return this.auth.currentUser?.uid ?? '';
  }

  private requireUserId(): string {
    const uid = this.userId;
    if (!uid) throw new Error('Authentication required');
    return uid;
  }

  /** Load all named lists for the current user. */
  loadNamedLists$(): Observable<SpreadListDoc[]> {
    try {
      const uid = this.requireUserId();
      const ref = collection(this.firestore, Collection.SPREAD_LISTS);
      const q = query(ref, where('userId', '==', uid));
      return collectionData(q, { idField: 'id' }).pipe(
        map((docs) => {
          const lists = docs as SpreadListDoc[];
          return lists.sort((a, b) => {
            const aTime = a.updatedAt ? String(a.updatedAt) : '';
            const bTime = b.updatedAt ? String(b.updatedAt) : '';
            return bTime.localeCompare(aTime);
          });
        }),
      );
    } catch (err) {
      return throwError(() => err);
    }
  }

  /** Load the user's recent spreads list. */
  loadRecentList$(): Observable<SpreadDefinition[]> {
    try {
      const uid = this.requireUserId();
      const ref = doc(this.firestore, `${Collection.SPREAD_LISTS}/${uid}_${RECENT_LIST_ID}`);
      return docData(ref).pipe(
        map((data) => (data as SpreadListDoc)?.spreads ?? []),
      );
    } catch (err) {
      return throwError(() => err);
    }
  }

  /** Save a named list (create or update). */
  async saveList(name: string, spreads: SpreadDefinition[]): Promise<void> {
    const uid = this.requireUserId();
    const listId = `${uid}_${name}`;
    const ref = doc(this.firestore, `${Collection.SPREAD_LISTS}/${listId}`);
    const snap = await getDoc(ref);
    const now = new Date().toISOString();
    await setDoc(ref, {
      userId: uid,
      name,
      spreads: spreads.map(cleanDefinition),
      createdAt: snap.exists() ? undefined : now,
      updatedAt: now,
    }, { merge: true });
  }

  /** Add a spread to the recent list, evicting oldest beyond MAX_RECENT. */
  async addToRecent(spread: SpreadDefinition): Promise<void> {
    const uid = this.requireUserId();
    const listId = `${uid}_${RECENT_LIST_ID}`;
    const ref = doc(this.firestore, `${Collection.SPREAD_LISTS}/${listId}`);
    const now = new Date().toISOString();

    await runTransaction(this.firestore, async (txn) => {
      const snap = await txn.get(ref);
      const existing = snap.exists() ? (snap.data() as SpreadListDoc).spreads ?? [] : [];
      const updated = [cleanDefinition(spread), ...existing].slice(0, MAX_RECENT);

      txn.set(ref, {
        userId: uid,
        name: RECENT_LIST_ID,
        spreads: updated,
        createdAt: snap.exists() ? undefined : now,
        updatedAt: now,
      }, { merge: true });
    });
  }

  /** Delete a list by its document ID. */
  async deleteList(listId: string): Promise<void> {
    const ref = doc(this.firestore, `${Collection.SPREAD_LISTS}/${listId}`);
    await deleteDoc(ref);
  }
}

/** Remove undefined fields from a SpreadDefinition so Firestore doesn't reject it. */
function cleanDefinition(def: SpreadDefinition): SpreadDefinition {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(def)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned as unknown as SpreadDefinition;
}
