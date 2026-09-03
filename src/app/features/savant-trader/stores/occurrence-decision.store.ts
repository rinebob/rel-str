/**
 * Savant Trader Occurrence Decision Store
 *
 * Durable source-specific ACCEPT / REJECT decisions for individual signal
 * occurrences. Decisions are keyed by runId + symbol + timeframe + signalType
 * so multiple intraday occurrences do not overwrite one another.
 *
 * The store loads decisions across a configurable time window (default 3 days)
 * so that accepts/rejects from prior runs remain visible in the signal review
 * UI. The UI shows the latest decision per symbol with a staleness indicator
 * when the decision's market date differs from the active run's market date.
 *
 * This store is intentionally separate from the ephemeral screening state in
 * TriageStore.
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
  OccurrenceDecisionService,
} from '../services/occurrence-decision.service';
import {
  StSignalItem,
  StOccurrenceDecision,
  DurableDecisionType,
} from '../services/types';
import { ReviewDecision, ALL_REVIEW_STATUSES, StatusCounts, DECISION_FETCH_DAYS } from '../common/constants';
import { buildStOccurrenceDecisionId } from '../services/firestore-helpers';

export interface OccurrenceDecisionState {
  /** Durable occurrence-level decisions keyed by decision id. */
  occurrenceDecisions: Record<string, StOccurrenceDecision>;
  /** True while decisions are loading. */
  decisionsLoading: boolean;
  /** Error from loading or persisting decisions. */
  decisionsError: string | null;
}

const initialState: OccurrenceDecisionState = {
  occurrenceDecisions: {},
  decisionsLoading: false,
  decisionsError: null,
};

function decisionId(runId: string, symbol: string, timeframe: string, signalType: string): string {
  return buildStOccurrenceDecisionId(runId, symbol, timeframe, signalType);
}

/**
 * Pick the latest decision per symbol by `decidedAt` timestamp.
 * Returns a map of symbol → decision.
 */
function latestDecisionBySymbol(
  decisions: Record<string, StOccurrenceDecision>,
): Record<string, StOccurrenceDecision> {
  const map: Record<string, StOccurrenceDecision> = {};
  for (const d of Object.values(decisions)) {
    const existing = map[d.symbol];
    if (!existing || d.decidedAt > existing.decidedAt) {
      map[d.symbol] = d;
    }
  }
  return map;
}

