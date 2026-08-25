import { Injectable, EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { defer, from, map, Observable, throwError } from 'rxjs';

import { CallableName } from '../../../core/common/constants';
import type {
  GetHistoricalOptionsContractRequest,
  PartnerHistoricalOptionsContractV2Response,
  GetListContractsRequest,
  PartnerListContractsV2Response,
  GetOptionsContractIndexRequest,
  OptionsContractIndexResponse,
  QueryContractCatalogRequest,
  ContractCatalogResponse,
  ContractSummaryResponse,
} from '@options-contract/contracts';
import { parseOccContractId } from '@options-contract/contracts';

/**
 * OptionsContractService
 *
 * Thin Angular wrapper around the options contract callables
 * (getHistoricalOptionsContract, listOptionsContracts). Fetches historical
 * time-series data for a single options contract and discovers available
 * contract IDs via the Savant Partner API backend callables.
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

  /** Discover available option contract IDs for a symbol, filtered by expiration/strike/type. */
  listContracts$(
    symbol: string,
    filters?: { expiration?: string; strike?: number; type?: 'C' | 'P' },
  ): Observable<PartnerListContractsV2Response> {
    const sym = String(symbol || '').trim().toUpperCase();

    if (!sym) {
      return throwError(() => new Error('symbol is required'));
    }
    if (!filters?.expiration && filters?.strike == null) {
      return throwError(() => new Error('at least one of expiration or strike must be provided'));
    }

    return defer(() => from(this.inCtx(() => {
      const callable = httpsCallable<GetListContractsRequest, PartnerListContractsV2Response>(
        this.functions,
        CallableName.LIST_OPTIONS_CONTRACTS,
      );
      const req: GetListContractsRequest = {
        symbol: sym,
        expiration: filters?.expiration,
        strike: filters?.strike,
        type: filters?.type,
      };
      return callable(req);
    }))).pipe(
      map((res) => res.data as PartnerListContractsV2Response),
    );
  }

  /** Fetch the options contract index (expirations + strikes with cross-filter maps) via callable. */
  getContractIndex$(symbol: string): Observable<OptionsContractIndexResponse> {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return throwError(() => new Error('symbol is required'));

    return defer(() => from(this.inCtx(() => {
      const callable = httpsCallable<GetOptionsContractIndexRequest, OptionsContractIndexResponse>(
        this.functions,
        CallableName.GET_OPTIONS_CONTRACT_INDEX,
      );
      return callable({ symbol: sym });
    }))).pipe(
      map((res) => res.data as OptionsContractIndexResponse),
    );
  }

  /** Fetch contract catalog summary (length-bucket histogram) for a symbol. */
  getContractCatalogSummary$(symbol: string): Observable<ContractSummaryResponse> {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return throwError(() => new Error('symbol is required'));

    return defer(() => from(this.inCtx(() => {
      const callable = httpsCallable<QueryContractCatalogRequest, ContractSummaryResponse>(
        this.functions,
        CallableName.QUERY_CONTRACT_CATALOG,
      );
      return callable({ symbol: sym, summary: true });
    }))).pipe(
      map((res) => res.data as ContractSummaryResponse),
    );
  }

  /** Query contract catalog with filters, sort, and pagination. */
  queryContractCatalog$(params: QueryContractCatalogRequest): Observable<ContractCatalogResponse> {
    const sym = String(params.symbol || '').trim().toUpperCase();
    if (!sym) return throwError(() => new Error('symbol is required'));

    return defer(() => from(this.inCtx(() => {
      const callable = httpsCallable<QueryContractCatalogRequest, ContractCatalogResponse>(
        this.functions,
        CallableName.QUERY_CONTRACT_CATALOG,
      );
      return callable({ ...params, symbol: sym });
    }))).pipe(
      map((res) => res.data as ContractCatalogResponse),
    );
  }
}
