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
  RhTradeSignal,
} from './rh-agent.service';

// State interface
export interface RhAgentState {
  status: RhAgentStatus | null;
  runs: RhAgentRun[];
  signals: RhTradeSignal[];
  isLoading: boolean;
}

// Initial state
const initialState: RhAgentState = {
  status: null,
  runs: [],
  signals: [],
  isLoading: false,
};

export const RhAgentStore = signalStore(
  withState(initialState),

  // Computed signals
  withComputed((state) => ({
    // Group signals by run ID for easy lookup
    signalsByRun: computed(() => {
      const map = new Map<string, RhTradeSignal[]>();
      for (const signal of state.signals()) {
        const existing = map.get(signal.runId) || [];
        existing.push(signal);
        map.set(signal.runId, existing);
      }
      return map;
    }),

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
     * Load all dashboard data (status, runs, signals)
     */
    loadData(): void {
      console.log('[RH Agent Store] loadData() called');
      patchState(state, { isLoading: true });

      let completedCalls = 0;
      const totalCalls = 3;

      const checkComplete = () => {
        completedCalls++;
        console.log(`[RH Agent Store] API call completed (${completedCalls}/${totalCalls})`);
        if (completedCalls >= totalCalls) {
          patchState(state, { isLoading: false });
          console.log('[RH Agent Store] All API calls complete');
          console.log('[RH Agent Store] Final state - runs:', state.runs().length, 'signals:', state.signals().length, 'status:', state.status());
        }
      };

      // Load status
      service
        .getStatus()
        .pipe(takeUntilDestroyed(destroyRef), finalize(checkComplete))
        .subscribe({
          next: (status) => {
            console.log('[RH Agent Store] Status received:', status);
            patchState(state, { status });
          },
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
          next: (runs) => {
            console.log('[RH Agent Store] Runs received:', runs.length, runs);
            patchState(state, { runs });
          },
          error: (err) => {
          console.error('[RH Agent Store] Failed to load runs:', err);
          snackBar.open('Failed to load runs', 'Dismiss', { duration: 5000 });
        },
        });

      // Load signals
      service
        .getSignalHistory(50)
        .pipe(takeUntilDestroyed(destroyRef), finalize(checkComplete))
        .subscribe({
          next: (signals) => {
            console.log('[RH Agent Store] Signals received:', signals.length, signals);
            patchState(state, { signals });
          },
          error: (err) => {
          console.error('[RH Agent Store] Failed to load signals:', err);
          snackBar.open('Failed to load signals', 'Dismiss', { duration: 5000 });
        },
        });
    },

    /**
     * Trigger a manual agent run
     * Now enqueues Cloud Tasks like the scheduler - async processing
     */
    triggerManualRun(): void {
      console.log('[RH Agent Store] triggerManualRun called');
      patchState(state, { isLoading: true });

      service
        .triggerManualRun({})
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

    /**
     * Get signals for a specific run
     */
    getSignalsForRun(runId: string): RhTradeSignal[] {
      return state.signalsByRun().get(runId) || [];
    },
  }))
);
