/**
 * Swing Analysis Store — NgRx SignalStore.
 *
 * Manages swing-analysis page state: symbol, configs (one or two ZigZag
 * instances), pivots, swings, stats, loading, error, and saved analyses.
 * Triggers bar loading and ZigZag recompute on symbol/config changes.
 * Persists analyses via SwingAnalysisService — each config is saved
 * independently under its own paramsId.
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
} from '../../shared/components/flex-chart/indicators/st-zigzag.engine';
import type {
  ZigZagConfig,
  Pivot,
  Swing,
  SwingStats,
  PriceBar,
} from '../../shared/components/flex-chart/indicators/st-zigzag.engine';

// =============================================================================
// Defaults — large (primary) and small (secondary) ZigZag configs
// =============================================================================

/** Primary config — identifies larger swings. */
export const LARGE_CONFIG: ZigZagConfig = {
  devThreshold: 10,
  leftDepth: 10,
  rightDepth: 10,
  allowZigZagOnOneBar: true,
  projectionPivots: true,
  lineColor: '#1976d2',
};

/** Secondary config — identifies smaller swings. Only used in dual mode. */
export const SMALL_CONFIG: ZigZagConfig = {
  devThreshold: 3,
  leftDepth: 3,
  rightDepth: 3,
  allowZigZagOnOneBar: true,
  projectionPivots: true,
  lineColor: '#e65100',
};

// =============================================================================
// State
// =============================================================================

export interface SwingAnalysisState {
  symbol: string;
  /** One or two ZigZag configs — one when dual mode off, two when on. */
  configs: ZigZagConfig[];
  /** Loaded price bars — shared across all configs. */
  bars: PriceBar[];
  /** Per-config pivots — one array per config. */
  pivots: Pivot[][];
  /** Per-config projected pivot — one per config. */
  projections: (Pivot | null)[];
  /** Per-config swings — one array per config. */
  swings: Swing[][];
  /** Per-config stats — one per config. */
  stats: (SwingStats | null)[];
  loading: boolean;
  /** Last error message from bar load or persistence — null when idle. */
  error: string | null;
  savedAnalyses: SwingAnalysisDoc[];
}

