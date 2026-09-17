/**
 * Swing Analysis Store — NgRx SignalStore.
 *
 * Manages swing-analysis page state: symbol, config, pivots, swings, stats,
 * loading, error, and saved analyses. Triggers bar loading and ZigZag
 * recompute on symbol/config changes. Persists analyses via
 * SwingAnalysisService.
 */

import { inject, DestroyRef } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  signalStore,
  withState,
  withMethods,
  withComputed,
  patchState,
} from '@ngrx/signals';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { computed } from '@angular/core';

import { ChartService } from '../services/chart.service';
import { SwingAnalysisService } from './swing-analysis.service';
import { deriveParamsId } from './swing-analysis.types';
import type { SwingAnalysisDoc, SwingAnalysisInput } from './swing-analysis.types';
import {
  computeZigZagPivots,
  deriveSwings,
  computeSwingStats,
  DEFAULT_CONFIG,
} from '../../shared/components/flex-chart/indicators/st-zigzag.engine';
import type {
  ZigZagConfig,
  Pivot,
  Swing,
  SwingStats,
  PriceBar,
} from '../../shared/components/flex-chart/indicators/st-zigzag.engine';

// =============================================================================
// State
// =============================================================================

export interface SwingAnalysisState {
  symbol: string;
  config: ZigZagConfig;
  /** Loaded price bars — kept for recompute on config change. */
  bars: PriceBar[];
  pivots: Pivot[];
  projection: Pivot | null;
  swings: Swing[];
  stats: SwingStats | null;
  loading: boolean;
  /** Last error message from bar load or persistence — null when idle. */
  error: string | null;
  savedAnalyses: SwingAnalysisDoc[];
}

const initialState: SwingAnalysisState = {
  symbol: '',
  config: { ...DEFAULT_CONFIG },
  bars: [],
  pivots: [],
  projection: null,
  swings: [],
  stats: null,
  loading: false,
  error: null,
  savedAnalyses: [],
};

// =============================================================================
// Recompute helper
// =============================================================================

interface RecomputeResult {
  pivots: Pivot[];
  projection: Pivot | null;
  swings: Swing[];
  stats: SwingStats | null;
}

function recompute(bars: PriceBar[], config: ZigZagConfig): RecomputeResult {
  if (bars.length === 0) {
    return { pivots: [], projection: null, swings: [], stats: null };
  }
  const { pivots, projection } = computeZigZagPivots(bars, config);
  const swings = deriveSwings(pivots, bars, projection);
  const stats = swings.length > 0 ? computeSwingStats(swings) : null;
  return { pivots, projection: projection ?? null, swings, stats };
}

// =============================================================================
// Store
// =============================================================================

