/**
 * RH Agent Overview Service
 *
 * Focused service for company overview backfill operations.
 * Extracted from the monolithic RhAgentService.
 */
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, from, map } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class RhAgentOverviewService {
  private functions = inject(Functions);

  /**
   * Trigger the company overview backfill (Phase 1).
   * Enqueues one Cloud Task per enabled symbol to fetch SA overview data.
   */
  triggerOverviewSync(forceRefresh = true): Observable<{ enqueued: number; skipped: number; total: number }> {
    const callable = httpsCallable<
      { forceRefresh: boolean },
      { enqueued: number; skipped: number; total: number }
    >(this.functions, 'rhAgentOverviewSyncAdmin');
    return from(callable({ forceRefresh })).pipe(map((r) => r.data));
  }
}
