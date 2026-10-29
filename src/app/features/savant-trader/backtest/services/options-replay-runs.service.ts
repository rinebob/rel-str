/**
 * Options Replay runs service.
 *
 * Realtime Firestore listeners for `st-options-replay-runs` and
 * `st-options-contract-lists` — same watch pattern as
 * `backtest-run.service.ts`. The `optionsReplayStart` callable wiring
 * lands with the run-dialog task (#1284).
 */

import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Firestore, collection, collectionData, query, where, orderBy, limit } from '@angular/fire/firestore';
import { Observable, from, map } from 'rxjs';

import type { OptionsContractListUi, OptionsReplayRunUi } from '../common/options-replay.types';
import { convertOptionsContractListDoc, convertOptionsReplayRunDoc } from './options-replay-firestore-converter';
import { ST_OPTIONS_REPLAY_RUNS_ROOT, ST_OPTIONS_CONTRACT_LISTS_ROOT } from '@st/collections';

@Injectable({
  providedIn: 'root',
})
export class OptionsReplayRunsService {
  private readonly firestore = inject(Firestore);
  private readonly injector = inject(EnvironmentInjector);

  private readonly runsCollection = ST_OPTIONS_REPLAY_RUNS_ROOT;
  private readonly listsCollection = ST_OPTIONS_CONTRACT_LISTS_ROOT;

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
