/**
 * RH Agent Chart Store
 *
 * Shared chart state for the RH Agent chart views.
 *
 * Responsibilities:
 * - Load D/W/M chart data via RhAgentChartService.
 * - Track loading/error state and the symbol-data bars version.
 * - Trigger the indicator-series callable once the version is known.
 *
 * Consumers (SignalDetailComponent, QuickChartsComponent) bind to this store
 * and keep their own chart config / UI-specific state.
 */
import { inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { type ChartDataset } from '../../heatmap-chart/heatmap-chart.types';
import { RhAgentChartService } from '../services/rh-agent-chart.service';
import { IndicatorSeriesStore } from './indicator-series.store';
import {
  ChartInterval,
  IndicatorFamily,
  StrategyFamily,
} from '../common/rh-agent-indicator.types';

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

export interface RhAgentChartState {
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

const initialState: RhAgentChartState = {
  selectedSymbol: null,
  loading: false,
  error: null,
  dailyData: null,
  weeklyData: null,
  monthlyData: null,
  symbolDataVersion: '',
};

export const RhAgentChartStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withMethods((
    state,
    chartService = inject(RhAgentChartService),
    indicatorStore = inject(IndicatorSeriesStore),
    destroyRef = inject(DestroyRef),
  ) => ({
    /**
     * Load D/W/M chart data for a symbol and trigger indicator series loading.
     * Clears existing data when the symbol changes.
     */
    loadCharts(symbol: string): void {
      if (!symbol) return;
      patchState(state, {
        selectedSymbol: symbol,
        loading: true,
        error: null,
      });

      chartService
        .loadBars$(symbol)
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
                symbol,
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

    /** Clear chart data and selected symbol. */
    clearCharts(): void {
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
  })),
);
