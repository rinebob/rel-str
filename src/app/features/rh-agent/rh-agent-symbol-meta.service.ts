/**
 * RH Agent Symbol Meta Service
 *
 * Manages persistent symbol-level classifications in the
 * `rh-agent-symbol-meta` collection. Used for universe management:
 * exclude, demote, mark preferred, classify as ETF, etc.
 */
import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  writeBatch,
  Timestamp,
  serverTimestamp,
  onSnapshot,
} from '@angular/fire/firestore';
import { Auth, authState } from '@angular/fire/auth';
import { Observable, from, of } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { UniverseStatus, SymbolType } from './rh-agent-group.store';

export interface RhSymbolMeta {
  symbol: string;
  universeStatus: UniverseStatus;
  symbolType: SymbolType;
  tags: string[];
  tradeabilityScore?: number;
  notes?: string;
  source?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  userId?: string;
  metadata?: Record<string, unknown>;
}

export interface RhSymbolMetaInput {
  symbol?: string;
  universeStatus?: UniverseStatus;
  symbolType?: SymbolType;
  tags?: string[];
  tradeabilityScore?: number;
  notes?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export const SYMBOL_META_COLLECTION = 'rh-agent-symbol-meta';

@Injectable({
  providedIn: 'root',
})
export class RhAgentSymbolMetaService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  private readonly metaCollection = collection(this.firestore, SYMBOL_META_COLLECTION);

  /** Load meta for a specific list of symbols. */
  loadSymbolMeta(symbols: string[]): Observable<Record<string, RhSymbolMeta>> {
    if (symbols.length === 0) return of({});

    return this.withUserId().pipe(
      switchMap(async (userId) => {
        const normalized = symbols.map((s) => s.toUpperCase());
        const chunks = chunkArray(normalized, 30);
        const map: Record<string, RhSymbolMeta> = {};

        for (const chunk of chunks) {
          const q = query(
            this.metaCollection,
            where('userId', '==', userId),
            where('symbol', 'in', chunk)
          );
          const snapshot = await getDocs(q);
          for (const docSnap of snapshot.docs) {
            const data = docSnap.data();
            const meta = this.toMeta(docSnap.id, data);
            map[meta.symbol] = meta;
          }
        }

        return map;
      })
    );
  }

  /** Load all symbol meta for the user. */
  loadAllSymbolMeta(): Observable<RhSymbolMeta[]> {
    return this.withUserId().pipe(
      switchMap((userId) => {
        const q = query(
          this.metaCollection,
          where('userId', '==', userId),
          orderBy('symbol', 'asc')
        );
        return from(getDocs(q)).pipe(
          map((snapshot) => snapshot.docs.map((d) => this.toMeta(d.id, d.data())))
        );
      })
    );
  }

  /** Set a symbol's persistent universe status. */
  setUniverseStatus(symbol: string, status: UniverseStatus, notes?: string): Observable<void> {
    return this.updateMeta(symbol, { universeStatus: status, notes });
  }

  /** Set a symbol's type (e.g., ETF). */
  setSymbolType(symbol: string, type: SymbolType): Observable<void> {
    return this.updateMeta(symbol, { symbolType: type });
  }

  /** Add a new symbol to the universe. */
  addSymbol(symbol: string, type: SymbolType = 'STOCK', tags: string[] = []): Observable<void> {
    return this.updateMeta(symbol, {
      symbolType: type,
      tags,
      universeStatus: 'IN_UNIVERSE',
      source: 'import',
    });
  }

