/**
 * Options Analysis runs service.
 *
 * Wraps the `optionsAnalysisStart` callable plus a realtime listener for
 * `st-options-analysis-results` — same pattern as
 * `options-replay-runs.service.ts`.
 */

import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, collection, collectionData, doc, docData, query, where } from '@angular/fire/firestore';
import { Observable, from, map, take } from 'rxjs';

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
   * Watch every analysis result doc — the row-actions table needs
   * readiness across all runs, not one selected run (#1471 detail-panel
   * removal). Doc count is ~6 per analyzed run.
   */
  watchAllResultDocs(): Observable<AnalysisResultDoc[]> {
    return from(runInInjectionContext(this.injector, () => {
      const resultsRef = collection(this.firestore, this.resultsCollection);
      return collectionData(resultsRef) as Observable<Record<string, unknown>[]>;
    })).pipe(
      map((docs) => docs.map((d) => convertAnalysisResultDoc(d)))
    );
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

  /**
   * One-shot read of a single result doc — `{listDocId}_{exitId}`. The
   * option-chart `?results=` deep link needs exactly one emission, not
   * a stream; null when the doc doesn't exist.
   */
  getResultDoc$(docId: string): Observable<AnalysisResultDoc | null> {
    return from(runInInjectionContext(this.injector, () => {
      const docRef = doc(this.firestore, this.resultsCollection, docId);
      return (docData(docRef) as Observable<Record<string, unknown> | undefined>).pipe(take(1));
    })).pipe(
      map((d) => (d ? convertAnalysisResultDoc(d) : null))
    );
  }
}
