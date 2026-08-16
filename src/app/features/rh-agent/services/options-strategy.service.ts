/**
 * @topic #108 — Options Position Strategy Engine
 *
 * Angular wrapper around the options strategy BE callables.
 * Uses the same httpsCallable + runInInjectionContext pattern as other
 * RH Agent services.
 */

import { inject, Injectable, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { from, map, Observable } from 'rxjs';
import { CallableName } from '../../../core/common/constants';
import type {
  GetStrategyEquityCurveRequest,
  ListStrategyPositionsRequest,
  StrategyEquityCurveResponse,
  StrategyPositionsResponse,
} from './options-strategy.types';

@Injectable({ providedIn: 'root' })
export class OptionsStrategyService {
  private readonly functions = inject(Functions);
  private readonly env = inject(EnvironmentInjector);

  private inCtx<T>(fn: () => T): T {
    return runInInjectionContext(this.env, fn);
  }

  /**
   * Fetch open and closed positions for the dashboard tables.
   * Optionally filter by instanceId (per-symbol) or status.
   */
  listStrategyPositions$(request: ListStrategyPositionsRequest = {}): Observable<StrategyPositionsResponse> {
    return from(this.inCtx(() => {
      const callable = httpsCallable<ListStrategyPositionsRequest, StrategyPositionsResponse>(
        this.functions,
        CallableName.LIST_STRATEGY_POSITIONS,
      );
      return callable(request);
    })).pipe(map((res) => res.data));
  }

  /**
   * Fetch equity curve points + stats for a scope.
   * Omit instanceId for the combined ALL-scope view.
   */
  getStrategyEquityCurve$(request: GetStrategyEquityCurveRequest = {}): Observable<StrategyEquityCurveResponse> {
    return from(this.inCtx(() => {
      const callable = httpsCallable<GetStrategyEquityCurveRequest, StrategyEquityCurveResponse>(
        this.functions,
        CallableName.GET_STRATEGY_EQUITY_CURVE,
      );
      return callable(request);
    })).pipe(map((res) => res.data));
  }
}
