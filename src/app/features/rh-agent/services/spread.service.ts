/**
 * @topic #77 — Spread Time Series Viewer (opened 2026-08-02)
 *
 * Thin wrapper around the submitSpreadRun callable.
 */
import { Injectable, EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { defer, from, map, Observable, throwError } from 'rxjs';

import { CallableName } from '../../../core/common/constants';
import type {
  SubmitSpreadRunRequest,
  SubmitSpreadRunResponse,
  SpreadDefinition,
} from '@spread/contracts';

@Injectable({ providedIn: 'root' })
export class SpreadService {
  private readonly env = inject(EnvironmentInjector);
  private readonly functions = inject(Functions);

  private inCtx<T>(fn: () => T): T {
    return runInInjectionContext(this.env, fn);
  }

  /** Submit a batch of spread definitions for time series loading. */
  submitSpreadRun$(spreads: SpreadDefinition[]): Observable<SubmitSpreadRunResponse> {
    if (!spreads || spreads.length === 0) {
      return throwError(() => new Error('At least one spread is required'));
    }

    console.log('[SpreadService] submitSpreadRun$ — sending', spreads.length, 'spreads', spreads);

    return defer(() => from(this.inCtx(() => {
      const callable = httpsCallable<SubmitSpreadRunRequest, SubmitSpreadRunResponse>(
        this.functions,
        CallableName.SUBMIT_SPREAD_RUN,
      );
      const req: SubmitSpreadRunRequest = { spreads };
      console.log('[SpreadService] calling callable', CallableName.SUBMIT_SPREAD_RUN, 'with', JSON.stringify(req).slice(0, 500));
      return callable(req);
    }))).pipe(
      map((res) => {
        console.log('[SpreadService] callable response:', res);
        return res.data as SubmitSpreadRunResponse;
      }),
    );
  }
}
