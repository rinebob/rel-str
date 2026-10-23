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
  CancelPaperTradeRequest,
  CancelPaperTradeResponse,
  ClosePaperTradeRequest,
  ClosePaperTradeResponse,
  GetPaperAccountResponse,
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

  /** Fetch the caller's paper account (null when none exists yet). */
  getPaperAccount$(): Observable<GetPaperAccountResponse> {
    return this.call(CallableName.GET_PAPER_ACCOUNT, {});
  }

  /** Fetch the exit-variant registry configs for the variant selector. */
  listExitVariants$(): Observable<ListExitVariantsResponse> {
    return this.call(CallableName.LIST_EXIT_VARIANTS, {});
  }

  /**
   * Close an OPEN trade at the live quote — whole-unit market close.
   * Returns the exit price, realized P&L, and close timestamp.
   */
  closePaperTrade$(tradeId: string): Observable<ClosePaperTradeResponse> {
    const request: ClosePaperTradeRequest = { tradeId };
    return this.call(CallableName.CLOSE_PAPER_TRADE, request);
  }

  /**
   * Cancel a PENDING trade before its fill pass runs — the trade flips
   * to CANCELLED and never reaches the ledger.
   */
  cancelPaperTrade$(tradeId: string): Observable<CancelPaperTradeResponse> {
    const request: CancelPaperTradeRequest = { tradeId };
    return this.call(CallableName.CANCEL_PAPER_TRADE, request);
  }
}
