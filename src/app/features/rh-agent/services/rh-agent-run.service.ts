/**
 * RH Agent Run Service
 *
 * Focused service for manual runs, agent status, run history, and
 * intraday snapshots. Extracted from the monolithic RhAgentService.
 */
import { Injectable, inject } from '@angular/core';
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

@Injectable({
  providedIn: 'root',
})
export class RhAgentRunService {
  private functions = inject(Functions);
  private firestore = inject(Firestore);
  private http = inject(HttpClient);
  private auth = inject(Auth);

  private readonly adminHttpUrl = 'https://us-central1-rel-str.cloudfunctions.net/rsBarsSyncAdminHttp';

  private readonly runsCollection = 'rh-agent-runs';
  private readonly statusDoc = 'rh-agent-status/current';

  /**
   * Trigger rs-bars backfill via rsBarsSyncAdminHttp HTTPS endpoint.
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
    const callable = httpsCallable<ManualRunRequest, ManualRunResponse>(
      this.functions,
      'rhAgentManualRun'
    );
    return from(callable(request)).pipe(map((result) => result.data));
  }

  /**
   * Get the current agent status.
   */
  getStatus(): Observable<RhAgentStatus> {
    const callable = httpsCallable<void, RhAgentStatus>(
      this.functions,
      'rhAgentGetStatus'
    );
    return from(callable()).pipe(map((result) => result.data));
  }

  /**
   * Get recent run history.
   */
  getRunHistory(limitCount = 20): Observable<RhAgentRun[]> {
    const callable = httpsCallable<{ limit: number }, { runs: RhAgentRun[] }>(
      this.functions,
      'rhAgentGetRunHistory'
    );
    return from(callable({ limit: limitCount })).pipe(map((result) => result.data.runs));
  }

  /**
   * Fetch the current intraday price for a single symbol.
   * Returns ip: null if SA has no data (outside market hours, unknown symbol, etc.).
   */
  getIntradaySnapshot$(symbol: string): Observable<{ symbol: string; ip: number | null; marketDate: string }> {
    const callable = httpsCallable<{ symbol: string }, { symbol: string; ip: number | null; marketDate: string }>(
      this.functions,
      'rhAgentGetIntradaySnapshot'
    );
    return from(callable({ symbol })).pipe(map(result => result.data));
  }

  /**
   * Subscribe to recent runs from Firestore (realtime updates).
   * Maps Firestore Timestamps to ISO strings so consumers receive plain RhAgentRun objects.
   */
  watchRecentRunsRealtime(count = 20): Observable<RhAgentRun[]> {
    const runsRef = collection(this.firestore, this.runsCollection);
    const runsQuery = query(runsRef, orderBy('startedAt', 'desc'), limit(count));
    return (collectionData(runsQuery, { idField: 'id' }) as Observable<any[]>).pipe(
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
