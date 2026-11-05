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

/** Firestore doc → AnalysisResultDoc — defaults guard sparse/partial
 *  snapshots; mirrors convertOptionsContractListDoc. */
function convertAnalysisResultDoc(d: Record<string, unknown>): AnalysisResultDoc {
  const exitId = String(d['exitId'] ?? '');
  return {
    contractListDocId: String(d['contractListDocId'] ?? ''),
    runId: String(d['runId'] ?? ''),
    symbol: String(d['symbol'] ?? ''),
    templateId: String(d['templateId'] ?? ''),
    exitId,
    registryVersion: Number(d['registryVersion'] ?? 0),
    // A missing status must NOT default to 'success' — that would flip the
    // card to a dead-end View Results and remove its only re-run affordance.
    // 'failed' fails safe: the card keeps Analyze enabled for a silent retry.
    status: (d['status'] as AnalysisResultDoc['status']) ?? 'failed',
    trades: Array.isArray(d['trades']) ? (d['trades'] as AnalysisResultDoc['trades']) : [],
    aggregate: (d['aggregate'] as AnalysisResultDoc['aggregate']) ?? {
      exitId, contractCount: 0, exitedCount: 0, expiredCount: 0, errorCount: 0,
    },
    generatedAt: String(d['generatedAt'] ?? ''),
    error: typeof d['error'] === 'string' ? d['error'] : undefined,
  };
}

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
}
