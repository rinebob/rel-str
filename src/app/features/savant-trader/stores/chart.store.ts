/**
 * Savant Trader Chart Store
 *
 * Shared chart state for the Savant Trader chart views.
 *
 * Responsibilities:
 * - Load D/W/M chart data: tracked symbols via ChartService (symbol-data),
 *   untracked via RhChartService (ephemeral RH equity bars, #1259), with a
 *   symbol-data-empty → RH fallback for tracked symbols.
 * - Track loading/error state and the symbol-data bars version.
 * - Trigger the indicator-series callable once the version is known —
 *   the RH path always yields version '', so indicators never load for
 *   untracked symbols.
 *
 * Consumers (SignalDetailComponent, QuickChartsComponent) bind to this store
 * and keep their own chart config / UI-specific state.
 */
import { inject, DestroyRef, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { type ChartDataset } from '../../heatmap-chart/heatmap-chart.types';
import { ChartService } from '../services/chart.service';
import { RhChartService } from '../services/rh-chart.service';
import { IndicatorSeriesStore } from './indicator-series.store';
import { SymbolListStore } from './symbol-list.store';
import {
  ChartInterval,
  IndicatorFamily,
  StrategyFamily,
} from '../common/indicator.types';

/** Default filters used when fetching indicator series for a chart view. */
export const DEFAULT_CHART_INTERVALS = [
  ChartInterval.DAILY,
  ChartInterval.WEEKLY,
  ChartInterval.MONTHLY,
];

export const DEFAULT_CHART_INDICATORS = [
  IndicatorFamily.ZONE_V1,
  IndicatorFamily.ZONE_V2,
  IndicatorFamily.TREND_STRENGTH,
  IndicatorFamily.TREND_BANDS,
];

export const DEFAULT_CHART_STRATEGIES = [
  StrategyFamily.ZONE_V1,
  StrategyFamily.ZONE_V2,
  StrategyFamily.TREND_STRENGTH,
];

/** Opt-in Trigger Bands request: a separate, lean call (bands + dots only, daily
 *  and weekly) cached under its own key, so enabling the indicator never touches
 *  the default response above. `StrategyFamily.TRIGGER_BANDS` keeps the backend
 *  from falling back to the default strategy set (it yields no strategy output). */
export const TRIGGER_BANDS_CHART_INTERVALS = [ChartInterval.DAILY, ChartInterval.WEEKLY];
export const TRIGGER_BANDS_CHART_INDICATORS = [IndicatorFamily.TRIGGER_BANDS];
export const TRIGGER_BANDS_CHART_STRATEGIES = [StrategyFamily.TRIGGER_BANDS];

export interface ChartState {
  /** Currently selected symbol for chart loading. */
  selectedSymbol: string | null;
  /** Loading state for the chart data fetch. */
  loading: boolean;
  /** Error message if the chart data fetch failed. */
  error: string | null;
  /** Daily chart dataset. */
  dailyData: ChartDataset | null;
  /** Weekly chart dataset. */
  weeklyData: ChartDataset | null;
  /** Monthly chart dataset. */
  monthlyData: ChartDataset | null;
  /** symbol-data version used as the indicator cache key. */
  symbolDataVersion: string;
}

const initialState: ChartState = {
  selectedSymbol: null,
  loading: false,
  error: null,
  dailyData: null,
  weeklyData: null,
  monthlyData: null,
  symbolDataVersion: '',
};

export const ChartStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withMethods((
    state,
    chartService = inject(ChartService),
    rhChartService = inject(RhChartService),
    indicatorStore = inject(IndicatorSeriesStore),
    symbolListStore = inject(SymbolListStore),
    destroyRef = inject(DestroyRef),
  ) => {
    // Only one bars request may be in flight — rapid symbol switches must
    // cancel the previous request, not stack subscriptions/datasets.
    let barsSub: Subscription | null = null;

    return {
    /**
     * Load D/W/M chart data for a symbol and trigger indicator series loading.
     * Cancels any in-flight request so a stale response can't overwrite newer
     * state or pile up datasets.
     */
    loadCharts(symbol: string): void {
      // Normalize before the emptiness guard — a whitespace-only input must
      // not slip through and fire calls for ''.
      const sym = symbol?.trim().toUpperCase() ?? '';
      if (!sym) return;
      barsSub?.unsubscribe();
      patchState(state, {
        selectedSymbol: sym,
        loading: true,
        error: null,
        // Blank the version while the new symbol's bars are in flight —
        // consumers key indicator responses by it, so leaving the prior
        // symbol's version would key lookups/fetches under `newSymbol|oldV`.
        symbolDataVersion: '',
      });

      // #1259 — fork on tracked membership. Untracked symbols chart from
      // ephemeral RH equity bars (version stays '', so the `if (version)`
      // guard below never asks for indicator series that don't exist for
      // them). A tracked symbol whose symbol-data is empty (just-onboarded,
      // pre-backfill, or a failed fetch) falls back to the same RH path.
      // The fork only applies once the universe is 'ready' — pages that
      // never call loadTrackedSymbols (QuickCharts, galleries) keep
      // pre-fork behavior: symbol-data first, then the version-'' fallback.
      // untracked: the fork is a point-in-time read. Host pages call
      // loadCharts inside effects() — without this, trackedStatus/
      // trackedSymbols become effect dependencies and the universe resolving
      // mid-flight would cancel + refire the request (possibly on the other
      // arm).
      const tracked = untracked(
        () =>
          symbolListStore.trackedStatus() !== 'ready' ||
          symbolListStore.trackedSymbols().includes(sym),
      );
      const bars$ = tracked
        ? chartService.loadBars$(sym).pipe(
            switchMap((r) => (r.version === '' ? rhChartService.loadBars$(sym) : of(r))),
          )
        : rhChartService.loadBars$(sym);

      barsSub = bars$
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (result) => {
            const version = result.version ?? '';
            patchState(state, {
              dailyData: result.daily,
              weeklyData: result.weekly,
              monthlyData: result.monthly,
              symbolDataVersion: version,
              loading: false,
              error: null,
            });
            if (version) {
              indicatorStore.loadIfNeeded(
                sym,
                version,
                DEFAULT_CHART_INTERVALS,
                DEFAULT_CHART_INDICATORS,
                DEFAULT_CHART_STRATEGIES,
              );
            }
          },
          error: (err: unknown) => {
            const message = err instanceof Error ? err.message : 'Failed to load chart data';
            patchState(state, {
              loading: false,
              error: message,
              dailyData: null,
              weeklyData: null,
              monthlyData: null,
              symbolDataVersion: '',
            });
          },
        });
    },

    /** Clear chart data and selected symbol. Cancels any in-flight request. */
    clearCharts(): void {
      barsSub?.unsubscribe();
      barsSub = null;
      patchState(state, {
        selectedSymbol: null,
        loading: false,
        error: null,
        dailyData: null,
        weeklyData: null,
        monthlyData: null,
        symbolDataVersion: '',
      });
    },
    };
  }),
);
