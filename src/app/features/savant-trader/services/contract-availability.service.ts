import { Injectable, EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { defer, from, map, Observable, throwError } from 'rxjs';

import { CallableName } from '../../../core/common/constants';
import type {
  ContractAvailabilityRequest,
  ContractAvailabilityResponse,
} from '@options-contract/contracts';

/**
 * ContractAvailabilityService
 *
 * Thin Angular wrapper around the `queryContractAvailability` callable —
 * the Firebase Functions proxy for SA's `partnerContractAvailabilityV1`.
 * Used by the OCC group generator drawer; the request/response shapes are
 * the SA wire contract verbatim (no FE reshaping — shared types are
 * canonical). Stubbed in specs — no Firebase dependency in unit tests.
 */
@Injectable({ providedIn: 'root' })
export class ContractAvailabilityService {
  private readonly env = inject(EnvironmentInjector);
  private readonly functions = inject(Functions);

  private inCtx<T>(fn: () => T): T {
    return runInInjectionContext(this.env, fn);
  }

  /** Query contract availability for a symbol + axis bounds. */
  queryContractAvailability$(
    req: ContractAvailabilityRequest,
  ): Observable<ContractAvailabilityResponse> {
    const sym = String(req.symbol || '').trim().toUpperCase();
    if (!sym) return throwError(() => new Error('symbol is required'));

    return defer(() => from(this.inCtx(() => {
      const callable = httpsCallable<ContractAvailabilityRequest, ContractAvailabilityResponse>(
        this.functions,
        CallableName.QUERY_CONTRACT_AVAILABILITY,
      );
      return callable({ ...req, symbol: sym });
    }))).pipe(
      map((res) => res.data as ContractAvailabilityResponse),
    );
  }
}
