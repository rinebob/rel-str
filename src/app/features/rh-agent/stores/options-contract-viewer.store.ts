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
  showVolumeOI: false,
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
    /** Parsed observations with numeric values for charting. */
    observations: computed((): ParsedObservation[] => {
      const data = state.contractData();
      if (!data?.series) return [];
      return parseObservations(data.series);
    }),

    /** Category labels for the X-axis (date strings). */
    xLabels: computed((): string[] => {
      const data = state.contractData();
      if (!data?.series) return [];
      return data.series.map((obs) => obs.date);
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

  withMethods((store, optionsContractService = inject(OptionsContractService), rsBarsService = inject(RsBarsService)) => ({
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

          // Auto-fetch underlying bars for the contract's date range
          patchState(store, { underlyingLoading: true });
          rsBarsService.getDailyBars$(data.symbol, {
            from: data.startDate,
            to: data.endDate,
          }).subscribe({
            next: (bars) => {
              patchState(store, { underlyingBars: bars, underlyingLoading: false });
            },
            error: () => {
              patchState(store, { underlyingBars: [], underlyingLoading: false });
            },
          });
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
  })),
);
