/**
 * RH Agent Dashboard UI State Store
 *
 * Manages UI state for the runs-only dashboard: run expansion, show-all toggle.
 * Signal triage has moved to the Grouped Review / Review / Order pipeline.
 */
import { inject, computed } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { RhAgentStore } from './rh-agent.store';
import {
  RhAgentRunTriggerFilter,
  RhAgentRunDateFilter,
  RhAgentRunStatusFilter,
} from '../common/rh-agent.constants';
import { RhAgentRun } from '../services/rh-agent.service';
import { todayDate, daysAgoPt } from '../utils/rh-agent.utils';

// State interface
export interface DashboardUiState {
  showAllRuns: boolean;
  currentRunOpen: boolean;
  triggerFilter: RhAgentRunTriggerFilter;
  dateFilter: RhAgentRunDateFilter;
  statusFilter: RhAgentRunStatusFilter;
  selectedRunId: string | null;
}

// Initial state
const initialState: DashboardUiState = {
  showAllRuns: false,
  currentRunOpen: true,
  triggerFilter: RhAgentRunTriggerFilter.ALL,
  dateFilter: RhAgentRunDateFilter.WEEK,
  statusFilter: RhAgentRunStatusFilter.ALL,
  selectedRunId: null,
};

export const RhAgentDashboardStore = signalStore(
  withState(initialState),

  withComputed((state, dataStore = inject(RhAgentStore)) => ({
    /** Run matching the selectedRunId (for metrics strip). */
    selectedRun: computed((): RhAgentRun | null => {
      const id = state.selectedRunId();
      if (!id) return null;
      return dataStore.runs().find((r) => r.id === id) ?? null;
    }),

    /** Runs filtered by the active trigger, date, and status filters. */
    filteredRuns: computed((): RhAgentRun[] => {
      const runs = dataStore.runs();
      const trigger = state.triggerFilter();
      const date = state.dateFilter();
      const status = state.statusFilter();

      return runs.filter((r) => {
        if (trigger !== RhAgentRunTriggerFilter.ALL && r.triggeredBy !== trigger) return false;
        if (status !== RhAgentRunStatusFilter.ALL && r.status?.toLowerCase() !== status) return false;
        if (date === RhAgentRunDateFilter.TODAY) {
          if ((r.marketDate ?? '') !== todayDate()) return false;
        } else if (date === RhAgentRunDateFilter.WEEK) {
          if ((r.marketDate ?? '') < daysAgoPt(7)) return false;
        }
        return true;
      });
    }),

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

    /** Set trigger filter. */
    setTriggerFilter(filter: RhAgentRunTriggerFilter): void {
      patchState(state, { triggerFilter: filter });
    },

    /** Set date filter. */
    setDateFilter(filter: RhAgentRunDateFilter): void {
      patchState(state, { dateFilter: filter });
    },

    /** Set status filter. */
    setStatusFilter(filter: RhAgentRunStatusFilter): void {
      patchState(state, { statusFilter: filter });
    },

    /** Select a run for the metrics strip. */
    selectRun(runId: string | null): void {
      patchState(state, { selectedRunId: runId });
    },
  }))
);
