/**
 * RH Agent Execution Store
 *
 * Canonical orchestration layer for "executing" accepted occurrence decisions.
 * A single call here creates the trade record, marks the occurrence decision
 * executed, and updates both local caches. This keeps the Order page free of
 * transaction choreography and avoids half-applied state.
 */
import { inject } from '@angular/core';
import {
  signalStore,
  withState,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { MatSnackBar } from '@angular/material/snack-bar';

import { RhAgentExecutionService, type ExecutionRowInput } from '../services/rh-agent-execution.service';
import { RhAgentTradeStore } from './rh-agent-trade.store';
import { RhAgentOccurrenceDecisionStore } from './rh-agent-occurrence-decision.store';

export interface RhAgentExecutionState {
  /** True while an execute-batch call is in flight. */
  executing: boolean;
  /** Error from the last execute call, if any. */
  executeError: string | null;
}

const initialState: RhAgentExecutionState = {
  executing: false,
  executeError: null,
};

export const RhAgentExecutionStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  withMethods((
    state,
    executionService = inject(RhAgentExecutionService),
    tradeStore = inject(RhAgentTradeStore),
    occurrenceStore = inject(RhAgentOccurrenceDecisionStore),
    snackBar = inject(MatSnackBar),
  ) => ({
    /**
     * Execute a batch of accepted rows atomically.
     * Creates trade records and marks the linked occurrence decisions executed in
     * a single transaction, then updates both local caches.
     */
    executeTradeRows(
      runId: string,
      marketDate: string,
      inputs: ExecutionRowInput[]
    ): void {
      if (inputs.length === 0) return;
      patchState(state, { executing: true, executeError: null });

      executionService.executeTradeRows(runId, marketDate, inputs).subscribe({
        next: ({ trades, decisionIds }) => {
          tradeStore.addTrades(trades);
          occurrenceStore.patchExecutedByIds(decisionIds);
          patchState(state, { executing: false });
        },
        error: (err: unknown) => {
          console.error('[ExecutionStore] Failed to execute trades:', err);
          const message = err instanceof Error ? err.message : String(err ?? 'Execution failed');
          patchState(state, { executing: false, executeError: message });
          snackBar.open(message, 'Dismiss', { duration: 4000 });
        },
      });
    },
  }))
);
