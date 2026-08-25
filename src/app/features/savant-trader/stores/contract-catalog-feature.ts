import { withMethods, patchState } from '@ngrx/signals';
import { inject } from '@angular/core';

import { OptionsContractService } from '../services/options-contract.service';
import type {
  ContractCatalogEntry,
  ContractSummaryResponse,
  QueryContractCatalogRequest,
} from '../../../core/models/partner.types';

export type CatalogSortBy = 'expiration' | 'strike' | 'contractLengthDays' | 'observationCount' | 'delta';

/** Contract type filter for catalog queries. `null` = both (no type filter). */
export type ContractType = 'C' | 'P' | null;

export interface CatalogFilters {
  contractLengthBucket: string | null;
  deltaGte: number | null;
  deltaLte: number | null;
  ivGte: number | null;
  ivLte: number | null;
  minObservationCount: number | null;
  strikeGte: number | null;
  strikeLte: number | null;
  expirationGte: string | null;
  expirationLte: string | null;
  sortBy: CatalogSortBy;
  sortOrder: 'asc' | 'desc';
}

export interface ContractCatalogState {
  catalogLoading: boolean;
  catalogError: string | null;
  catalogResults: ContractCatalogEntry[];
  catalogCount: number;
  catalogPageToken: string | null;
  catalogPageSize: number;
  catalogSummary: ContractSummaryResponse | null;
  catalogSummaryLoading: boolean;
  catalogFilters: CatalogFilters;
  catalogSymbol: string;
  catalogType: ContractType;
  catalogLoadAllProgress: string | null;
  catalogLoadAllCancelled: boolean;
}

export const initialCatalogState: ContractCatalogState = {
  catalogLoading: false,
  catalogError: null,
  catalogResults: [],
  catalogCount: 0,
  catalogPageToken: null,
  catalogPageSize: 1000,
  catalogSummary: null,
  catalogSummaryLoading: false,
  catalogFilters: {
    contractLengthBucket: null,
    deltaGte: null,
    deltaLte: null,
    ivGte: null,
    ivLte: null,
    minObservationCount: null,
    strikeGte: null,
    strikeLte: null,
    expirationGte: null,
    expirationLte: null,
    sortBy: 'strike',
    sortOrder: 'asc',
  },
  catalogSymbol: '',
  catalogType: null,
  catalogLoadAllProgress: null,
  catalogLoadAllCancelled: false,
};

function buildCatalogRequest(
  symbol: string,
  expiration: string | null,
  strike: number | null,
  type: ContractType,
  filters: CatalogFilters,
  pageSize: number,
  pageToken?: string | null,
): QueryContractCatalogRequest {
  const hasStrikeRange = filters.strikeGte != null || filters.strikeLte != null;
  const hasExpRange = filters.expirationGte != null || filters.expirationLte != null;
  return {
    symbol,
    expiration: hasExpRange ? undefined : (expiration ?? undefined),
    expirationGte: filters.expirationGte ?? undefined,
    expirationLte: filters.expirationLte ?? undefined,
    strike: hasStrikeRange ? undefined : (strike ?? undefined),
    strikeGte: filters.strikeGte ?? undefined,
    strikeLte: filters.strikeLte ?? undefined,
    type: type ?? undefined,
    contractLengthBucket: filters.contractLengthBucket ?? undefined,
    deltaGte: filters.deltaGte ?? undefined,
    deltaLte: filters.deltaLte ?? undefined,
    ivGte: filters.ivGte ?? undefined,
    ivLte: filters.ivLte ?? undefined,
    minObservationCount: filters.minObservationCount ?? undefined,
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
    pageSize,
    pageToken: pageToken ?? undefined,
  };
}

