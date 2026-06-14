/**
 * RH Agent SignalStore
 *
 * Manages agent state, runs, and signals using NgRx Signals.
 */
import { inject, computed, Injectable } from '@angular/core';
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
  withMethods((state, service = inject(RhAgentService), snackBar = inject(MatSnackBar)) => ({
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
          // Generate shim signals if no real signals and we have runs + symbols
          if (state.signals().length === 0 && state.runs().length > 0) {
            console.log('[RH Agent Store] No signals after all data loaded, generating shims...');
            this.generateShimSignals();
          }
        }
      };

      // Load status
      service
        .getStatus()
        .pipe(takeUntilDestroyed(), finalize(checkComplete))
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
        .pipe(takeUntilDestroyed(), finalize(checkComplete))
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
        .pipe(takeUntilDestroyed(), finalize(checkComplete))
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
     * Generate shim signals for UI testing
     */
    generateShimSignals(): void {
      console.log('[RH Agent Store] generateShimSignals called');
      const symbols = state.status()?.symbolsMonitored;
      if (!symbols?.length) {
        console.log('[RH Agent Store] No symbols to generate shims for');
        return;
      }

      const shimSignals: RhTradeSignal[] = [];
      const now = new Date().toISOString();
      const runId = state.runs().length > 0 ? state.runs()[0].id : 'shim-run';

      // Create a signal for every 3rd symbol
      for (let i = 2; i < symbols.length; i += 3) {
        const symbol = symbols[i];
        const shimSignal: RhTradeSignal = {
          id: `shim-${symbol}-${Date.now()}`,
          runId: runId,
          symbol: symbol,
          action: 'BUY',
          status: 'PENDING',
          reason: `[SHIM] RSI oversold (28.5) with -2.3% price drop. Potential bounce opportunity.`,
          createdAt: now,
          confidence: 85,
          signalType: 'RSI_OVERSOLD',
          indicators: {
            rsi: 28.5,
            priceChange: -0.023,
            currentPrice: 150.0 + Math.random() * 100,
          },
        };
        shimSignals.push(shimSignal);
      }

      console.log('[RH Agent Store] Shim signals generated:', shimSignals.length);
      patchState(state, { signals: shimSignals });
      snackBar.open(
        `Generated ${shimSignals.length} shim signals for UI testing`,
        'Dismiss',
        { duration: 3000 }
      );
    },

    /**
     * Trigger a manual agent run
     */
    triggerManualRun(): void {
      console.log('[RH Agent Store] triggerManualRun called');
      patchState(state, { isLoading: true });

      service
        .triggerManualRun({ dryRun: true })
        .pipe(takeUntilDestroyed())
        .subscribe({
          next: (result) => {
            console.log('[RH Agent Store] Manual run triggered:', result);
            snackBar.open(`Run completed: ${result.message}`, 'Dismiss', { duration: 5000 });
            // Reload data after run
            this.loadData();
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
