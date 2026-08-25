/**
 * @topic #77 — Spread Time Series Viewer (opened 2026-08-02)
 *
 * Manages onSnapshot subscriptions on spread-runs/{runId} and
 * spread-runs/{runId}/jobs subcollection. Emits RxJS observables to the store.
 */
import { Injectable, EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import { Firestore, collection, doc, docSnapshots, collectionSnapshots } from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';

import { Collection } from '../../../core/common/constants';
import type { SpreadRunStatus, SpreadJobStatus } from '@spread/contracts';

export interface SpreadRunDocData {
  userId: string;
  status: SpreadRunStatus;
  expectedJobs: number;
  successJobs: number;
  failedJobs: number;
  createdAt?: unknown;
  updatedAt?: unknown;
  completedAt?: unknown;
}

export interface SpreadJobDocData {
  spreadIndex: number;
  status: SpreadJobStatus;
  definition: unknown;
  result?: unknown;
  error?: string;
  attempts: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

@Injectable({ providedIn: 'root' })
export class SpreadRunService {
  private readonly env = inject(EnvironmentInjector);
  private readonly firestore = inject(Firestore);

  private inCtx<T>(fn: () => T): T {
    return runInInjectionContext(this.env, fn);
  }

  /** Emits run progress (counts + status) on each snapshot update. */
  watchRun$(runId: string): Observable<SpreadRunDocData> {
    console.log('[SpreadRunService] watchRun$ — subscribing to run doc:', runId);
    return new Observable<SpreadRunDocData>((subscriber) => {
      const sub = this.inCtx(() => {
        const ref = doc(this.firestore, `${Collection.SPREAD_RUNS}/${runId}`);
        return docSnapshots(ref).subscribe({
          next: (snap) => {
            if (snap.exists()) {
              const data = snap.data() as SpreadRunDocData;
              console.log('[SpreadRunService] run doc snapshot:', data.status, 'success:', data.successJobs, 'failed:', data.failedJobs, 'expected:', data.expectedJobs);
              subscriber.next(data);
            } else {
              console.warn('[SpreadRunService] run doc does not exist:', runId);
              subscriber.error(new Error(`Run document ${runId} does not exist`));
            }
          },
          error: (err) => {
            console.error('[SpreadRunService] run doc snapshot error:', err);
            subscriber.error(err);
          },
        });
      });
      return () => sub.unsubscribe();
    });
  }

  /** Emits per-spread job results as they arrive. */
  watchRunJobs$(runId: string): Observable<SpreadJobDocData[]> {
    console.log('[SpreadRunService] watchRunJobs$ — subscribing to jobs collection:', runId);
    return new Observable<SpreadJobDocData[]>((subscriber) => {
      const sub = this.inCtx(() => {
        const ref = collection(this.firestore, `${Collection.SPREAD_RUNS}/${runId}/jobs`);
        return collectionSnapshots(ref).subscribe({
          next: (snaps) => {
            const jobs = snaps.map((s) => s.data() as SpreadJobDocData);
            jobs.sort((a, b) => a.spreadIndex - b.spreadIndex);
            console.log('[SpreadRunService] jobs snapshot:', jobs.length, 'jobs', jobs.map((j) => ({ idx: j.spreadIndex, status: j.status, hasResult: !!j.result, error: j.error })));
            subscriber.next(jobs);
          },
          error: (err) => {
            console.error('[SpreadRunService] jobs snapshot error:', err);
            subscriber.error(err);
          },
        });
      });
      return () => sub.unsubscribe();
    });
  }
}
