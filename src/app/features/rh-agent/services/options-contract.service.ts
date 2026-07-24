import { Injectable, EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { defer, from, map, Observable, throwError } from 'rxjs';

import { CallableName } from '../../../core/common/constants';
import type {
  GetHistoricalOptionsContractRequest,
  PartnerHistoricalOptionsContractV2Response,
} from '@options-contract/contracts';
import { parseOccContractId } from '@options-contract/contracts';

/**
 * OptionsContractService
 *
 * Thin Angular wrapper around the getHistoricalOptionsContract callable.
 * Fetches historical time-series data for a single options contract from the
 * Savant Partner API via the backend callable.
 */
@Injectable({ providedIn: 'root' })
export class OptionsContractService {
  private readonly env = inject(EnvironmentInjector);
  private readonly functions = inject(Functions);

  private inCtx<T>(fn: () => T): T {
    return runInInjectionContext(this.env, fn);
  }

  /** Fetch historical options contract data by symbol + contractID, optionally resolving by length. */
  getHistoricalOptionsContract$(
    symbol: string,
    contractID: string,
    length?: string | null,
  ): Observable<PartnerHistoricalOptionsContractV2Response> {
    const sym = String(symbol || '').trim().toUpperCase();
    const cid = String(contractID || '').trim().toUpperCase();

    if (!sym || !cid) {
      return throwError(() => new Error('symbol and contractID are required'));
    }

    return defer(() => from(this.inCtx(() => {
      const callable = httpsCallable<GetHistoricalOptionsContractRequest, PartnerHistoricalOptionsContractV2Response>(
        this.functions,
        CallableName.GET_HISTORICAL_OPTIONS_CONTRACT,
      );
      const req: GetHistoricalOptionsContractRequest = {
        symbol: sym,
        contractID: cid,
        length: length ?? undefined,
      };
      return callable(req);
    }))).pipe(
      map((res) => res.data as PartnerHistoricalOptionsContractV2Response),
    );
  }

  /** Parse an OCC-style contract ID into its constituent parts. */
  static parseOccId(occId: string) {
    return parseOccContractId(occId);
  }
}
