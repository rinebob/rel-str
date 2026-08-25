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

import type { BacktestPermutationUi, BacktestRunUi, BacktestStrategyMetadata, StartBacktestRequest } from '../common/backtest.types';
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

/**
 * Build a readable error message from a callable or runtime failure.
 * Firebase callable errors expose the original server message in `details`.
 */
function buildBacktestErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const details = (err as { details?: unknown }).details;
    if (details) {
      const detailText = typeof details === 'string' ? details : JSON.stringify(details);
      return `${err.message} — ${detailText}`;
    }
    return err.message;
  }
  return String(err ?? 'Unknown error');
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
      stopPatch: Partial<BacktestRunState>
    ): Subscription {
      patchState(state, startPatch);

      return source.pipe(
        catchError((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error(`[BacktestRunStore] Failed to stream ${label}`, err);
          const message = buildBacktestErrorMessage(err);
          snackBar.open(`Failed to stream ${label}: ${message}`, 'Dismiss', { duration: 30000 });
          return of<T[]>([]);
        }),
        takeUntilDestroyed(destroyRef),
      ).subscribe({
        next: (value: T[]) => {
          onValue(value);
          patchState(state, stopPatch);
        },
        error: () => {
          patchState(state, stopPatch);
        },
        complete: () => {
          patchState(state, stopPatch);
        },
      });
    }

    function loadPermutations(runId: string | null): void {
      permutationsSubscription?.unsubscribe();
      permutationsSubscription = null;
      if (!runId) {
        patchState(state, { permutations: [], permutationsStreaming: false });
        return;
      }

      permutationsSubscription = watchStream(
        'permutations',
        runService.watchPermutations(runId),
        (permutations) => patchState(state, { permutations }),
        { permutationsStreaming: true },
        { permutationsStreaming: false }
      );
    }

    return {
      /** Load strategy metadata once. */
      loadStrategies(): void {
        runService.listStrategies().pipe(
          catchError((err: unknown) => {
            // eslint-disable-next-line no-console
            console.error('[BacktestRunStore] loadStrategies failed', err);
            const message = buildBacktestErrorMessage(err);
            snackBar.open(`Failed to load strategies: ${message}`, 'Dismiss', { duration: 30000 });
            return of<BacktestStrategyMetadata[]>([]);
          }),
          takeUntilDestroyed(destroyRef)
        ).subscribe((strategies) => {
          patchState(state, { strategies });
        });
      },

      /** Start a realtime listener for backtest runs. Idempotent. */
      loadRuns(): void {
        if (runsSubscription) return;

        runsSubscription = watchStream(
          'runs',
          runService.watchRuns(50),
          (runs) => patchState(state, { runs }),
          { isLoading: true, runsStreaming: true },
          { isLoading: false, runsStreaming: false }
        );
      },

      /** Start a new backtest run and select it when the callable succeeds. */
      startRun(request: StartBacktestRequest): void {
        patchState(state, { isLoading: true });

        runService
          .startRun(request)
          .pipe(
            catchError((err: unknown) => {
              // eslint-disable-next-line no-console
              console.error('[BacktestRunStore] startRun failed', err);
              const message = buildBacktestErrorMessage(err);
              snackBar.open(`Failed to start backtest: ${message}`, 'Dismiss', { duration: 30000 });
              patchState(state, { isLoading: false });
              return of(null);
            }),
            takeUntilDestroyed(destroyRef)
          )
          .subscribe((response) => {
            patchState(state, { isLoading: false });
            if (response) {
              snackBar.open(`Backtest started: ${response.runId}`, 'Dismiss', { duration: 30000 });
              patchState(state, { selectedRunId: response.runId });
              loadPermutations(response.runId);
            }
          });
      },

      /** Select a run for detail/summary panels and start streaming its permutations. */
      selectRun(runId: string | null): void {
        patchState(state, { selectedRunId: runId });
        loadPermutations(runId);
      },
    };
  })
);
