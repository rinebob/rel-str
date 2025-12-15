import { EnvironmentInjector, NgZone, inject, Injectable, runInInjectionContext } from '@angular/core';
import type { Company, RanksByDate, RelStrStockList, RsSeriesPoint } from '../shared/types/rs.interfaces';
import { RsPhase, Timeframe } from '../shared/types/rs.interfaces';
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
  limit,
  startAfter,
} from '@angular/fire/firestore';
import { Observable, map, from, tap, catchError, firstValueFrom, of, retry, defer } from 'rxjs';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { timer } from 'rxjs';
import { Auth } from '@angular/fire/auth';
import { CallableName, Collection, userListsPath } from '../../core/common/constants';
import { GetTrackedSymbolsResponse } from '../../core/models/partner.types';

@Injectable({ providedIn: 'root' })
export class RelStrDbV2Service {
  private readonly env = inject(EnvironmentInjector);
  readonly firestore: Firestore = inject(Firestore);
  readonly functions = inject(Functions);
  private readonly auth = inject(Auth);
  private readonly zone = inject(NgZone);

  constructor() {}

  private inCtx<T>(fn: () => T): T {
    // Ensures AngularFire helper calls execute inside an injection context
    return runInInjectionContext(this.env, fn);
  }

  /**
   * Windowed archive read: fetch only the most recent `daysBack` days for a pair.
   * This minimizes initial payload for faster first render.
   * Rules mirror getPairSeriesFromArchive$ (POST for historical; POST then PRE for today).
   */
  getPairSeriesFromArchiveWindow$(pairId: string, daysBack = 60): Observable<RsSeriesPoint[]> {
    const pair = String(pairId || '').trim();
    if (!pair || !Number.isFinite(daysBack) || daysBack <= 0) return of([]);

    const fmtYMD = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

    const today = new Date();
    const todayYMD = fmtYMD(today);
    const START_ARCHIVE_YEAR = 2019;
    const currentYear = today.getUTCFullYear();

    return defer(() => from(this.inCtx(async () => {
      const resultsDesc: RsSeriesPoint[] = [];
      let remaining = Math.max(1, Math.floor(daysBack));
      for (let y = currentYear; y >= START_ARCHIVE_YEAR && remaining > 0; y--) {
        try {
          const colRef = collection(this.firestore, `${Collection.PAIRS_DATA}/${pair}/archive-${y}`);
          // Fetch newest first
          const qRef = query(colRef, orderBy('day', 'desc'), limit(remaining));
          const snap = await this.inCtx(() => this.zone.run(() => getDocs(qRef)));
          for (const docSnap of snap.docs) {
            const raw = (docSnap.data() as any) || {};
            const dateYMD = String(raw?.day || '').trim();
            if (!dateYMD) continue;
            const isToday = dateYMD === todayYMD;
            const post = raw?.post;
            const pre = raw?.pre;
            let phase: RsPhase | undefined;
            let value: number | undefined;
            let norm: number | undefined;
            if (!isToday) {
              // Historical days: require canonical POST rsRaw/rsNorm
              const postRsRaw = Number.isFinite(post?.rsRaw) ? Number(post.rsRaw) : undefined;
              const postRsNorm = Number.isFinite(post?.rsNorm) ? Number(post.rsNorm) : undefined;
              if (!Number.isFinite(postRsRaw) || !Number.isFinite(postRsNorm)) {
                continue;
              }
              value = postRsRaw;
              norm = postRsNorm;
              phase = RsPhase.POST;
            } else {
              // Today (UTC): prefer POST rsRaw/rsNorm, else PRE rsRaw/rsNorm
              const postRsRaw = Number.isFinite(post?.rsRaw) ? Number(post.rsRaw) : undefined;
              const postRsNorm = Number.isFinite(post?.rsNorm) ? Number(post.rsNorm) : undefined;
              const preRsRaw = Number.isFinite(pre?.rsRaw) ? Number(pre.rsRaw) : undefined;
              const preRsNorm = Number.isFinite(pre?.rsNorm) ? Number(pre.rsNorm) : undefined;

              if (Number.isFinite(postRsRaw) && Number.isFinite(postRsNorm)) {
                value = postRsRaw;
                norm = postRsNorm;
                phase = RsPhase.POST;
              } else if (Number.isFinite(preRsRaw) && Number.isFinite(preRsNorm)) {
                value = preRsRaw;
                norm = preRsNorm;
                phase = RsPhase.PRE;
              } else {
                continue;
              }
            }
            resultsDesc.push({ date: dateYMD, value: value!, norm, phase });
          }
          remaining = Math.max(0, daysBack - resultsDesc.length);
        } catch (e) {
          console.warn('[RelStrDbV2Service] windowed archive read failed for year', { pair, year: y, e });
        }
      }
      // We accumulated newest-first; return ascending by date
      return resultsDesc.sort((a, b) => {
        const ad = String(a?.date ?? '');
        const bd = String(b?.date ?? '');
        return ad.localeCompare(bd);
      });
    }))).pipe(
      retry({ count: 2, delay: (e, i) => timer(Math.min(1500, 300 * Math.pow(2, i))) }),
      tap(arr => console.log('[RS][Archive][Window] Series ready', { pair, len: arr.length, first: arr[0] })),
      catchError(err => {
        console.error('[RelStrDbV2Service] getPairSeriesFromArchiveWindow$ error', { pair, err });
        return of([] as RsSeriesPoint[]);
      })
    );
  }

