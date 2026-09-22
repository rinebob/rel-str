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
import { SymbolListStore } from '../stores/symbol-list.store';
import { SwingAnalysisService } from './swing-analysis.service';
import { buildBatchSweep, parseSymbols } from './swing-batch';
import {
  symbolNavComputedBlock,
  symbolNavMethods,
  type NavFilter,
} from './symbol-nav.feature';
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

/** Primary config — identifies larger swings. Matches the seeded 10/10/10
 *  swing set so the default view lines up with saved analyses. */
export const LARGE_CONFIG: ZigZagConfig = {
  devThreshold: 10,
  leftDepth: 10,
  rightDepth: 10,
  allowZigZagOnOneBar: true,
  projectionPivots: true,
  lineColor: '#1976d2',
};

/** Secondary config — identifies smaller swings. Only used in dual mode.
 *  Matches the seeded 3/3/3 swing set. */
export const SMALL_CONFIG: ZigZagConfig = {
  devThreshold: 3,
  leftDepth: 3,
  rightDepth: 3,
  allowZigZagOnOneBar: true,
  projectionPivots: true,
  lineColor: '#000000',
  showTriggerDots: false,
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
  /** Batch sweep state — progress and per-symbol results of runBatch. */
  batchRunning: boolean;
  batchProgress: { done: number; total: number; current: string | null };
  batchResults: { symbol: string; ok: boolean; error?: string }[];
  /** All saved swing sets across symbols — the saved-sets browser's
   *  source. Populated lazily by loadSwingSets() (whole-collection read —
   *  deliberately NOT on page init). */
  savedSets: SwingAnalysisDoc[];
  savedSetsLoading: boolean;
  /** Watchlist filter narrowing the nav sequence; 'ALL' = all tracked. */
  navFilter: NavFilter;
}