  /** Add multiple symbols in a batch. */
  addSymbolsBatch(symbols: Array<{ symbol: string; type: SymbolType; tags?: string[] }>): Observable<void> {
    if (symbols.length === 0) return of(undefined);

    return this.withUserId().pipe(
      take(1),
      switchMap(async (userId) => {
        const batch = writeBatch(this.firestore);
        const now = Timestamp.now();

        for (const item of symbols) {
          const symbol = item.symbol.toUpperCase();
          const docRef = doc(this.firestore, SYMBOL_META_COLLECTION, symbol);
          const existing = await this.getDocData(docRef);

          batch.set(
            docRef,
            {
              symbol,
              universeStatus: 'IN_UNIVERSE' as UniverseStatus,
              symbolType: item.type,
              tags: item.tags ?? [],
              userId,
              source: 'import',
              metadata: {},
              updatedAt: now,
              createdAt: existing?.createdAt ?? now,
            },
            { merge: true }
          );
        }

        await batch.commit();
      }),
      map(() => undefined)
    );
  }

  /** Full update of a symbol's meta record. */
  updateMeta(symbol: string, input: RhSymbolMetaInput): Observable<void> {
    return this.withUserId().pipe(
      take(1),
      switchMap(async (userId) => {
        const normalized = symbol.toUpperCase();
        const docRef = doc(this.firestore, SYMBOL_META_COLLECTION, normalized);
        const existing = await this.getDocData(docRef);
        const now = serverTimestamp();

        const payload: Record<string, any> = {
          symbol: normalized,
          userId,
          updatedAt: now,
        };

        if (input.universeStatus !== undefined) payload['universeStatus'] = input.universeStatus;
        if (input.symbolType !== undefined) payload['symbolType'] = input.symbolType;
        if (input.tags !== undefined) payload['tags'] = input.tags;
        if (input.tradeabilityScore !== undefined) payload['tradeabilityScore'] = input.tradeabilityScore;
        if (input.notes !== undefined) payload['notes'] = input.notes ?? null;
        if (input.source !== undefined) payload['source'] = input.source;
        if (input.metadata !== undefined) payload['metadata'] = input.metadata ?? {};
        if (!existing) {
          payload['createdAt'] = now;
          payload['universeStatus'] = input.universeStatus ?? 'IN_UNIVERSE';
          payload['symbolType'] = input.symbolType ?? 'STOCK';
          payload['tags'] = input.tags ?? [];
          payload['metadata'] = input.metadata ?? {};
        }

        await setDoc(docRef, payload, { merge: true });
      }),
      map(() => undefined)
    );
  }

  /** Listen to real-time changes for all symbol meta. */
  listenToAllSymbolMeta(): Observable<RhSymbolMeta[]> {
    return this.withUserId().pipe(
      switchMap((userId) => {
        const q = query(
          this.metaCollection,
          where('userId', '==', userId),
          orderBy('symbol', 'asc')
        );

        return new Observable<RhSymbolMeta[]>((subscriber) => {
          const unsubscribe = onSnapshot(q, (snapshot) => {
            subscriber.next(snapshot.docs.map((d) => this.toMeta(d.id, d.data())));
          }, (error) => {
            subscriber.error(error);
          });

          return unsubscribe;
        });
      })
    );
  }

  private toMeta(id: string, data: any): RhSymbolMeta {
    return {
      symbol: data['symbol'] ?? id,
      universeStatus: data['universeStatus'] ?? 'IN_UNIVERSE',
      symbolType: data['symbolType'] ?? 'STOCK',
      tags: data['tags'] ?? [],
      tradeabilityScore: data['tradeabilityScore'],
      notes: data['notes'],
      source: data['source'],
      createdAt: data['createdAt'],
      updatedAt: data['updatedAt'],
      userId: data['userId'],
      metadata: data['metadata'] ?? {},
    };
  }

  private async getDocData(docRef: any): Promise<{ createdAt?: Timestamp } | null> {
    const snap = await getDoc(docRef);
    return snap.exists() ? (snap.data() as { createdAt?: Timestamp }) : null;
  }

  private withUserId(): Observable<string> {
    return authState(this.auth).pipe(
      take(1),
      map((user) => {
        if (!user?.uid) {
          throw new Error('Authentication required to manage symbol meta');
        }
        return user.uid;
      })
    );
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