  getPairSeriesFromArchiveWindowByInterval$(pairId: string, daysBack = 60, timeframe: Timeframe = Timeframe.DAILY): Observable<RsSeriesPoint[]> {
    const pair = String(pairId || '').trim();
    if (!pair || !Number.isFinite(daysBack) || daysBack <= 0) return of([] as RsSeriesPoint[]);

    const fmtYMD = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

    const today = new Date();
    const todayYMD = fmtYMD(today);
    const START_ARCHIVE_YEAR = 2019;
    const currentYear = today.getUTCFullYear();

    const prefix = timeframe === Timeframe.WEEKLY
      ? 'archive-weekly'
      : timeframe === Timeframe.MONTHLY
        ? 'archive-monthly'
        : 'archive';

    return defer(() => from(this.inCtx(async () => {
      const resultsDesc: RsSeriesPoint[] = [];
      let remaining = Math.max(1, Math.floor(daysBack));
      let hadPermissionError = false;

      const isWindowed = timeframe === Timeframe.DAILY || timeframe === Timeframe.TWO_DAY;

      for (let y = currentYear; y >= START_ARCHIVE_YEAR && (isWindowed ? remaining > 0 : true); y--) {
        try {
          const colRef = collection(this.firestore, `${Collection.PAIRS_DATA}/${pair}/${prefix}-${y}`);
          const qRef = isWindowed
            ? query(colRef, orderBy('day', 'desc'), limit(remaining))
            : query(colRef, orderBy('day', 'desc'));
          const snap = await this.inCtx(() => this.zone.run(() => getDocs(qRef)));
          for (const docSnap of snap.docs) {
            const raw = (docSnap.data() as any) || {};
            const dateYMD = String(raw?.day || '').trim();
            if (!dateYMD) continue;
            const isToday = dateYMD === todayYMD;
            const post = raw?.post;
            const pre = raw?.pre;
            let phase: RsPhase | undefined;
            let value: number | undefined;
            let norm: number | undefined;
            if (!isToday) {
              const postRsRaw = Number.isFinite(post?.rsRaw) ? Number(post.rsRaw) : undefined;
              const postRsNorm = Number.isFinite(post?.rsNorm) ? Number(post.rsNorm) : undefined;
              if (!Number.isFinite(postRsRaw) && !Number.isFinite(postRsNorm)) {
                continue;
              }
              value = Number(postRsRaw ?? postRsNorm);
              norm = Number(postRsNorm ?? postRsRaw);
              phase = RsPhase.POST;
            } else {
              const postRsRaw = Number.isFinite(post?.rsRaw) ? Number(post.rsRaw) : undefined;
              const postRsNorm = Number.isFinite(post?.rsNorm) ? Number(post.rsNorm) : undefined;
              const preRsRaw = Number.isFinite(pre?.rsRaw) ? Number(pre?.rsRaw) : undefined;
              const preRsNorm = Number.isFinite(pre?.rsNorm) ? Number(pre.rsNorm) : undefined;

              if (Number.isFinite(postRsRaw) || Number.isFinite(postRsNorm)) {
                value = Number(postRsRaw ?? postRsNorm);
                norm = Number(postRsNorm ?? postRsRaw);
                phase = RsPhase.POST;
              } else if (Number.isFinite(preRsRaw) || Number.isFinite(preRsNorm)) {
                value = Number(preRsRaw ?? preRsNorm);
                norm = Number(preRsNorm ?? preRsRaw);
                phase = RsPhase.PRE;
              } else {
                continue;
              }
            }
            resultsDesc.push({ date: dateYMD, value: value!, norm, phase });
          }
          if (isWindowed) {
            remaining = Math.max(0, daysBack - resultsDesc.length);
          }
        } catch (e: any) {
          const code = e?.code || '';
          const msg = e?.message || '';
          if (code === 'permission-denied' || /insufficient permissions/i.test(msg)) {
            hadPermissionError = true;
            // Stop iterating years; FE is not allowed to read these archives.
            break;
          }
        }
      }
      const sorted = resultsDesc.sort((a, b) => {
        const ad = String(a?.date ?? '');
        const bd = String(b?.date ?? '');
        return ad.localeCompare(bd);
      });
      if (sorted.length === 0 && hadPermissionError) {
        // Surface a single aggregated error so outer catchError can decide how to log.
        const err: any = new Error('permission-denied');
        err.code = 'permission-denied';
        throw err;
      }
      return sorted;
    }))).pipe(
      retry({ count: 2, delay: (e, i) => timer(Math.min(1500, 300 * Math.pow(2, i))) }),
      tap(arr => console.log('[RS][Archive][Window][Interval] Series ready', { pair, timeframe, len: arr.length, first: arr[0] })),
      catchError(err => {
        const code = (err as any)?.code || '';
        const msg = (err as any)?.message || '';
        if (code !== 'permission-denied' && !/insufficient permissions/i.test(msg)) {
          console.error('[RelStrDbV2Service] getPairSeriesFromArchiveWindowByInterval$ error', { pair, timeframe, err });
        }
        return of([] as RsSeriesPoint[]);
      })
    );
  }

