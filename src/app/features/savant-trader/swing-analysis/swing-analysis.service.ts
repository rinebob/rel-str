/**
 * Swing Analysis Service — minimal Firestore persistence.
 *
 * Reads and writes saved swing analyses under
 * `zig-zags/{symbol}/analyses/{paramsId}`.
 * Task #335 will add security rules and hardening.
 */

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  setDoc,
  getDoc,
} from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

import type { SwingAnalysisDoc } from './swing-analysis.types';

const ZIG_ZAGS_COLLECTION = 'zig-zags';
const ANALYSES_SUBCOLLECTION = 'analyses';

@Injectable({ providedIn: 'root' })
export class SwingAnalysisService {
  private readonly firestore = inject(Firestore);

  /** Load all saved analyses for a symbol. */
  loadSavedAnalyses(symbol: string): Observable<SwingAnalysisDoc[]> {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return of([]);

    const coll = collection(
      this.firestore,
      ZIG_ZAGS_COLLECTION,
      sym,
      ANALYSES_SUBCOLLECTION,
    ).withConverter<SwingAnalysisDoc>({
      toFirestore: (v: SwingAnalysisDoc) => ({ ...v }),
      fromFirestore: (snap) => ({
        ...(snap.data() as Omit<SwingAnalysisDoc, 'id'>),
        id: snap.id,
      }),
    });
    return collectionData(coll).pipe(
      catchError(() => of([] as SwingAnalysisDoc[])),
    );
  }

  /** Save (or overwrite) an analysis document. */
  saveAnalysis(analysis: SwingAnalysisDoc): Observable<void> {
    return from(
      setDoc(
        doc(
          this.firestore,
          ZIG_ZAGS_COLLECTION,
          analysis.symbol,
          ANALYSES_SUBCOLLECTION,
          analysis.paramsId,
        ),
        analysis,
      ),
    ).pipe(
      map(() => undefined),
      catchError(() => of(undefined)),
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
              ...(snap.data() as Omit<SwingAnalysisDoc, 'id'>),
              id: snap.id,
            })
          : null,
      ),
      catchError(() => of(null)),
    );
  }
}
