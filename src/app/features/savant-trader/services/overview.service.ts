/**
 * Savant Trader Overview Service
 *
 * Focused service for company overview backfill operations.
 * Extracted from the monolithic AgentService.
 */
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, from, map } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class OverviewService {
  private functions = inject(Functions);

  /**
   * Trigger the company overview backfill (Phase 1).
   * Enqueues one Cloud Task per enabled symbol to fetch SA overview data.
   */
  triggerOverviewSync(forceRefresh = true): Observable<{ enqueued: number; skipped: number; total: number }> {
    const callable = httpsCallable<
      { forceRefresh: boolean },
      { enqueued: number; skipped: number; total: number }
    >(this.functions, 'stOverviewSyncAdmin');
    return from(callable({ forceRefresh })).pipe(map((r) => r.data));
  }
}
