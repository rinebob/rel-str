/**
 * Savant Trader SignalStore
 *
 * Manages agent state, runs, and signals using NgRx Signals.
 */
import { inject, computed, DestroyRef } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of, catchError, finalize, map, Subscription } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';

import {
  type StStatus,
  type StRun,
} from '../services/types';
import { RunService } from '../services/run.service';

// State interface
export interface StState {
  status: StStatus | null;
  runs: StRun[];
  isLoading: boolean;
  runsStreaming: boolean;
}

// Initial state
const initialState: StState = {
  status: null,
  runs: [],
  isLoading: false,
  runsStreaming: false,
};

export const StStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  // Computed signals
  withComputed((state) => ({
    /** True if any status or run data has been loaded. */
    hasData: computed(() => state.runs().length > 0 || state.status() !== null),

    /** The most recent run from the run history. */
    latestRun: computed(() => state.runs()[0] || null),

    /** The latest completed actionable run (SUCCESS or PARTIAL with a completedAt timestamp). */
    latestCompletedRun: computed(() => {
      const runs = state.runs();
      const status = (r: StRun) => r.status?.toUpperCase();
      return (
        runs.find((r) => {
          const s = status(r);
          return (s === 'SUCCESS' || s === 'PARTIAL') && !!r.completedAt;
        }) ?? null
      );
    }),

    /** Number of symbols currently enabled for monitoring. */
    symbolCount: computed(() => state.status()?.symbolsMonitored?.length || 0),
  })),

  // Methods
  withMethods((state, runService = inject(RunService), snackBar = inject(MatSnackBar), destroyRef = inject(DestroyRef)) => {
    let runsSubscription: Subscription | null = null;

    return {
    /**
     * Load status and start a realtime listener for runs.
     * The listener stays active until the store is destroyed.
     */
    loadData(): void {
      patchState(state, { isLoading: true });

      // Load status once
      runService.getStatus().pipe(
        catchError(() => {
          snackBar.open('Failed to load status', 'Dismiss', { duration: 5000 });
          return of(null);
        }),
        takeUntilDestroyed(destroyRef),
        finalize(() => patchState(state, { isLoading: false }))
      ).subscribe({
        next: (status) => patchState(state, { status }),
      });

      // Start realtime runs stream (idempotent â€” only one listener at a time)
      if (!runsSubscription) {
        patchState(state, { runsStreaming: true });
        runsSubscription = runService.watchRecentRunsRealtime(100).pipe(
          map((runs) => runs.filter((r) => r.triggeredBy !== 'symbol-added')),
          catchError(() => {
            snackBar.open('Failed to stream runs', 'Dismiss', { duration: 5000 });
            return of([]);
          }),
          takeUntilDestroyed(destroyRef),
        ).subscribe({
          next: (runs) => patchState(state, { runs }),
          error: () => patchState(state, { runsStreaming: false }),
          complete: () => patchState(state, { runsStreaming: false }),
        });
      }
    },

    /**
     * Refresh status only â€” runs update automatically via the realtime listener.
     */
    refreshStatus(): void {
      patchState(state, { isLoading: true });
      runService.getStatus().pipe(
        catchError(() => {
          snackBar.open('Failed to load status', 'Dismiss', { duration: 5000 });
          return of(null);
        }),
        takeUntilDestroyed(destroyRef),
        finalize(() => patchState(state, { isLoading: false }))
      ).subscribe({
        next: (status) => patchState(state, { status }),
      });
    },

    /**
     * Trigger a manual agent run via the stManualRun callable.
     * Enqueues Cloud Tasks like the PDR scheduler; workers process asynchronously.
     * @param date Optional market date override (YYYY-MM-DD).
     */
    triggerManualRun(date?: string): void {
      patchState(state, { isLoading: true });

      runService.triggerManualRun(date ? { date } : {})
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (result) => {
            snackBar.open(
              `Run ${result.runId} started: ${result.enqueued} symbols enqueued`,
              'Dismiss',
              { duration: 5000 }
            );
            patchState(state, { isLoading: false });
          },
          error: (err: unknown) => {
            const message = err instanceof Error ? err.message : 'Unknown error';
            snackBar.open(`Run failed: ${message}`, 'Dismiss', { duration: 5000 });
            patchState(state, { isLoading: false });
          },
        });
    },

    /**
     * Trigger the symbol-data backfill callable for all enabled symbols.
     * Displays a snackbar with the total enqueued and error counts.
     */
    triggerBarsBackfill(): void {
      snackBar.open('Starting bars backfill for all symbolsâ€¦', 'Dismiss', { duration: 4000 });
      runService.triggerBarsBackfill()
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (result) => {
            snackBar.open(`Bars backfill done: ${result.enqueued} ok, ${result.errors} errors`, 'Dismiss', { duration: 8000 });
          },
          error: (err: unknown) => {
            const message = err instanceof Error ? err.message : 'Unknown error';
            snackBar.open(`Bars backfill failed: ${message}`, 'Dismiss', { duration: 6000 });
          },
        });
    },

    };
  })
);