const initialState: SwingAnalysisState = {
  symbol: '',
  // Dual mode is the default — large + small configs both present.
  configs: [{ ...LARGE_CONFIG }, { ...SMALL_CONFIG }],
  bars: [],
  pivots: [[], []],
  projections: [null, null],
  swings: [[], []],
  stats: [null, null],
  loading: false,
  error: null,
  savedAnalyses: [],
  batchRunning: false,
  batchProgress: { done: 0, total: 0, current: null },
  batchResults: [],
  savedSets: [],
  savedSetsLoading: false,
  navFilter: 'ALL',
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
    /** Multi-config mode — N>1 configs (the N-slot load from saved sets
     *  makes N>2 possible; the UI treats "dual" as "more than one"). */
    dualMode: computed(() => store.configs().length > 1),
    /**
     * Combined stats across ALL config swing arrays (multi mode's "All"
     * stats view). Recomputed from the merged swings — computeSwingStats
     * is order-insensitive (filters confirmed, aggregates by direction),
     * so no sort is needed. Null in single-config mode or no swings.
     */
    allStats: computed(() => {
      // Same guard as dualMode — sibling computeds aren't visible to each
      // other inside a single withComputed block, so configs().length is
      // read directly here.
      if (store.configs().length < 2) return null;
      const merged = store.swings().flat();
      return merged.length > 0 ? computeSwingStats(merged) : null;
    }),
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
      // Track the in-flight batch sweep so cancelBatch/resetState can abort
      // it — takeUntilDestroyed only fires on store teardown, and a root
      // store outlives any page visit.
      let batchSub: Subscription | null = null;
      // Track the saved-sets collection load so resetState can't leave a
      // zombie load patching savedSets after page re-entry.
      let setsSub: Subscription | null = null;

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

      /**
       * The setSymbol flow — normalize the symbol, clear derived state,
       * kick off the bar load. Hoisted so loadSwingSetsIntoSlots can run
       * it after patching configs (the in-flight bar load's recomputeAll
       * reads store.configs() fresh, so the N loaded slots are the ones
       * recomputed when bars arrive).
       */
      function applySymbol(symbol: string): void {
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
          // Abort any in-flight batch too — otherwise a zombie sweep keeps
          // writing batchResults into the "reset" store after page re-entry.
          batchSub?.unsubscribe();
          batchSub = null;
          setsSub?.unsubscribe();
          setsSub = null;
          patchState(store, {
            symbol: '',
            configs: [{ ...LARGE_CONFIG }, { ...SMALL_CONFIG }],
            bars: [],
            pivots: [[], []],
            projections: [null, null],
            swings: [[], []],
            stats: [null, null],
            loading: false,
            error: null,
            batchRunning: false,
            batchProgress: { done: 0, total: 0, current: null },
            batchResults: [],
            savedSets: [],
            savedSetsLoading: false,
          });
        },

        /**
         * Set the symbol and trigger bar load + recompute for all configs.
         */
        setSymbol(symbol: string): void {
          applySymbol(symbol);
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
          if (configs.length > 1) {
            // Turn off — collapse to the first config. From N>2 loaded
            // slots this discards slots 2+ — the toggle is explicitly a
            // "single vs multi" switch, not a resize.
            patchState(store, {
              configs: [configs[0]],
              pivots: [store.pivots()[0]],
              projections: [store.projections()[0]],
              swings: [store.swings()[0]],
              stats: [store.stats()[0]],
            });
          } else {
            // Turn on — add a second config with small defaults (from
            // single mode; from N>2 the toggle reads "on" so this branch
            // only runs when configs.length === 1).
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

        /**
         * Batch sweep — analyze a pasted symbol list with the current
         * configs and save each result to `st-swing-sets/{symbol}_{paramsId}`.
         *
         * Runs strictly in the background: symbols are processed serially
         * (see buildBatchSweep in swing-batch.ts), bars are fetched through
         * ChartService directly, and the displayed symbol/bars/derived state
         * is never touched. Configs are snapshotted at run start; per-symbol
         * failures are recorded in batchResults and the sweep continues.
         * A per-symbol `ok:false` means at least one save failed — sibling
         * config docs may already be persisted.
         */
        runBatch(symbolsText: string): void {
          if (store.batchRunning()) return;
          const symbols = parseSymbols(symbolsText);
          if (symbols.length === 0) return;

          const configs = store.configs(); // snapshot — mid-run edits don't leak in
          patchState(store, {
            batchRunning: true,
            batchProgress: { done: 0, total: symbols.length, current: symbols[0] },
            batchResults: [],
          });

          batchSub = buildBatchSweep(
            chartService,
            swingAnalysisService,
            configs,
            symbols,
          )
            .pipe(takeUntilDestroyed(destroyRef))
            .subscribe({
              next: (res) => {
                const results = [...store.batchResults(), res];
                patchState(store, {
                  batchResults: results,
                  batchProgress: {
                    done: results.length,
                    total: symbols.length,
                    current: symbols[results.length] ?? null,
                  },
                });
              },
              // Outer stream dying must not latch batchRunning — the guard
              // at the top would brick runBatch for the whole session.
              error: () => {
                batchSub = null;
                patchState(store, { batchRunning: false });
              },
              complete: () => {
                batchSub = null;
                patchState(store, { batchRunning: false });
              },
            });
        },

        /** Abort an in-flight batch sweep — unsubscribes, clears the
         *  running flag, and drops the in-progress symbol from the
         *  progress line (done/total remain as a post-mortem). Caveat:
         *  a save already in flight inside the pipeline is a promise —
         *  it can't be un-written, so a doc may land after cancel with
         *  no result row recorded for it. */
        cancelBatch(): void {
          batchSub?.unsubscribe();
          batchSub = null;
          if (store.batchRunning()) {
            patchState(store, {
              batchRunning: false,
              batchProgress: { ...store.batchProgress(), current: null },
            });
          }
        },

        /**
         * Populate `savedSets` — the saved-sets browser's source. Lazy:
         * called when the panel expands, never on page init. With a symbol
         * it reads that symbol's docs only (small); without it falls back
         * to the whole-collection read (slow — thousands of pivot/swings
         * docs — avoid in the UI). Re-invocation for another symbol
         * refetches; in-flight re-entry for the same call is ignored.
         */
        loadSwingSets(symbol?: string): void {
          if (store.savedSetsLoading()) return;
          setsSub?.unsubscribe();
          patchState(store, { savedSets: [], savedSetsLoading: true });
          const sym = String(symbol || '').trim().toUpperCase();
          const src$ = sym
            ? swingAnalysisService.loadSavedAnalyses(sym)
            : swingAnalysisService.loadAllSwingSets();
          setsSub = src$
            .pipe(takeUntilDestroyed(destroyRef))
            .subscribe({
              next: (docs) => {
                setsSub = null;
                patchState(store, {
                  savedSets: docs,
                  savedSetsLoading: false,
                });
              },
              error: (err: unknown) => {
                setsSub = null;
                const msg = err instanceof Error ? err.message : String(err);
                patchState(store, {
                  savedSetsLoading: false,
                  error: `Failed to load swing sets: ${msg}`,
                });
              },
            });
        },

        /**
         * Load N saved docs into N config slots. Replaces `configs` with
         * the docs' configs and recomputes every slot on the current bars.
         * Same-symbol guard re-validates the UI's constraint; a different
         * symbol runs the setSymbol flow (the bar load recomputes the new
         * N configs when bars arrive). Nothing is re-saved — the docs are
         * already persisted snapshots.
         */
        loadSwingSetsIntoSlots(docs: SwingAnalysisDoc[]): void {
          if (docs.length === 0) return;
          // Cancel an in-flight loadAnalysis — its next handler re-reads
          // configs() and would overwrite one just-loaded slot.
          analysisSub?.unsubscribe();
          analysisSub = null;
          const symbols = new Set(
            docs.map((d) => d.symbol.trim().toUpperCase()),
          );
          if (symbols.size !== 1) return; // same-symbol guard
          const sym = [...symbols][0];
          // Slot styling is positional, never from the doc: slot 0 renders
          // as the large config (blue, trigger dots); slots 1+ render as
          // small — black line, no trigger dots.
          const configs = docs.map((d, i) => ({
            ...d.config,
            lineColor: i === 0 ? LARGE_CONFIG.lineColor : SMALL_CONFIG.lineColor,
            showTriggerDots: i === 0 ? LARGE_CONFIG.showTriggerDots ?? true : false,
          }));

          if (sym !== store.symbol()) {
            patchState(store, { configs, error: null });
            applySymbol(sym); // recompute happens on bar arrival
            return;
          }
          const { pivots, projections, swings, stats } = recomputeAll(
            store.bars(),
            configs,
          );
          patchState(store, {
            configs,
            pivots,
            projections,
            swings,
            stats,
            error: null,
          });
        },
      };
    },
  ),

  // Symbol navigation — see symbol-nav.feature.ts. Appended after the
  // main blocks so `store` already carries setSymbol and the signals.
  withComputed((store, symbolListStore = inject(SymbolListStore)) =>
    symbolNavComputedBlock(store, symbolListStore),
  ),

  withMethods((store, symbolListStore = inject(SymbolListStore)) =>
    symbolNavMethods(store, { lists: symbolListStore }),
  ),
);
