/**
 * Swing Analysis Service — Firestore persistence with user-scoping.
 *
 * Reads and writes saved swing sets in a flat `swing-sets/{docId}` collection
 * where docId is `{symbol}_{paramsId}`. Security rules enforce that users can
 * only read/write their own docs (matched by the `userId` field).
 */

import { Injectable, inject, EnvironmentInjector } from '@angular/core';
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
} from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { requireUserId } from '../services/firestore-helpers';
import type { SwingAnalysisDoc, SwingAnalysisInput } from './swing-analysis.types';

const SWING_SETS_COLLECTION = 'swing-sets';

/** Fields persisted to Firestore (excludes the synthetic `id`). */
type PersistedAnalysis = Omit<SwingAnalysisDoc, 'id'>;

@Injectable({ providedIn: 'root' })
export class SwingAnalysisService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(EnvironmentInjector);

  /** Composite doc id for a symbol + paramsId. */
  private docId(symbol: string, paramsId: string): string {
    return `${symbol}_${paramsId}`;
  }

  /** Load every saved swing set (one-shot). */
  loadAllSwingSets(): Observable<SwingAnalysisDoc[]> {
    return from(getDocs(collection(this.firestore, SWING_SETS_COLLECTION))).pipe(
      map((snap) =>
        snap.docs.map((d) => ({
          ...(d.data() as PersistedAnalysis),
          id: d.id,
        })),
      ),
    );
  }

  /** Load all saved swing sets for a symbol (one-shot). */
  loadSavedAnalyses(symbol: string): Observable<SwingAnalysisDoc[]> {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return of([]);

    const q = query(
      collection(this.firestore, SWING_SETS_COLLECTION),
      where('symbol', '==', sym),
    );
    return from(getDocs(q)).pipe(
      map((snap) =>
        snap.docs.map((d) => ({
          ...(d.data() as PersistedAnalysis),
          id: d.id,
        })),
      ),
    );
  }

  /** Save (or overwrite) a swing set doc. Stamps userId from auth. */
  saveAnalysis(analysis: SwingAnalysisInput): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      switchMap((userId) => {
        const sym = String(analysis.symbol || '').trim().toUpperCase();
        const { ...payload } = analysis;
        const stamped: PersistedAnalysis = { ...payload, userId, symbol: sym };
        return from(
          setDoc(
            doc(this.firestore, SWING_SETS_COLLECTION, this.docId(sym, analysis.paramsId)),
            stamped,
          ),
        );
      }),
    );
  }

  /** Load a single saved swing set by symbol + paramsId. */
  loadAnalysis(symbol: string, docId: string): Observable<SwingAnalysisDoc | null> {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym || !docId) return of(null);

    return from(
      getDoc(doc(this.firestore, SWING_SETS_COLLECTION, this.docId(sym, docId))),
    ).pipe(
      map((snap) =>
        snap.exists()
          ? ({
              ...(snap.data() as PersistedAnalysis),
              id: snap.id,
            })
          : null,
      ),
    );
  }
}
