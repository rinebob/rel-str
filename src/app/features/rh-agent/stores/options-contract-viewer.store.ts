/**
 * Options Contract Viewer Store
 *
 * NgRx SignalStore managing state for the options contract viewer page.
 * Handles contract data loading, underlying bar fetching, and UI toggles.
 */
import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';

import { OptionsContractService } from '../services/options-contract.service';
import { LocalBarReadService } from '../../../core/services/local-bar-read.service';
import { getMarketDatePT, daysAgoPT } from '../../../core/common/pt-date-utils';
import type { OhlcBar } from '../../../core/models/market-data.types';
import type { OHLCDatum } from '../../shared/types/rs.interfaces';
import type {
  PartnerHistoricalOptionsContractV2Response,
  ContractCatalogEntry,
} from '../../../core/models/partner.types';
import {
  ContractCatalogState,
  initialCatalogState,
  withCatalogMethods,
} from './contract-catalog-feature';
import {
  type ParsedObservation,
  parseObservations,
  paddedDateRange,
  padObservations,
  computeDte,
  computeGaps,
  countNaNIV,
  countZeroVolume,
} from '../utils/contract-observation.utils';
import { toOHLCDatum } from '../utils/ohlc-datum.utils';

export type { ParsedObservation };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface OptionsContractViewerState extends ContractCatalogState {
  occIdInput: string;
  loading: boolean;
  error: string | null;
  contractData: PartnerHistoricalOptionsContractV2Response | null;
  underlyingBars: OHLCDatum[];
  underlyingLoading: boolean;
  showUnderlying: boolean;
  showGreeks: boolean;
  showVolumeOI: boolean;
  expirations: string[];
  strikes: number[];
  expirationToStrikes: Record<string, number[]>;
  strikeToExpirations: Record<number, string[]>;
  filteredExpirations: string[];
  filteredStrikes: number[];
  selectedExpiration: string | null;
  selectedStrike: number | null;
  indexLoading: boolean;
  indexError: string | null;
  chartPadDays: number;
  currentSearchIndex: number;
  contractLength: string | null;
}

