/**
 * RH Agent Dashboard UI State Store
 *
 * Manages UI state for the dashboard: filters, selections, view options.
 * Separate from the data store (rh-agent.store.ts) which manages business data.
 */
import { inject, computed } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { RhAgentStore } from './rh-agent.store';
import { RhTradeSignal, RH_AGENT_SCHEDULE_CRON } from './rh-agent.service';

type SignalStatus = 'PENDING' | 'ACCEPTED' | 'CONSIDERED' | 'REJECTED';

// State interface
export interface DashboardUiState {
  selectedSymbols: Set<string>;
  selectedSignalTypes: Set<string>;
  filterPanelsOpen: boolean; // Single toggle for both symbols and signal types
  showAllRuns: boolean;
  symbolSearch: string;
  signalStatuses: Map<string, SignalStatus>; // signalId -> status
  acceptedPanelOpen: boolean;
  consideredPanelOpen: boolean;
  rejectedPanelOpen: boolean;
  currentRunOpen: boolean;
}

// Initial state - panels open by default
const initialState: DashboardUiState = {
  selectedSymbols: new Set<string>(),
  selectedSignalTypes: new Set<string>(),
  filterPanelsOpen: true,
  showAllRuns: false,
  symbolSearch: '',
  signalStatuses: new Map(),
  acceptedPanelOpen: true,
  consideredPanelOpen: true,
  rejectedPanelOpen: true,
  currentRunOpen: true,
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
      state.selectedSymbols().size > 0 || state.selectedSignalTypes().size > 0
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

    // Live total runs count from loaded data
    totalRunsLive: computed(() => dataStore.runs().length),

    // Live signal count for the current (most recent) run
    currentRunSignalCount: computed(() => {
      const runs = dataStore.runs();
      if (runs.length === 0) return 0;
      return dataStore.signals().filter(s => s.runId === runs[0].id).length;
    }),
  })),

  withMethods((state, dataStore = inject(RhAgentStore)) => ({
    getRunSignalStats(runId: string): { symbols: number; signals: number } {
      const signals = dataStore.signals().filter(s => s.runId === runId);
      const uniqueSymbols = new Set(signals.map(s => s.symbol));
      return { symbols: uniqueSymbols.size, signals: signals.length };
    },
  })),

  // Methods
  withMethods((state, dataStore = inject(RhAgentStore)) => ({
    /**
     * Toggle symbol filter selection
     */
    toggleSymbolFilter(symbol: string): void {
      const current = new Set(state.selectedSymbols());
      if (current.has(symbol)) current.delete(symbol); else current.add(symbol);
      patchState(state, { selectedSymbols: current });
    },

    deselectSymbol(symbol: string): void {
      const current = new Set(state.selectedSymbols());
      current.delete(symbol);
      patchState(state, { selectedSymbols: current });
    },

    /**
     * Set symbol search filter
     */
    setSymbolSearch(search: string): void {
      patchState(state, { symbolSearch: search });
    },

    /**
     * Get filtered symbols based on search
     */
    getFilteredSymbols(): string[] {
      const symbols = dataStore.status()?.symbolsMonitored || [];
      const search = state.symbolSearch().toLowerCase();
      if (!search) return symbols;
      return symbols.filter(s => s.toLowerCase().includes(search));
    },

    /**
     * Sort signals by direction, type, then symbol
     */
    sortSignals(signals: RhTradeSignal[]): RhTradeSignal[] {
      return [...signals].sort((a, b) => {
        // First: trade direction (LONG before SHORT)
        const dirA = a.tradeDirection || 'LONG';
        const dirB = b.tradeDirection || 'LONG';
        if (dirA !== dirB) return dirA === 'LONG' ? -1 : 1;

        // Second: signal type
        const typeA = a.signalType || '';
        const typeB = b.signalType || '';
        if (typeA !== typeB) return typeA.localeCompare(typeB);

        // Third: symbol ticker
        return a.symbol.localeCompare(b.symbol);
      });
    },

    /**
     * Get signal status (defaults to PENDING)
     */
    getSignalStatus(signalId: string): SignalStatus {
      return state.signalStatuses().get(signalId) || 'PENDING';
    },

    /**
     * Set signal status and move to appropriate bucket
     */
    setSignalStatus(signalId: string, status: SignalStatus): void {
      const currentStatuses = new Map(state.signalStatuses());
      if (status === 'PENDING') {
        currentStatuses.delete(signalId);
      } else {
        currentStatuses.set(signalId, status);
      }
      patchState(state, { signalStatuses: currentStatuses });
    },

    /**
     * Get signals by status for a run
     */
    getSignalsByStatus(runId: string, status: SignalStatus): RhTradeSignal[] {
      const allSignals = dataStore.signals().filter(s => s.runId === runId);
      return this.sortSignals(allSignals.filter(s => this.getSignalStatus(s.id) === status));
    },

    /**
     * Toggle signal type filter selection
     */
    toggleSignalTypeFilter(type: string): void {
      const current = new Set(state.selectedSignalTypes());
      if (current.has(type)) current.delete(type); else current.add(type);
      patchState(state, { selectedSignalTypes: current });
    },

    deselectSignalType(type: string): void {
      const current = new Set(state.selectedSignalTypes());
      current.delete(type);
      patchState(state, { selectedSignalTypes: current });
    },

    /**
     * Clear all filters
     */
    clearFilters(): void {
      patchState(state, { 
        selectedSymbols: new Set<string>(),
        selectedSignalTypes: new Set<string>()
      });
    },

    clearSymbolFilters(): void {
      patchState(state, { selectedSymbols: new Set<string>() });
    },

    /**
     * Get filtered signals for a run based on selected filters (PENDING only)
     */
    getFilteredSignals(runId: string): RhTradeSignal[] {
      let signals = dataStore.getSignalsForRun(runId);
      const symbolFilters = state.selectedSymbols();
      const typeFilters = state.selectedSignalTypes();

      // Filter to only PENDING signals
      signals = signals.filter(s => this.getSignalStatus(s.id) === 'PENDING');

      if (symbolFilters.size > 0) {
        signals = signals.filter(s => symbolFilters.has(s.symbol));
      }
      if (typeFilters.size > 0) {
        signals = signals.filter(s => !!s.signalType && typeFilters.has(s.signalType));
      }
      return this.sortSignals(signals);
    },

    /**
     * Open filter panels (both symbols and signal types)
     */
    openFilterPanels(): void {
      patchState(state, { filterPanelsOpen: true });
    },

    /**
     * Close filter panels (both symbols and signal types)
     */
    closeFilterPanels(): void {
      patchState(state, { filterPanelsOpen: false });
    },

    /**
     * Toggle filter panels (both symbols and signal types)
     */
    toggleFilterPanels(): void {
      patchState(state, { filterPanelsOpen: !state.filterPanelsOpen() });
    },

    /**
     * Toggle show all runs
     */
    toggleShowAllRuns(): void {
      patchState(state, { showAllRuns: !state.showAllRuns() });
    },

    /**
     * Open accepted panel
     */
    openAcceptedPanel(): void {
      patchState(state, { acceptedPanelOpen: true });
    },

    /**
     * Close accepted panel
     */
    closeAcceptedPanel(): void {
      patchState(state, { acceptedPanelOpen: false });
    },

    /**
     * Open considered panel
     */
    openConsideredPanel(): void {
      patchState(state, { consideredPanelOpen: true });
    },

    /**
     * Close considered panel
     */
    closeConsideredPanel(): void {
      patchState(state, { consideredPanelOpen: false });
    },

    /**
     * Open rejected panel
     */
    openRejectedPanel(): void {
      patchState(state, { rejectedPanelOpen: true });
    },

    /**
     * Close rejected panel
     */
    closeRejectedPanel(): void {
      patchState(state, { rejectedPanelOpen: false });
    },

    /**
     * Toggle accepted panel
     */
    toggleAcceptedPanel(): void {
      patchState(state, { acceptedPanelOpen: !state.acceptedPanelOpen() });
    },

    /**
     * Toggle considered panel
     */
    toggleConsideredPanel(): void {
      patchState(state, { consideredPanelOpen: !state.consideredPanelOpen() });
    },

    /**
     * Toggle rejected panel
     */
    toggleRejectedPanel(): void {
      patchState(state, { rejectedPanelOpen: !state.rejectedPanelOpen() });
    },

    toggleCurrentRun(): void {
      patchState(state, { currentRunOpen: !state.currentRunOpen() });
    },

    /**
     * Translate cron expression (UTC) to Pacific Time human-readable format
     * Schedule is 12:00 PM PT Monday-Friday (0 20 * * 1-5 UTC)
     */
    getScheduleDescription(_cron: string | undefined): string {
      const cron = RH_AGENT_SCHEDULE_CRON;
      if (!cron) return 'Not scheduled';
      
      // Parse cron: "0 20 * * 1-5" (8 PM UTC = 12 PM PT)
      const parts = cron.split(' ');
      if (parts.length !== 5) return cron;
      
      const [minute, hour, , , dayOfWeek] = parts;
      
      // Convert UTC to Pacific Time (UTC-8, or UTC-7 during DST)
      // For simplicity, assume standard offset (8 hours behind)
      let hourNum = parseInt(hour, 10);
      hourNum = (hourNum - 8 + 24) % 24; // Convert UTC to PT (PST)
      
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

    /**
     * Move signal to ACCEPTED bucket
     */
    acceptSignal(signalId: string): void {
      console.log('[RH Agent Dashboard] Signal accepted:', signalId);
      this.setSignalStatus(signalId, 'ACCEPTED');
    },

    /**
     * Move signal to CONSIDERED bucket
     */
    considerSignal(signalId: string): void {
      console.log('[RH Agent Dashboard] Signal considered:', signalId);
      this.setSignalStatus(signalId, 'CONSIDERED');
    },

    /**
     * Move signal to REJECTED bucket
     */
    rejectSignal(signalId: string): void {
      console.log('[RH Agent Dashboard] Signal rejected:', signalId);
      this.setSignalStatus(signalId, 'REJECTED');
    },

    /**
     * Send order for an accepted signal (placeholder)
     */
    sendOrder(signalId: string): void {
      console.log('[RH Agent Dashboard] Send order for signal:', signalId);
      // TODO: Implement actual order sending
    },
  }))
);
