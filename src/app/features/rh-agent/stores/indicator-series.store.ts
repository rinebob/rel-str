/**
 * Indicator Series Store
 *
 * NgRx Signal Store that caches callable responses for indicator series.
 * Cache key includes the symbol, the rs-bars version, and the requested
 * filters so that stale data is automatically refetched when the bars change.
 */
import { DestroyRef, EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState,
} from '@ngrx/signals';
import { from } from 'rxjs';

import {
  ChartInterval,
  GetIndicatorSeriesRequest,
  IndicatorFamily,
  StrategyFamily,
  SymbolIndicatorSeriesResponse,
} from '../common/rh-agent-indicator.types';

export interface IndicatorSeriesState {
  /** Cache keyed by symbol|version|intervals|indicators|strategies */
  cache: Record<string, SymbolIndicatorSeriesResponse>;
  /** Per-key loading flags */
  loading: Record<string, boolean>;
  /** Per-key error messages */
  error: Record<string, string | null>;
}

const initialState: IndicatorSeriesState = {
  cache: {},
  loading: {},
  error: {},
};

function cacheKey(
  callableName: string,
  symbol: string,
  version: string,
  intervals: ChartInterval[],
  indicators: IndicatorFamily[],
  strategies: StrategyFamily[],
): string {
  return [
    callableName,
    symbol,
    version,
    intervals.slice().sort().join(','),
    indicators.slice().sort().join(','),
    strategies.slice().sort().join(','),
  ].join('|');
}

export const IndicatorSeriesStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withMethods((
    state,
    functions = inject(Functions),
    destroyRef = inject(DestroyRef),
    injector = inject(EnvironmentInjector),
  ) => ({
    /**
     * Load the indicator series for the given symbol if not already cached.
     * The version comes from the rs-bars/{symbol} doc and busts the cache
     * whenever the bars change.
     */
    loadIfNeeded(
      symbol: string,
      version: string,
      intervals: ChartInterval[] = [ChartInterval.DAILY, ChartInterval.WEEKLY, ChartInterval.MONTHLY],
      indicators: IndicatorFamily[] = [
        IndicatorFamily.ZONE_V1,
        IndicatorFamily.ZONE_V2,
        IndicatorFamily.TREND_STRENGTH,
        IndicatorFamily.TREND_BANDS,
      ],
      strategies: StrategyFamily[] = [
        StrategyFamily.ZONE_V1,
        StrategyFamily.ZONE_V2,
        StrategyFamily.TREND_STRENGTH,
      ],
    ): void {
      const callableName = 'rhAgentGetSymbolIndicatorSeriesV2';
      const key = cacheKey(callableName, symbol, version, intervals, indicators, strategies);

      if (state.cache()[key] !== undefined) return;
      if (state.loading()[key]) return;

      patchState(state, {
        loading: { ...state.loading(), [key]: true },
        error: { ...state.error(), [key]: null },
      });

      const request: GetIndicatorSeriesRequest = {
        symbol,
        intervals,
        indicators,
        strategies,
      };

      runInInjectionContext(injector, () => {
        const callable = httpsCallable<GetIndicatorSeriesRequest, SymbolIndicatorSeriesResponse>(
          functions,
          'rhAgentGetSymbolIndicatorSeriesV2',
        );
        return from(callable(request));
      })
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (result) => {
            patchState(state, {
              cache: { ...state.cache(), [key]: result.data },
              loading: { ...state.loading(), [key]: false },
            });
          },
          error: (err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[IndicatorSeriesStore] Failed to load indicators for ${symbol}:`, err);
            patchState(state, {
              loading: { ...state.loading(), [key]: false },
              error: { ...state.error(), [key]: message },
            });
          },
        });
    },

    /** Clear the cache for a symbol, or the entire cache if no symbol is provided. */
    clearCache(symbol?: string): void {
      if (!symbol) {
        patchState(state, { cache: {}, loading: {}, error: {} });
        return;
      }
      const cache = { ...state.cache() };
      const loading = { ...state.loading() };
      const error = { ...state.error() };
      for (const key of Object.keys(cache)) {
        if (key.startsWith(`${symbol}|`)) {
          delete cache[key];
          delete loading[key];
          delete error[key];
        }
      }
      patchState(state, { cache, loading, error });
    },
  })),

  withComputed((state) => ({
    /**
     * Returns a function that looks up the cached response for a given filter set.
     * Usage: store.responseFor(symbol, version, intervals, indicators, strategies)()
     */
    responseFor: () => (
      symbol: string,
      version: string,
      intervals: ChartInterval[],
      indicators: IndicatorFamily[],
      strategies: StrategyFamily[],
    ) => state.cache()[cacheKey('rhAgentGetSymbolIndicatorSeriesV2', symbol, version, intervals, indicators, strategies)],

    /**
     * Returns a function that looks up the loading flag for a given filter set.
     */
    loadingFor: () => (
      symbol: string,
      version: string,
      intervals: ChartInterval[],
      indicators: IndicatorFamily[],
      strategies: StrategyFamily[],
    ) => state.loading()[cacheKey('rhAgentGetSymbolIndicatorSeriesV2', symbol, version, intervals, indicators, strategies)] ?? false,

    /**
     * Returns a function that looks up the error for a given filter set.
     */
    errorFor: () => (
      symbol: string,
      version: string,
      intervals: ChartInterval[],
      indicators: IndicatorFamily[],
      strategies: StrategyFamily[],
    ) => state.error()[cacheKey('rhAgentGetSymbolIndicatorSeriesV2', symbol, version, intervals, indicators, strategies)] ?? null,
  })),
);
