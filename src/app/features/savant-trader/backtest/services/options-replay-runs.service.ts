/**
 * Options Replay runs service.
 *
 * Wraps the `optionsReplayStart` / `optionsReplayRetry` /
 * `optionsReplayDelete` callables plus
 * realtime Firestore listeners for `st-options-replay-runs` and
 * `st-options-contract-lists` — same pattern as
 * `backtest-run.service.ts`.
 */

import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, collection, collectionData, doc, docData, query, orderBy, limit } from '@angular/fire/firestore';
import { Observable, from, map } from 'rxjs';

import type {
  OptionsReplayStartRequest,
  OptionsReplayStartResponse,
  OptionsReplayRetryRequest,
  OptionsReplayRetryResponse,
  OptionsReplayDeleteRequest,
  OptionsReplayDeleteResponse,
} from '@options-replay/contracts';
import type { OptionsContractListUi, OptionsReplayRunUi } from '../common/options-replay.types';
import { convertOptionsContractListDoc, convertOptionsReplayRunDoc } from './options-replay-firestore-converter';
import { ST_OPTIONS_REPLAY_RUNS_ROOT, ST_OPTIONS_CONTRACT_LISTS_ROOT } from '@st/collections';

@Injectable({
  providedIn: 'root',
})
export class OptionsReplayRunsService {
  private readonly functions = inject(Functions);
  private readonly firestore = inject(Firestore);
  private readonly injector = inject(EnvironmentInjector);

  private readonly runsCollection = ST_OPTIONS_REPLAY_RUNS_ROOT;
  private readonly listsCollection = ST_OPTIONS_CONTRACT_LISTS_ROOT;

  /**
   * Start a new selection replay run.
   */
  startReplay(request: OptionsReplayStartRequest): Observable<OptionsReplayStartResponse> {
    return from(runInInjectionContext(this.injector, () => {
      const callable = httpsCallable<OptionsReplayStartRequest, OptionsReplayStartResponse>(
        this.functions,
        'optionsReplayStart'
      );
      return callable(request);
    })).pipe(map((result) => result.data));
  }

  /**
   * Re-run a failed single-symbol run in place. The BE no-ops on
   * pending/running/cancelled/completed runs, returning
   * `{ retriedSymbol: null }`. Throws for missing/unknown runs and
   * enqueue failures.
   */
  retryRun(runId: string): Observable<OptionsReplayRetryResponse> {
    return from(runInInjectionContext(this.injector, () => {
      const callable = httpsCallable<OptionsReplayRetryRequest, OptionsReplayRetryResponse>(
        this.functions,
        'optionsReplayRetry'
      );
      return callable({ runId });
    })).pipe(map((result) => result.data));
  }

  /**
   * Cascade-delete a run: the run doc, its 1:1 contract list, and every
   * analysis-result doc keyed off it. Idempotent — missing pieces count
   * as already-deleted (task #1439).
   */
  deleteRun(runId: string): Observable<OptionsReplayDeleteResponse> {
    return from(runInInjectionContext(this.injector, () => {
      const callable = httpsCallable<OptionsReplayDeleteRequest, OptionsReplayDeleteResponse>(
        this.functions,
        'optionsReplayDelete'
      );
      return callable({ runId });
    })).pipe(map((result) => result.data));
  }

  /**
   * Watch recent replay runs in realtime (createdAt desc).
   */
  watchRuns(count = 50): Observable<OptionsReplayRunUi[]> {
    return from(runInInjectionContext(this.injector, () => {
      const runsRef = collection(this.firestore, this.runsCollection);
      const runsQuery = query(runsRef, orderBy('createdAt', 'desc'), limit(count));
      return collectionData(runsQuery, { idField: 'runId' }) as Observable<Record<string, unknown>[]>;
    })).pipe(
      map((docs) =>
        docs.map((d) => convertOptionsReplayRunDoc(String(d['runId'] ?? d['id']), d))
      )
    );
  }

  /**
   * Watch the run's contract-list doc in realtime. Runs are single-symbol
   * (#1430) so docId IS the runId — a direct doc read, no query/index.
   * Emits null while the doc doesn't exist (worker hasn't written yet).
   */
  watchContractList(runId: string): Observable<OptionsContractListUi | null> {
    return from(runInInjectionContext(this.injector, () => {
      const listRef = doc(this.firestore, this.listsCollection, runId);
      return docData(listRef, { idField: 'listId' }) as Observable<Record<string, unknown> | undefined>;
    })).pipe(
      map((d) => (d ? convertOptionsContractListDoc(String(d['listId'] ?? runId), d) : null))
    );
  }
}