const initialState: OptionsContractViewerState = {
  ...initialCatalogState,
  occIdInput: '',
  loading: false,
  error: null,
  contractData: null,
  underlyingBars: [],
  underlyingLoading: false,
  showUnderlying: true,
  showGreeks: true,
  showVolumeOI: true,
  expirations: [],
  strikes: [],
  expirationToStrikes: {},
  strikeToExpirations: {},
  filteredExpirations: [],
  filteredStrikes: [],
  selectedExpiration: null,
  selectedStrike: null,
  indexLoading: false,
  indexError: null,
  chartPadDays: 0,
  currentSearchIndex: -1,
  contractLength: null,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const OptionsContractViewerStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  withComputed((state) => ({
    /** Parsed observations with numeric values for charting, extended with null-valued padding entries. */
    observations: computed((): ParsedObservation[] => {
      const data = state.contractData();
      if (!data?.series) return [];
      return padObservations(parseObservations(data.series), state.chartPadDays());
    }),

    /** Days to expiration from today. */
    dte: computed((): number | null => {
      const data = state.contractData();
      if (!data?.expiration) return null;
      return computeDte(data.expiration);
    }),

    /** Observation count. */
    observationCount: computed((): number => {
      const data = state.contractData();
      return data?.series?.length ?? 0;
    }),

    /** Data quality flags. */
    dataQuality: computed(() => {
      const data = state.contractData();
      if (!data?.series) return { gaps: 0, nanIV: 0, zeroVolume: 0 };
      return {
        gaps: computeGaps(data.series),
        nanIV: countNaNIV(data.series),
        zeroVolume: countZeroVolume(data.series),
      };
    }),

    /** Parsed contract metadata from OCC ID. */
    parsedOccId: computed(() => {
      const input = state.occIdInput();
      return OptionsContractService.parseOccId(input);
    }),
  })),

  withComputed((state) => ({
    /** Category labels for the X-axis — from observations, or falling back to underlying bar dates. */
    xLabels: computed((): string[] => {
      const obs = state.observations();
      if (obs.length > 0) return obs.map((o) => o.date);
      return state.underlyingBars()
        .filter((b) => b.date)
        .map((b) => b.date!);
    }),
  })),

  withCatalogMethods(),

  withMethods((store, optionsContractService = inject(OptionsContractService), localBarReadService = inject(LocalBarReadService)) => {
    /** Fetch underlying bars from local Firestore and update store loading state. */
    function fetchUnderlyingBars(symbol: string, from: string, to: string): void {
      patchState(store, { underlyingLoading: true });
      localBarReadService.getDailyBarsForRange$(symbol, from, to).subscribe({
        next: (bars) => patchState(store, { underlyingBars: toOHLCDatum(bars), underlyingLoading: false }),
        error: () => patchState(store, { underlyingBars: [], underlyingLoading: false }),
      });
    }

    /** Shared contract-loading pipeline used by loadContract and navigateContract. */
    function loadContractInternal(occId: string, length: string | null | undefined, index: number): void {
      const parsed = OptionsContractService.parseOccId(occId);
      if (!parsed) {
        patchState(store, { error: 'Invalid OCC ID format', contractData: null, underlyingBars: [] });
        return;
      }
      patchState(store, { loading: true, error: null, contractData: null, underlyingBars: [], currentSearchIndex: index });
      optionsContractService.getHistoricalOptionsContract$(parsed.symbol, parsed.contractID, length).subscribe({
        next: (data) => {
          patchState(store, { loading: false, contractData: data, occIdInput: occId });
          const range = paddedDateRange(data.startDate, data.endDate, store.chartPadDays());
          fetchUnderlyingBars(data.symbol, range.from, range.to);
        },
        error: (err: Error) => {
          patchState(store, { loading: false, error: err?.message ?? 'Failed to load contract' });
        },
      });
    }

    return {
    setOccIdInput(value: string): void {
      patchState(store, { occIdInput: value });
    },

    setContractLength(value: string | null): void {
      patchState(store, { contractLength: value });
    },

    /** Fetch underlying bars for a symbol without needing a loaded contract. */
    loadUnderlyingBars(symbol: string): void {
      const sym = String(symbol || '').trim().toUpperCase();
      if (!sym) return;
      // Use PT to match backend bar dates (UTC would cause off-by-one at boundaries)
      const to = getMarketDatePT();
      const from = daysAgoPT(730);
      fetchUnderlyingBars(sym, from, to);
    },

    /** Fetch full underlying history for a symbol (10 years). */
    loadUnderlyingBarsFullHistory(symbol: string): void {
      const sym = String(symbol || '').trim().toUpperCase();
      if (!sym) return;
      const to = getMarketDatePT();
      const from = daysAgoPT(3650);
      fetchUnderlyingBars(sym, from, to);
    },

    loadContract(occId: string, length?: string | null): void {
      const results = store.catalogResults();
      const idx = results.findIndex((c) => c.contractId === occId);
      loadContractInternal(occId, length, idx);
    },

    toggleUnderlying(): void {
      patchState(store, { showUnderlying: !store.showUnderlying() });
    },

    toggleGreeks(): void {
      patchState(store, { showGreeks: !store.showGreeks() });
    },

    toggleVolumeOI(): void {
      patchState(store, { showVolumeOI: !store.showVolumeOI() });
    },

    loadContractIndex(symbol: string): void {
      const sym = String(symbol || '').trim().toUpperCase();
      if (!sym) {
        patchState(store, {
          expirations: [], strikes: [], indexError: 'Symbol is required', indexLoading: false,
          expirationToStrikes: {}, strikeToExpirations: {},
          filteredExpirations: [], filteredStrikes: [],
          selectedExpiration: null, selectedStrike: null,
        });
        return;
      }

      patchState(store, {
        indexLoading: true, indexError: null,
        expirations: [], strikes: [],
        expirationToStrikes: {}, strikeToExpirations: {},
        filteredExpirations: [], filteredStrikes: [],
        selectedExpiration: null, selectedStrike: null,
      });

      optionsContractService.getContractIndex$(sym).subscribe({
        next: (data) => {
          const expToStrikes: Record<string, number[]> = {};
          const strikeToExps: Record<number, string[]> = {};
          const allExpirations: string[] = [];
          const allStrikes: number[] = [];

          for (const exp of data.expirations) {
            expToStrikes[exp.date] = exp.strikes;
            allExpirations.push(exp.date);
          }
          for (const s of data.strikes) {
            strikeToExps[s.strike] = s.expirations;
            allStrikes.push(s.strike);
          }
          allExpirations.sort();
          allStrikes.sort((a, b) => a - b);

          patchState(store, {
            indexLoading: false,
            expirations: allExpirations,
            strikes: allStrikes,
            expirationToStrikes: expToStrikes,
            strikeToExpirations: strikeToExps,
            filteredExpirations: allExpirations,
            filteredStrikes: allStrikes,
            selectedExpiration: null,
            selectedStrike: null,
          });
        },
        error: (err: Error) => {
          console.error('[loadContractIndex] error:', err);
          patchState(store, { indexError: err?.message ?? 'Failed to load contract index', indexLoading: false });
        },
      });
    },

    setExpiration(expiration: string | null): void {
      const expToStrikes = store.expirationToStrikes();
      if (expiration && expToStrikes[expiration]) {
        patchState(store, {
          selectedExpiration: expiration,
          filteredStrikes: [...expToStrikes[expiration]].sort((a, b) => a - b),
        });
      } else {
        patchState(store, {
          selectedExpiration: expiration,
          filteredStrikes: [...store.strikes()],
        });
      }
    },

    setStrike(strike: number | null): void {
      const strikeToExps = store.strikeToExpirations();
      if (strike !== null && strikeToExps[strike]) {
        patchState(store, {
          selectedStrike: strike,
          filteredExpirations: [...strikeToExps[strike]].sort(),
        });
      } else {
        patchState(store, {
          selectedStrike: strike,
          filteredExpirations: [...store.expirations()],
        });
      }
    },

    addPadDays(days: number): void {
      const newPad = store.chartPadDays() + days;
      patchState(store, { chartPadDays: newPad });

      const data = store.contractData();
      if (!data) return;
      const range = paddedDateRange(data.startDate, data.endDate, newPad);
      fetchUnderlyingBars(data.symbol, range.from, range.to);
    },

    resetPadDays(): void {
      patchState(store, { chartPadDays: 0 });

      const data = store.contractData();
      if (!data) return;
      fetchUnderlyingBars(data.symbol, data.startDate, data.endDate);
    },

    navigateCatalogContract(direction: 1 | -1): void {
      const results = store.catalogResults();
      const current = store.currentSearchIndex();
      if (!results.length) return;
      const next = current + direction;
      if (next < 0 || next >= results.length) return;
      const target = results[next];
      patchState(store, { occIdInput: target.contractId });
      loadContractInternal(target.contractId, store.contractLength(), next);
    },
    };
  }),
);
