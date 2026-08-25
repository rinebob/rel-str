/**
 * Backtest run service.
 *
 * Wraps the `stBacktestStart` and `stBacktestStrategies` callables
 * plus realtime Firestore listeners for `backtest-runs` and `backtest-permutations`.
 */

import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, collection, collectionData, query, where, orderBy, limit, doc, docData } from '@angular/fire/firestore';
import { Observable, from, map } from 'rxjs';

import type {
  BacktestPermutationUi,
  BacktestRunUi,
  BacktestStrategyMetadata,
  StartBacktestRequest,
  StartBacktestResponse,
} from '../common/backtest.types';
import { convertBacktestPermutationDoc, convertBacktestRunDoc } from './backtest-firestore-converter';

@Injectable({
  providedIn: 'root',
})
export class BacktestRunService {
  private readonly functions = inject(Functions);
  private readonly firestore = inject(Firestore);
  private readonly injector = inject(EnvironmentInjector);

  private readonly runsCollection = 'backtest-runs';
  private readonly permutationsCollection = 'backtest-permutations';

  /**
   * Fetch strategy metadata from the backend registry.
   */
  listStrategies(): Observable<BacktestStrategyMetadata[]> {
    return from(runInInjectionContext(this.injector, () => {
      const callable = httpsCallable<void, { strategies: BacktestStrategyMetadata[] }>(
        this.functions,
        'stBacktestStrategies'
      );
      return callable();
    })).pipe(map((result) => result.data.strategies));
  }

  /**
   * Start a new backtest run.
   */
  startRun(request: StartBacktestRequest): Observable<StartBacktestResponse> {
    return from(runInInjectionContext(this.injector, () => {
      const callable = httpsCallable<StartBacktestRequest, StartBacktestResponse>(
        this.functions,
        'stBacktestStart'
      );
      return callable(request);
    })).pipe(map((result) => result.data));
  }

  /**
   * Watch recent backtest runs in realtime (all runs; UI store filters archived).
   */
  watchRuns(count = 50): Observable<BacktestRunUi[]> {
    return from(runInInjectionContext(this.injector, () => {
      const runsRef = collection(this.firestore, this.runsCollection);
      const runsQuery = query(runsRef, orderBy('createdAt', 'desc'), limit(count));
      return collectionData(runsQuery, { idField: 'runId' }) as Observable<Record<string, unknown>[]>;
    })).pipe(
      map((docs) =>
        docs.map((d) => convertBacktestRunDoc(String(d['runId'] ?? d['id']), d))
      )
    );
  }

  /**
   * Watch a single backtest run in realtime.
   */
  watchRun(runId: string): Observable<BacktestRunUi> {
    return from(runInInjectionContext(this.injector, () => {
      const runRef = doc(this.firestore, `${this.runsCollection}/${runId}`);
      return docData(runRef) as Observable<Record<string, unknown> | undefined>;
    })).pipe(
      map((data) => convertBacktestRunDoc(runId, data ?? {}))
    );
  }

  /**
   * Watch all permutations for a given run in realtime.
   */
  watchPermutations(runId: string): Observable<BacktestPermutationUi[]> {
    return from(runInInjectionContext(this.injector, () => {
      const permRef = collection(this.firestore, this.permutationsCollection);
      const permQuery = query(permRef, where('runId', '==', runId), orderBy('completedAt', 'desc'));
      return collectionData(permQuery, { idField: 'permutationId' }) as Observable<Record<string, unknown>[]>;
    })).pipe(
      map((docs) =>
        docs.map((d) => convertBacktestPermutationDoc(String(d['permutationId'] ?? d['id']), d))
      )
    );
  }
}
