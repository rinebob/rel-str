/**
 * RH Agent Triage Store
 *
 * Single source of truth for RACR (Review/Accept/Consider/Reject/Exclude/etc.)
 * state across all RH Agent pages: Grouped Review, Review, and Order.
 *
 * Persisted to Firestore via RhAgentTriageService.
 * providedIn: 'root' so state survives route navigation.
 */
import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  withHooks,
  patchState,
} from '@ngrx/signals';

import { RhReviewStatus, ALL_REVIEW_STATUSES, StatusCounts } from '../common/rh-agent.constants';
import { RhAgentTriageService } from '../services/rh-agent-triage.service';

const ReviewStatus = RhReviewStatus;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface RhAgentTriageState {
  /** Per-symbol PACR status. Key = symbol ticker. */
  statuses: Record<string, RhReviewStatus>;
  /** Active timeframe carried from Grouped Review. */
  timeframe: 'W' | 'D';
  /** Active run ID — the run whose signals are being triaged. */
  activeRunId: string | null;
  /** Market date of the active run (YYYY-MM-DD) — used for triage decision persistence only. */
  activeMarketDate: string | null;
  /** Whether persisted decisions are being loaded. */
  decisionsLoading: boolean;
  /** Error from loading or persisting decisions. */
  decisionsError: string | null;
  /** Cache of all persisted decisions loaded from Firestore: symbol -> date -> status. */
  persistedStatuses: Record<string, Record<string, RhReviewStatus>>;
}

