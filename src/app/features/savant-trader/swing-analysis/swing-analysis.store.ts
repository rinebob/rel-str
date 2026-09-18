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
      // Track the in-flight analysis-document-load subscription so that
      // setSymbol/resetState can cancel a stale loadAnalysis request before
      // its result overwrites newer state.
      let analysisSub: Subscription | null = null;

      /**
       * Shared bar-load + recompute helper. Cancels any in-flight bar load,
       * fetches bars for `symbol`, recomputes pivots/swings/stats with
       * `config`, and patches the store. `clearOnError` controls whether
       * the error handler resets derived state (setSymbol) or only sets
       * `error` (loadAnalysis, which has already patched config).
       */
      function loadBarsAndRecompute(
        symbol: string,
        config: ZigZagConfig,
        clearOnError: boolean,
      ): void {
        barsSub?.unsubscribe();
        barsSub = chartService
          .loadBars$(symbol)
          .pipe(takeUntilDestroyed(destroyRef))
          .subscribe({
            next: (result) => {
              const bars = result.daily.bars;
              const { pivots, projection, swings, stats } = recompute(bars, config);
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
                symbol,
                err,
              );
              const patch: Partial<SwingAnalysisState> = {
                loading: false,
                error: `Failed to load bars: ${msg}`,
              };
              if (clearOnError) {
                patch.bars = [];
                patch.pivots = [];
                patch.projection = null;
                patch.swings = [];
                patch.stats = null;
              }
              patchState(store, patch);
              barsSub = null;
            },
          });
      }

      return {
        /**
         * Reset the store to initial state (except savedAnalyses).
         * Called by the page on init to avoid stale data from prior visits.
         */
        resetState(): void {
          barsSub?.unsubscribe();
          barsSub = null;
          analysisSub?.unsubscribe();
          analysisSub = null;
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
          // Cancel any in-flight analysis load to prevent stale overwrites.
          analysisSub?.unsubscribe();
          analysisSub = null;
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

          loadBarsAndRecompute(sym, store.config(), true);
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
         *
         * Bars are NOT persisted in the doc — they are loaded from the chart
         * service (same path as setSymbol). If bars are already loaded, the
         * config from the doc is applied and pivots/swings/stats are
         * recomputed from the existing bars. If bars are not yet loaded,
         * bars are fetched from the chart service first, then the config
         * is applied and results are recomputed.
         */
        loadAnalysis(docId: string): void {
          const symbol = store.symbol();
          if (!symbol || !docId) return;

          // Cancel any prior in-flight analysis load to prevent stale overwrites.
          analysisSub?.unsubscribe();
          analysisSub = swingAnalysisService
            .loadAnalysis(symbol, docId)
            .pipe(takeUntilDestroyed(destroyRef))
            .subscribe({
              next: (doc) => {
                analysisSub = null;
                if (!doc) return;
                const config = doc.config;
                const bars = store.bars();

                if (bars.length > 0) {
                  // Bars already loaded — recompute with the loaded config.
                  const { pivots, projection, swings, stats } = recompute(bars, config);
                  patchState(store, {
                    config,
                    pivots,
                    projection,
                    swings,
                    stats,
                    error: null,
                  });
                } else {
                  // No bars loaded — fetch from chart service, then recompute.
                  patchState(store, { config, loading: true, error: null });
                  loadBarsAndRecompute(symbol, config, false);
                }
              },
              error: (err: unknown) => {
                analysisSub = null;
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
