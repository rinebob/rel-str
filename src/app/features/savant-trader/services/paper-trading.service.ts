/**
 * Angular wrapper around the paper-trading BE callables.
 * Uses the same httpsCallable + runInInjectionContext pattern as
 * OptionsStrategyService / OrderTicketService.
 */

import { inject, Injectable, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { from, map, Observable } from 'rxjs';
import { CallableName } from '../../../core/common/constants';
import type {
  GetPaperAccountResponse,
  GetPaperStatsRequest,
  GetPaperStatsResponse,
  ListExitVariantsResponse,
  ListPaperTradesRequest,
  ListPaperTradesResponse,
  PaperSignalOrderRequest,
  PaperSignalOrderResponse,
} from '@paper-trading/contracts';

@Injectable({ providedIn: 'root' })
export class PaperTradingService {
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
   * Accept a signal/order ticket as a paper trade — fills the equity leg
   * on the acceptance quote, creates the cohort, and fans out PENDING
   * expression trades.
   */
  paperSignalOrder$(request: PaperSignalOrderRequest): Observable<PaperSignalOrderResponse> {
    return this.call(CallableName.PAPER_SIGNAL_ORDER, request);
  }

  /**
   * List paper trades with AND-combined filters (status, source, instance,
   * cohort, signal, symbol, expression, variantKey). Empty request → all.
   */
  listPaperTrades$(request: ListPaperTradesRequest = {}): Observable<ListPaperTradesResponse> {
    return this.call(CallableName.LIST_PAPER_TRADES, request);
  }

  /**
   * Fetch rollup stats. Pass a scope id ('all', 'inst-…', 'sym-…', …) for
   * one rollup; omit to enumerate every stats doc for the dashboard.
   */
  getPaperStats$(request: GetPaperStatsRequest = {}): Observable<GetPaperStatsResponse> {
    return this.call(CallableName.GET_PAPER_STATS, request);
  }

  /** Fetch the caller's paper account (null when none exists yet). */
  getPaperAccount$(): Observable<GetPaperAccountResponse> {
    return this.call(CallableName.GET_PAPER_ACCOUNT, {});
  }

  /** Fetch the exit-variant registry configs for the variant selector. */
  listExitVariants$(): Observable<ListExitVariantsResponse> {
    return this.call(CallableName.LIST_EXIT_VARIANTS, {});
  }
}