const initialState: RhAgentTriageState = {
  statuses: {},
  timeframe: 'W',
  activeRunId: null,
  activeMarketDate: null,
  decisionsLoading: false,
  decisionsError: null,
  persistedStatuses: {},
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const RhAgentTriageStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  withComputed((state) => ({
    /** Symbols with REVIEW status — feeds the Review page. */
    reviewSymbols: computed((): string[] =>
      Object.entries(state.statuses())
        .filter(([_, status]) => status === ReviewStatus.REVIEW)
        .map(([symbol]) => symbol)
    ),

    /** Symbols with ACCEPT status — feeds the Order page. */
    acceptedSymbols: computed((): string[] =>
      Object.entries(state.statuses())
        .filter(([_, status]) => status === ReviewStatus.ACCEPT)
        .map(([symbol]) => symbol)
    ),

    /** Count of REVIEW symbols (for badge on "Review" button). */
    reviewCount: computed((): number =>
      Object.values(state.statuses()).filter((s) => s === ReviewStatus.REVIEW).length
    ),

    /** Count of ACCEPT symbols (for badge on "Order Accepted" button). */
    acceptedCount: computed((): number =>
      Object.values(state.statuses()).filter((s) => s === ReviewStatus.ACCEPT).length
    ),

    /** Full status counts — useful for summary chips. */
    statusCounts: computed((): StatusCounts => {
      const values = Object.values(state.statuses());
      const counts = Object.fromEntries(
        ALL_REVIEW_STATUSES.map((status) => [status, values.filter((s) => s === status).length])
      ) as StatusCounts;
      return counts;
    }),
  })),

  withMethods((
    state,
    triageService = inject(RhAgentTriageService),
  ) => ({
    /** Set a single symbol's PACR status and persist it. */
    setStatus(symbol: string, status: RhReviewStatus, source = 'unknown'): void {
      const marketDate = state.activeMarketDate();
      patchState(state, {
        statuses: { ...state.statuses(), [symbol]: status },
        persistedStatuses: marketDate ? mergePersistedStatus(state.persistedStatuses(), symbol, marketDate, status) : state.persistedStatuses(),
      });

      if (!marketDate) return;
      triageService.setDecision({ symbol, date: marketDate, status, source }).subscribe({
        error: (err) => {
          console.error(`[TriageStore] Failed to persist status for ${symbol}:`, err);
          patchState(state, { decisionsError: err?.message ?? 'Persist failed' });
        },
      });
    },

    /** Set PACR status for multiple symbols at once (group-level action) and persist. */
    setGroupStatus(symbols: string[], status: RhReviewStatus, source = 'unknown'): void {
      const marketDate = state.activeMarketDate();
      const current = state.statuses();
      const updates: Record<string, RhReviewStatus> = {};
      let persisted = state.persistedStatuses();
      for (const symbol of symbols) {
        updates[symbol] = status;
        if (marketDate) persisted = mergePersistedStatus(persisted, symbol, marketDate, status);
      }
      patchState(state, { statuses: { ...current, ...updates }, persistedStatuses: persisted });

      if (!marketDate) return;
      const inputs = symbols.map((symbol) => ({ symbol, date: marketDate, status, source }));
      triageService.setDecisionsBatch(inputs).subscribe({
        error: (err) => {
          console.error(`[TriageStore] Failed to persist group status:`, err);
          patchState(state, { decisionsError: err?.message ?? 'Batch persist failed' });
        },
      });
    },

    /** Set the active timeframe. */
    setTimeframe(timeframe: 'W' | 'D'): void {
      patchState(state, { timeframe });
    },

    /** Set the active run and sync local statuses from persisted cache for that run's market date. */
    setActiveRun(runId: string, marketDate: string): void {
      const persisted = state.persistedStatuses();
      const dateStatuses: Record<string, RhReviewStatus> = {};
      for (const [symbol, byDate] of Object.entries(persisted)) {
        if (byDate[marketDate]) {
          dateStatuses[symbol] = byDate[marketDate];
        }
      }
      patchState(state, {
        activeRunId: runId,
        activeMarketDate: marketDate,
        statuses: { ...state.statuses(), ...dateStatuses },
      });
    },

    /** Load persisted decisions for a date range and merge into local state. */
    loadPersistedDecisions(startDate: string, endDate: string): void {
      patchState(state, { decisionsLoading: true, decisionsError: null });

      triageService.loadDecisionsForDateRange(startDate, endDate).subscribe({
        next: (decisions) => {
          let persisted = state.persistedStatuses();
          const currentStatuses = { ...state.statuses() };
          // Fall back to endDate when activeMarketDate is not yet set (e.g. direct page reload).
          const currentDate = state.activeMarketDate() ?? endDate;

          for (const d of decisions) {
            persisted = mergePersistedStatus(persisted, d.symbol, d.date, d.status);
            if (d.date === currentDate) {
              currentStatuses[d.symbol] = d.status;
            }
          }

          patchState(state, {
            persistedStatuses: persisted,
            statuses: currentStatuses,
            decisionsLoading: false,
            activeMarketDate: state.activeMarketDate() ?? endDate,
          });
        },
        error: (err) => {
          console.error('[TriageStore] Failed to load persisted decisions:', err);
          patchState(state, { decisionsLoading: false, decisionsError: err?.message ?? 'Load failed' });
        },
      });
    },

    /** Clear all triage state — full local reset (does not delete Firestore). */
    clear(): void {
      patchState(state, { statuses: {} });
    },

    // --- Convenience methods for daily PACR actions ---

    /** Mark a symbol as REVIEW and persist. */
    markForReview(symbol: string): void  { this.setStatus(symbol, ReviewStatus.REVIEW,   'triage-store'); },
    /** Mark a symbol as ACCEPT and persist. */
    acceptSymbol(symbol: string): void   { this.setStatus(symbol, ReviewStatus.ACCEPT,   'triage-store'); },
    /** Mark a symbol as CONSIDER and persist. */
    considerSymbol(symbol: string): void { this.setStatus(symbol, ReviewStatus.CONSIDER, 'triage-store'); },
    /** Mark a symbol as REJECT and persist. */
    rejectSymbol(symbol: string): void   { this.setStatus(symbol, ReviewStatus.REJECT,   'triage-store'); },
    /** Mark a symbol as WATCH and persist. */
    watchSymbol(symbol: string): void    { this.setStatus(symbol, ReviewStatus.WATCH,    'triage-store'); },
    /** Reset a symbol's daily status back to PENDING and persist. */
    resetSymbol(symbol: string): void    { this.setStatus(symbol, ReviewStatus.PENDING,  'triage-store'); },
  })),

  withHooks((store) => ({
    onInit() {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const startDate = thirtyDaysAgo.toISOString().slice(0, 10);

      store.loadPersistedDecisions(startDate, today);
    },
  }))
);

/**
 * Immutable update of the persisted status cache.
 * Returns a new object with the given symbol/date updated to the new status.
 */
function mergePersistedStatus(
  persisted: Record<string, Record<string, RhReviewStatus>>,
  symbol: string,
  date: string,
  status: RhReviewStatus,
): Record<string, Record<string, RhReviewStatus>> {
  return {
    ...persisted,
    [symbol]: {
      ...(persisted[symbol] ?? {}),
      [date]: status,
    },
  };
}
