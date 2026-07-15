/**
 * RH Agent Occurrence Decision Store
 *
 * Durable source-specific ACCEPT / REJECT decisions for individual signal
 * occurrences. Decisions are keyed by runId + symbol + timeframe + signalType
 * so multiple intraday occurrences do not overwrite one another.
 *
 * This store is intentionally separate from the ephemeral screening state in
 * RhAgentTriageStore.
 */
import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { MatSnackBar } from '@angular/material/snack-bar';

import {
  RhAgentOccurrenceDecisionService,
} from '../services/rh-agent-occurrence-decision.service';
import {
  RhAgentSignalItem,
  RhAgentOccurrenceDecision,
  DurableDecisionType,
} from '../services/rh-agent.types';
import { RhAgentReviewDecision } from '../common/rh-agent.constants';
import { buildRhAgentOccurrenceDecisionId } from '../services/rh-agent-firestore-helpers';

export interface RhAgentOccurrenceDecisionState {
  /** Durable occurrence-level decisions keyed by decision id. */
  occurrenceDecisions: Record<string, RhAgentOccurrenceDecision>;
  /** True while decisions for the active run are loading. */
  decisionsLoading: boolean;
  /** Error from loading or persisting decisions. */
  decisionsError: string | null;
}

const initialState: RhAgentOccurrenceDecisionState = {
  occurrenceDecisions: {},
  decisionsLoading: false,
  decisionsError: null,
};

function decisionId(runId: string, symbol: string, timeframe: string, signalType: string): string {
  return buildRhAgentOccurrenceDecisionId(runId, symbol, timeframe, signalType);
}

function buildDecision(
  runId: string,
  marketDate: string,
  signal: RhAgentSignalItem,
  decisionType: DurableDecisionType,
): RhAgentOccurrenceDecision {
  return {
    id: decisionId(runId, signal.symbol, signal.timeframe, signal.signalType),
    runId,
    marketDate,
    symbol: signal.symbol.toUpperCase(),
    timeframe: signal.timeframe,
    direction: signal.direction,
    signalType: signal.signalType,
    barDate: signal.barDate,
    decisionType,
    decidedAt: new Date().toISOString(),
    isCurrentInLatestRun: true,
    indicators: signal.indicators ?? {},
  };
}

export const RhAgentOccurrenceDecisionStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  withComputed((state) => {
    const acceptedSymbols = computed((): string[] =>
      Array.from(
        new Set(
          Object.values(state.occurrenceDecisions())
            .filter((d) => d.decisionType === RhAgentReviewDecision.ACCEPT && d.isCurrentInLatestRun)
            .map((d) => d.symbol)
        )
      )
    );

    const activeOrderSymbols = computed((): string[] =>
      Array.from(
        new Set(
          Object.values(state.occurrenceDecisions())
            .filter(
              (d) =>
                d.decisionType === RhAgentReviewDecision.ACCEPT &&
                d.isCurrentInLatestRun &&
                !d.executedAt
            )
            .map((d) => d.symbol)
        )
      )
    );

    return {
      acceptedSymbols,

      /** Accepted symbols that have not yet been executed, suitable for the active Order page. */
      activeOrderSymbols,

      /** Count of symbols with an accepted current-run occurrence. */
      acceptedCount: computed((): number => acceptedSymbols().length),

      /** True while decisions are loading. */
      loading: computed((): boolean => state.decisionsLoading()),
    };
  }),

  withMethods((
    state,
    occurrenceService = inject(RhAgentOccurrenceDecisionService),
    snackBar = inject(MatSnackBar),
  ) => ({
    /** Persist ACCEPT decisions for the given signal occurrences in the active run. */
    acceptSignals(signals: RhAgentSignalItem[], runId: string, marketDate: string): void {
      this.persistSignalDecisions(signals, runId, marketDate, RhAgentReviewDecision.ACCEPT);
    },

    /** Persist REJECT decisions for the given signal occurrences in the active run. */
    rejectSignals(signals: RhAgentSignalItem[], runId: string, marketDate: string): void {
      this.persistSignalDecisions(signals, runId, marketDate, RhAgentReviewDecision.REJECT);
    },

    /** Delete durable decisions for the given signal occurrences. */
    resetSignals(signals: RhAgentSignalItem[], runId: string): void {
      if (signals.length === 0) return;
      const previousDecisions = state.occurrenceDecisions();
      const next = { ...previousDecisions };
      for (const signal of signals) {
        delete next[decisionId(runId, signal.symbol, signal.timeframe, signal.signalType)];
      }
      patchState(state, { occurrenceDecisions: next });

      occurrenceService.deleteDecisionsBatch(
        runId,
        signals.map((s) => ({ symbol: s.symbol, timeframe: s.timeframe, signalType: s.signalType }))
      ).subscribe({
        error: (err: unknown) => {
          console.error('[OccurrenceDecisionStore] Failed to reset decisions:', err);
          const message = err instanceof Error ? err.message : String(err ?? 'Reset failed');
          patchState(state, { occurrenceDecisions: previousDecisions, decisionsError: message });
          snackBar.open('Failed to reset decisions — reverted', 'Dismiss', { duration: 4000 });
        },
      });
    },

    /** Delete all durable occurrence decisions for a symbol in the given run. */
    resetSymbol(symbol: string, runId: string): void {
      const previousDecisions = state.occurrenceDecisions();
      const next = { ...previousDecisions };
      const idsToDelete: string[] = [];
      const normalized = symbol.toUpperCase();
      for (const [id, d] of Object.entries(previousDecisions)) {
        if (d.runId === runId && d.symbol === normalized) {
          idsToDelete.push(id);
          delete next[id];
        }
      }
      if (idsToDelete.length === 0) return;
      patchState(state, { occurrenceDecisions: next });

      occurrenceService.deleteDecisionIds(idsToDelete).subscribe({
        error: (err: unknown) => {
          console.error('[OccurrenceDecisionStore] Failed to reset symbol:', err);
          const message = err instanceof Error ? err.message : String(err ?? 'Reset failed');
          patchState(state, { occurrenceDecisions: previousDecisions, decisionsError: message });
          snackBar.open('Failed to reset decisions — reverted', 'Dismiss', { duration: 4000 });
        },
      });
    },

    /** Load durable decisions for a specific source run. */
    loadDecisionsForRun(runId: string): void {
      patchState(state, { decisionsLoading: true, decisionsError: null });
      occurrenceService.loadDecisionsForRun(runId).subscribe({
        next: (decisions) => {
          const map: Record<string, RhAgentOccurrenceDecision> = {};
          for (const d of decisions) {
            map[d.id] = d;
          }
          patchState(state, { occurrenceDecisions: map, decisionsLoading: false });
        },
        error: (err: unknown) => {
          console.error('[OccurrenceDecisionStore] Failed to load decisions:', err);
          const message = err instanceof Error ? err.message : String(err ?? 'Load failed');
          patchState(state, { decisionsLoading: false, decisionsError: message });
        },
      });
    },

    /**
     * Mark accepted, current-run occurrence decisions for the given symbols as
     * executed. Optimistically sets executedAt on the local cache and rolls back
     * on service failure.
     */
    markExecutedForSymbols(runId: string, symbols: string[]): void {
      if (symbols.length === 0) return;
      const normalizedSymbols = symbols.map((s) => s.toUpperCase());
      const symbolSet = new Set(normalizedSymbols);
      const previousDecisions = state.occurrenceDecisions();
      const next: Record<string, RhAgentOccurrenceDecision> = { ...previousDecisions };
      const now = new Date().toISOString();
      const idsToMark: string[] = [];
      for (const [id, d] of Object.entries(previousDecisions)) {
        if (
          d.runId === runId &&
          d.decisionType === RhAgentReviewDecision.ACCEPT &&
          symbolSet.has(d.symbol) &&
          d.isCurrentInLatestRun
        ) {
          next[id] = { ...d, executedAt: now };
          idsToMark.push(id);
        }
      }
      if (idsToMark.length === 0) return;
      patchState(state, { occurrenceDecisions: next });

      occurrenceService.markExecutedByIds(idsToMark).subscribe({
        error: (err: unknown) => {
          console.error('[OccurrenceDecisionStore] Failed to mark executed:', err);
          const message = err instanceof Error ? err.message : String(err ?? 'Update failed');
          patchState(state, { occurrenceDecisions: previousDecisions, decisionsError: message });
          snackBar.open('Failed to mark executed — reverted', 'Dismiss', { duration: 4000 });
        },
      });
    },

    /** Mark every decision for the given source run as no longer current in the latest run. */
    markRunNotCurrent(runId: string): void {
      const previousDecisions = state.occurrenceDecisions();
      const next: Record<string, RhAgentOccurrenceDecision> = {};
      for (const [id, d] of Object.entries(previousDecisions)) {
        if (d.runId === runId) {
          next[id] = { ...d, isCurrentInLatestRun: false };
        } else {
          next[id] = d;
        }
      }
      patchState(state, { occurrenceDecisions: next });
      occurrenceService.markRunDecisionsNotCurrent(runId).subscribe({
        error: (err: unknown) => {
          console.error('[OccurrenceDecisionStore] Failed to mark run not current:', err);
          const message = err instanceof Error ? err.message : String(err ?? 'Update failed');
          patchState(state, { occurrenceDecisions: previousDecisions, decisionsError: message });
        },
      });
    },

    /** Drop all loaded decisions. Called when switching to a different run. */
    clearDecisions(): void {
      patchState(state, { occurrenceDecisions: {} });
    },

    persistSignalDecisions(
      signals: RhAgentSignalItem[],
      runId: string,
      marketDate: string,
      decisionType: DurableDecisionType
    ): void {
      if (signals.length === 0) return;
      // userId is provided by the service, so the optimistic local object leaves it empty.
      const previousDecisions = state.occurrenceDecisions();
      const next = { ...previousDecisions };
      for (const signal of signals) {
        const d = buildDecision(runId, marketDate, signal, decisionType);
        next[d.id] = d;
      }
      patchState(state, { occurrenceDecisions: next });

      occurrenceService.persistDecisionsBatch(runId, marketDate, signals, decisionType).subscribe({
        error: (err: unknown) => {
          console.error('[OccurrenceDecisionStore] Failed to persist decisions:', err);
          const message = err instanceof Error ? err.message : String(err ?? 'Persist failed');
          patchState(state, { occurrenceDecisions: previousDecisions, decisionsError: message });
          snackBar.open(`Failed to save ${decisionType.toLowerCase()} decisions`, 'Dismiss', { duration: 4000 });
        },
      });
    },
  })),

);
