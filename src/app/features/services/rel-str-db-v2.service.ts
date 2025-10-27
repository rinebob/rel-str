import { EnvironmentInjector, inject, Injectable, runInInjectionContext } from '@angular/core';
import { BaselineTargetRankDatum, ListAction, RanksByDate, RelStrStockList, StockDatum, Company } from '../shared/types/rs.interfaces';
import {
  collection,
  query,
  where,
  orderBy,
  deleteDoc,
  getDocs,
  getDoc,
  setDoc,
  doc,
  docData,
  collectionData,
  Firestore,
} from '@angular/fire/firestore';
import { Observable, map, from, tap, catchError, firstValueFrom, of } from 'rxjs';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Auth } from '@angular/fire/auth';
import { CallableName, Collection, userListsPath } from '../../core/common/constants';

interface SymbolMetadata {
    supported: boolean;
    baseline: boolean;
}

interface SymbolSupport {
    [key: string]: SymbolMetadata       // key is stock symbol in uppercase
}

interface SupportedSymbolsList {
    supportedSymbolsList: string[];
}

@Injectable({ providedIn: 'root' })
export class RelStrDbV2Service {
  private readonly env = inject(EnvironmentInjector);
  readonly firestore: Firestore = inject(Firestore);
  readonly functions = inject(Functions);
  private readonly auth = inject(Auth);

  constructor() {}

  private inCtx<T>(fn: () => T): T {
    // Ensures AngularFire helper calls execute inside an injection context
    return runInInjectionContext(this.env, fn);
  }

  // New: Fetch tracked symbols via RS backend callable (SavantAPI behind it)
  getTrackedSymbols$(ttlSeconds = 600): Observable<Company[]> {
    return from(
      this.inCtx(() => {
        const callable = httpsCallable<
          { ttlSeconds?: number },
          { items: Array<{ symbol: string; name?: string }>; cached: boolean; updatedAt?: number }
        >(this.functions, CallableName.GET_TRACKED_SYMBOLS);
        return callable({ ttlSeconds });
      })
    ).pipe(
      map(res => Array.isArray(res?.data?.items) ? res.data.items : []),
      map(items => items.map(it => ({ symbol: String(it.symbol || '').toUpperCase(), company: String(it.name || it.symbol || '').trim() }) as Company)),
      catchError(err => {
        console.error('[RelStrDbService] getTrackedSymbols$ error', err);
        return of([] as Company[]);
      })
    );
  }

  // Firestore: supported pairs list (doc IDs under pairs-data)
  getSupportedPairsList$(): Observable<string[]> {
    return from(this.inCtx(() => {
      const colRef = collection(this.firestore, Collection.PAIRS_DATA);
      return getDocs(colRef);
    })).pipe(
      map(snap => snap.docs.map(d => String(d.id))),
      catchError(err => {
        console.error('[RelStrDbService] getSupportedPairsList$ error', err);
        return of([] as string[]);
      })
    );
  }

  //////////////////////////////////////////

  getListsForUser$(userId: string): Observable<RelStrStockList[]> {
    const uid = String(userId || '').trim();
    const currUid = this.auth.currentUser?.uid ?? '';
    if (!uid || uid.length === 0) {
      // Pre-auth load: avoid issuing a Firestore list that would be denied by rules
      return of([] as RelStrStockList[]);
    }
    if (!currUid || currUid !== uid) {
      console.warn('[RelStrDbService] getListsForUser$ skipped: auth uid mismatch or missing', { requested: uid, current: currUid });
      return of([] as RelStrStockList[]);
    }
    return from(this.inCtx(() => {
      const colRef = collection(this.firestore, userListsPath(uid));
      const qRef = query(colRef, orderBy('updatedAt', 'desc'));
      return getDocs(qRef);
    })).pipe(
      map(snap => snap.docs.map(d => ({
        name: String((d.data() as any)?.name || d.id || '').trim(),
        baseline: String((d.data() as any)?.baseline || '').toUpperCase(),
        symbols: Array.isArray((d.data() as any)?.symbols)
          ? (d.data() as any).symbols.map((s: any) => ({ symbol: String(s?.symbol || '').toUpperCase(), company: String(s?.company || s?.symbol || '').trim() }))
          : [],
        ranksDataWithColors: (d.data() as any)?.ranksDataWithColors ?? undefined,
      }) as RelStrStockList)),
      catchError(err => {
        console.error('[RelStrDbService] getListsForUser$ error', err);
        return of([] as RelStrStockList[]);
      })
    );
  }

  async getListsForUser(userId: string): Promise<RelStrStockList[]> {
    try { return await firstValueFrom(this.getListsForUser$(userId)); } catch (e) { console.error('getListsForUser failed', e); return []; }
  }

