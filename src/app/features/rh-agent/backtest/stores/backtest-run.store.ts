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
import { of, catchError, Subscription, Observable } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';

import type { BacktestPermutationUi, BacktestRunUi, BacktestStrategyMetadata } from '../common/backtest.types';
import { BacktestRunService } from '../services/backtest-run.service';

export interface BacktestRunState {
  runs: BacktestRunUi[];
  strategies: BacktestStrategyMetadata[];
  selectedRunId: string | null;
  permutations: BacktestPermutationUi[];
  isLoading: boolean;
  runsStreaming: boolean;
  permutationsStreaming: boolean;
}

const initialState: BacktestRunState = {
  runs: [],
  strategies: [],
  selectedRunId: null,
  permutations: [],
  isLoading: false,
  runsStreaming: false,
  permutationsStreaming: false,
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
    let permutationsSubscription: Subscription | null = null;

    function watchStream<T>(
      label: string,
      source: Observable<T[]>,
      onValue: (value: T[]) => void,
      startPatch: Partial<BacktestRunState>,
      stopPatch: Partial<BacktestRunState>,
      subscriptionRef: { current: Subscription | null }
    ): void {
      subscriptionRef.current?.unsubscribe();
      subscriptionRef.current = null;
      patchState(state, startPatch);

      subscriptionRef.current = source.pipe(
        catchError((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Unknown error';
          snackBar.open(`Failed to stream ${label}: ${message}`, 'Dismiss', { duration: 5000 });
          return of([] as unknown as T[]);
        }),
        takeUntilDestroyed(destroyRef),
      ).subscribe({
        next: (value: T[]) => {
          onValue(value);
          patchState(state, stopPatch);
        },
        error: () => {
          subscriptionRef.current = null;
          patchState(state, stopPatch);
        },
        complete: () => {
          subscriptionRef.current = null;
          patchState(state, stopPatch);
        },
      });
    }

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

        watchStream(
          'runs',
          runService.watchRuns(50),
          (runs) => patchState(state, { runs }),
          { isLoading: true, runsStreaming: true },
          { isLoading: false, runsStreaming: false },
          { get current() { return runsSubscription; }, set current(value) { runsSubscription = value; } }
        );
      },

      /** Select a run for detail/summary panels and start streaming its permutations. */
      selectRun(runId: string | null): void {
        patchState(state, { selectedRunId: runId });
        this.loadPermutations(runId);
      },

      /** Start a realtime listener for the selected run's permutations. */
      loadPermutations(runId: string | null): void {
        if (!runId) {
          permutationsSubscription?.unsubscribe();
          permutationsSubscription = null;
          patchState(state, { permutations: [], permutationsStreaming: false });
          return;
        }

        watchStream(
          'permutations',
          runService.watchPermutations(runId),
          (permutations) => patchState(state, { permutations }),
          { permutationsStreaming: true },
          { permutationsStreaming: false },
          { get current() { return permutationsSubscription; }, set current(value) { permutationsSubscription = value; } }
        );
      },
    };
  })
);
