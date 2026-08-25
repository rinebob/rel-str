/**
 * RH Agent Symbol History Store
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

import { type AgentSignalItem } from '../services/types';
import { SignalService } from '../services/signal.service';

export interface RhAgentSymbolHistoryState {
  /** Per-symbol signal history cache: symbol â†’ signals[] */
  signalHistoryCache: Record<string, AgentSignalItem[]>;
  /** Per-symbol loading flags. */
  signalHistoryLoading: Record<string, boolean>;
}

const initialState: RhAgentSymbolHistoryState = {
  signalHistoryCache: {},
  signalHistoryLoading: {},
};

export const RhAgentSymbolHistoryStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withMethods((state, signalService = inject(SignalService), destroyRef = inject(DestroyRef), injector = inject(EnvironmentInjector)) => ({
    /**
     * Load signals for a symbol from a specific run (run-ids/{runId}).
     * Used by signal review â€” shows only signals from the active run.
     * Cache key: `${symbol}::${runId}` to avoid conflicts with all-history cache.
     */
    loadSignalHistoryForRun(symbol: string, runId: string): void {
      const cacheKey = `${symbol}::${runId}`;
      if (state.signalHistoryCache()[cacheKey] !== undefined) return;
      if (state.signalHistoryLoading()[cacheKey]) return;

      patchState(state, {
        signalHistoryLoading: { ...state.signalHistoryLoading(), [cacheKey]: true },
      });

      runInInjectionContext(injector, () => signalService.getSymbolSignalsForRun(symbol, runId))
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (signals) => {
            patchState(state, {
              signalHistoryCache: { ...state.signalHistoryCache(), [cacheKey]: signals },
              signalHistoryLoading: { ...state.signalHistoryLoading(), [cacheKey]: false },
            });
          },
          error: (err: unknown) => {
            patchState(state, {
              signalHistoryCache: { ...state.signalHistoryCache(), [cacheKey]: [] },
              signalHistoryLoading: { ...state.signalHistoryLoading(), [cacheKey]: false },
            });
            console.error(`[RhAgentSymbolHistoryStore] Failed to load run signals for ${symbol}:`, err);
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
            patchState(state, {
              signalHistoryCache: { ...state.signalHistoryCache(), [symbol]: [] },
              signalHistoryLoading: { ...state.signalHistoryLoading(), [symbol]: false },
            });
            console.error(`[RhAgentSymbolHistoryStore] Failed to load signal history for ${symbol}:`, err);
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
