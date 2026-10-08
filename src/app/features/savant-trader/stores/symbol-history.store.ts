/**
 * Savant Trader Symbol History Store
 *
 * Owns per-symbol signal history loading and caching.
 * Decoupled from the signal-review store so any page can load a symbol's
 * history without pulling in the full group state.
 *
 * Responsibilities:
 * - Fetch signal history for a symbol on demand
 * - Cache results by symbol
 * - Expose loading flags per symbol
 */
import { inject, DestroyRef, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import {
  signalStore,
  withState,
  withMethods,
  withComputed,
  patchState,
} from '@ngrx/signals';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { type StSignalItem } from '../services/types';
import { SignalService } from '../services/signal.service';
import { SignalTimeframe } from '../common/constants';
import { LocalBarReadService, type OhlcBar } from '../../../core/services/local-bar-read.service';
import { fillSignalClosePrices, getCacheKey } from '../utils/utils';

/**
 * Derive missing closePrice values from symbol-data bars so cached run signals
 * are priced even though backend signal entries do not store `close`. Skips
 * all bar reads when every signal is already priced.
 */
function enrichClosePrices(
  barRead: LocalBarReadService,
  symbol: string,
  signals: StSignalItem[],
): Observable<StSignalItem[]> {
  const needsPrice = (s: StSignalItem): boolean => s.closePrice === undefined;
  const dailyDates = signals
    .filter((s) => s.timeframe !== SignalTimeframe.WEEKLY && needsPrice(s))
    .map((s) => s.barDate);
  const needWeekly = signals.some(
    (s) => s.timeframe === SignalTimeframe.WEEKLY && needsPrice(s),
  );
  if (dailyDates.length === 0 && !needWeekly) return of(signals);

  const daily$ = dailyDates.length
    ? barRead.getDailyBarsForRange$(symbol, dailyDates.reduce((a, b) => (a < b ? a : b)), dailyDates.reduce((a, b) => (a > b ? a : b)))
    : of([] as OhlcBar[]);
  const weekly$ = needWeekly ? barRead.getWeeklyBars$(symbol) : of([] as OhlcBar[]);

  return forkJoin({ daily: daily$, weekly: weekly$ }).pipe(
    map(({ daily, weekly }) => fillSignalClosePrices(signals, daily, weekly)),
    catchError(() => of(signals)),
  );
}

export interface SymbolHistoryState {
  /** Per-symbol signal history cache: symbol â†’ signals[] */
  signalHistoryCache: Record<string, StSignalItem[]>;
  /** Per-symbol loading flags. */
  signalHistoryLoading: Record<string, boolean>;
}

const initialState: SymbolHistoryState = {
  signalHistoryCache: {},
  signalHistoryLoading: {},
};

export const SymbolHistoryStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withMethods((state, signalService = inject(SignalService), barRead = inject(LocalBarReadService), destroyRef = inject(DestroyRef), injector = inject(EnvironmentInjector)) => ({
    /**
     * Load signals for a symbol from a specific run (run-ids/{runId}).
     * Used by signal review â€” shows only signals from the active run.
     * Cache key: `${symbol}::${runId}` to avoid conflicts with all-history cache.
     */
    loadSignalHistoryForRun(symbol: string, runId: string): void {
      const cacheKey = getCacheKey(symbol, runId);
      if (state.signalHistoryCache()[cacheKey] !== undefined) return;
      if (state.signalHistoryLoading()[cacheKey]) return;

      patchState(state, {
        signalHistoryLoading: { ...state.signalHistoryLoading(), [cacheKey]: true },
      });

      runInInjectionContext(injector, () => signalService.getSymbolSignalsForRun(symbol, runId))
        .pipe(
          switchMap((signals) => enrichClosePrices(barRead, symbol, signals)),
          takeUntilDestroyed(destroyRef),
        )
        .subscribe({
          next: (signals) => {
            patchState(state, {
              signalHistoryCache: { ...state.signalHistoryCache(), [cacheKey]: signals },
              signalHistoryLoading: { ...state.signalHistoryLoading(), [cacheKey]: false },
            });
          },
          error: (err: unknown) => {
            // Don't cache a failure as [] — a transient error would mark the
            // symbol cardless for the whole session and refresh could never
            // recover it (cache-hit early return above). Uncached = retryable
            // on the next loadSymbolsWithSignals fan-out (#838 review).
            patchState(state, {
              signalHistoryLoading: { ...state.signalHistoryLoading(), [cacheKey]: false },
            });
            console.error(`[SymbolHistoryStore] Failed to load run signals for ${symbol}:`, err);
          },
        });
    },

    /**
     * Load signal history for a symbol into the cache.
     * Reads all signals (W + D) directly from the Firestore subcollection.
     * If the symbol is already cached, this is a no-op.
     */
    loadSignalHistory(symbol: string): void {
      if (state.signalHistoryCache()[symbol] !== undefined) return;
      if (state.signalHistoryLoading()[symbol]) return;

      patchState(state, {
        signalHistoryLoading: { ...state.signalHistoryLoading(), [symbol]: true },
      });

      runInInjectionContext(injector, () => signalService.getSymbolSignalHistoryFromHistory(symbol))
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (signals) => {
            patchState(state, {
              signalHistoryCache: { ...state.signalHistoryCache(), [symbol]: signals },
              signalHistoryLoading: { ...state.signalHistoryLoading(), [symbol]: false },
            });
          },
          error: (err: unknown) => {
            // Same as the run-scoped loader: don't cache a failure as [] —
            // uncached stays retryable on the next select/load (#838 review).
            patchState(state, {
              signalHistoryLoading: { ...state.signalHistoryLoading(), [symbol]: false },
            });
            console.error(`[SymbolHistoryStore] Failed to load signal history for ${symbol}:`, err);
          },
        });
    },

    /** Clear a single symbol's cached history. */
    clearSymbolHistory(symbol: string): void {
      const cache = { ...state.signalHistoryCache() };
      const loading = { ...state.signalHistoryLoading() };
      delete cache[symbol];
      delete loading[symbol];
      patchState(state, { signalHistoryCache: cache, signalHistoryLoading: loading });
    },
  })),
);
