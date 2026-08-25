/**
 * RH Agent Triage Service
 *
 * Persists dateless review flags (`rh-agent-review-flags`).
 * Durable ACCEPT/REJECT decisions for signal occurrences live in
 * RhAgentOccurrenceDecisionService.
 */
import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
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
  writeBatch,
  serverTimestamp,
} from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { Collection } from '../../../core/common/constants';
import { requireUserId } from './rh-agent-firestore-helpers';

@Injectable({
  providedIn: 'root',
})
export class RhAgentTriageService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(EnvironmentInjector);

  // ---------------------------------------------------------------------------
  // Review Flags (dateless)
  // ---------------------------------------------------------------------------

  private get reviewFlagCollection() {
    return collection(this.firestore, Collection.ST_REVIEW_LIST);
  }

  /** Persist a review flag for a symbol (dateless). Doc existence = flagged. */
  setReviewFlag(symbol: string): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const normalized = symbol.toUpperCase();
        const docRef = doc(this.firestore, Collection.ST_REVIEW_LIST, normalized);
        await setDoc(docRef, {
          symbol: normalized,
          userId,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      })),
      map(() => undefined)
    );
  }

  /** Remove a review flag for a symbol by deleting its doc. */
  clearReviewFlag(symbol: string): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() => runInInjectionContext(this.injector, async () => {
        const normalized = symbol.toUpperCase();
        const docRef = doc(this.firestore, Collection.ST_REVIEW_LIST, normalized);
        await deleteDoc(docRef);
      })),
      map(() => undefined)
    );
  }

  /** Set or clear review flags for multiple symbols at once. */
  setReviewFlagsBatch(symbols: string[], flagged: boolean): Observable<void> {
    if (symbols.length === 0) return of(undefined);
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const batch = writeBatch(this.firestore);
        for (const symbol of symbols) {
          const normalized = symbol.toUpperCase();
          const docRef = doc(this.firestore, Collection.ST_REVIEW_LIST, normalized);
          if (flagged) {
            batch.set(docRef, {
              symbol: normalized,
              userId,
              updatedAt: serverTimestamp(),
            }, { merge: true });
          } else {
            batch.delete(docRef);
          }
        }
        await batch.commit();
      })),
      map(() => undefined)
    );
  }

  /** Load all active review flags (all existing docs are flagged). */
  loadReviewFlags(): Observable<string[]> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => {
        const q = query(
          this.reviewFlagCollection,
          where('userId', '==', userId)
        );
        return from(runInInjectionContext(this.injector, () => getDocs(q)));
      }),
      map((snapshot) => snapshot.docs.map((d) => d.data()['symbol'] as string))
    );
  }

}
