/**
 * Swing Analysis Service — Firestore persistence with user-scoping.
 *
 * Reads and writes saved swing analyses under
 * `zig-zags/{symbol}/analyses/{paramsId}`.
 * Security rules enforce that users can only read/write their own analyses
 * (matched by the `userId` field on each doc).
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
} from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { requireUserId } from '../services/firestore-helpers';
import type { SwingAnalysisDoc, SwingAnalysisInput } from './swing-analysis.types';

const ZIG_ZAGS_COLLECTION = 'zig-zags';
const ANALYSES_SUBCOLLECTION = 'analyses';

/** Fields persisted to Firestore (excludes the synthetic `id`). */
type PersistedAnalysis = Omit<SwingAnalysisDoc, 'id'>;

@Injectable({ providedIn: 'root' })
export class SwingAnalysisService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(EnvironmentInjector);

  /** Load all saved analyses for a symbol (one-shot). */
  loadSavedAnalyses(symbol: string): Observable<SwingAnalysisDoc[]> {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return of([]);

    const coll = collection(
      this.firestore,
      ZIG_ZAGS_COLLECTION,
      sym,
      ANALYSES_SUBCOLLECTION,
    ).withConverter<SwingAnalysisDoc>({
      toFirestore: (v: SwingAnalysisDoc) => {
        const { id, ...data } = v;
        return data;
      },
      fromFirestore: (snap) => ({
        ...(snap.data() as PersistedAnalysis),
        id: snap.id,
      }),
    });
    return from(getDocs(coll)).pipe(
      map((snap) => snap.docs.map((d) => d.data())),
    );
  }

  /** Save (or overwrite) an analysis document. Stamps userId from auth. */
  saveAnalysis(analysis: SwingAnalysisInput): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      switchMap((userId) => {
        const sym = String(analysis.symbol || '').trim().toUpperCase();
        const { ...payload } = analysis;
        const stamped: PersistedAnalysis = { ...payload, userId, symbol: sym };
        return from(
          setDoc(
            doc(
              this.firestore,
              ZIG_ZAGS_COLLECTION,
              sym,
              ANALYSES_SUBCOLLECTION,
              analysis.paramsId,
            ),
            stamped,
          ),
        );
      }),
    );
  }

  /** Load a single saved analysis by doc id. */
  loadAnalysis(symbol: string, docId: string): Observable<SwingAnalysisDoc | null> {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym || !docId) return of(null);

    return from(
      getDoc(
        doc(
          this.firestore,
          ZIG_ZAGS_COLLECTION,
          sym,
          ANALYSES_SUBCOLLECTION,
          docId,
        ),
      ),
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