  async saveStockList(userId: string, list: RelStrStockList): Promise<void> {
    const uid = String(userId || '').trim();
    const docId = String(list?.name || '').trim();
    if (!uid) throw new Error('[RelStrDbV2Service] saveStockList: missing userId');
    if (!docId) throw new Error('[RelStrDbV2Service] saveStockList: missing list.name');
    const colRef = collection(this.firestore, userListsPath(uid));
    const docRef = doc(colRef, docId);
    const payload = {
      name: docId,
      baseline: String(list.baseline || '').toUpperCase(),
      symbols: Array.isArray(list.symbols) ? list.symbols.map(s => ({ symbol: String(s.symbol || '').toUpperCase(), company: String(s.company || s.symbol || '').trim() })) : [],
      ranksDataWithColors: list.ranksDataWithColors ?? null,
      updatedAt: Date.now(),
    };
    await setDoc(docRef, payload, { merge: true });
  }

  async deleteStockList(userId: string, listName: string): Promise<void> {
    const uid = String(userId || '').trim();
    const docId = String(listName || '').trim();
    if (!uid) throw new Error('[RelStrDbV2Service] deleteStockList: missing userId');
    if (!docId) throw new Error('[RelStrDbV2Service] deleteStockList: missing listName');
    const colRef = collection(this.firestore, userListsPath(uid));
    const docRef = doc(colRef, docId);
    await deleteDoc(docRef);
  }

  async renameStockList(userId: string, oldName: string, newList: RelStrStockList): Promise<void> {
    const uid = String(userId || '').trim();
    const srcId = String(oldName || '').trim();
    const destId = String(newList?.name || '').trim();
    if (!uid || !srcId || !destId) return;
    if (srcId === destId) { await this.saveStockList(userId, newList); return; }
    const colRef = collection(this.firestore, userListsPath(uid));
    const newDocRef = doc(colRef, destId);
    const exists = await getDoc(newDocRef).then(snap => snap.exists());
    if (exists) { console.warn('[RelStrDbService] renameStockList aborted: target name already exists', { userId: uid, oldName: srcId, newName: destId }); return; }
    await this.saveStockList(userId, newList); // write new
    await this.deleteStockList(userId, srcId); // delete old
  }

  // Live series for a pair doc (hyphenated ID), unified series entries with { pre?, post? }
  // Returns simplified { date, value } array where value = post.rank if present else pre.rank
  getPairSeriesLive$(pairId: string): Observable<Array<{ date: string; value: number }>> {
    return this.inCtx(() => {
      const ref = doc(this.firestore, `${Collection.PAIRS_DATA}/${pairId}`);
      return docData(ref);
    }).pipe(
      map((doc: any) => {
        const series: any[] = Array.isArray(doc?.data) ? doc.data : [];
        return series.map((row: any) => {
          const day = String(row?.day ?? row?.date ?? '');
          const postRank = Number(row.post?.rank ?? row.post?.rs ?? NaN);
          const preRank = Number(row.pre?.rank ?? row.pre?.rs ?? NaN);
          const value = Number.isFinite(postRank) ? postRank : (Number.isFinite(preRank) ? preRank : 0);
          return { date: day, value };
        });
      }),
      catchError(err => { console.error('[RelStrDbV2Service] getPairSeriesLive$ error', { pairId, err }); return of([] as Array<{ date: string; value: number }>) })
    );
  }

  // RANKS DATA (placeholder stubs)
  /**
   * Returns ranks data object for a pair. Placeholder returns an empty map until BE schema is finalized.
   */
  async getRanksData(pair: string): Promise<RanksByDate> {
    console.warn('[RelStrDbV2Service] getRanksData stub invoked', { pair });
    return {} as RanksByDate;
  }

  /**
   * Persists ranks data for a pair. Placeholder is a no-op to avoid rules violations until schema is finalized.
   */
  async setRanksData(pair: string, data: RanksByDate): Promise<void> {
    console.warn('[RelStrDbV2Service] setRanksData stub invoked (no-op)', { pair, dates: Object.keys(data || {}).length });
  }

  // Pair Registry (backend callables)
  async registerPairs(list: RelStrStockList): Promise<string[]> {
    try {
      const symbols = Array.isArray(list.symbols) ? list.symbols.map(s => s.symbol) : [];
      const res = await this.inCtx(() => {
        const callable = httpsCallable<
          { listId: string; baseline: string; symbols: string[] },
          { registered: string[]; rejected?: Array<{ symbol: string; reason: string }>; baselineHint?: { nonStandard?: boolean } }
        >(this.functions, CallableName.VALIDATE_AND_REGISTER_PAIRS);
        return callable({ listId: list.name, baseline: list.baseline, symbols });
      });
      const payload = res?.data || ({} as any);
      return Array.isArray(payload.registered) ? payload.registered : [];
    } catch (e) {
      console.error('registerPairs callable failed', e);
      return [];
    }
  }

  async unregisterPairs(list: RelStrStockList): Promise<string[]> {
    try {
      const symbols = Array.isArray(list.symbols) ? list.symbols.map(s => s.symbol) : [];
      const res = await this.inCtx(() => {
        const callable = httpsCallable<
          { listId: string; baseline: string; symbols: string[] },
          { unregistered: string[] }
        >(this.functions, CallableName.UNREGISTER_PAIRS);
        return callable({ listId: list.name, baseline: list.baseline, symbols });
      });
      const payload = (res?.data as any) || {};
      return Array.isArray(payload.unregistered) ? payload.unregistered : [];
    } catch (e) {
      console.error('unregisterPairs callable failed', e);
      return [];
    }
  }
}
