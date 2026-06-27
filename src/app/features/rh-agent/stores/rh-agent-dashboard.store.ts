/**
 * RH Agent Dashboard UI State Store
 *
 * Manages UI state for the runs-only dashboard: run expansion, show-all toggle.
 * Signal triage has moved to the Grouped Review / Review / Order pipeline.
 */
import { inject, computed } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { RhAgentStore } from './rh-agent.store';
import { RH_AGENT_SCHEDULE_CRON } from '../services/rh-agent.service';

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

    getScheduleDescription(_cron: string | undefined): string {
      const cron = RH_AGENT_SCHEDULE_CRON;
      if (!cron) return 'Not scheduled';
      const parts = cron.split(' ');
      if (parts.length !== 5) return cron;
      const [minute, hour, , , dayOfWeek] = parts;
      let hourNum = (parseInt(hour, 10) - 8 + 24) % 24;
      const minNum = parseInt(minute, 10);
      const ampm = hourNum >= 12 ? 'PM' : 'AM';
      const hour12 = hourNum % 12 || 12;
      const minStr = minNum === 0 ? '' : `:${minNum.toString().padStart(2, '0')}`;
      const time = `${hour12}${minStr} ${ampm}`;
      let days = '';
      if (dayOfWeek === '*') days = 'daily';
      else if (dayOfWeek === '1-5') days = 'Monday-Friday';
      else if (dayOfWeek === '0-6') days = 'daily';
      else if (dayOfWeek === '1') days = 'Mondays';
      else if (dayOfWeek === '5') days = 'Fridays';
      else days = dayOfWeek;
      return `${time} PT, ${days}`;
    },

    getRunStatusColor(status: string): string {
      switch (status.toLowerCase()) {
        case 'success': return 'success';
        case 'failed': return 'error';
        case 'running': return 'primary';
        case 'partial': return 'accent';
        default: return '';
      }
    },

    getRunStatusIcon(status: string): string {
      switch (status.toLowerCase()) {
        case 'success': return 'check_circle';
        case 'failed': return 'error';
        case 'running': return 'pending';
        case 'partial': return 'warning';
        default: return 'help';
      }
    },
  }))
);
