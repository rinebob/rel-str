/**
 * Options Replay runs service.
 *
 * Wraps the `optionsReplayStart` callable plus realtime Firestore
 * listeners for `st-options-replay-runs` and
 * `st-options-contract-lists` — same pattern as
 * `backtest-run.service.ts`.
 */

import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, collection, collectionData, query, where, orderBy, limit } from '@angular/fire/firestore';
import { Observable, from, map } from 'rxjs';

import type { OptionsReplayStartRequest, OptionsReplayStartResponse } from '@options-replay/contracts';
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
   * Watch all contract-list docs for a given run in realtime (symbol asc).
   */
  watchContractLists(runId: string): Observable<OptionsContractListUi[]> {
    return from(runInInjectionContext(this.injector, () => {
      const listsRef = collection(this.firestore, this.listsCollection);
      const listsQuery = query(listsRef, where('runId', '==', runId), orderBy('symbol'));
      return collectionData(listsQuery, { idField: 'listId' }) as Observable<Record<string, unknown>[]>;
    })).pipe(
      map((docs) =>
        docs.map((d) => convertOptionsContractListDoc(String(d['listId'] ?? d['id']), d))
      )
    );
  }
}
