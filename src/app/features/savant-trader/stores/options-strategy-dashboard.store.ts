/**
 * Signal-based store for the options strategy dashboard. Holds positions,
 * equity curve, stats, and loading/error state. Follows the existing
 * StStore pattern with NgRx SignalStore.
 *
 * Stats + equity curve read the canonical `getPaperStats` rollup docs
 * (#1564): a Population selector picks the scope family and the
 * instance selector narrows to `inst-{id}` under Strategies. Position
 * tables stay strategy-only by design.
 */

import { computed, inject, DestroyRef } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, finalize, of, Subscription } from 'rxjs';
import { DsToastService } from '../../../shared/ds/ds-toast.service';


import { OptionsStrategyService } from '../services/options-strategy.service';
import { PaperTradingService } from '../services/paper-trading.service';
import type { Position } from '../services/options-strategy.types';
import { PaperTradeSource, type PaperStats, type EquityCurvePoint } from '@paper-trading/contracts';
import { statsScopeAll, statsScopeInstance, statsScopeSource } from '@paper-trading/ids';

// ── State ────────────────────────────────────────────────────────────────────

export type StatsPopulation = 'ALL' | 'STRATEGY' | 'SIGNAL';

export interface OptionsStrategyDashboardState {
  /** Selected instance filter (null = combined strategy scope). */
  selectedInstanceId: string | null;
  /** Stats population — which scope family feeds the stat cards + curve. */
  selectedPopulation: StatsPopulation;
  openPositions: Position[];
  closedPositions: Position[];
  equityCurve: EquityCurvePoint[];
  stats: PaperStats | null;
  isLoadingPositions: boolean;
  isLoadingStats: boolean;
  error: string | null;
}

const initialState: OptionsStrategyDashboardState = {
  selectedInstanceId: null,
  selectedPopulation: 'STRATEGY',
  openPositions: [],
  closedPositions: [],
  equityCurve: [],
  stats: null,
  isLoadingPositions: false,
  isLoadingStats: false,
  error: null,
};

// ── Store ────────────────────────────────────────────────────────────────────

export const OptionsStrategyDashboardStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withComputed((state) => ({
    /** True when either positions or equity curve is loading. */
    isLoading: computed(
      () => state.isLoadingPositions() || state.isLoadingStats(),
    ),

    /**
     * True when there is no data at all (day one, before first scheduled
     * run). Positions + curve only — a stats doc may carry counters
     * without an equityCurve under non-STRATEGY populations.
     */
    isEmpty: computed(
      () =>
        state.openPositions().length === 0 &&
        state.closedPositions().length === 0 &&
        state.equityCurve().length === 0,
    ),

    /**
     * Canonical stats-doc scope for the current population + instance.
     * `inst-{id}` only applies under STRATEGY; other populations ignore
     * the retained instance selection.
     */
    statsScope: computed(() => {
      if (state.selectedPopulation() === 'STRATEGY') {
        const id = state.selectedInstanceId();
        return id ? statsScopeInstance(id) : statsScopeSource(PaperTradeSource.STRATEGY);
      }
      return state.selectedPopulation() === 'SIGNAL'
        ? statsScopeSource(PaperTradeSource.SIGNAL)
        : statsScopeAll();
    }),

    /** Open-trade count from the stats doc for the stat strip. */
    openCount: computed(() => state.stats()?.openTradeCount ?? 0),

    /** Closed-trade count from the stats doc for the stat strip. */
    closedCount: computed(() => state.stats()?.closedTradeCount ?? 0),

    /** Max drawdown from stats, formatted for display. */
    maxDrawdown: computed(() => state.stats()?.maxDrawdown ?? 0),

    /** Unique instance IDs derived from loaded positions, for the scope toggle. */
    availableInstances: computed(() => {
      const all = [...state.openPositions(), ...state.closedPositions()];
      const ids = new Set(all.map((p) => p.instanceId));
      return [...ids].sort();
    }),
  })),

  withMethods(
    (
      state,
      service = inject(OptionsStrategyService),
      paperService = inject(PaperTradingService),
      snackBar = inject(DsToastService),
      destroyRef = inject(DestroyRef),
    ) => {
      // Track in-flight subscriptions so we can cancel before starting new ones.
      let positionsSub: Subscription | null = null;
      let statsSub: Subscription | null = null;

      return {
        /**
         * Load positions from the backend, splitting into open/closed arrays.
         * Uses the current selectedInstanceId filter. Cancels any previous
         * in-flight positions request to prevent stale state corruption.
         */
        loadPositions(): void {
          positionsSub?.unsubscribe();
          patchState(state, { isLoadingPositions: true, error: null });
          const instanceId = state.selectedInstanceId() ?? undefined;

          positionsSub = service
            .listStrategyPositions$({ instanceId })
            .pipe(
              catchError((err) => {
                const msg = err?.code === 'unauthenticated'
                  ? 'Authentication required to view positions'
                  : 'Failed to load positions';
                patchState(state, { error: msg });
                snackBar.open(msg, 'Dismiss', { duration: 5000 });
                return of({ openPositions: [], closedPositions: [] });
              }),
              finalize(() => patchState(state, { isLoadingPositions: false })),
              takeUntilDestroyed(destroyRef),
            )
            .subscribe({
              next: (response) =>
                patchState(state, {
                  openPositions: response.openPositions,
                  closedPositions: response.closedPositions,
                }),
            });
        },

        /**
         * Load the stats doc + equity curve for the current population scope
         * from the canonical getPaperStats rollup. An absent scope doc
         * (pre-first-nightly-pass) yields `stats: []` — empty state, no error.
         * Cancels any previous in-flight stats request.
         */
        loadStats(): void {
          statsSub?.unsubscribe();
          patchState(state, { isLoadingStats: true, error: null });
          statsSub = paperService
            .getPaperStats$({ scope: state.statsScope() })
            .pipe(
              catchError((err) => {
                const msg = err?.code === 'unauthenticated'
                  ? 'Authentication required to view stats'
                  : 'Failed to load stats';
                patchState(state, { error: msg });
                snackBar.open(msg, 'Dismiss', { duration: 5000 });
                return of({ stats: [] });
              }),
              finalize(() => patchState(state, { isLoadingStats: false })),
              takeUntilDestroyed(destroyRef),
            )
            .subscribe({
              next: (response) => {
                const stats = response.stats[0] ?? null;
                patchState(state, {
                  stats,
                  equityCurve: stats?.equityCurve ?? [],
                });
              },
            });
        },

        /**
         * Load both positions and stats in parallel.
         */
        loadAll(): void {
          this.loadPositions();
          this.loadStats();
        },

        /**
         * Set the instance filter and refetch data.
         * Pass null for the combined strategy scope. Cancels previous requests.
         * The instanceId also filters the position tables — under
         * non-STRATEGY populations it still applies there even though it
         * no longer feeds the stats scope.
         */
        selectInstance(instanceId: string | null): void {
          patchState(state, { selectedInstanceId: instanceId });
          this.loadAll();
        },

        /**
         * Set the stats population (ALL / STRATEGY / SIGNAL) and refetch.
         * The instance selection is retained: it feeds the stats scope
         * only under STRATEGY, but keeps filtering the position tables
         * regardless.
         */
        selectPopulation(population: StatsPopulation): void {
          patchState(state, { selectedPopulation: population });
          this.loadAll();
        },
      };
    },
  ),
);
