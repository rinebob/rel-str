/**
 * Savant Trader Symbol List Service
 *
 * Registry model (Topic #465, Thread #492): every list — system or
 * user-created — is a `st-symbol-lists/{userId}_{key}` doc carrying
 * `{key, label, order, role, hidden, symbols[]}`. Reads go through
 * `watchLists$` (live snapshots); legacy pre-registry docs are lazily
 * rekeyed and stamped on first emission.
 *
 * Collection: savant-trader/data/symbol-lists
 * Document ID: {userId}_{key}
 */
import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  collectionSnapshots,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  Timestamp,
  serverTimestamp,
  DocumentData,
  QueryDocumentSnapshot,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { map, switchMap, take, concatMap } from 'rxjs/operators';

import { requireUserId } from './firestore-helpers';
import { Collection } from '../../../core/common/constants';
import {
  SymbolListDef,
  symbolListDocId,
  systemListDef,
  ALL_LEGACY_LIST_IDS,
  USER_LIST_ORDER_START,
  SYSTEM_LIST_KEYS,
} from '../common/symbol-list-defs';
import { resolveSnapshot } from './symbol-list-registry';

/** Compat shape for consumers still keyed on `name` (= registry key). */
export interface SymbolList {
  name: string;
  symbols: string[];
  userId?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

@Injectable({ providedIn: 'root' })
export class SymbolListService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(EnvironmentInjector);

  private readonly listsCollection = collection(this.firestore, Collection.ST_SYMBOL_LISTS);

  /**
   * Live stream of the current user's list registry. Each snapshot lazily
   * migrates pre-registry docs (bare-name ids, missing `key`): rekey to
   * `{userId}_{key}`, stamp metadata from SYSTEM_LIST_DEFS, fold
   * PAST_SIGNALS into MONITOR, delete the old doc — one batch per
   * emission. A failed migration emits a best-effort def view and retries
   * on the next snapshot.
   */
  watchLists$(): Observable<SymbolListDef[]> {
    return requireUserId(this.auth, this.injector).pipe(
      switchMap((userId) => {
        // One uid per subscription — account switches require a resubscribe.
        let firstEmission = true;
        return new Observable<QueryDocumentSnapshot[]>((subscriber) => {
          const sub = runInInjectionContext(this.injector, () => {
            const q = query(this.listsCollection, where('userId', '==', userId));
            return collectionSnapshots(q).subscribe(subscriber);
          });
          return () => sub.unsubscribe();
        }).pipe(
          concatMap(async (snap) => {
            const docs = snap.map((d) => ({ id: d.id, data: d.data() }));
            // First emission only: the userId query can't see pre-registry
            // docs that lack a userId field (e.g. backend-written bare
            // docs), so probe the known legacy ids directly.
            if (firstEmission) {
              firstEmission = false;
              docs.push(...await this.probeLegacyDocs(userId, docs));
            }
            return resolveSnapshot(this.firestore, userId, docs);
          }),
        );
      }),
    );
  }

  /**
   * Compat one-shot load — emits `SymbolList[]` with `name` = registry key
   * so existing `symbolLists` consumers keep working. New consumers should
   * subscribe to `watchLists$` for defs.
   */
  loadAllLists(): Observable<SymbolList[]> {
    return this.watchLists$().pipe(
      take(1),
      map((defs) =>
        defs.map((d) => ({
          name: d.key,
          symbols: d.symbols,
          userId: d.userId,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        })),
      ),
    );
  }

  /**
   * Probe the known legacy bare-name doc ids on the first emission — docs
   * written without a userId field (e.g. the symbol-added pipeline writer)
   * are invisible to the filtered query but still carry this user's data.
   * Docs owned by a different userId are skipped (their owner migrates them).
   */
  private async probeLegacyDocs(
    userId: string,
    alreadySeen: { id: string; data: DocumentData }[],
  ): Promise<{ id: string; data: DocumentData }[]> {
    const seen = new Set(alreadySeen.map((d) => d.id));
    const candidates = [...ALL_LEGACY_LIST_IDS].filter((id) => !seen.has(id));
    const found: { id: string; data: DocumentData }[] = [];
    await runInInjectionContext(this.injector, async () => {
      await Promise.all(
        candidates.map(async (id) => {
          const snap = await getDoc(doc(this.firestore, Collection.ST_SYMBOL_LISTS, id));
          if (!snap.exists()) return;
          const data = snap.data();
          // A bare-id doc owned by another user stays for its owner.
          if (data['userId'] && data['userId'] !== userId) return;
          found.push({ id, data });
        }),
      );
    });
    return found;
  }

