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
import type { PartnerHistoricalOptionsContractV2Response } from '../../../core/models/partner.types';
import {
  ContractCatalogState,
  initialCatalogState,
  withCatalogMethods,
} from './contract-catalog-feature';
import {
  PlottedContractsState,
  initialPlottedState,
  withPlottedComputed,
  withAllDatesComputed,
  withPlottedContracts,
} from './plotted-contracts-feature';
import {
  UnderlyingBarsState,
  initialUnderlyingBarsState,
  withUnderlyingBars,
} from './underlying-bars-feature';
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

export type { ParsedObservation };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface OptionsContractViewerState
  extends ContractCatalogState,
    PlottedContractsState,
    UnderlyingBarsState {
  occIdInput: string;
  loading: boolean;
  error: string | null;
  contractData: PartnerHistoricalOptionsContractV2Response | null;
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
  currentSearchIndex: number;
  contractLength: string | null;
}

const initialState: OptionsContractViewerState = {
  ...initialCatalogState,
  ...initialPlottedState,
  ...initialUnderlyingBarsState,
  occIdInput: '',
  loading: false,
  error: null,
  contractData: null,
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

  withPlottedComputed(),
  withAllDatesComputed(),

  withCatalogMethods(),

  withUnderlyingBars(),

  withMethods((store, optionsContractService = inject(OptionsContractService)) => {
    /** Shared contract-loading pipeline used by loadContract and navigateContract. */
    function loadContractInternal(occId: string, length: string | null | undefined, index: number): void {
      const parsed = OptionsContractService.parseOccId(occId);
      if (!parsed) {
        // A failed load changes nothing about the displayed view — the
        // plotted set or previously focused contract stays rendered; only
        // the error surfaces.
        patchState(store, { error: 'Invalid OCC ID format' });
        return;
      }
      // Focus is claimed on INTENT — the pane and chips switch to this
      // contract's loading state immediately rather than lingering on the
      // old view — and released on error so a failed fetch can't dead-end
      // the display on an empty focused pane with the set stranded behind.
      // contractData clears for the same reason: during the fetch the pane
      // shows the loading spinner, not the prior contract's stale line.
      patchState(store, { loading: true, error: null, contractData: null, currentSearchIndex: index, chartFocusContractId: parsed.contractID });
      optionsContractService.getHistoricalOptionsContract$(parsed.symbol, parsed.contractID, length).subscribe({
        next: (data) => {
          patchState(store, { loading: false, contractData: data, occIdInput: occId });
          const range = paddedDateRange(data.startDate, data.endDate, store.chartPadDays());
          // A dated plotted set's pick days widen the fetch to the context
          // window on both edges — chip drill-down never narrows the
          // underlying away from the set's prefix or tail.
          store.loadUnderlyingBarsForRange(data.symbol, range.from, range.to);
        },
        error: (err: Error) => {
          // Release focus only while it still points at THIS contract — a
          // newer load may have claimed it in the meantime. Releasing lands
          // the view back on the plotted set (or the empty single view);
          // the set itself is untouched so the error can't strand it.
          const focus = store.chartFocusContractId();
          patchState(store, {
            loading: false,
            error: err?.message ?? 'Failed to load contract',
            chartFocusContractId: focus === parsed.contractID ? null : focus,
          });
          // The contract load failed — pre-existing bars stay. Refetch the
          // set's own context only when the last range no longer covers it
          // (a narrower or foreign-symbol range replaced the bars).
          store.ensureContextCoverage();
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

  withPlottedContracts(),
);
