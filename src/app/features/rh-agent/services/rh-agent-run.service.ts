/**
 * RH Agent Run Service
 *
 * Focused service for manual runs, agent status, and run history.
 * Extracted from the monolithic RhAgentService.
 */
import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Auth, getIdToken } from '@angular/fire/auth';
import { Firestore, collection, collectionData, query, where, orderBy, limit } from '@angular/fire/firestore';
import { Observable, from, map, switchMap } from 'rxjs';

import {
  type RhAgentStatus,
  type RhAgentRun,
  type ManualRunRequest,
  type ManualRunResponse,
} from './rh-agent.types';
import { Collection } from '../../../core/common/constants';

@Injectable({
  providedIn: 'root',
})
export class RhAgentRunService {
  private functions = inject(Functions);
  private firestore = inject(Firestore);
  private http = inject(HttpClient);
  private auth = inject(Auth);
  private injector = inject(EnvironmentInjector);

  private readonly adminHttpUrl = 'https://us-central1-rel-str.cloudfunctions.net/symbolDataSyncAdminHttp';

  private readonly runsCollection = Collection.RH_RUNS;
  private readonly statusDoc = 'rh-agent-status/current';

  /**
   * Trigger symbol-data backfill via symbolDataSyncAdminHttp HTTPS endpoint.
   */
  triggerBarsBackfill(symbols?: string[]): Observable<{ total: number; enqueued: number; errors: number }> {
    return from(getIdToken(this.auth.currentUser!, false)).pipe(
      switchMap(token =>
        this.http.post<{ total: number; enqueued: number; errors: number }>(
          this.adminHttpUrl,
          { forceFullFetch: true, ...(symbols?.length ? { symbols } : {}) },
          { headers: { Authorization: `Bearer ${token}` } }
        )
      )
    );
  }

  /**
   * Trigger a manual agent run.
   */
  triggerManualRun(request: ManualRunRequest = {}): Observable<ManualRunResponse> {
    return from(runInInjectionContext(this.injector, () => {
      const callable = httpsCallable<ManualRunRequest, ManualRunResponse>(this.functions, 'rhAgentManualRun');
      return callable(request);
    })).pipe(map((result) => result.data));
  }

  /**
   * Get the current agent status.
   */
  getStatus(): Observable<RhAgentStatus> {
    return from(runInInjectionContext(this.injector, () => {
      const callable = httpsCallable<void, RhAgentStatus>(this.functions, 'rhAgentGetStatus');
      return callable();
    })).pipe(map((result) => result.data));
  }

  /**
   * Get recent run history.
   */
  getRunHistory(limitCount = 20): Observable<RhAgentRun[]> {
    return from(runInInjectionContext(this.injector, () => {
      const callable = httpsCallable<{ limit: number }, { runs: RhAgentRun[] }>(this.functions, 'rhAgentGetRunHistory');
      return callable({ limit: limitCount });
    })).pipe(map((result) => result.data.runs));
  }

  /**
   * Subscribe to recent runs from Firestore (realtime updates).
   * Maps Firestore Timestamps to ISO strings so consumers receive plain RhAgentRun objects.
   */
  watchRecentRunsRealtime(count = 20): Observable<RhAgentRun[]> {
    const runsRef = collection(this.firestore, this.runsCollection);
    const runsQuery = query(runsRef, orderBy('startedAt', 'desc'), limit(count));
    return (runInInjectionContext(this.injector, () => collectionData(runsQuery, { idField: 'id' })) as Observable<any[]>).pipe(
      map(docs => docs.map(d => ({
        id: d['id'],
        status: d['status'] ?? '',
        startedAt: d['startedAt']?.toDate?.()?.toISOString?.() ?? d['startedAt'] ?? '',
        completedAt: d['completedAt']?.toDate?.()?.toISOString?.() ?? d['completedAt'],
        marketDate: d['marketDate'],
        triggeredBy: d['triggeredBy'],
        totalSymbols: d['totalSymbols'],
        processedCount: d['processedCount'] ?? d['symbolsProcessed'],
        symbolsProcessed: d['symbolsProcessed'],
        signalsGenerated: d['signalsGenerated'],
        summary: d['summary'],
        strategy: d['strategy'],
      } as RhAgentRun)))
    );
  }
}
