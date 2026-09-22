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
  getDoc,
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
  legacyListKey,
  ALL_LEGACY_LIST_IDS,
  USER_LIST_ORDER_START,
} from '../common/symbol-list-defs';

/** Stable catalog ordering — by `order` field. */
const byOrder = (a: SymbolListDef, b: SymbolListDef) => a.order - b.order;

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
            return this.resolveSnapshot(userId, docs);
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
   * Split the snapshot into registry docs and legacy docs; when legacy docs
   * exist, batch-rekey them and emit the merged def view. On batch failure
   * emit the best-effort view (docs-as-defs) — reads stay correct and the
   * migration retries on the next emission.
   */
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

  private async resolveSnapshot(
    userId: string,
    docs: { id: string; data: DocumentData }[],
  ): Promise<SymbolListDef[]> {
    const prefix = `${userId}_`;
    const registry = new Map<string, SymbolListDef>();
    const legacy: typeof docs = [];

    for (const d of docs) {
      const isRegistry = d.id.startsWith(prefix) && d.data['key'];
      if (isRegistry) registry.set(d.data['key'], this.toDef(d.data));
      else legacy.push(d);
    }
    if (legacy.length === 0) return [...registry.values()].sort(byOrder);

    const out = new Map(registry);
    const batch = writeBatch(this.firestore);
    // Deterministic order for synthetic ordering of unknown lists.
    legacy.sort((a, b) => a.id.localeCompare(b.id));
    let userOrder = USER_LIST_ORDER_START;
    for (const d of legacy) {
      // Name wins; a prefixed-but-unstamped id falls back to its suffix.
      const name =
        (d.data['name'] as string) ??
        (d.id.startsWith(prefix) ? d.id.slice(prefix.length) : d.id);
      const key = legacyListKey(name);
      const template = systemListDef(key);
      // Merge into the accumulated view — covers both an existing registry
      // doc and a previous legacy doc that resolved to the same key.
      const existing = out.get(key);
      const symbols = [
        ...new Set([...(existing?.symbols ?? []), ...((d.data['symbols'] as string[]) ?? [])]),
      ];
      const def: SymbolListDef = {
        ...(existing ?? template ?? {
          key, label: name, order: userOrder++, role: 'nonexclusive', hidden: false,
        }),
        symbols,
        userId,
        createdAt: existing?.createdAt ?? d.data['createdAt'],
      };
      batch.set(
        doc(this.firestore, Collection.ST_SYMBOL_LISTS, symbolListDocId(userId, key)),
        {
          key: def.key,
          label: def.label,
          order: def.order,
          role: def.role,
          hidden: def.hidden,
          symbols,
          userId,
          createdAt: def.createdAt ?? serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      // A prefixed-but-unstamped doc rekeys to itself — delete would erase it.
      if (d.id !== symbolListDocId(userId, key)) {
        batch.delete(doc(this.firestore, Collection.ST_SYMBOL_LISTS, d.id));
      }
      out.set(key, def);
    }

    try {
      await batch.commit();
    } catch (err) {
      console.error('[SymbolListService] registry doc migration failed', err);
      return this.fallbackDefs(userId, docs);
    }
    return [...out.values()].sort(byOrder);
  }

  /**
   * Best-effort defs straight from the snapshot when the migration batch
   * fails — legacy docs map name→key, same-key docs merge, nothing written.
   */
  private fallbackDefs(
    userId: string,
    docs: { id: string; data: DocumentData }[],
  ): SymbolListDef[] {
    const prefix = `${userId}_`;
    const out = new Map<string, SymbolListDef>();
    const sorted = [...docs].sort((a, b) => a.id.localeCompare(b.id));
    let userOrder = USER_LIST_ORDER_START;
    for (const d of sorted) {
      const isRegistry = d.id.startsWith(prefix) && d.data['key'];
      if (isRegistry) {
        const def = this.toDef(d.data);
        const prev = out.get(def.key);
        out.set(def.key, {
          ...def,
          symbols: [...new Set([...(prev?.symbols ?? []), ...def.symbols])],
        });
        continue;
      }
      const name =
        (d.data['name'] as string) ??
        (d.id.startsWith(prefix) ? d.id.slice(prefix.length) : d.id);
      const key = legacyListKey(name);
      const template = systemListDef(key);
      const symbols = (d.data['symbols'] as string[]) ?? [];
      const prev = out.get(key);
      out.set(key, {
        ...(prev ?? template ?? {
          key, label: name, order: userOrder++, role: 'nonexclusive', hidden: false,
        }),
        symbols: [...new Set([...(prev?.symbols ?? []), ...symbols])],
        userId,
        createdAt: prev?.createdAt ?? d.data['createdAt'],
      });
    }
    return [...out.values()].sort(byOrder);
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

  /** Convert a registry doc's data into the typed def shape. */
  private toDef(data: DocumentData): SymbolListDef {
    const key = String(data['key']);
    const role = data['role'] === 'exclusive' ? 'exclusive' : 'nonexclusive';
    return {
      key,
      label: data['label'] ?? key,
      order: typeof data['order'] === 'number' ? data['order'] : 0,
      role,
      hidden: data['hidden'] === true,
      symbols: Array.isArray(data['symbols']) ? (data['symbols'] as string[]) : [],
      userId: data['userId'],
      createdAt: data['createdAt'],
      updatedAt: data['updatedAt'],
    };
  }

}