function buildDecision(
  runId: string,
  marketDate: string,
  signal: StSignalItem,
  decisionType: DurableDecisionType,
): StOccurrenceDecision {
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

export const OccurrenceDecisionStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  withComputed((state) => {
    /** Latest decision per symbol (by decidedAt) across all loaded runs. */
    const latestBySymbol = computed((): Record<string, StOccurrenceDecision> =>
      latestDecisionBySymbol(state.occurrenceDecisions())
    );

    const acceptedSymbols = computed((): string[] =>
      Array.from(
        new Set(
          Object.values(latestBySymbol())
            .filter((d) => d.decisionType === ReviewDecision.ACCEPT)
            .map((d) => d.symbol)
        )
      )
    );

    const activeOrderDecisions = computed((): StOccurrenceDecision[] =>
      Object.values(latestBySymbol())
        .filter((d) => d.decisionType === ReviewDecision.ACCEPT)
        .sort((a, b) => a.symbol.localeCompare(b.symbol))
    );

    const activeOrderSymbols = computed((): string[] =>
      Array.from(new Set(activeOrderDecisions().map((d) => d.symbol)))
    );

    return {
      acceptedSymbols,

      /** Accepted occurrence decisions (latest per symbol). */
      activeOrderDecisions,

      /** Accepted symbols suitable for the Order page. */
      activeOrderSymbols,

      /** Count of symbols with an accepted latest decision. */
      acceptedCount: computed((): number => acceptedSymbols().length),

      /** True while decisions are loading. */
      loading: computed((): boolean => state.decisionsLoading()),

      /**
       * Latest decision per symbol (by decidedAt) across all loaded runs.
       * Exposed for the UI to display staleness and decision date.
       */
      latestBySymbol,

      /**
       * Per-symbol durable decision status based on the latest decision.
       * Returns ACCEPT or REJECT if a decision exists, PENDING otherwise.
       */
      statusBySymbol: computed((): Record<string, ReviewDecision> => {
        const map: Record<string, ReviewDecision> = {};
        for (const d of Object.values(latestBySymbol())) {
          map[d.symbol] = d.decisionType;
        }
        return map;
      }),

      /** Counts of durable decision statuses (ACCEPT/REJECT) based on latest per symbol. */
      durableStatusCounts: computed((): StatusCounts => {
        const counts = Object.fromEntries(
          ALL_REVIEW_STATUSES.map((s) => [s, 0])
        ) as StatusCounts;
        for (const d of Object.values(latestBySymbol())) {
          counts[d.decisionType]++;
        }
        return counts;
      }),
    };
  }),

  withMethods((
    state,
    occurrenceService = inject(OccurrenceDecisionService),
    snackBar = inject(MatSnackBar),
  ) => ({
    /** Returns the latest durable decision status for a symbol, or PENDING if none. */
    statusForSymbol(symbol: string): ReviewDecision {
      const normalized = symbol.toUpperCase();
      const latest = latestDecisionBySymbol(state.occurrenceDecisions())[normalized];
      return latest?.decisionType ?? ReviewDecision.PENDING;
    },

    /** Persist ACCEPT decisions for the given signal occurrences in the active run. */
    acceptSignals(signals: StSignalItem[], runId: string, marketDate: string): void {
      this.persistSignalDecisions(signals, runId, marketDate, ReviewDecision.ACCEPT);
    },

    /** Persist REJECT decisions for the given signal occurrences in the active run. */
    rejectSignals(signals: StSignalItem[], runId: string, marketDate: string): void {
      this.persistSignalDecisions(signals, runId, marketDate, ReviewDecision.REJECT);
    },

    /** Delete durable decisions for the given signal occurrences. */
    resetSignals(signals: StSignalItem[], runId: string): void {
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

    /**
     * Delete ALL occurrence decisions for a symbol across all runs (manual
     * "clear history" action). Removes from local state and Firestore.
     */
    clearSymbolHistory(symbol: string): void {
      const previousDecisions = state.occurrenceDecisions();
      const next = { ...previousDecisions };
      const normalized = symbol.toUpperCase();
      for (const [id, d] of Object.entries(previousDecisions)) {
        if (d.symbol === normalized) {
          delete next[id];
        }
      }
      patchState(state, { occurrenceDecisions: next });

      occurrenceService.deleteAllDecisionsForSymbol(normalized).subscribe({
        error: (err: unknown) => {
          console.error('[OccurrenceDecisionStore] Failed to clear symbol history:', err);
          const message = err instanceof Error ? err.message : String(err ?? 'Clear failed');
          patchState(state, { occurrenceDecisions: previousDecisions, decisionsError: message });
          snackBar.open('Failed to clear decision history — reverted', 'Dismiss', { duration: 4000 });
        },
      });
    },

    /**
     * Load decisions for a specific source run (legacy — kept for backward
     * compatibility). Prefer loadRecentDecisions for cross-run UI.
     */
    loadDecisionsForRun(runId: string): void {
      patchState(state, { decisionsLoading: true, decisionsError: null });
      occurrenceService.loadDecisionsForRun(runId).subscribe({
        next: (decisions) => {
          const map: Record<string, StOccurrenceDecision> = {};
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
     * Load all decisions made within the last `days` days (default
     * DECISION_FETCH_DAYS). This is the primary load method for the signal
     * review UI — it surfaces cross-run decisions so accepts/rejects from
     * prior days remain visible.
     */
    loadRecentDecisions(days: number = DECISION_FETCH_DAYS): void {
      patchState(state, { decisionsLoading: true, decisionsError: null });
      occurrenceService.loadDecisionsForLastNDays(days).subscribe({
        next: (decisions) => {
          const map: Record<string, StOccurrenceDecision> = {};
          for (const d of decisions) {
            map[d.id] = d;
          }
          patchState(state, { occurrenceDecisions: map, decisionsLoading: false });
        },
        error: (err: unknown) => {
          console.error('[OccurrenceDecisionStore] Failed to load recent decisions:', err);
          const message = err instanceof Error ? err.message : String(err ?? 'Load failed');
          patchState(state, { decisionsLoading: false, decisionsError: message });
        },
      });
    },

    /** Mark every decision for the given source run as no longer current in the latest run. */
    markRunNotCurrent(runId: string): void {
      const previousDecisions = state.occurrenceDecisions();
      const next: Record<string, StOccurrenceDecision> = {};
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
      signals: StSignalItem[],
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
