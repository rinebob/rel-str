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
  getDocs,
  query,
  where,
} from '@angular/fire/firestore';
import { Observable, from, of, throwError } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

import { requireUserId } from '../services/firestore-helpers';
import type {
  SwingAnalysisDoc,
  SwingConfigDoc,
  SwingConfigInput,
} from './swing-analysis.types';
import { deriveParamsId, deriveSetParamsId } from './swing-analysis.types';

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
  /** Load all saved swing sets for a symbol, scoped to the current user.
   *  The query must constrain
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

  /** Save a config (or config set) to the library. Doc id = paramsId —
   *  identical params overwrite the same doc (dedupe is structural).
   *  Set inputs (`configs`) key on `deriveSetParamsId`; singles on the
   *  plain paramsId. Stamps userId. */
  saveConfig(input: SwingConfigInput): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      switchMap((userId) => {
        const paramsId =
          input.paramsId ??
          (input.configs?.length
            ? deriveSetParamsId(input.configs)
            : input.config
              ? deriveParamsId(input.config)
              : undefined);
        // Silent success on a non-write would leave callers' optimistic
        // library patches lying — error instead of pretending to save.
        if (!paramsId) {
          return throwError(
            () => new Error('saveConfig requires config or non-empty configs'),
          );
        }
        const name = input.name?.trim();
        const payload: PersistedConfig = {
          paramsId,
          userId,
          ...(input.config ? { config: input.config } : {}),
          ...(input.configs ? { configs: input.configs } : {}),
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
