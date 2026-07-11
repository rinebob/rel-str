/**
 * RH Agent Symbol List Service
 *
 * Manages user-defined symbol lists (watchlists) in Firestore.
 * A symbol can belong to many lists simultaneously. Lists are independent
 * of PACR daily decisions and of any single symbol classification.
 *
 * Collection: rh-agent-symbol-lists
 * Document ID: {listName}
 */
import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  Timestamp,
  serverTimestamp,
  DocumentData,
} from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { requireUserId } from './rh-agent-firestore-helpers';

export const SYMBOL_LISTS_COLLECTION = 'rh-agent-symbol-lists';

export interface RhSymbolList {
  name: string;
  symbols: string[];
  userId?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

@Injectable({ providedIn: 'root' })
export class RhAgentSymbolListService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(EnvironmentInjector);

  private readonly listsCollection = collection(this.firestore, SYMBOL_LISTS_COLLECTION);

  /** Load a single named list for the current user. */
  loadList(name: string): Observable<RhSymbolList> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const docId = this.listId(userId, name);
        const snap = await getDoc(doc(this.firestore, SYMBOL_LISTS_COLLECTION, docId));
        return snap.exists() ? this.toList(snap.id, snap.data()) : { name, symbols: [], userId };
      }))
    );
  }

  /** Load all lists for the current user. */
  loadAllLists(): Observable<RhSymbolList[]> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const q = query(this.listsCollection, where('userId', '==', userId));
        const snapshot = await getDocs(q);
        return snapshot.docs.map((d) => this.toList(d.id, d.data()));
      }))
    );
  }

  /** Replace a list with a full set of symbols. */
  setList(name: string, symbols: string[]): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const docId = this.listId(userId, name);
        const docRef = doc(this.firestore, SYMBOL_LISTS_COLLECTION, docId);
        const existing = await getDoc(docRef);
        await setDoc(
          docRef,
          {
            name,
            symbols: symbols.map((s) => s.toUpperCase()),
            userId,
            updatedAt: serverTimestamp(),
            createdAt: existing.exists() ? (existing.data()['createdAt'] ?? serverTimestamp()) : serverTimestamp(),
          },
          { merge: true }
        );
      })),
      map(() => undefined)
    );
  }

  /** Add a symbol to a list if it is not already present. */
  addToList(symbol: string, name: string): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const docId = this.listId(userId, name);
        const docRef = doc(this.firestore, SYMBOL_LISTS_COLLECTION, docId);
        const existing = await getDoc(docRef);
        const normalized = symbol.toUpperCase();
        const current = existing.exists() ? (existing.data()['symbols'] as string[] ?? []) : [];
        if (current.includes(normalized)) return;
        await setDoc(
          docRef,
          {
            name,
            symbols: [...current, normalized],
            userId,
            updatedAt: serverTimestamp(),
            createdAt: existing.exists() ? (existing.data()['createdAt'] ?? serverTimestamp()) : serverTimestamp(),
          },
          { merge: true }
        );
      })),
      map(() => undefined)
    );
  }

  /** Remove a symbol from a list. */
  removeFromList(symbol: string, name: string): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const docId = this.listId(userId, name);
        const docRef = doc(this.firestore, SYMBOL_LISTS_COLLECTION, docId);
        const existing = await getDoc(docRef);
        if (!existing.exists()) return;
        const normalized = symbol.toUpperCase();
        const current = (existing.data()['symbols'] as string[] ?? []).filter((s) => s !== normalized);
        await setDoc(
          docRef,
          {
            name,
            symbols: current,
            userId,
            updatedAt: serverTimestamp(),
            createdAt: existing.data()['createdAt'] ?? serverTimestamp(),
          },
          { merge: true }
        );
      })),
      map(() => undefined)
    );
  }

  /** Toggle a symbol in a list. */
  toggleInList(symbol: string, name: string): Observable<boolean> {
    return this.loadList(name).pipe(
      take(1),
      switchMap((list) => {
        const normalized = symbol.toUpperCase();
        const isInList = list.symbols.includes(normalized);
        if (isInList) {
          return this.removeFromList(symbol, name).pipe(map(() => false));
        } else {
          return this.addToList(symbol, name).pipe(map(() => true));
        }
      })
    );
  }

  /** Build the Firestore document ID for a list. Currently keyed by list name only. */
  private listId(_userId: string, name: string): string {
    return name;
  }

  /** Convert a Firestore document into the typed RhSymbolList shape. */
  private toList(id: string, data: DocumentData): RhSymbolList {
    return {
      name: data['name'] ?? id,
      symbols: data['symbols'] ?? [],
      userId: data['userId'],
      createdAt: data['createdAt'],
      updatedAt: data['updatedAt'],
    };
  }

}
