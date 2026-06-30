/**
 * RH Agent Dashboard UI State Store
 *
 * Manages UI state for the runs-only dashboard: run expansion, show-all toggle.
 * Signal triage has moved to the Grouped Review / Review / Order pipeline.
 */
import { inject, computed } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { RhAgentStore } from './rh-agent.store';

// State interface
export interface DashboardUiState {
  showAllRuns: boolean;
  currentRunOpen: boolean;
  selectedSignalId: string | null;
}

// Initial state
const initialState: DashboardUiState = {
  showAllRuns: false,
  currentRunOpen: true,
  selectedSignalId: null,
};

export const RhAgentDashboardStore = signalStore(
  withState(initialState),

  withComputed((_state, dataStore = inject(RhAgentStore)) => ({
    /** Most recent run from the shared RhAgentStore. */
    currentRun: computed(() => {
      const runs = dataStore.runs();
      return runs.length > 0 ? runs[0] : null;
    }),

    /** All runs except the most recent. */
    previousRuns: computed(() => dataStore.runs().slice(1)),

    /** Total number of runs loaded. */
    totalRunsLive: computed(() => dataStore.runs().length),
  })),

  withMethods((state) => ({
    /** Toggle the "show all runs" expansion state. */
    toggleShowAllRuns(): void {
      patchState(state, { showAllRuns: !state.showAllRuns() });
    },

    /** Toggle the current run expansion panel. */
    toggleCurrentRun(): void {
      patchState(state, { currentRunOpen: !state.currentRunOpen() });
    },

    /** Set the currently selected signal ID for the dashboard detail panel. */
    selectSignal(signalId: string): void {
      patchState(state, { selectedSignalId: signalId });
    },

    /** Clear the selected signal. */
    clearSelectedSignal(): void {
      patchState(state, { selectedSignalId: null });
    },
  }))
);
