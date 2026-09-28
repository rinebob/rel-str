/**
 * Swing Analysis Store — NgRx SignalStore.
 *
 * Manages swing-analysis page state: symbol, configs (unbounded list of
 * ZigZag instances), pivots, swings, stats, loading, error, and the
 * config library. Triggers bar loading and ZigZag recompute on
 * symbol/config changes. Persists configs via SwingAnalysisService —
 * st-swing-configs/{paramsId}.
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

import {
  symbolNavComputedBlock,
  symbolNavMethods,
  type NavFilter,
} from './symbol-nav.feature';
import { deriveParamsId, deriveSetParamsId, docConfigs } from './swing-analysis.types';
import type {
  SwingConfigDoc,
  SwingConfigInput,
} from './swing-analysis.types';
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

/** Secondary default config — identifies smaller swings. Matches the
 *  seeded 3/3/3 swing set. */
export const SMALL_CONFIG: ZigZagConfig = {
  devThreshold: 3,
  leftDepth: 3,
  rightDepth: 3,
  allowZigZagOnOneBar: true,
  projectionPivots: true,
  lineColor: '#000000',
  showTriggerDots: false,
};

/** Canned presets for the settings dialog's Available list — the
 *  bulk-sweep 4-config set, ordered highest→lowest devThreshold. No
 *  display names: the row label is the param summary. */
export const SWING_PRESETS: ZigZagConfig[] = [
  { devThreshold: 10, leftDepth: 10, rightDepth: 10, allowZigZagOnOneBar: true, projectionPivots: true, showTriggerDots: true, lineColor: '#673ab7' },
  { devThreshold: 5,  leftDepth: 5,  rightDepth: 5,  allowZigZagOnOneBar: true, projectionPivots: true, showTriggerDots: true, lineColor: '#1976d2' },
  { devThreshold: 3,  leftDepth: 3,  rightDepth: 3,  allowZigZagOnOneBar: true, projectionPivots: true, showTriggerDots: true, lineColor: '#388e3c' },
  { devThreshold: 2,  leftDepth: 2,  rightDepth: 2,  allowZigZagOnOneBar: true, projectionPivots: true, showTriggerDots: true, lineColor: '#e65100' },
];

// =============================================================================
// State
// =============================================================================

export interface SwingAnalysisState {
  symbol: string;
  /** Active ZigZag configs — always-N, unbounded, positional. */
  configs: ZigZagConfig[];
  /** Runtime-only per-config on/off — index-aligned with configs. Never
   *  persisted: library docs carry params only. Disabled slots keep
   *  empty derived arrays (no compute, nothing renders). */
  configEnabled: boolean[];
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
  /** Global config library — st-swing-configs docs. Populated lazily by
   *  loadConfigLibrary() when the settings dialog opens. */
  configLibrary: SwingConfigDoc[];
  configLibraryLoading: boolean;
  /** Watchlist filter narrowing the nav sequence; 'ALL' = all tracked. */
  navFilter: NavFilter;
}

