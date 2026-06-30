/**
 * RH Agent Symbol History Store
 *
 * Owns per-symbol signal history loading and caching.
 * Decoupled from the grouped-review store so any page can load a symbol's
 * history without pulling in the full group state.
 *
 * Responsibilities:
 * - Fetch signal history for a symbol on demand
 * - Cache results by symbol
 * - Expose loading flags per symbol
 */
import { inject, DestroyRef } from '@angular/core';
import {
  signalStore,
  withState,
  withMethods,
  withComputed,
  patchState,
} from '@ngrx/signals';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { RhAgentService, RhAgentSignalItem } from '../services/rh-agent.service';

export interface RhAgentSymbolHistoryState {
  /** Per-symbol signal history cache: symbol → signals[] */
  signalHistoryCache: Record<string, RhAgentSignalItem[]>;
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

  withMethods((state, service = inject(RhAgentService), destroyRef = inject(DestroyRef)) => ({
    /**
     * Load signal history for a symbol into the cache.
     * Reads all signals (W + D) directly from the Firestore subcollection.
     * If the symbol is already cached, this is a no-op.
     */
    loadSignalHistory(symbol: string): void {
      const cache = state.signalHistoryCache();
      if (cache[symbol] !== undefined) {
        return;
      }

      patchState(state, {
        signalHistoryLoading: { ...state.signalHistoryLoading(), [symbol]: true },
      });

      service.getSymbolSignalHistory(symbol)
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
