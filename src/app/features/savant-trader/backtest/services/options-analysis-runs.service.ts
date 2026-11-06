/**
 * Options Analysis runs service.
 *
 * Wraps the `optionsAnalysisStart` callable plus a realtime listener for
 * `st-options-analysis-results` — same pattern as
 * `options-replay-runs.service.ts`.
 */

import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, collection, collectionData, query, where } from '@angular/fire/firestore';
import { Observable, from, map } from 'rxjs';

import type {
  AnalysisResultDoc,
  OptionsAnalysisStartRequest,
  OptionsAnalysisStartResponse,
} from '@options-analysis/contracts';
import { ST_OPTIONS_ANALYSIS_RESULTS_ROOT } from '@st/collections';
import { convertAnalysisResultDoc } from './options-analysis-firestore-converter';

@Injectable({
  providedIn: 'root',
})
export class OptionsAnalysisRunsService {
  private readonly functions = inject(Functions);
  private readonly firestore = inject(Firestore);
  private readonly injector = inject(EnvironmentInjector);

  private readonly resultsCollection = ST_OPTIONS_ANALYSIS_RESULTS_ROOT;

  /**
   * Kick off analysis of one contract list doc. The callable validates
   * `status === 'success'` (failed-precondition otherwise) and enqueues
   * the analysis task; result docs arrive via `watchResultDocs`.
   */
  startAnalysis(contractListDocId: string): Observable<OptionsAnalysisStartResponse> {
    return from(runInInjectionContext(this.injector, () => {
      const callable = httpsCallable<OptionsAnalysisStartRequest, OptionsAnalysisStartResponse>(
        this.functions,
        'optionsAnalysisStart'
      );
      return callable({ contractListDocId });
    })).pipe(map((result) => result.data));
  }

  /**
   * Watch all analysis result docs for a run — one query feeds every
   * per-symbol card since docs carry `runId`.
   */
  watchResultDocs(runId: string): Observable<AnalysisResultDoc[]> {
    return from(runInInjectionContext(this.injector, () => {
      const resultsRef = collection(this.firestore, this.resultsCollection);
      const resultsQuery = query(resultsRef, where('runId', '==', runId));
      return collectionData(resultsQuery) as Observable<Record<string, unknown>[]>;
    })).pipe(
      map((docs) => docs.map((d) => convertAnalysisResultDoc(d)))
    );
  }

  /**
   * Watch the result docs for ONE contract list — the results-page query
   * (`{listDocId}_{exitId}` docs, one per exit type). Registry ordering is
   * applied client-side; the single-field `==` predicate rides the
   * automatic index — the declared (contractListDocId, exitId) composite
   * serves ordered/multi-field shapes.
   */
  watchListResultDocs(contractListDocId: string): Observable<AnalysisResultDoc[]> {
    return from(runInInjectionContext(this.injector, () => {
      const resultsRef = collection(this.firestore, this.resultsCollection);
      const resultsQuery = query(resultsRef, where('contractListDocId', '==', contractListDocId));
      return collectionData(resultsQuery) as Observable<Record<string, unknown>[]>;
    })).pipe(
      map((docs) => docs.map((d) => convertAnalysisResultDoc(d)))
    );
  }
}
