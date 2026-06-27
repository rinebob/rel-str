/**
 * RH Agent SignalStore
 *
 * Manages agent state, runs, and signals using NgRx Signals.
 */
import { inject, computed, Injectable, DestroyRef } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';

import {
  RhAgentService,
  RhAgentStatus,
  RhAgentRun,
} from '../services/rh-agent.service';

// State interface
export interface RhAgentState {
  status: RhAgentStatus | null;
  runs: RhAgentRun[];
  isLoading: boolean;
}

// Initial state
const initialState: RhAgentState = {
  status: null,
  runs: [],
  isLoading: false,
};

export const RhAgentStore = signalStore(
  withState(initialState),

  // Computed signals
  withComputed((state) => ({
    // Check if we have any data
    hasData: computed(() => state.runs().length > 0 || state.status() !== null),

    // Get latest run
    latestRun: computed(() => state.runs()[0] || null),

    // Count of monitored symbols
    symbolCount: computed(() => state.status()?.symbolsMonitored?.length || 0),
  })),

  // Methods
  withMethods((state, service = inject(RhAgentService), snackBar = inject(MatSnackBar), destroyRef = inject(DestroyRef)) => ({
    /**
     * Load dashboard data (status + runs)
     */
    loadData(): void {
      console.log('[RH Agent Store] loadData() called');
      patchState(state, { isLoading: true });

      let completedCalls = 0;
      const totalCalls = 2;

      const checkComplete = () => {
        completedCalls++;
        if (completedCalls >= totalCalls) {
          patchState(state, { isLoading: false });
        }
      };

      // Load status
      service
        .getStatus()
        .pipe(takeUntilDestroyed(destroyRef), finalize(checkComplete))
        .subscribe({
          next: (status) => patchState(state, { status }),
          error: (err) => {
            console.error('[RH Agent Store] Failed to load status:', err);
            snackBar.open('Failed to load status', 'Dismiss', { duration: 5000 });
          },
        });

      // Load runs
      service
        .getRunHistory(20)
        .pipe(takeUntilDestroyed(destroyRef), finalize(checkComplete))
        .subscribe({
          next: (runs) => patchState(state, { runs }),
          error: (err) => {
            console.error('[RH Agent Store] Failed to load runs:', err);
            snackBar.open('Failed to load runs', 'Dismiss', { duration: 5000 });
          },
        });
    },

    /**
     * Trigger a manual agent run
     * Now enqueues Cloud Tasks like the scheduler - async processing
     */
    triggerManualRun(date?: string): void {
      console.log('[RH Agent Store] triggerManualRun called', { date });
      patchState(state, { isLoading: true });

      service
        .triggerManualRun(date ? { date } : {})
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (result) => {
            console.log('[RH Agent Store] Manual run enqueued:', result);
            snackBar.open(
              `Run ${result.runId} started: ${result.enqueued} symbols enqueued`,
              'Dismiss',
              { duration: 5000 }
            );
            // Keep loading state active - workers are processing asynchronously
            // Reload data after a short delay to show initial progress
            setTimeout(() => {
              this.loadData();
            }, 2000);
          },
          error: (err) => {
            console.error('[RH Agent Store] Manual run failed:', err);
            snackBar.open(`Run failed: ${err.message}`, 'Dismiss', { duration: 5000 });
            patchState(state, { isLoading: false });
          },
        });
    },

    triggerBarsBackfill(): void {
      snackBar.open('Starting bars backfill for all symbols…', 'Dismiss', { duration: 4000 });
      service.triggerBarsBackfill()
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (result) => {
            console.log('[RH Agent Store] Bars backfill complete:', result);
            snackBar.open(`Bars backfill done: ${result.ok} ok, ${result.errors} errors`, 'Dismiss', { duration: 8000 });
          },
          error: (err) => {
            console.error('[RH Agent Store] Bars backfill failed:', err);
            snackBar.open(`Bars backfill failed: ${err.message}`, 'Dismiss', { duration: 6000 });
          },
        });
    },

  }))
);
