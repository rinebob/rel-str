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
import { RsBarsService } from '../../services/rs-bars.service';
import type { OHLCDatum } from '../../shared/types/rs.interfaces';
import type {
  PartnerHistoricalOptionsContractV2Response,
  HistoricalOptionsContractV2Observation,
  ListContractsV2Contract,
} from '../../../core/models/partner.types';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface OptionsContractViewerState {
  occIdInput: string;
  loading: boolean;
  error: string | null;
  contractData: PartnerHistoricalOptionsContractV2Response | null;
  underlyingBars: OHLCDatum[];
  underlyingLoading: boolean;
  showUnderlying: boolean;
  showGreeks: boolean;
  showVolumeOI: boolean;
  searchLoading: boolean;
  searchError: string | null;
  searchResults: ListContractsV2Contract[];
  searchedSymbol: string | null;
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
}

const initialState: OptionsContractViewerState = {
  occIdInput: '',
  loading: false,
  error: null,
  contractData: null,
  underlyingBars: [],
  underlyingLoading: false,
  showUnderlying: true,
  showGreeks: true,
  showVolumeOI: true,
  searchLoading: false,
  searchError: null,
  searchResults: [],
  searchedSymbol: null,
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
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parsed observation with numeric values for charting. */
export interface ParsedObservation {
  date: string;
  mark: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  openInterest: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
}

function parseNum(val: string | undefined): number | null {
  if (val == null) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function parseObservations(series: HistoricalOptionsContractV2Observation[]): ParsedObservation[] {
  return series.map((obs) => ({
    date: obs.date,
    mark: parseNum(obs.mark),
    bid: parseNum(obs.bid),
    ask: parseNum(obs.ask),
    volume: parseNum(obs.volume),
    openInterest: parseNum(obs.open_interest),
    iv: parseNum(obs.implied_volatility),
    delta: parseNum(obs.delta),
    gamma: parseNum(obs.gamma),
    theta: parseNum(obs.theta),
    vega: parseNum(obs.vega),
    rho: parseNum(obs.rho),
  }));
}

/** Compute a padded date range from a contract's start/end dates and a pad-days count. */
function paddedDateRange(startDate: string, endDate: string, padDays: number): { from: string; to: string } {
  if (padDays <= 0) return { from: startDate, to: endDate };
  const padMillis = padDays * 24 * 60 * 60 * 1000;
  const from = new Date(new Date(startDate + 'T00:00:00.000Z').getTime() - padMillis);
  const to = new Date(new Date(endDate + 'T00:00:00.000Z').getTime() + padMillis);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/** Generate null-valued padding observations for the given number of days on each side. */
function padObservations(baseObs: ParsedObservation[], padDays: number): ParsedObservation[] {
  if (padDays <= 0 || baseObs.length === 0) return baseObs;

  const nullObs = (date: string): ParsedObservation => ({
    date, mark: null, bid: null, ask: null, volume: null, openInterest: null,
    iv: null, delta: null, gamma: null, theta: null, vega: null, rho: null,
  });

  const firstDate = new Date(baseObs[0].date + 'T00:00:00.000Z');
  const leftObs: ParsedObservation[] = [];
  let d = new Date(firstDate);
  for (let i = 0; i < padDays; i++) {
    d = new Date(d.getTime() - 24 * 60 * 60 * 1000);
    leftObs.unshift(nullObs(d.toISOString().slice(0, 10)));
  }

  const lastDate = new Date(baseObs[baseObs.length - 1].date + 'T00:00:00.000Z');
  const rightObs: ParsedObservation[] = [];
  d = new Date(lastDate);
  for (let i = 0; i < padDays; i++) {
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    rightObs.push(nullObs(d.toISOString().slice(0, 10)));
  }

  return [...leftObs, ...baseObs, ...rightObs];
}

/** Compute days to expiration from today (PT) to the expiration date. */
function computeDte(expiration: string): number | null {
  if (!expiration) return null;
  const exp = new Date(`${expiration}T00:00:00.000Z`);
  const now = new Date();
  const diffMs = exp.getTime() - now.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/** Detect gaps in a daily date series (missing weekdays). */
function computeGaps(series: HistoricalOptionsContractV2Observation[]): number {
  if (series.length < 2) return 0;
  let gaps = 0;
  for (let i = 1; i < series.length; i++) {
    const prev = new Date(`${series[i - 1].date}T00:00:00.000Z`);
    const curr = new Date(`${series[i].date}T00:00:00.000Z`);
    const dayDiff = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
    // Count missing weekdays: for each calendar day beyond 1, check if it's a weekday
    // dayDiff=1 → no gap; dayDiff=3 (Fri→Mon) → no gap (weekend)
    // dayDiff=2 (e.g. Tue→Thu) → 1 missing weekday
    // dayDiff=4 (e.g. Fri→Tue) → 1 missing weekday
    if (dayDiff <= 1) continue;
    let missingWeekdays = 0;
    for (let d = 1; d < dayDiff; d++) {
      const checkDate = new Date(prev.getTime() + d * (1000 * 60 * 60 * 24));
      const dayOfWeek = checkDate.getUTCDay(); // 0=Sun, 6=Sat
      if (dayOfWeek !== 0 && dayOfWeek !== 6) missingWeekdays++;
    }
    gaps += missingWeekdays;
  }
  return gaps;
}

function countNaNIV(series: HistoricalOptionsContractV2Observation[]): number {
  return series.filter((obs) => {
    const iv = parseNum(obs.implied_volatility);
    return iv === null;
  }).length;
}

function countZeroVolume(series: HistoricalOptionsContractV2Observation[]): number {
  return series.filter((obs) => {
    const vol = parseNum(obs.volume);
    return vol === null || vol === 0;
  }).length;
}

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
    /** Category labels for the X-axis (date strings), derived from observations. */
    xLabels: computed((): string[] => state.observations().map((obs) => obs.date)),
  })),

  withMethods((store, optionsContractService = inject(OptionsContractService), rsBarsService = inject(RsBarsService)) => {
    /** Fetch underlying bars and update store loading state. */
    function fetchUnderlyingBars(symbol: string, from: string, to: string): void {
      patchState(store, { underlyingLoading: true });
      rsBarsService.getDailyBars$(symbol, { from, to }).subscribe({
        next: (bars) => patchState(store, { underlyingBars: bars, underlyingLoading: false }),
        error: () => patchState(store, { underlyingBars: [], underlyingLoading: false }),
      });
    }

    return {
    setOccIdInput(value: string): void {
      patchState(store, { occIdInput: value });
    },

    loadContract(occId: string, length?: string | null): void {
      const parsed = OptionsContractService.parseOccId(occId);
      if (!parsed) {
        patchState(store, { error: 'Invalid OCC ID format', contractData: null, underlyingBars: [] });
        return;
      }

      patchState(store, { loading: true, error: null, contractData: null, underlyingBars: [] });

      optionsContractService.getHistoricalOptionsContract$(parsed.symbol, parsed.contractID, length).subscribe({
        next: (data) => {
          patchState(store, { loading: false, contractData: data, occIdInput: occId });

          // Auto-fetch underlying bars for the contract's date range, extended by current padding
          const range = paddedDateRange(data.startDate, data.endDate, store.chartPadDays());
          fetchUnderlyingBars(data.symbol, range.from, range.to);
        },
        error: (err: Error) => {
          patchState(store, { loading: false, error: err?.message ?? 'Failed to load contract' });
        },
      });
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

    searchContracts(symbol: string, filters?: { expiration?: string; strike?: number; type?: 'C' | 'P' }): void {
      patchState(store, { searchLoading: true, searchError: null, searchResults: [], searchedSymbol: String(symbol || '').trim().toUpperCase() });

      optionsContractService.listContracts$(symbol, filters).subscribe({
        next: (data) => {
          patchState(store, { searchLoading: false, searchResults: data.contracts ?? [], searchedSymbol: data.symbol ?? store.searchedSymbol() });
        },
        error: (err: Error) => {
          patchState(store, { searchLoading: false, searchError: err?.message ?? 'Failed to search contracts', searchResults: [] });
        },
      });
    },

    clearSearch(): void {
      patchState(store, { searchLoading: false, searchError: null, searchResults: [], searchedSymbol: null });
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
    };
  }),
);
