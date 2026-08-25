/**
 * Savant Trader Occurrence Decision Store
 *
 * Durable source-specific ACCEPT / REJECT decisions for individual signal
 * occurrences. Decisions are keyed by runId + symbol + timeframe + signalType
 * so multiple intraday occurrences do not overwrite one another.
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
import { ReviewDecision, ALL_REVIEW_STATUSES, StatusCounts } from '../common/constants';
import { buildStOccurrenceDecisionId } from '../services/firestore-helpers';

export interface OccurrenceDecisionState {
  /** Durable occurrence-level decisions keyed by decision id. */
  occurrenceDecisions: Record<string, StOccurrenceDecision>;
  /** True while decisions for the active run are loading. */
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

const DURABLE_RANKED = [ReviewDecision.ACCEPT, ReviewDecision.REJECT];

/** Pick the higher-priority durable status. ACCEPT wins over REJECT. */
function rankDurable(current: ReviewDecision | null, next: ReviewDecision): ReviewDecision {
  if (!current) return next;
  return DURABLE_RANKED.indexOf(next) < DURABLE_RANKED.indexOf(current) ? next : current;
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
    const acceptedSymbols = computed((): string[] =>
      Array.from(
        new Set(
          Object.values(state.occurrenceDecisions())
            .filter((d) => d.decisionType === ReviewDecision.ACCEPT && d.isCurrentInLatestRun)
            .map((d) => d.symbol)
        )
      )
    );

    const activeOrderDecisions = computed((): StOccurrenceDecision[] =>
      Object.values(state.occurrenceDecisions())
        .filter(
          (d) =>
            d.decisionType === ReviewDecision.ACCEPT &&
            d.isCurrentInLatestRun
        )
        .sort((a, b) => a.symbol.localeCompare(b.symbol))
    );

    const activeOrderSymbols = computed((): string[] =>
      Array.from(new Set(activeOrderDecisions().map((d) => d.symbol)))
    );

    return {
      acceptedSymbols,

      /** Accepted, current-run occurrence decisions. */
      activeOrderDecisions,

      /** Accepted symbols suitable for the active Order page. */
      activeOrderSymbols,

      /** Count of symbols with an accepted current-run occurrence. */
      acceptedCount: computed((): number => acceptedSymbols().length),

      /** True while decisions are loading. */
      loading: computed((): boolean => state.decisionsLoading()),

      /** Per-symbol durable decision status (ACCEPT/REJECT) for the current run. */
      statusBySymbol: computed((): Record<string, ReviewDecision> => {
        const map: Record<string, ReviewDecision> = {};
        for (const d of Object.values(state.occurrenceDecisions())) {
          if (!d.isCurrentInLatestRun) continue;
          map[d.symbol] = rankDurable(map[d.symbol] ?? null, d.decisionType);
        }
        return map;
      }),

      /** Counts of durable decision statuses (ACCEPT/REJECT) for the current run. */
      durableStatusCounts: computed((): StatusCounts => {
        const counts = Object.fromEntries(
          ALL_REVIEW_STATUSES.map((s) => [s, 0])
        ) as StatusCounts;
        const seen = new Set<string>();
        for (const d of Object.values(state.occurrenceDecisions())) {
          if (!d.isCurrentInLatestRun) continue;
          if (seen.has(d.symbol)) continue;
          seen.add(d.symbol);
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
    /** Returns the durable decision status for a symbol in the current run, or PENDING if none. */
    statusForSymbol(symbol: string): ReviewDecision {
      const normalized = symbol.toUpperCase();
      let result: ReviewDecision | null = null;
      for (const d of Object.values(state.occurrenceDecisions())) {
        if (!d.isCurrentInLatestRun) continue;
        if (d.symbol !== normalized) continue;
        result = rankDurable(result, d.decisionType);
      }
      return result ?? ReviewDecision.PENDING;
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
          snackBar.open('Failed to reset decisions â€” reverted', 'Dismiss', { duration: 4000 });
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
          snackBar.open('Failed to reset decisions â€” reverted', 'Dismiss', { duration: 4000 });
        },
      });
    },

    /** Load durable decisions for a specific source run. */
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