export function withCatalogMethods() {
  return withMethods((store, optionsContractService = inject(OptionsContractService)) => {
    return {
      loadCatalogSummary(symbol: string): void {
        const sym = String(symbol || '').trim().toUpperCase();
        if (!sym) return;

        patchState(store, { catalogSummaryLoading: true, catalogSummary: null });

        optionsContractService.getContractCatalogSummary$(sym).subscribe({
          next: (summary) => {
            patchState(store, { catalogSummaryLoading: false, catalogSummary: summary });
          },
          error: (err: Error) => {
            patchState(store, { catalogSummaryLoading: false, catalogSummary: null });
          },
        });
      },

      setCatalogBuilder(partial: { symbol?: string; type?: ContractType }): void {
        const updates: Partial<ContractCatalogState> = {};
        if (partial.symbol !== undefined) updates.catalogSymbol = partial.symbol;
        if (partial.type !== undefined) updates.catalogType = partial.type;
        patchState(store, updates);
      },

      queryCatalog(autoLoadAll = false): void {
        const sym = String(store.catalogSymbol() || '').trim().toUpperCase();
        if (!sym) {
          patchState(store, { catalogError: 'Symbol is required', catalogResults: [], catalogCount: 0, catalogPageToken: null });
          return;
        }

        const filters = store.catalogFilters();
        const req = buildCatalogRequest(
          sym,
          store.selectedExpiration(),
          store.selectedStrike(),
          store.catalogType(),
          filters,
          store.catalogPageSize(),
        );

        // Cancel any in-flight load-all, then reset for the new query.
        patchState(store, { catalogLoadAllCancelled: true });
        patchState(store, { catalogLoading: true, catalogError: null, catalogResults: [], catalogCount: 0, catalogPageToken: null, catalogLoadAllProgress: null, catalogLoadAllCancelled: false, currentSearchIndex: -1 });

        optionsContractService.queryContractCatalog$(req).subscribe({
          next: (data) => {
            patchState(store, {
              catalogResults: data.contracts ?? [],
              catalogCount: Math.max(0, data.count ?? 0),
              catalogPageToken: data.nextPageToken ?? null,
              currentSearchIndex: -1,
              catalogLoading: false,
            });
            if (autoLoadAll && data.nextPageToken) {
              store.loadAllCatalog();
            }
          },
          error: (err: Error) => {
            patchState(store, {
              catalogLoading: false,
              catalogError: err?.message ?? 'Failed to query catalog',
              catalogResults: [],
              catalogCount: 0,
              catalogPageToken: null,
              currentSearchIndex: -1,
            });
          },
        });
      },

      loadMoreCatalog(): void {
        const token = store.catalogPageToken();
        if (!token) return;

        const sym = String(store.catalogSymbol() || '').trim().toUpperCase();
        const filters = store.catalogFilters();
        const req = buildCatalogRequest(
          sym,
          store.selectedExpiration(),
          store.selectedStrike(),
          store.catalogType(),
          filters,
          store.catalogPageSize(),
          token,
        );

        patchState(store, { catalogLoading: true, catalogError: null });

        optionsContractService.queryContractCatalog$(req).subscribe({
          next: (data) => {
            const existing = store.catalogResults();
            patchState(store, {
              catalogLoading: false,
              catalogResults: [...existing, ...(data.contracts ?? [])],
              catalogCount: Math.max(store.catalogCount(), data.count ?? 0),
              catalogPageToken: data.nextPageToken ?? null,
            });
          },
          error: (err: Error) => {
            patchState(store, { catalogLoading: false, catalogError: err?.message ?? 'Failed to load more' });
          },
        });
      },

      loadAllCatalog(): void {
        const token = store.catalogPageToken();
        if (!token || store.catalogLoading()) return;

        const sym = String(store.catalogSymbol() || '').trim().toUpperCase();
        const filters = store.catalogFilters();
        const pageSize = store.catalogPageSize();
        const firstPageCount = store.catalogCount();
        const estimatedTotalPages = Math.max(2, Math.ceil(firstPageCount / pageSize));
        let pagesLoaded = 1;

        patchState(store, { catalogLoading: true, catalogError: null, catalogLoadAllProgress: `Loading 2/${estimatedTotalPages}...`, catalogLoadAllCancelled: false });

        const loadNext = (currentToken: string) => {
          if (store.catalogLoadAllCancelled()) return;
          const req = buildCatalogRequest(
            sym,
            store.selectedExpiration(),
            store.selectedStrike(),
            store.catalogType(),
            filters,
            pageSize,
            currentToken,
          );

          optionsContractService.queryContractCatalog$(req).subscribe({
            next: (data) => {
              if (store.catalogLoadAllCancelled()) return;
              const existing = store.catalogResults();
              pagesLoaded++;
              patchState(store, {
                catalogResults: [...existing, ...(data.contracts ?? [])],
                catalogCount: Math.max(store.catalogCount(), data.count ?? 0),
                catalogPageToken: data.nextPageToken ?? null,
              });

              const nextToken = data.nextPageToken;
              if (nextToken) {
                patchState(store, { catalogLoadAllProgress: `Loading ${pagesLoaded + 1}/${estimatedTotalPages}...` });
                loadNext(nextToken);
              } else {
                patchState(store, { catalogLoading: false, catalogLoadAllProgress: null });
              }
            },
            error: (err: Error) => {
              if (store.catalogLoadAllCancelled()) return;
              patchState(store, { catalogLoading: false, catalogError: err?.message ?? 'Failed to load all', catalogLoadAllProgress: null });
            },
          });
        };

        loadNext(token);
      },

      setCatalogFilter(key: keyof CatalogFilters, value: string | number | null): void {
        const filters = store.catalogFilters();
        patchState(store, { catalogFilters: { ...filters, [key]: value } });
      },

      setCatalogFilters(partial: Partial<CatalogFilters>): void {
        const filters = store.catalogFilters();
        patchState(store, { catalogFilters: { ...filters, ...partial } });
      },

      clearCatalogFilters(): void {
        patchState(store, { catalogFilters: { ...initialCatalogState.catalogFilters } });
      },

      clearCatalog(): void {
        patchState(store, {
          catalogLoading: false,
          catalogError: null,
          catalogResults: [],
          catalogCount: 0,
          catalogPageToken: null,
          catalogLoadAllProgress: null,
          catalogLoadAllCancelled: true,
          currentSearchIndex: -1,
        });
      },
    };
  });
}
