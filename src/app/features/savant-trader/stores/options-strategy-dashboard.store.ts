/**
 * Signal-based store for the options strategy dashboard. Holds positions,
 * equity curve, stats, and loading/error state. Follows the existing
 * StStore pattern with NgRx SignalStore.
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
import { MatSnackBar } from '@angular/material/snack-bar';

import { OptionsStrategyService } from '../services/options-strategy.service';
import type {
  Position,
  StrategyStats,
  EquityCurvePoint,
} from '../services/options-strategy.types';

// ── State ────────────────────────────────────────────────────────────────────

export interface OptionsStrategyDashboardState {
  /** Selected instance filter (null = combined ALL scope). */
  selectedInstanceId: string | null;
  openPositions: Position[];
  closedPositions: Position[];
  equityCurve: EquityCurvePoint[];
  stats: StrategyStats | null;
  isLoadingPositions: boolean;
  isLoadingEquityCurve: boolean;
  error: string | null;
}

const initialState: OptionsStrategyDashboardState = {
  selectedInstanceId: null,
  openPositions: [],
  closedPositions: [],
  equityCurve: [],
  stats: null,
  isLoadingPositions: false,
  isLoadingEquityCurve: false,
  error: null,
};

// ── Store ────────────────────────────────────────────────────────────────────

export const OptionsStrategyDashboardStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withComputed((state) => ({
    /** True when either positions or equity curve is loading. */
    isLoading: computed(
      () => state.isLoadingPositions() || state.isLoadingEquityCurve(),
    ),

    /** True when there is no data at all (day one, before first scheduled run). */
    isEmpty: computed(
      () =>
        state.openPositions().length === 0 &&
        state.closedPositions().length === 0 &&
        state.equityCurve().length === 0,
    ),

    /** Count of open positions for the stat strip. */
    openCount: computed(() => state.openPositions().length),

    /** Count of closed positions for the stat strip. */
    closedCount: computed(() => state.closedPositions().length),

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
      snackBar = inject(MatSnackBar),
      destroyRef = inject(DestroyRef),
    ) => {
      // Track in-flight subscriptions so we can cancel before starting new ones.
      let positionsSub: Subscription | null = null;
      let equitySub: Subscription | null = null;

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
         * Load the equity curve + stats for the current scope.
         * Uses selectedInstanceId (null → ALL scope). Cancels any previous
         * in-flight equity curve request.
         */
        loadEquityCurve(): void {
          equitySub?.unsubscribe();
          patchState(state, { isLoadingEquityCurve: true, error: null });
          const instanceId = state.selectedInstanceId() ?? undefined;

          equitySub = service
            .getStrategyEquityCurve$({ instanceId })
            .pipe(
              catchError((err) => {
                const msg = err?.code === 'unauthenticated'
                  ? 'Authentication required to view equity curve'
                  : 'Failed to load equity curve';
                patchState(state, { error: msg });
                snackBar.open(msg, 'Dismiss', { duration: 5000 });
                return of({ points: [], stats: null });
              }),
              finalize(() => patchState(state, { isLoadingEquityCurve: false })),
              takeUntilDestroyed(destroyRef),
            )
            .subscribe({
              next: (response) =>
                patchState(state, {
                  equityCurve: response.points,
                  stats: response.stats,
                }),
            });
        },

        /**
         * Load both positions and equity curve in parallel.
         */
        loadAll(): void {
          this.loadPositions();
          this.loadEquityCurve();
        },

        /**
         * Set the instance filter and refetch data.
         * Pass null for the combined ALL scope. Cancels previous requests.
         */
        selectInstance(instanceId: string | null): void {
          patchState(state, { selectedInstanceId: instanceId });
          this.loadAll();
        },
      };
    },
  ),
);