export const SwingAnalysisStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withComputed((store) => ({
    /** Whether there is a current projected (unconfirmed) swing. */
    hasProjection: computed(() => store.projection() !== null),
    /** paramsId for the current config — used as Firestore doc id. */
    paramsId: computed(() => deriveParamsId(store.config())),
  })),

  withMethods(
    (
      store,
      chartService = inject(ChartService),
      swingAnalysisService = inject(SwingAnalysisService),
      destroyRef = inject(DestroyRef),
    ) => {
      // Track the in-flight bar-load subscription so we can cancel stale
      // requests when setSymbol is called again before the previous one
      // completes.
      let barsSub: Subscription | null = null;

      return {
        /**
         * Reset the store to initial state (except savedAnalyses).
         * Called by the page on init to avoid stale data from prior visits.
         */
        resetState(): void {
          barsSub?.unsubscribe();
          barsSub = null;
          patchState(store, {
            symbol: '',
            config: { ...DEFAULT_CONFIG },
            bars: [],
            pivots: [],
            projection: null,
            swings: [],
            stats: null,
            loading: false,
            error: null,
          });
        },

        /**
         * Set the symbol and trigger bar load + recompute.
         */
        setSymbol(symbol: string): void {
          const sym = String(symbol || '').trim().toUpperCase();
          patchState(store, {
            symbol: sym,
            loading: true,
            error: null,
            bars: [],
            pivots: [],
            projection: null,
            swings: [],
            stats: null,
          });

          // Cancel any in-flight bar load to prevent stale overwrites.
          barsSub?.unsubscribe();
          barsSub = null;

          if (!sym) {
            patchState(store, { loading: false });
            return;
          }

          barsSub = chartService
            .loadBars$(sym)
            .pipe(takeUntilDestroyed(destroyRef))
            .subscribe({
              next: (result) => {
                const bars = result.daily.bars;
                const { pivots, projection, swings, stats } = recompute(
                  bars,
                  store.config(),
                );
                patchState(store, {
                  bars,
                  pivots,
                  projection,
                  swings,
                  stats,
                  loading: false,
                  error: null,
                });
                barsSub = null;
              },
              error: (err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(
                  '[SwingAnalysisStore] Failed to load bars for',
                  sym,
                  err,
                );
                patchState(store, {
                  loading: false,
                  error: `Failed to load bars: ${msg}`,
                  bars: [],
                  pivots: [],
                  projection: null,
                  swings: [],
                  stats: null,
                });
                barsSub = null;
              },
            });
        },

        /**
         * Update the config and recompute from already-loaded bars.
         */
        updateConfig(partial: Partial<ZigZagConfig>): void {
          const config = { ...store.config(), ...partial };
          const bars = store.bars();
          const { pivots, projection, swings, stats } = recompute(bars, config);
          patchState(store, {
            config,
            pivots,
            projection,
            swings,
            stats,
            error: null,
          });
        },

        /**
         * Save the current analysis to Firestore.
         */
        saveAnalysis(): void {
          const symbol = store.symbol();
          const config = store.config();
          const paramsId = store.paramsId();
          const stats = store.stats();

          if (!symbol || !stats) return;

          const doc: SwingAnalysisInput = {
            symbol,
            paramsId,
            config,
            bars: store.bars(),
            pivots: store.pivots(),
            projection: store.projection(),
            swings: store.swings(),
            stats,
            savedAt: new Date().toISOString(),
          };

          swingAnalysisService
            .saveAnalysis(doc)
            .pipe(takeUntilDestroyed(destroyRef))
            .subscribe({
              next: () => {
                patchState(store, { error: null });
                // Refresh the saved analyses list.
                swingAnalysisService
                  .loadSavedAnalyses(symbol)
                  .pipe(takeUntilDestroyed(destroyRef))
                  .subscribe({
                    next: (docs) => patchState(store, { savedAnalyses: docs }),
                    error: (err: unknown) => {
                      const msg = err instanceof Error ? err.message : String(err);
                      console.error(
                        '[SwingAnalysisStore] Failed to refresh saved analyses for',
                        symbol,
                        err,
                      );
                      patchState(store, { error: `Failed to refresh: ${msg}` });
                    },
                  });
              },
              error: (err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(
                  '[SwingAnalysisStore] Failed to save analysis for',
                  symbol,
                  err,
                );
                patchState(store, { error: `Failed to save: ${msg}` });
              },
            });
        },

        /**
         * Load all saved analyses for the current symbol.
         */
        loadSavedAnalyses(): void {
          const symbol = store.symbol();
          if (!symbol) return;

          swingAnalysisService
            .loadSavedAnalyses(symbol)
            .pipe(takeUntilDestroyed(destroyRef))
            .subscribe({
              next: (docs) => {
                patchState(store, { savedAnalyses: docs, error: null });
              },
              error: (err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(
                  '[SwingAnalysisStore] Failed to load saved analyses for',
                  symbol,
                  err,
                );
                patchState(store, { error: `Failed to load saved analyses: ${msg}` });
              },
            });
        },

        /**
         * Load a saved analysis into the store.
         */
        loadAnalysis(docId: string): void {
          const symbol = store.symbol();
          if (!symbol || !docId) return;

          swingAnalysisService
            .loadAnalysis(symbol, docId)
            .pipe(takeUntilDestroyed(destroyRef))
            .subscribe({
              next: (doc) => {
                if (!doc) return;
                patchState(store, {
                  config: doc.config,
                  bars: doc.bars ?? [],
                  pivots: doc.pivots,
                  projection: doc.projection ?? null,
                  swings: doc.swings,
                  stats: doc.stats,
                  error: null,
                });
              },
              error: (err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(
                  '[SwingAnalysisStore] Failed to load analysis',
                  docId,
                  err,
                );
                patchState(store, { error: `Failed to load analysis: ${msg}` });
              },
            });
        },
      };
    },
  ),
);