const initialState: SwingAnalysisState = {
  symbol: '',
  configs: [{ ...LARGE_CONFIG }],
  bars: [],
  pivots: [[]],
  projections: [null],
  swings: [[]],
  stats: [null],
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

/** Recompute all configs from the same bars. Returns aligned arrays. */
function recomputeAll(
  bars: PriceBar[],
  configs: ZigZagConfig[],
): {
  pivots: Pivot[][];
  projections: (Pivot | null)[];
  swings: Swing[][];
  stats: (SwingStats | null)[];
} {
  const pivots: Pivot[][] = [];
  const projections: (Pivot | null)[] = [];
  const swings: Swing[][] = [];
  const stats: (SwingStats | null)[] = [];
  for (const config of configs) {
    const r = recompute(bars, config);
    pivots.push(r.pivots);
    projections.push(r.projection);
    swings.push(r.swings);
    stats.push(r.stats);
  }
  return { pivots, projections, swings, stats };
}

// =============================================================================
// Store
// =============================================================================

export const SwingAnalysisStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withComputed((store) => ({
    /** Whether any config has a current projected (unconfirmed) swing. */
    hasProjection: computed(() => store.projections().some((p) => p !== null)),
    /** paramsIds for all configs — each used as its own Firestore doc id. */
    paramsIds: computed(() => store.configs().map((c) => deriveParamsId(c))),
    /** Whether dual mode is active — derived from configs array length. */
    dualMode: computed(() => store.configs().length === 2),
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
       * fetches bars for `symbol`, recomputes all configs, and patches the
       * store. `clearOnError` controls whether the error handler resets
       * derived state (setSymbol) or only sets `error` (loadAnalysis, which
       * has already patched config).
       *
       * Reads `store.configs()` fresh inside the `next` handler to avoid
       * stale-config desync when `toggleDualMode`/`updateConfig` mutate
       * configs while a bar load is in flight.
       */
      function loadBarsAndRecompute(
        symbol: string,
        clearOnError: boolean,
      ): void {
        barsSub?.unsubscribe();
        barsSub = chartService
          .loadBars$(symbol)
          .pipe(takeUntilDestroyed(destroyRef))
          .subscribe({
            next: (result) => {
              const bars = result.daily.bars;
              // Read configs fresh — may have changed during in-flight load.
              const configs = store.configs();
              const { pivots, projections, swings, stats } = recomputeAll(bars, configs);
              patchState(store, {
                bars,
                pivots,
                projections,
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
                patch.pivots = store.configs().map(() => []);
                patch.projections = store.configs().map(() => null);
                patch.swings = store.configs().map(() => []);
                patch.stats = store.configs().map(() => null);
              }
              patchState(store, patch);
              barsSub = null;
            },
          });
      }

      /**
       * Recompute one config slot and return the four patched arrays.
       * Centralizes the index-mapped patch used by updateConfig and
       * loadAnalysis — both recompute one slot while leaving the rest
       * of the parallel arrays untouched.
       */
      function recomputeSlot(
        index: number,
        bars: PriceBar[],
        config: ZigZagConfig,
      ): {
        pivots: Pivot[][];
        projections: (Pivot | null)[];
        swings: Swing[][];
        stats: (SwingStats | null)[];
      } {
        const r = recompute(bars, config);
        return {
          pivots: store.pivots().map((p, i) => (i === index ? r.pivots : p)),
          projections: store
            .projections()
            .map((p, i) => (i === index ? r.projection : p)),
          swings: store.swings().map((s, i) => (i === index ? r.swings : s)),
          stats: store.stats().map((s, i) => (i === index ? r.stats : s)),
        };
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
            configs: [{ ...LARGE_CONFIG }],
            bars: [],
            pivots: [[]],
            projections: [null],
            swings: [[]],
            stats: [null],
            loading: false,
            error: null,
          });
        },

        /**
         * Set the symbol and trigger bar load + recompute for all configs.
         */
        setSymbol(symbol: string): void {
          const sym = String(symbol || '').trim().toUpperCase();
          // Cancel any in-flight analysis load to prevent stale overwrites.
          analysisSub?.unsubscribe();
          analysisSub = null;
          const configs = store.configs();
          patchState(store, {
            symbol: sym,
            loading: true,
            error: null,
            bars: [],
            pivots: configs.map(() => []),
            projections: configs.map(() => null),
            swings: configs.map(() => []),
            stats: configs.map(() => null),
          });

          // Cancel any in-flight bar load to prevent stale overwrites.
          barsSub?.unsubscribe();
          barsSub = null;

          if (!sym) {
            patchState(store, { loading: false });
            return;
          }

          loadBarsAndRecompute(sym, true);
        },

        /**
         * Update one config and recompute only that config's pivots/swings/stats.
         */
        updateConfig(index: number, partial: Partial<ZigZagConfig>): void {
          const configs = store.configs();
          if (index < 0 || index >= configs.length) return;
          const newConfig = { ...configs[index], ...partial };
          const newConfigs = configs.map((c, i) => (i === index ? newConfig : c));
          const bars = store.bars();
          const slot = recomputeSlot(index, bars, newConfig);
          patchState(store, {
            configs: newConfigs,
            ...slot,
            error: null,
          });
        },

        /**
         * Toggle dual mode. When turning on, adds a second config with small
         * defaults and recomputes it from loaded bars. When turning off,
         * removes the second config and its derived state.
         *
         * `dualMode` is a computed signal derived from `configs.length === 2`,
         * so no separate flag is patched here — adding/removing the config
         * drives the flag automatically.
         */
        toggleDualMode(): void {
          const configs = store.configs();
          if (configs.length === 2) {
            // Turn off — remove second config.
            patchState(store, {
              configs: [configs[0]],
              pivots: [store.pivots()[0]],
              projections: [store.projections()[0]],
              swings: [store.swings()[0]],
              stats: [store.stats()[0]],
            });
          } else {
            // Turn on — add second config with small defaults.
            const bars = store.bars();
            const r = recompute(bars, { ...SMALL_CONFIG });
            patchState(store, {
              configs: [configs[0], { ...SMALL_CONFIG }],
              pivots: [store.pivots()[0], r.pivots],
              projections: [store.projections()[0], r.projection],
              swings: [store.swings()[0], r.swings],
              stats: [store.stats()[0], r.stats],
            });
          }
        },

        /**
         * Save one config's analysis to Firestore under its own paramsId.
         */
        saveAnalysis(index: number): void {
          const symbol = store.symbol();
          const configs = store.configs();
          if (!symbol || index < 0 || index >= configs.length) return;

          const config = configs[index];
          const paramsId = deriveParamsId(config);
          const stats = store.stats()[index];
          if (!stats) return;

          const doc: SwingAnalysisInput = {
            symbol,
            paramsId,
            config,
            pivots: store.pivots()[index],
            projection: store.projections()[index],
            swings: store.swings()[index],
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
         * Load a saved analysis into a specific config slot.
         *
         * Bars are NOT persisted in the doc — they are loaded from the chart
         * service (same path as setSymbol). If bars are already loaded, the
         * config from the doc is applied and that slot's pivots/swings/stats
         * are recomputed. If bars are not yet loaded, bars are fetched from
         * the chart service first, then all configs are recomputed.
         */
        loadAnalysis(docId: string, index: number): void {
          const symbol = store.symbol();
          if (!symbol || !docId) return;
          if (index < 0 || index >= store.configs().length) return;

          // Cancel any prior in-flight analysis load to prevent stale overwrites.
          analysisSub?.unsubscribe();
          analysisSub = swingAnalysisService
            .loadAnalysis(symbol, docId)
            .pipe(takeUntilDestroyed(destroyRef))
            .subscribe({
              next: (doc) => {
                analysisSub = null;
                if (!doc) {
                  patchState(store, { error: 'Analysis not found' });
                  return;
                }
                // Re-read configs fresh — toggleDualMode/updateConfig may
                // have mutated the array while the fetch was in flight.
                const configs = store.configs();
                if (index >= configs.length) return;
                const newConfig = doc.config;
                const newConfigs = configs.map((c, i) =>
                  i === index ? newConfig : c,
                );
                const bars = store.bars();

                if (bars.length > 0) {
                  // Bars already loaded — recompute only this slot.
                  const slot = recomputeSlot(index, bars, newConfig);
                  patchState(store, {
                    configs: newConfigs,
                    ...slot,
                    error: null,
                  });
                } else {
                  // No bars loaded — fetch from chart service, then recompute all.
                  patchState(store, {
                    configs: newConfigs,
                    loading: true,
                    error: null,
                  });
                  loadBarsAndRecompute(symbol, false);
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