  /** Add a symbol to a list if it is not already present. */
  addToList(symbol: string, key: string): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const docRef = doc(this.firestore, Collection.ST_SYMBOL_LISTS, symbolListDocId(userId, key));
        const existing = await getDoc(docRef);
        const normalized = symbol.toUpperCase();
        const current = existing.exists() ? (existing.data()['symbols'] as string[] ?? []) : [];
        if (current.includes(normalized)) return;
        await setDoc(
          docRef,
          {
            key,
            // Stamp registry metadata only when materializing a system doc —
            // user-list metadata arrives via the list-CRUD API.
            ...(existing.exists() ? {} : (systemListDef(key) ?? {})),
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
  removeFromList(symbol: string, key: string): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const docRef = doc(this.firestore, Collection.ST_SYMBOL_LISTS, symbolListDocId(userId, key));
        const existing = await getDoc(docRef);
        if (!existing.exists()) return;
        const normalized = symbol.toUpperCase();
        const current = (existing.data()['symbols'] as string[] ?? []).filter((s) => s !== normalized);
        await setDoc(
          docRef,
          {
            key,
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
   * Atomically move a symbol to a target list, removing it from all other
   * lists in the caller-supplied key set. Uses a Firestore batch write so
   * the add and all removals are committed together. If targetKey is null,
   * the symbol is removed from every list in the set (un-assign). The
   * caller (store) passes the exclusive-key set — the service stays
   * role-agnostic.
   */
  moveToList(symbol: string, targetKey: string | null, allKeys: string[]): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const normalized = symbol.toUpperCase();
        const batch = writeBatch(this.firestore);

        // Read all list docs in parallel to avoid sequential round-trips.
        const reads = allKeys.map(async (key) => {
          const docRef = doc(this.firestore, Collection.ST_SYMBOL_LISTS, symbolListDocId(userId, key));
          const existing = await getDoc(docRef);
          return { key, docRef, existing };
        });
        const results = await Promise.all(reads);

        for (const { key, docRef, existing } of results) {
          const currentSymbols: string[] = existing.exists()
            ? (existing.data()['symbols'] as string[] ?? [])
            : [];

          const newSymbols = key === targetKey
            ? (currentSymbols.includes(normalized) ? currentSymbols : [...currentSymbols, normalized])
            : currentSymbols.filter((s) => s !== normalized);

          // Only write if the array actually changed
          if (newSymbols.length !== currentSymbols.length) {
            // merge: true — a bare set would wipe label/order/role/hidden.
            batch.set(docRef, {
              key,
              ...(existing.exists() ? {} : (systemListDef(key) ?? {})),
              symbols: newSymbols,
              userId,
              updatedAt: serverTimestamp(),
              createdAt: existing.exists() ? (existing.data()['createdAt'] ?? serverTimestamp()) : serverTimestamp(),
            }, { merge: true });
          }
        }

        await batch.commit();
      })),
      map(() => undefined)
    );
  }

  /**
   * Create a user list: slug key generated from the label (collision-
   * suffixed), `role: nonexclusive`, `order` appended after the highest
   * existing order (floor USER_LIST_ORDER_START). Resolves the generated
   * key so the caller can select/navigate to the new list.
   */
  createList(label: string): Observable<string> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const snap = await getDocs(
          query(this.listsCollection, where('userId', '==', userId)),
        );
        // Case-insensitive taken set: system keys included so 'Primary'
        // can't shadow 'PRIMARY' with a lookalike lowercase slug.
        const taken = new Set<string>(
          Object.values(SYSTEM_LIST_KEYS).map((k) => k.toLowerCase()),
        );
        let maxOrder = USER_LIST_ORDER_START - 1;
        for (const d of snap.docs) {
          const data = d.data();
          if (data['key']) taken.add(String(data['key']).toLowerCase());
          if (typeof data['order'] === 'number') {
            maxOrder = Math.max(maxOrder, data['order']);
          }
        }

        const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'list';
        let key = base;
        for (let i = 2; taken.has(key); i++) key = `${base}-${i}`;

        await setDoc(
          doc(this.firestore, Collection.ST_SYMBOL_LISTS, symbolListDocId(userId, key)),
          {
            key,
            label: label.trim() || key,
            order: maxOrder + 1,
            role: 'nonexclusive',
            hidden: false,
            symbols: [],
            userId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
        return key;
      })),
    );
  }

  /**
   * Rename a list — label-only write; nothing is keyed on label. Reads
   * first so an unknown key can't materialize a stub doc. System lists
   * are renameable (label is cosmetic; the key is immutable).
   */
  renameList(key: string, label: string): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const docRef = doc(this.firestore, Collection.ST_SYMBOL_LISTS, symbolListDocId(userId, key));
        // Pre-read for the friendly error; updateDoc (not merge-set) so a
        // doc deleted mid-flight rejects atomically instead of
        // materializing a key-less stub the migration would resurrect.
        const existing = await getDoc(docRef);
        if (!existing.exists()) throw new Error(`List '${key}' does not exist`);
        await updateDoc(docRef, { label: label.trim() || key, updatedAt: serverTimestamp() });
      })),
      map(() => undefined),
    );
  }

  /**
   * Delete a user-list doc; the catalog drops it on the next emission.
   * System lists are structural (triage targets) — rejected.
   */
  deleteList(key: string): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, () => {
        if (systemListDef(key)) {
          throw new Error(`'${key}' is a system list and cannot be deleted`);
        }
        return deleteDoc(
          doc(this.firestore, Collection.ST_SYMBOL_LISTS, symbolListDocId(userId, key)),
        );
      })),
      map(() => undefined),
    );
  }

  /**
   * Persist a user-list reorder — system keys are filtered out (their
   * order block is fixed). Uses `update` (not merge-set) so a stale key
   * fails the batch atomically instead of resurrecting a ghost doc.
   */
  setListOrder(orderedKeys: string[]): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const batch = writeBatch(this.firestore);
        orderedKeys.filter((key) => !systemListDef(key)).forEach((key, i) => {
          batch.update(
            doc(this.firestore, Collection.ST_SYMBOL_LISTS, symbolListDocId(userId, key)),
            { order: USER_LIST_ORDER_START + i, updatedAt: serverTimestamp() },
          );
        });
        await batch.commit();
      })),
      map(() => undefined),
    );
  }

}
