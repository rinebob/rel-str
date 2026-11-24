/**
 * Angular wrapper around the signal-selection review callables (#1117).
 * Uses the same httpsCallable + runInInjectionContext pattern as
 * PaperTradingService.
 */

import { inject, Injectable, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { from, map, Observable } from 'rxjs';
import { CallableName } from '../../../core/common/constants';
import type {
  DeletePaperTradesRequest,
  DeletePaperTradesResponse,
  GeneratePaperSignalTradesRequest,
  GeneratePaperSignalTradesResponse,
  GetSignalReviewBundleRequest,
  GetSignalReviewBundleResponse,
  GetSignalReviewQueueRequest,
  GetSignalReviewQueueResponse,
} from '@paper-trading/contracts';

@Injectable({ providedIn: 'root' })
export class SignalReviewService {
  private readonly functions = inject(Functions);
  private readonly env = inject(EnvironmentInjector);

  private inCtx<T>(fn: () => T): T {
    return runInInjectionContext(this.env, fn);
  }

  private call<Req, Res>(name: CallableName, request: Req): Observable<Res> {
    return from(this.inCtx(() => {
      const callable = httpsCallable<Req, Res>(this.functions, name);
      return callable(request);
    })).pipe(map((res) => res.data));
  }

  /**
   * The review pane's symbol queue — one row per symbol with an un-groomed
   * signal, joined with the pane-open stamp for the new-signal dot.
   */
  getSignalReviewQueue$(): Observable<GetSignalReviewQueueResponse> {
    return this.call<GetSignalReviewQueueRequest, GetSignalReviewQueueResponse>(
      CallableName.GET_SIGNAL_REVIEW_QUEUE, {});
  }

  /**
   * One symbol's signal-occurrence bundle. Server-side stamps `openedAt`
   * on every successful response — the stamp feeds the next call's
   * `previousOpenedAt` split line.
   */
  getSignalReviewBundle$(symbol: string): Observable<GetSignalReviewBundleResponse> {
    return this.call<GetSignalReviewBundleRequest, GetSignalReviewBundleResponse>(
      CallableName.GET_SIGNAL_REVIEW_BUNDLE, { symbol });
  }

  /**
   * Mint real PaperTrades from checked occurrences — historical picks mint
   * backdated trades; deterministic trade ids make re-mints no-ops.
   */
  generatePaperSignalTrades$(
    request: GeneratePaperSignalTradesRequest,
  ): Observable<GeneratePaperSignalTradesResponse> {
    return this.call(CallableName.GENERATE_PAPER_SIGNAL_TRADES, request);
  }

  /**
   * Hard-delete unwanted curated signal trades plus the artifacts they own
   * (raw-quote audit docs, the `pap_{tradeId}` ticket). Idempotent.
   */
  deletePaperTrades$(request: DeletePaperTradesRequest): Observable<DeletePaperTradesResponse> {
    return this.call(CallableName.DELETE_PAPER_TRADES, request);
  }
}
