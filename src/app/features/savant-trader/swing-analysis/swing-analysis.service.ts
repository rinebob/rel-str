/**
 * Swing Analysis Service — Firestore persistence with user-scoping.
 *
 * Reads and writes saved swing sets in a flat `st-swing-sets/{docId}` collection
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
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
} from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { requireUserId } from '../services/firestore-helpers';
import type {
  SwingAnalysisDoc,
  SwingAnalysisInput,
  SwingConfigDoc,
  SwingConfigInput,
} from './swing-analysis.types';
import { deriveParamsId } from './swing-analysis.types';

const SWING_SETS_COLLECTION = 'st-swing-sets';
const SWING_CONFIGS_COLLECTION = 'st-swing-configs';

/** Fields persisted to Firestore (excludes the synthetic `id`). */
type PersistedAnalysis = Omit<SwingAnalysisDoc, 'id'>;

/** Fields persisted for a config-library doc (excludes the `id`). */
type PersistedConfig = Omit<SwingConfigDoc, 'id'>;

@Injectable({ providedIn: 'root' })
export class SwingAnalysisService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(EnvironmentInjector);

  /** Composite doc id for a symbol + paramsId. */
  private docId(symbol: string, paramsId: string): string {
    return `${symbol}_${paramsId}`;
  }

  /** Load every saved swing set for the current user (one-shot). The
   *  userId where-clause is required — the rule evaluates
   *  resource.data.userId == auth.uid per doc, so a list query must
   *  constrain userId for the engine to prove ownership up front. */
  loadAllSwingSets(): Observable<SwingAnalysisDoc[]> {
    return requireUserId(this.auth, this.injector).pipe(
      switchMap((userId) =>
        from(
          getDocs(
            query(
              collection(this.firestore, SWING_SETS_COLLECTION),
              where('userId', '==', userId),
            ),
          ),
        ),
      ),
      map((snap) =>
        snap.docs.map((d) => ({
          ...(d.data() as PersistedAnalysis),
          id: d.id,
        })),
      ),
    );
  }

  /** Load all saved swing sets for a symbol, scoped to the current user.
   *  Same requirement as loadAllSwingSets — the query must constrain
   *  userId or the rules deny it outright. */
  loadSavedAnalyses(symbol: string): Observable<SwingAnalysisDoc[]> {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return of([]);

    return requireUserId(this.auth, this.injector).pipe(
      switchMap((userId) =>
        from(
          getDocs(
            query(
              collection(this.firestore, SWING_SETS_COLLECTION),
              where('symbol', '==', sym),
              where('userId', '==', userId),
            ),
          ),
        ),
      ),
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

  // ── Config library (st-swing-configs/{paramsId}) ──────────────────────────

  /** Load every saved config for the current user. The userId constraint
   *  is required — the rules engine must prove ownership up front. */
  loadConfigs(): Observable<SwingConfigDoc[]> {
    return requireUserId(this.auth, this.injector).pipe(
      switchMap((userId) =>
        from(
          getDocs(
            query(
              collection(this.firestore, SWING_CONFIGS_COLLECTION),
              where('userId', '==', userId),
            ),
          ),
        ),
      ),
      map((snap) =>
        snap.docs.map((d) => ({
          ...(d.data() as Omit<SwingConfigDoc, 'id'>),
          id: d.id,
        })),
      ),
    );
  }

  /** Save a config to the library. Doc id = paramsId — identical params
   *  overwrite the same doc (dedupe is structural). Stamps userId. */
  saveConfig(input: SwingConfigInput): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      switchMap((userId) => {
        const paramsId = deriveParamsId(input.config);
        const name = input.name?.trim();
        const payload: PersistedConfig = {
          paramsId,
          userId,
          config: input.config,
          savedAt: input.savedAt,
          ...(name ? { name } : {}),
        };
        return from(
          setDoc(doc(this.firestore, SWING_CONFIGS_COLLECTION, paramsId), payload),
        );
      }),
    );
  }

  /** Delete a saved config by paramsId (the doc id). */
  deleteConfig(paramsId: string): Observable<void> {
    if (!paramsId) return of(void 0);
    return requireUserId(this.auth, this.injector).pipe(
      switchMap(() =>
        from(
          deleteDoc(doc(this.firestore, SWING_CONFIGS_COLLECTION, paramsId)),
        ),
      ),
    );
  }
}
