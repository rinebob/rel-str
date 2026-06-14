/**
 * RH Agent Dashboard UI State Store
 *
 * Manages UI state for the dashboard: filters, selections, view options.
 * Separate from the data store (rh-agent.store.ts) which manages business data.
 */
import { inject, computed } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { RhAgentStore } from './rh-agent.store';
import { RhTradeSignal } from './rh-agent.service';

// State interface
export interface DashboardUiState {
  selectedSymbol: string | null;
  selectedSignalType: string | null;
  symbolsPanelOpen: boolean;
  signalTypesPanelOpen: boolean;
  showAllRuns: boolean;
}

// Initial state
const initialState: DashboardUiState = {
  selectedSymbol: null,
  selectedSignalType: null,
  symbolsPanelOpen: false,
  signalTypesPanelOpen: false,
  showAllRuns: false,
};

export const RhAgentDashboardStore = signalStore(
  withState(initialState),

  // Computed values
  withComputed((state, dataStore = inject(RhAgentStore)) => ({
    // Get unique signal types from all signals
    signalTypes: computed(() => {
      const types = new Set<string>();
      for (const signal of dataStore.signals()) {
        if (signal.signalType) {
          types.add(signal.signalType);
        }
      }
      return Array.from(types).sort();
    }),

    // Check if any filter is active
    hasActiveFilters: computed(() => 
      state.selectedSymbol() !== null || state.selectedSignalType() !== null
    ),

    // Current run (most recent)
    currentRun: computed(() => {
      const runs = dataStore.runs();
      return runs.length > 0 ? runs[0] : null;
    }),

    // Previous runs (all except current)
    previousRuns: computed(() => {
      return dataStore.runs().slice(1);
    }),
  })),

  // Methods
  withMethods((state, dataStore = inject(RhAgentStore)) => ({
    /**
     * Toggle symbol filter selection
     */
    toggleSymbolFilter(symbol: string): void {
      const current = state.selectedSymbol();
      patchState(state, { selectedSymbol: current === symbol ? null : symbol });
    },

    /**
     * Toggle signal type filter selection
     */
    toggleSignalTypeFilter(type: string): void {
      const current = state.selectedSignalType();
      patchState(state, { selectedSignalType: current === type ? null : type });
    },

    /**
     * Clear all filters
     */
    clearFilters(): void {
      patchState(state, { 
        selectedSymbol: null, 
        selectedSignalType: null 
      });
    },

    /**
     * Get filtered signals for a run based on selected filters
     */
    getFilteredSignals(runId: string): RhTradeSignal[] {
      let signals = dataStore.getSignalsForRun(runId);
      const symbolFilter = state.selectedSymbol();
      const typeFilter = state.selectedSignalType();

      if (symbolFilter) {
        signals = signals.filter(s => s.symbol === symbolFilter);
      }
      if (typeFilter) {
        signals = signals.filter(s => s.signalType === typeFilter);
      }
      return signals;
    },

    /**
     * Toggle symbols panel expansion
     */
    toggleSymbolsPanel(): void {
      patchState(state, { symbolsPanelOpen: !state.symbolsPanelOpen() });
    },

    /**
     * Toggle signal types panel expansion
     */
    toggleSignalTypesPanel(): void {
      patchState(state, { signalTypesPanelOpen: !state.signalTypesPanelOpen() });
    },

    /**
     * Toggle show all runs
     */
    toggleShowAllRuns(): void {
      patchState(state, { showAllRuns: !state.showAllRuns() });
    },

    /**
     * Translate cron expression to Pacific Time human-readable format
     * Schedule is 12:00 PM PT Monday-Friday (0 12 * * 1-5)
     */
    getScheduleDescription(cron: string | undefined): string {
      if (!cron) return 'Not scheduled';
      
      // Parse cron: "0 12 * * 1-5" -> 12:00 PM PT, Monday-Friday
      const parts = cron.split(' ');
      if (parts.length !== 5) return cron;
      
      const [minute, hour, , , dayOfWeek] = parts;
      
      // Convert 24h to 12h format
      const hourNum = parseInt(hour, 10);
      const minNum = parseInt(minute, 10);
      const ampm = hourNum >= 12 ? 'PM' : 'AM';
      const hour12 = hourNum % 12 || 12;
      const minStr = minNum === 0 ? '' : `:${minNum.toString().padStart(2, '0')}`;
      const time = `${hour12}${minStr} ${ampm}`;
      
      // Day of week
      let days = '';
      if (dayOfWeek === '*') days = 'daily';
      else if (dayOfWeek === '1-5') days = 'Monday-Friday';
      else if (dayOfWeek === '0-6') days = 'daily';
      else if (dayOfWeek === '1') days = 'Mondays';
      else if (dayOfWeek === '5') days = 'Fridays';
      else days = dayOfWeek;
      
      return `${time} PT, ${days}`;
    },

    /**
     * Get Material color for run status
     */
    getRunStatusColor(status: string): string {
      switch (status.toLowerCase()) {
        case 'success': return 'success';
        case 'failed': return 'error';
        case 'running': return 'primary';
        case 'partial': return 'accent';
        default: return '';
      }
    },

    /**
     * Get Material icon for run status
     */
    getRunStatusIcon(status: string): string {
      switch (status.toLowerCase()) {
        case 'success': return 'check_circle';
        case 'failed': return 'error';
        case 'running': return 'pending';
        case 'partial': return 'warning';
        default: return 'help';
      }
    },

    /**
     * Get Material icon for action type
     */
    getActionIcon(action: string): string {
      switch (action.toLowerCase()) {
        case 'buy': return 'trending_up';
        case 'sell': return 'trending_down';
        case 'hold': return 'remove_circle';
        default: return 'help';
      }
    },
  }))
);
