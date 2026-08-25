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
  RunTriggerFilter,
  RunDateFilter,
  RunStatusFilter,
} from '../common/constants';
import { AgentRun } from '../services/agent.service';
import { todayDate, daysAgoPt } from '../utils/utils';

// State interface
export interface DashboardUiState {
  showAllRuns: boolean;
  currentRunOpen: boolean;
  triggerFilter: RunTriggerFilter;
  dateFilter: RunDateFilter;
  statusFilter: RunStatusFilter;
  selectedRunId: string | null;
}

// Initial state
const initialState: DashboardUiState = {
  showAllRuns: false,
  currentRunOpen: true,
  triggerFilter: RunTriggerFilter.ALL,
  dateFilter: RunDateFilter.WEEK,
  statusFilter: RunStatusFilter.ALL,
  selectedRunId: null,
};

export const RhAgentDashboardStore = signalStore(
  withState(initialState),

  withComputed((state, dataStore = inject(RhAgentStore)) => ({
    /** Run matching the selectedRunId (for metrics strip). */
    selectedRun: computed((): AgentRun | null => {
      const id = state.selectedRunId();
      if (!id) return null;
      return dataStore.runs().find((r) => r.id === id) ?? null;
    }),

    /** Runs filtered by the active trigger, date, and status filters. */
    filteredRuns: computed((): AgentRun[] => {
      const runs = dataStore.runs();
      const trigger = state.triggerFilter();
      const date = state.dateFilter();
      const status = state.statusFilter();

      return runs.filter((r) => {
        if (trigger !== RunTriggerFilter.ALL && r.triggeredBy !== trigger) return false;
        if (status !== RunStatusFilter.ALL && r.status?.toLowerCase() !== status) return false;
        if (date === RunDateFilter.TODAY) {
          if ((r.marketDate ?? '') !== todayDate()) return false;
        } else if (date === RunDateFilter.WEEK) {
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
    setTriggerFilter(filter: RunTriggerFilter): void {
      patchState(state, { triggerFilter: filter });
    },

    /** Set date filter. */
    setDateFilter(filter: RunDateFilter): void {
      patchState(state, { dateFilter: filter });
    },

    /** Set status filter. */
    setStatusFilter(filter: RunStatusFilter): void {
      patchState(state, { statusFilter: filter });
    },

    /** Select a run for the metrics strip. */
    selectRun(runId: string | null): void {
      patchState(state, { selectedRunId: runId });
    },
  }))
);
