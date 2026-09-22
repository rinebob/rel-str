/**
 * Savant Trader Symbol List Service
 *
 * Manages user-defined symbol lists (watchlists) in Firestore.
 * Triage-list membership is exclusive (moveToList removes the symbol from
 * every other list); MONITOR is the exception — the Monitor action is a
 * non-exclusive add/remove. Lists are independent of PACR daily decisions
 * and of any single symbol classification.
 *
 * Collection: savant-trader/data/symbol-lists
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

import { requireUserId } from './firestore-helpers';
import { Collection } from '../../../core/common/constants';
import { SymbolListName } from '../common/constants';

export interface SymbolList {
  name: string;
  symbols: string[];
  userId?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/** Legacy Firestore doc id for the Monitor list — migrated to MONITOR on load. */
const LEGACY_MONITOR_LIST_NAME = 'PAST_SIGNALS';

@Injectable({ providedIn: 'root' })
export class SymbolListService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(EnvironmentInjector);

  private readonly listsCollection = collection(this.firestore, Collection.ST_SYMBOL_LISTS);

  /** Load all lists for the current user. */
  loadAllLists(): Observable<SymbolList[]> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const q = query(this.listsCollection, where('userId', '==', userId));
        const snapshot = await getDocs(q);
        const lists = snapshot.docs.map((d) => this.toList(d.id, d.data()));
        return this.migrateLegacyMonitorList(userId, lists);
      }))
    );
  }

  /**
   * Rename the legacy PAST_SIGNALS doc to MONITOR in place of the loaded
   * list. Merges into an existing MONITOR doc if one somehow exists, then
   * deletes the legacy doc — the two writes commit atomically via batch.
   * A write failure leaves the unmigrated lists intact (still correct to
   * read); migration retries on the next load. No-op when no legacy doc
   * is present.
   */
  private async migrateLegacyMonitorList(userId: string, lists: SymbolList[]): Promise<SymbolList[]> {
    const legacy = lists.find((l) => l.name === LEGACY_MONITOR_LIST_NAME);
    if (!legacy) return lists;

    const monitor = lists.find((l) => l.name === SymbolListName.MONITOR);
    const merged = [...new Set([...(monitor?.symbols ?? []), ...legacy.symbols])];
    try {
      const batch = writeBatch(this.firestore);
      batch.set(doc(this.firestore, Collection.ST_SYMBOL_LISTS, SymbolListName.MONITOR), {
        name: SymbolListName.MONITOR,
        symbols: merged,
        userId,
        updatedAt: serverTimestamp(),
        createdAt: monitor?.createdAt ?? legacy.createdAt ?? serverTimestamp(),
      });
      batch.delete(doc(this.firestore, Collection.ST_SYMBOL_LISTS, LEGACY_MONITOR_LIST_NAME));
      await batch.commit();
    } catch (err) {
      console.error('[SymbolListService] legacy PAST_SIGNALS migration failed', err);
      return lists;
    }

    return lists
      .filter((l) => l.name !== LEGACY_MONITOR_LIST_NAME && l.name !== SymbolListName.MONITOR)
      .concat({ ...(monitor ?? legacy), name: SymbolListName.MONITOR, symbols: merged });
  }

  /** Add a symbol to a list if it is not already present. */
  addToList(symbol: string, name: string): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const docId = this.listId(userId, name);
        const docRef = doc(this.firestore, Collection.ST_SYMBOL_LISTS, docId);
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
        const docRef = doc(this.firestore, Collection.ST_SYMBOL_LISTS, docId);
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

  /**
   * Atomically move a symbol to a target list, removing it from all other lists.
   * Uses a Firestore batch write so the add and all removals are committed together.
   * If targetList is null, the symbol is removed from all lists (un-assign).
   */
  moveToList(symbol: string, targetList: string | null, allListNames: string[]): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const normalized = symbol.toUpperCase();
        const batch = writeBatch(this.firestore);

        // Read all list docs in parallel to avoid sequential round-trips.
        const reads = allListNames.map(async (listName) => {
          const docId = this.listId(userId, listName);
          const docRef = doc(this.firestore, Collection.ST_SYMBOL_LISTS, docId);
          const existing = await getDoc(docRef);
          return { listName, docRef, existing };
        });
        const results = await Promise.all(reads);

        for (const { listName, docRef, existing } of results) {
          const currentSymbols: string[] = existing.exists()
            ? (existing.data()['symbols'] as string[] ?? [])
            : [];

          const newSymbols = listName === targetList
            ? (currentSymbols.includes(normalized) ? currentSymbols : [...currentSymbols, normalized])
            : currentSymbols.filter((s) => s !== normalized);

          // Only write if the array actually changed
          if (newSymbols.length !== currentSymbols.length) {
            batch.set(docRef, {
              name: listName,
              symbols: newSymbols,
              userId,
              updatedAt: serverTimestamp(),
              createdAt: existing.exists() ? (existing.data()['createdAt'] ?? serverTimestamp()) : serverTimestamp(),
            });
          }
        }

        await batch.commit();
      })),
      map(() => undefined)
    );
  }

  /** Build the Firestore document ID for a list. Currently keyed by list name only. */
  private listId(_userId: string, name: string): string {
    return name;
  }

  /** Convert a Firestore document into the typed SymbolList shape. */
  private toList(id: string, data: DocumentData): SymbolList {
    return {
      name: data['name'] ?? id,
      symbols: data['symbols'] ?? [],
      userId: data['userId'],
      createdAt: data['createdAt'],
      updatedAt: data['updatedAt'],
    };
  }

}