  async diagnosePairDaysAutoFix(baseline: string, symbols: string[], options?: { phase?: RsPhase; dates?: string[]; from?: string; to?: string; yearsBack?: number; forceWrite?: boolean }): Promise<any> {
    try {
      return await this.inCtx(async () => {
        const callable = httpsCallable<any, any>(this.functions, CallableName.DIAGNOSE_PAIR_DAYS);
        const payload: any = {
          baseline: String(baseline || '').toUpperCase(),
          symbols: Array.isArray(symbols) ? symbols.map(s => String(s).toUpperCase()) : [],
          autoFix: true,
        };
        if (options?.phase) payload.phase = options.phase;
        if (options?.dates) payload.dates = options.dates.map(d => String(d).slice(0,10));
        if (options?.from) payload.from = String(options.from).slice(0,10);
        if (options?.to) payload.to = String(options.to).slice(0,10);
        if (Number.isFinite(options?.yearsBack as number)) payload.yearsBack = Number(options?.yearsBack);
        if (options?.forceWrite) payload.forceWrite = true;
        const res = await callable(payload);
        return res?.data ?? res;
      });
    } catch (e) {
      console.error('diagnosePairDaysAutoFix failed', e);
      return { ok: false };
    }
  }

  // New: Fetch tracked symbols via RS backend callable (SavantAPI behind it)
  getTrackedSymbols$(ttlSeconds = 600): Observable<Company[]> {
    return from(
      this.inCtx(() => {
        const callable = httpsCallable<
          { ttlSeconds?: number },
          GetTrackedSymbolsResponse
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
  /**
   * DEPRECATED: Use getPairsForBaseline$(base) or getBaselineLeaders$ for sorted/top/bottom queries.
   * For backward compatibility, this now prefers curated SPY baseline holdings → pair IDs,
   * and falls back to enumerating all doc IDs under pairs-data if SPY baseline doc is unavailable.
   */
  getSupportedPairsList$(): Observable<string[]> {
    // Prod-safe: enumerate all pair IDs from pairs-data (no curated baseline reads)
    return defer(() => from(this.inCtx(() => {
      const colRef = collection(this.firestore, Collection.PAIRS_DATA);
      return this.zone.run(() => getDocs(colRef));
    }))).pipe(
      map(snap => snap.docs.map(d => String(d.id))),
      catchError(err => {
        console.error('[RelStrDbService] getSupportedPairsList$ error', err);
        return of([] as string[]);
      })
    );
  }

  /** Build pair IDs for a baseline by filtering pairs-data IDs (no curated baseline reads). */
  getPairsForBaseline$(baseline: string): Observable<string[]> {
    const base = String(baseline || '').toUpperCase();
    if (!base) return of([]);
    return defer(() => from(this.inCtx(() => {
      const colRef = collection(this.firestore, Collection.PAIRS_DATA);
      return this.zone.run(() => getDocs(colRef));
    }))).pipe(
      map(snap => snap.docs.map(d => String(d.id)).filter(id => id.startsWith(`${base}-`))),
      catchError(err => {
        console.error('[RelStrDbService] getPairsForBaseline$ error', { baseline: base, err });
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
      console.warn('[RelStrDbV2Service] getListsForUser$ skipped: auth uid mismatch or missing', { requested: uid, current: currUid });
      return of([] as RelStrStockList[]);
    }
    return defer(() => from(this.inCtx(() => {
      const colRef = collection(this.firestore, userListsPath(uid));
      const qRef = query(colRef, orderBy('updatedAt', 'desc'));
      return this.zone.run(() => getDocs(qRef));
    }))).pipe(
      map(snap => snap.docs.map(d => ({
        name: String((d.data() as any)?.name || d.id || '').trim(),
        baseline: String((d.data() as any)?.baseline || '').toUpperCase(),
        symbols: Array.isArray((d.data() as any)?.symbols)
          ? (d.data() as any).symbols.map((s: any) => ({ symbol: String(s?.symbol || '').toUpperCase(), company: String(s?.company || s?.symbol || '').trim() }) as Company)
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
    const exists = await this.zone.run(() => getDoc(newDocRef)).then(snap => snap.exists());
    if (exists) { console.warn('[RelStrDbService] renameStockList aborted: target name already exists', { userId: uid, oldName: srcId, newName: destId }); return; }
    await this.saveStockList(userId, newList); // write new
    await this.deleteStockList(userId, srcId); // delete old
  }

  /**
   * Reads RS series from archive shards under pairs-data/{PAIR}/archive-YYYY/{YYMMDD}.
   * Selection rules:
   * - Historical days: use POST only.
   * - Today (UTC): use POST if present, else PRE if present.
   * Value selection:
   * - Use canonical rsRaw for the numeric value.
   * - Use canonical rsNorm for the normalized rank used by heatmaps.
   * - Do not fall back to legacy `rs` fields or cross-fallback between raw/norm.
   */
  getPairSeriesFromArchive$(pairId: string): Observable<RsSeriesPoint[]> {
    const pair = String(pairId || '').trim();
    if (!pair) return of([]);

    const fmtYMD = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const ymdFromShardId = (yyMMdd: string, year: number) => `${year}-${yyMMdd.substring(2, 4)}-${yyMMdd.substring(4, 6)}`;

    const today = new Date();
    const todayYMD = fmtYMD(today);
    // Fetch all archive shards from START_ARCHIVE_YEAR through current year
    const START_ARCHIVE_YEAR = 2019;
    const currentYear = today.getUTCFullYear();
    const years = Array.from({ length: currentYear - START_ARCHIVE_YEAR + 1 }, (_, i) => START_ARCHIVE_YEAR + i);

    return defer(() => from(this.inCtx(async () => {
      const results: RsSeriesPoint[] = [];
      let hadPermissionError = false;
      for (const y of years) {
        try {
          const colRef = collection(this.firestore, `${Collection.PAIRS_DATA}/${pair}/archive-${y}`);
          const qRef = query(colRef, orderBy('day', 'asc'));
          const snap = await this.inCtx(() => this.zone.run(() => getDocs(qRef)));
          for (const docSnap of snap.docs) {
            const raw = (docSnap.data() as any) || {};
            const dateYMD = String(raw?.day || '').trim() || ymdFromShardId(docSnap.id, y);
            if (!dateYMD) continue;
            const isToday = dateYMD === todayYMD;
            const post = raw?.post;
            const pre = raw?.pre;
            let phase: RsPhase | undefined;
            let value: number | undefined;
            let norm: number | undefined;

            if (!isToday) {
              // Historical days: require canonical POST rsRaw/rsNorm
              const postRsRaw = Number.isFinite(post?.rsRaw) ? Number(post.rsRaw) : undefined;
              const postRsNorm = Number.isFinite(post?.rsNorm) ? Number(post.rsNorm) : undefined;
              if (!Number.isFinite(postRsRaw) || !Number.isFinite(postRsNorm)) {
                continue;
              }
              value = postRsRaw;
              norm = postRsNorm;
              phase = RsPhase.POST;
            } else {
              // Today (UTC): prefer POST rsRaw/rsNorm, else PRE rsRaw/rsNorm
              const postRsRaw = Number.isFinite(post?.rsRaw) ? Number(post.rsRaw) : undefined;
              const postRsNorm = Number.isFinite(post?.rsNorm) ? Number(post.rsNorm) : undefined;
              const preRsRaw = Number.isFinite(pre?.rsRaw) ? Number(pre.rsRaw) : undefined;
              const preRsNorm = Number.isFinite(pre?.rsNorm) ? Number(pre.rsNorm) : undefined;

              if (Number.isFinite(postRsRaw) && Number.isFinite(postRsNorm)) {
                value = postRsRaw;
                norm = postRsNorm;
                phase = RsPhase.POST;
              } else if (Number.isFinite(preRsRaw) && Number.isFinite(preRsNorm)) {
                value = preRsRaw;
                norm = preRsNorm;
                phase = RsPhase.PRE;
              } else {
                continue;
              }
            }

            results.push({ date: dateYMD, value: value!, norm, phase });
          }
        } catch (e: any) {
          const code = e?.code || '';
          const msg = e?.message || '';
          if (code === 'permission-denied' || /insufficient permissions/i.test(msg)) {
            hadPermissionError = true;
          }
          console.warn('[RelStrDbV2Service] archive read failed for year', { pair, year: y, e });
        }
      }
      const byDate = new Map<string, { date: string; value: number; norm?: number; phase?: RsPhase }>();
      for (const row of results) byDate.set(row.date, row);
      const merged = Array.from(byDate.values()).sort((a, b) => {
        const ad = String(a?.date ?? '');
        const bd = String(b?.date ?? '');
        return ad.localeCompare(bd);
      });
      if (merged.length === 0 && hadPermissionError) {
        // Signal outer catchError to fallback to legacy
        const err: any = new Error('permission-denied');
        err.code = 'permission-denied';
        throw err;
      }
      return merged;
    }))).pipe(
      retry({ count: 3, delay: (e, i) => timer(Math.min(2000, 300 * Math.pow(2, i))) }),
      tap(arr => console.log('[RS][Archive] Series ready', { pair, len: arr.length, first: arr[0] })),
      catchError(err => {
        console.error('[RelStrDbV2Service] getPairSeriesFromArchive$ error', { pair, err });
        return of([] as Array<{ date: string; value: number; norm?: number; phase?: RsPhase }>);
      })
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
