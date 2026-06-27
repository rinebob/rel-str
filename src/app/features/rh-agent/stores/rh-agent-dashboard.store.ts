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
    currentRun: computed(() => {
      const runs = dataStore.runs();
      return runs.length > 0 ? runs[0] : null;
    }),

    previousRuns: computed(() => dataStore.runs().slice(1)),

    totalRunsLive: computed(() => dataStore.runs().length),
  })),

  withMethods((state) => ({
    toggleShowAllRuns(): void {
      patchState(state, { showAllRuns: !state.showAllRuns() });
    },

    toggleCurrentRun(): void {
      patchState(state, { currentRunOpen: !state.currentRunOpen() });
    },

    selectSignal(signalId: string): void {
      patchState(state, { selectedSignalId: signalId });
    },

    clearSelectedSignal(): void {
      patchState(state, { selectedSignalId: null });
    },
  }))
);
