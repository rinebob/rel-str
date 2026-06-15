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
     * Generate shim signals for UI testing
     * Creates multiple signals per symbol with varied signal types
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

      // Signal type configurations for variety
      const signalTypes = [
        { type: 'RSI_OVERSOLD', action: 'BUY', reason: 'RSI oversold ({rsi}) with {priceChange}% price drop. Potential bounce opportunity.' },
        { type: 'BREAKOUT', action: 'BUY', reason: 'Volume breakout detected at {price}. Breaking above resistance level.' },
        { type: 'MOMENTUM', action: 'BUY', reason: 'Strong upward momentum with {rsi} RSI and positive MACD crossover.' },
        { type: 'REVERSAL', action: 'SELL', reason: 'Bearish reversal pattern forming. RSI at {rsi}, considering exit.' },
        { type: 'SUPPORT_BOUNCE', action: 'BUY', reason: 'Bounced off key support level at ${price}. Expecting continuation.' },
      ];

      // Create 3-5 signals for each symbol to generate plenty of data
      let signalCounter = 0;
      for (let i = 0; i < symbols.length && i < 50; i++) { // Limit to first 50 symbols
        const symbol = symbols[i];
        const numSignals = 3 + Math.floor(Math.random() * 3); // 3-5 signals per symbol

        for (let j = 0; j < numSignals; j++) {
          const typeConfig = signalTypes[Math.floor(Math.random() * signalTypes.length)];
          const rsi = Math.floor(Math.random() * 40) + 20; // 20-60 RSI
          const priceChange = (Math.random() * 6 - 3).toFixed(2); // -3% to +3%
          const price = (50 + Math.random() * 450).toFixed(2); // $50-$500

          const tradeDirection = typeConfig.action === 'SELL' || typeConfig.type === 'REVERSAL' ? 'SHORT' : 'LONG';

          const shimSignal: RhTradeSignal = {
            id: `shim-${symbol}-${signalCounter++}`,
            runId: runId,
            symbol: symbol,
            action: typeConfig.action as 'BUY' | 'SELL' | 'HOLD',
            status: 'PENDING',
            reason: typeConfig.reason
              .replace('{rsi}', rsi.toString())
              .replace('{priceChange}', priceChange)
              .replace('{price}', price),
            createdAt: new Date(Date.now() - Math.random() * 3600000).toISOString(), // Within last hour
            confidence: Math.floor(Math.random() * 30) + 70, // 70-100%
            signalType: typeConfig.type,
            tradeDirection,
            indicators: {
              rsi: rsi,
              priceChange: parseFloat(priceChange) / 100,
              currentPrice: parseFloat(price),
            },
          };
          shimSignals.push(shimSignal);
        }
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
