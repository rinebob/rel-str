import { withMethods, patchState } from '@ngrx/signals';
import { inject } from '@angular/core';

import { OptionsContractService } from '../services/options-contract.service';
import type {
  ContractCatalogEntry,
  ContractSummaryResponse,
  QueryContractCatalogRequest,
} from '../../../core/models/partner.types';

export type CatalogSortBy = 'expiration' | 'strike' | 'contractLengthDays' | 'observationCount' | 'delta';

export interface CatalogFilters {
  contractLengthBucket: string | null;
  deltaGte: number | null;
  deltaLte: number | null;
  ivGte: number | null;
  ivLte: number | null;
  minObservationCount: number | null;
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
  catalogType: 'C' | 'P';
}

export const initialCatalogState: ContractCatalogState = {
  catalogLoading: false,
  catalogError: null,
  catalogResults: [],
  catalogCount: 0,
  catalogPageToken: null,
  catalogPageSize: 200,
  catalogSummary: null,
  catalogSummaryLoading: false,
  catalogFilters: {
    contractLengthBucket: null,
    deltaGte: null,
    deltaLte: null,
    ivGte: null,
    ivLte: null,
    minObservationCount: null,
    sortBy: 'strike',
    sortOrder: 'asc',
  },
  catalogSymbol: '',
  catalogType: 'C',
};

function buildCatalogRequest(
  symbol: string,
  expiration: string | null,
  strike: number | null,
  type: 'C' | 'P',
  filters: CatalogFilters,
  pageSize: number,
  pageToken?: string | null,
): QueryContractCatalogRequest {
  return {
    symbol,
    expiration: expiration ?? undefined,
    strike: strike ?? undefined,
    type,
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
            console.error('[loadCatalogSummary] error:', err);
          },
        });
      },

      setCatalogBuilder(partial: { symbol?: string; type?: 'C' | 'P' }): void {
        const updates: Partial<ContractCatalogState> = {};
        if (partial.symbol !== undefined) updates.catalogSymbol = partial.symbol;
        if (partial.type !== undefined) updates.catalogType = partial.type;
        patchState(store, updates);
      },

      queryCatalog(): void {
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

        patchState(store, { catalogLoading: true, catalogError: null, catalogResults: [], catalogCount: 0, catalogPageToken: null, currentSearchIndex: -1 });

        optionsContractService.queryContractCatalog$(req).subscribe({
          next: (data) => {
            patchState(store, {
              catalogLoading: false,
              catalogResults: data.contracts ?? [],
              catalogCount: data.count ?? 0,
              catalogPageToken: data.nextPageToken ?? null,
              currentSearchIndex: -1,
            });
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
              catalogCount: data.count ?? store.catalogCount(),
              catalogPageToken: data.nextPageToken ?? null,
            });
          },
          error: (err: Error) => {
            patchState(store, { catalogLoading: false, catalogError: err?.message ?? 'Failed to load more' });
          },
        });
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
          currentSearchIndex: -1,
        });
      },
    };
  });
}
