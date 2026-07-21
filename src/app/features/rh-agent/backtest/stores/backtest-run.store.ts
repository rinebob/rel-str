/**
 * Backtest Run Store
 *
 * NgRx SignalStore that owns backtest run data, realtime streaming, and
 * strategy metadata. The UI store (BacktestUiStore) reads from this store
 * and applies filters/sorting.
 */
import { inject, computed, DestroyRef } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of, catchError, Subscription } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';

import type { BacktestRunUi, BacktestStrategyMetadata } from '../common/backtest.types';
import { BacktestRunService } from '../services/backtest-run.service';

export interface BacktestRunState {
  runs: BacktestRunUi[];
  strategies: BacktestStrategyMetadata[];
  selectedRunId: string | null;
  isLoading: boolean;
  runsStreaming: boolean;
}

const initialState: BacktestRunState = {
  runs: [],
  strategies: [],
  selectedRunId: null,
  isLoading: false,
  runsStreaming: false,
};

export const BacktestRunStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withComputed((state) => ({
    /** The currently selected run, if any. */
    selectedRun: computed(() => {
      const id = state.selectedRunId();
      return id ? state.runs().find((r) => r.runId === id) ?? null : null;
    }),

    /** The most recent run by createdAt (Firestore query is ordered desc). */
    latestRun: computed(() => state.runs()[0] ?? null),

    /** Strategy options for filter dropdowns. */
    strategyOptions: computed(() =>
      state.strategies().map((s) => ({ id: s.id, name: s.name }))
    ),
  })),

  withMethods((state, runService = inject(BacktestRunService), snackBar = inject(MatSnackBar), destroyRef = inject(DestroyRef)) => {
    let runsSubscription: Subscription | null = null;

    return {
      /** Load strategy metadata once. */
      loadStrategies(): void {
        runService.listStrategies().pipe(
          catchError((err: unknown) => {
            const message = err instanceof Error ? err.message : 'Unknown error';
            snackBar.open(`Failed to load strategies: ${message}`, 'Dismiss', { duration: 5000 });
            return of([]);
          }),
          takeUntilDestroyed(destroyRef)
        ).subscribe((strategies) => {
          patchState(state, { strategies });
        });
      },

      /** Start a realtime listener for backtest runs. Idempotent. */
      loadRuns(): void {
        if (runsSubscription) return;

        patchState(state, { isLoading: true, runsStreaming: true });

        runsSubscription = runService.watchRuns(50).pipe(
          catchError((err: unknown) => {
            const message = err instanceof Error ? err.message : 'Unknown error';
            snackBar.open(`Failed to stream runs: ${message}`, 'Dismiss', { duration: 5000 });
            return of([]);
          }),
          takeUntilDestroyed(destroyRef),
        ).subscribe({
          next: (runs) => patchState(state, { runs, isLoading: false }),
          error: () => {
            runsSubscription = null;
            patchState(state, { runsStreaming: false, isLoading: false });
          },
          complete: () => {
            runsSubscription = null;
            patchState(state, { runsStreaming: false, isLoading: false });
          },
        });
      },

      /** Select a run for detail/summary panels. */
      selectRun(runId: string | null): void {
        patchState(state, { selectedRunId: runId });
      },
    };
  })
);