const initialState: SwingAnalysisState = {
  symbol: '',
  // The default session opens with two active configs — primary + secondary.
  configs: [{ ...LARGE_CONFIG }, { ...SMALL_CONFIG }],
  configEnabled: [true, true],
  bars: [],
  pivots: [[], []],
  projections: [null, null],
  swings: [[], []],
  stats: [null, null],
  loading: false,
  error: null,
  configLibrary: [],
  configLibraryLoading: false,
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

/** Recompute all configs from the same bars. Returns aligned arrays.
 *  Disabled slots (`enabled[i] === false`) compute to empty — the flag is
 *  runtime-only and never part of the saved config. */
function recomputeAll(
  bars: PriceBar[],
  configs: ZigZagConfig[],
  enabled?: boolean[],
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
  for (let i = 0; i < configs.length; i++) {
    const r = enabled?.[i] === false
      ? { pivots: [] as Pivot[], projection: null, swings: [] as Swing[], stats: null }
      : recompute(bars, configs[i]);
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
    /**
     * Combined stats across ALL config swing arrays (multi-config "All"
     * stats view). Recomputed from the merged swings — computeSwingStats
     * is order-insensitive (filters confirmed, aggregates by direction),
     * so no sort is needed. Null with fewer than two configs or no swings.
     */
    allStats: computed(() => {
      // Length guard — sibling computeds aren't visible to each
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
      // Track the config-library load so resetState can't leave a
      // zombie load patching configLibrary after page re-entry.
      let librarySub: Subscription | null = null;

      /**
       * Cancel any in-flight library load and re-query st-swing-configs.
       * Used by loadConfigLibrary (lazy entry) and as the post-write
       * refresh after saveActiveConfig/deleteSavedConfig — a load issued
       * before a write commits could otherwise overwrite the just-saved
       * (or resurrect the just-deleted) row when its stale response lands.
       */
      function refreshLibrary(): void {
        librarySub?.unsubscribe();
        patchState(store, { configLibraryLoading: true });
        // Assign after subscribe: a sync-completing observable runs the
        // handler (which nulls librarySub) before the Subscription lands —
        // keep null rather than a closed handle so `librarySub` truthiness
        // stays a reliable in-flight signal.
        const sub = swingAnalysisService
          .loadConfigs()
          .pipe(takeUntilDestroyed(destroyRef))
          .subscribe({
            next: (docs) => {
              librarySub = null;
              patchState(store, {
                configLibrary: docs,
                configLibraryLoading: false,
              });
            },
            error: (err: unknown) => {
              librarySub = null;
              const msg = err instanceof Error ? err.message : String(err);
              patchState(store, {
                configLibraryLoading: false,
                error: `Failed to load configs: ${msg}`,
              });
            },
          });
        librarySub = sub.closed ? null : sub;
      }

      /**
       * Shared bar-load + recompute helper. Cancels any in-flight bar load,
       * fetches bars for `symbol`, recomputes all configs, and patches the
       * store. `clearOnError` controls whether the error handler resets
       * derived state (setSymbol) or only sets `error` (config loads that
       * have already patched config).
       *
       * Reads `store.configs()` fresh inside the `next` handler to avoid
       * stale-config desync when config-list ops/`updateConfig` mutate
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
              const { pivots, projections, swings, stats } = recomputeAll(
                bars,
                configs,
                store.configEnabled(),
              );
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
       * doc loads — both recompute one slot while leaving the rest
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
       * kick off the bar load. Hoisted so config changes can run
       * it after patching configs (the in-flight bar load's recomputeAll
       * reads store.configs() fresh, so the N loaded slots are the ones
       * recomputed when bars arrive).
       */
      function applySymbol(symbol: string): void {
        const sym = String(symbol || '').trim().toUpperCase();
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
         * Reset the store to initial state (except configLibrary).
         * Called by the page on init to avoid stale data from prior visits.
         */
        resetState(): void {
          barsSub?.unsubscribe();
          barsSub = null;
          librarySub?.unsubscribe();
          librarySub = null;
          patchState(store, {
            symbol: '',
            configs: [{ ...LARGE_CONFIG }, { ...SMALL_CONFIG }],
            configEnabled: [true, true],
            bars: [],
            pivots: [[], []],
            projections: [null, null],
            swings: [[], []],
            stats: [null, null],
            loading: false,
            error: null,
            configLibrary: [],
            configLibraryLoading: false,
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
          // Disabled slots keep empty derived arrays — edit now, compute on re-enable.
          const slot = store.configEnabled()[index] === false
            ? {
                pivots: store.pivots().map((p, i) => (i === index ? [] : p)),
                projections: store
                  .projections()
                  .map((p, i) => (i === index ? null : p)),
                swings: store.swings().map((s, i) => (i === index ? [] : s)),
                stats: store.stats().map((s, i) => (i === index ? null : s)),
              }
            : recomputeSlot(index, store.bars(), newConfig);
          patchState(store, {
            configs: newConfigs,
            ...slot,
            error: null,
          });
        },

        /**
         * Append a config to the active list and recompute its slot from
         * loaded bars. Unbounded — any count is legal.
         */
        activateConfig(config: ZigZagConfig): void {
          const copy = { ...config };
          const bars = store.bars();
          const r = recompute(bars, copy);
          patchState(store, {
            configs: [...store.configs(), copy],
            configEnabled: [...store.configEnabled(), true],
            pivots: [...store.pivots(), r.pivots],
            projections: [...store.projections(), r.projection],
            swings: [...store.swings(), r.swings],
            stats: [...store.stats(), r.stats],
            error: null,
          });
        },

        /**
         * Remove the config at `index` and splice its derived arrays.
         * Index 0 is allowed — the list may shrink to zero.
         */
        removeActiveConfig(index: number): void {
          const configs = store.configs();
          if (index < 0 || index >= configs.length) return;
          const drop = <T>(arr: T[]) => arr.filter((_, i) => i !== index);
          patchState(store, {
            configs: drop(configs),
            configEnabled: drop(store.configEnabled()),
            pivots: drop(store.pivots()),
            projections: drop(store.projections()),
            swings: drop(store.swings()),
            stats: drop(store.stats()),
            error: null,
          });
        },

        /**
         * Append a deep copy of the config at `index` — the dialog's
         * Clone path. Recomputes the new slot from loaded bars.
         */
        cloneConfig(index: number): void {
          const configs = store.configs();
          if (index < 0 || index >= configs.length) return;
          const copy = { ...configs[index] };
          const copyEnabled = store.configEnabled()[index] ?? true;
          const r = copyEnabled
            ? recompute(store.bars(), copy)
            : { pivots: [] as Pivot[], projection: null, swings: [] as Swing[], stats: null };
          patchState(store, {
            configs: [...configs, copy],
            configEnabled: [...store.configEnabled(), copyEnabled],
            pivots: [...store.pivots(), r.pivots],
            projections: [...store.projections(), r.projection],
            swings: [...store.swings(), r.swings],
            stats: [...store.stats(), r.stats],
            error: null,
          });
        },

        /**
         * Replace the active list with a library doc's configs — the
         * Saved-set apply path. Singles apply as a one-element replace
         * too (same code path). Recomputes every config from loaded bars.
         */
        applyConfigSet(doc: SwingConfigDoc): void {
          const members = docConfigs(doc);
          if (!members.length) return;
          const configs = members.map((c) => ({ ...c }));
          const rs = configs.map((c) => recompute(store.bars(), c));
          patchState(store, {
            configs,
            configEnabled: configs.map(() => true),
            pivots: rs.map((r) => r.pivots),
            projections: rs.map((r) => r.projection),
            swings: rs.map((r) => r.swings),
            stats: rs.map((r) => r.stats),
            error: null,
          });
        },

        /**
         * Persist the whole active list as a config SET —
         * st-swing-configs keyed by the joined member paramsIds. An empty
         * active list is a no-op. Upserts the library row in place.
         */
        saveActiveSet(): void {
          const configs = store.configs();
          if (!configs.length) return;
          const paramsId = deriveSetParamsId(configs);
          const input: SwingConfigInput = {
            configs: configs.map((c) => ({ ...c })),
            savedAt: new Date().toISOString(),
          };
          swingAnalysisService
            .saveConfig(input)
            .pipe(takeUntilDestroyed(destroyRef))
            .subscribe({
              next: () => {
                const doc: SwingConfigDoc = {
                  id: paramsId,
                  paramsId,
                  userId: '',
                  configs: input.configs,
                  savedAt: input.savedAt,
                };
                const rest = store
                  .configLibrary()
                  .filter((c) => c.paramsId !== paramsId);
                patchState(store, { configLibrary: [...rest, doc], error: null });
                if (librarySub) refreshLibrary();
              },
              error: (err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(
                  '[SwingAnalysisStore] Failed to save config set',
                  paramsId,
                  err,
                );
                patchState(store, { error: `Failed to save config set: ${msg}` });
              },
            });
        },

        /** Duplicate every active config — appends a full copy of the list. */
        cloneAllConfigs(): void {
          const configs = store.configs();
          if (!configs.length) return;
          const copies = configs.map((c) => ({ ...c }));
          const flags = store.configEnabled();
          const rs = copies.map((c, i) =>
            flags[i] === false
              ? { pivots: [] as Pivot[], projection: null, swings: [] as Swing[], stats: null }
              : recompute(store.bars(), c),
          );
          patchState(store, {
            configs: [...configs, ...copies],
            configEnabled: [...store.configEnabled(), ...store.configEnabled()],
            pivots: [...store.pivots(), ...rs.map((r) => r.pivots)],
            projections: [...store.projections(), ...rs.map((r) => r.projection)],
            swings: [...store.swings(), ...rs.map((r) => r.swings)],
            stats: [...store.stats(), ...rs.map((r) => r.stats)],
            error: null,
          });
        },

        /** Clear the whole active list — derived arrays empty alongside. */
        clearActiveConfigs(): void {
          patchState(store, {
            configs: [],
            configEnabled: [],
            pivots: [],
            projections: [],
            swings: [],
            stats: [],
            error: null,
          });
        },

        /**
         * Flip the runtime-only enabled flag for config `index`. Off →
         * the slot's derived arrays are zeroed (nothing renders, no
         * compute on later bar loads); on → the slot recomputes from the
         * loaded bars. The flag is never persisted — saved configs are
         * params only.
         */
        toggleActiveConfig(index: number): void {
          const flags = store.configEnabled();
          if (index < 0 || index >= flags.length) return;
          const nowEnabled = !(flags[index] ?? true);
          const next = flags.map((f, i) => (i === index ? nowEnabled : f));
          const derived = nowEnabled
            ? recomputeSlot(index, store.bars(), store.configs()[index])
            : {
                pivots: store.pivots().map((p, i) => (i === index ? [] : p)),
                projections: store
                  .projections()
                  .map((p, i) => (i === index ? null : p)),
                swings: store.swings().map((s, i) => (i === index ? [] : s)),
                stats: store.stats().map((s, i) => (i === index ? null : s)),
              };
          patchState(store, { configEnabled: next, ...derived, error: null });
        },

        /**
         * Persist the active config at `index` to the config library
         * (st-swing-configs/{paramsId}) and upsert the library row —
         * re-saves overwrite in place, no duplicate paramsId entries.
         */
        saveActiveConfig(index: number, name?: string): void {
          const config = store.configs()[index];
          if (!config) return;
          const paramsId = deriveParamsId(config);
          const input = {
            name: name?.trim() || undefined,
            config,
            savedAt: new Date().toISOString(),
          };
          swingAnalysisService
            .saveConfig(input)
            .pipe(takeUntilDestroyed(destroyRef))
            .subscribe({
              next: () => {
                const doc: SwingConfigDoc = {
                  id: paramsId,
                  paramsId,
                  userId: '',
                  name: input.name,
                  config,
                  savedAt: input.savedAt,
                };
                const rest = store
                  .configLibrary()
                  .filter((c) => c.paramsId !== paramsId);
                patchState(store, { configLibrary: [...rest, doc], error: null });
                // An in-flight library load may carry a pre-write snapshot
                // that would clobber this row when it lands — refire it.
                if (librarySub) refreshLibrary();
              },
              error: (err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(
                  '[SwingAnalysisStore] Failed to save config',
                  paramsId,
                  err,
                );
                patchState(store, { error: `Failed to save config: ${msg}` });
              },
            });
        },

        /**
         * Rename a saved library doc — same paramsId upsert, only the
         * `name` field changes. `undefined` clears the name so the row
         * falls back to the param summary.
         */
        renameSavedConfig(doc: SwingConfigDoc, name: string | undefined): void {
          const input = {
            name,
            config: doc.config,
            configs: doc.configs,
            savedAt: doc.savedAt,
            paramsId: doc.paramsId, // target the stored doc, don't re-derive
          };
          swingAnalysisService
            .saveConfig(input)
            .pipe(takeUntilDestroyed(destroyRef))
            .subscribe({
              next: () => {
                patchState(store, {
                  configLibrary: store
                    .configLibrary()
                    .map((c) =>
                      c.paramsId === doc.paramsId ? { ...c, name } : c,
                    ),
                  error: null,
                });
                if (librarySub) refreshLibrary();
              },
              error: (err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(
                  '[SwingAnalysisStore] Failed to rename config',
                  doc.paramsId,
                  err,
                );
                patchState(store, { error: `Failed to rename config: ${msg}` });
              },
            });
        },

        /**
         * Delete a library doc by paramsId and drop it from the list.
         * Active configs are unaffected — the library is independent.
         */
        deleteSavedConfig(paramsId: string): void {
          if (!paramsId) return;
          swingAnalysisService
            .deleteConfig(paramsId)
            .pipe(takeUntilDestroyed(destroyRef))
            .subscribe({
              next: () => {
                patchState(store, {
                  configLibrary: store
                    .configLibrary()
                    .filter((c) => c.paramsId !== paramsId),
                  error: null,
                });
                // Same stale-snapshot hazard as saveActiveConfig — refire.
                if (librarySub) refreshLibrary();
              },
              error: (err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(
                  '[SwingAnalysisStore] Failed to delete config',
                  paramsId,
                  err,
                );
                patchState(store, { error: `Failed to delete config: ${msg}` });
              },
            });
        },

        /**
         * Populate `configLibrary` — the dialog's saved-config source.
         * Lazy: called when the dialog opens, never on page init.
         * In-flight re-entry is ignored.
         */
        loadConfigLibrary(): void {
          if (store.configLibraryLoading()) return;
          refreshLibrary();
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
