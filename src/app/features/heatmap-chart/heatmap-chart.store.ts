import { computed, inject } from '@angular/core';
import { signalStore, withState, withMethods, withComputed, patchState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap, catchError, of, combineLatest } from 'rxjs';

import { BarsInterval } from '../../core/models/partner.types';
import { HeatmapChartDataService } from './heatmap-chart-data.service';
import type {
  HeatmapChartQuery,
  HeatmapChartViewModel,
  ChartDataset,
  HeatmapDataset,
  HeatmapColorScheme,
  ListContext,
} from './heatmap-chart.types';

interface HeatmapChartState {
  query: HeatmapChartQuery | null;
  chartData: ChartDataset | null;
  heatmapData: HeatmapDataset | null;
  loading: boolean;
  error: string | null;
  colorScheme: HeatmapColorScheme;
}

const initialState: HeatmapChartState = {
  query: null,
  chartData: null,
  heatmapData: null,
  loading: false,
  error: null,
  colorScheme: {
    type: 'dynamic',
    variation: 'standard',
  },
};

export const HeatmapChartStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed((store) => ({
    viewModel: computed((): HeatmapChartViewModel | null => {
      const query = store.query();
      if (!query) return null;

      return {
        query,
        chartData: store.chartData(),
        heatmapData: store.heatmapData(),
        loading: store.loading(),
        error: store.error(),
        colorScheme: store.colorScheme(),
      };
    }),
    canNavigateNext: computed(() => {
      const query = store.query();
      if (!query?.listContext) return false;
      const { currentIndex, pairIds } = query.listContext;
      return currentIndex < pairIds.length - 1;
    }),
    canNavigatePrevious: computed(() => {
      const query = store.query();
      if (!query?.listContext) return false;
      return query.listContext.currentIndex > 0;
    }),
  })),
  withMethods((store, dataService = inject(HeatmapChartDataService)) => ({
    /**
     * Load data for a given query.
     * Fetches both chart data (OHLC bars) and heatmap data (RS series for all intervals).
     */
    loadData: rxMethod<HeatmapChartQuery>(
      pipe(
        tap((query) => {
          patchState(store, {
            query,
            loading: true,
            error: null,
          });
        }),
        switchMap((query) => {
          const { baseline, symbol, interval } = query;

          const chartData$ = dataService.fetchChartData$(baseline, symbol, interval);
          const heatmapData$ = dataService.fetchHeatmapData$(baseline, symbol);

          return combineLatest([chartData$, heatmapData$]).pipe(
            tap(([chartData, heatmapData]) => {
              patchState(store, {
                chartData,
                heatmapData,
                loading: false,
                error: null,
              });
            }),
            catchError((error) => {
              console.error('HeatmapChartStore.loadData error', error);
              patchState(store, {
                loading: false,
                error: error?.message || 'Failed to load data',
              });
              return of(null);
            })
          );
        })
      )
    ),

    /**
     * Change the selected interval and reload chart data.
     * Heatmap data remains the same (all intervals are already loaded).
     */
    setInterval(interval: BarsInterval) {
      const query = store.query();
      if (!query) return;

      const newQuery: HeatmapChartQuery = { ...query, interval };
      patchState(store, { query: newQuery, loading: true });

      const { baseline, symbol } = newQuery;
      dataService.fetchChartData$(baseline, symbol, interval).subscribe({
        next: (chartData) => {
          patchState(store, { chartData, loading: false });
        },
        error: (error) => {
          console.error('HeatmapChartStore.setInterval error', error);
          patchState(store, {
            loading: false,
            error: error?.message || 'Failed to change interval',
          });
        },
      });
    },

    /**
     * Set the color scheme for the heatmap.
     */
    setColorScheme(colorScheme: HeatmapColorScheme) {
      patchState(store, { colorScheme });
    },

    /**
     * Navigate to the next pair in the list context.
     */
    navigateNext() {
      const query = store.query();
      if (!query?.listContext) return;

      const { listContext } = query;
      const nextIndex = listContext.currentIndex + 1;
      if (nextIndex >= listContext.pairIds.length) return;

      const nextPairId = listContext.pairIds[nextIndex];
      const [baseline, symbol] = nextPairId.split('-');

      const newQuery: HeatmapChartQuery = {
        ...query,
        baseline,
        symbol,
        listContext: {
          ...listContext,
          currentIndex: nextIndex,
        },
      };

      patchState(store, { query: newQuery });
      this.loadData(newQuery);
    },

    /**
     * Navigate to the previous pair in the list context.
     */
    navigatePrevious() {
      const query = store.query();
      if (!query?.listContext) return;

      const { listContext } = query;
      const prevIndex = listContext.currentIndex - 1;
      if (prevIndex < 0) return;

      const prevPairId = listContext.pairIds[prevIndex];
      const [baseline, symbol] = prevPairId.split('-');

      const newQuery: HeatmapChartQuery = {
        ...query,
        baseline,
        symbol,
        listContext: {
          ...listContext,
          currentIndex: prevIndex,
        },
      };

      patchState(store, { query: newQuery });
      this.loadData(newQuery);
    },

    /**
     * Reset the store to initial state.
     */
    reset() {
      patchState(store, initialState);
    },
  }))
);
