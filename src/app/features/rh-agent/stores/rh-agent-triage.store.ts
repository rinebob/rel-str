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

import { MatSnackBar } from '@angular/material/snack-bar';

import { RhReviewStatus, ALL_REVIEW_STATUSES, StatusCounts } from '../common/rh-agent.constants';
import { RhAgentTriageService } from '../services/rh-agent-triage.service';
import { todayDate, daysAgoPt } from '../utils/rh-agent.utils';

const ReviewStatus = RhReviewStatus;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface RhAgentTriageState {
  /** Per-symbol PACR status. Key = symbol ticker. */
  statuses: Record<string, RhReviewStatus>;
  /** Whether persisted decisions are being loaded. */
  decisionsLoading: boolean;
  /** Error from loading or persisting decisions. */
  decisionsError: string | null;
  /** Cache of all persisted decisions loaded from Firestore: symbol -> date -> status. */
  persistedStatuses: Record<string, Record<string, RhReviewStatus>>;
}

const initialState: RhAgentTriageState = {
  statuses: {},
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
    snackBar = inject(MatSnackBar),
  ) => ({
    /** Set a single symbol's PACR status and persist it for the given market date. */
    setStatus(symbol: string, status: RhReviewStatus, marketDate: string, source = 'unknown'): void {
      patchState(state, {
        statuses: { ...state.statuses(), [symbol]: status },
        persistedStatuses: mergePersistedStatus(state.persistedStatuses(), symbol, marketDate, status),
      });

      triageService.setDecision({ symbol, date: marketDate, status, source }).subscribe({
        error: (err) => {
          console.error(`[TriageStore] Failed to persist status for ${symbol}:`, err);
          patchState(state, { decisionsError: err?.message ?? 'Persist failed' });
        },
      });
    },

    /** Set PACR status for multiple symbols at once (group-level action) and persist. */
    setGroupStatus(symbols: string[], status: RhReviewStatus, marketDate: string, source = 'unknown'): void {
      const current = state.statuses();
      const updates: Record<string, RhReviewStatus> = {};
      let persisted = state.persistedStatuses();
      for (const symbol of symbols) {
        updates[symbol] = status;
        persisted = mergePersistedStatus(persisted, symbol, marketDate, status);
      }
      patchState(state, { statuses: { ...current, ...updates }, persistedStatuses: persisted });

      const inputs = symbols.map((symbol) => ({ symbol, date: marketDate, status, source }));
      triageService.setDecisionsBatch(inputs).subscribe({
        error: (err) => {
          console.error(`[TriageStore] Failed to persist group status:`, err);
          patchState(state, { decisionsError: err?.message ?? 'Batch persist failed' });
        },
      });
    },

    /** Sync local statuses from the persisted cache for the given market date. */
    syncStatusesForDate(marketDate: string): void {
      const persisted = state.persistedStatuses();
      const dateStatuses: Record<string, RhReviewStatus> = {};
      for (const [symbol, byDate] of Object.entries(persisted)) {
        if (byDate[marketDate]) {
          dateStatuses[symbol] = byDate[marketDate];
        }
      }
      patchState(state, {
        statuses: { ...state.statuses(), ...dateStatuses },
      });
    },

    /** Load persisted decisions for a date range and merge into local state. */
    loadPersistedDecisions(startDate: string, endDate: string, currentDate?: string): void {
      patchState(state, { decisionsLoading: true, decisionsError: null });

      triageService.loadDecisionsForDateRange(startDate, endDate).subscribe({
        next: (decisions) => {
          let persisted = state.persistedStatuses();
          const currentStatuses = { ...state.statuses() };

          for (const d of decisions) {
            persisted = mergePersistedStatus(persisted, d.symbol, d.date, d.status);
            // Always restore REVIEW status regardless of date — the review queue
            // should show any symbol the user marked for review in the window.
            if (d.status === ReviewStatus.REVIEW) {
              currentStatuses[d.symbol] = d.status;
            }
          }

          // Also apply non-REVIEW statuses for the current market date when provided.
          if (currentDate) {
            for (const d of decisions) {
              if (d.date === currentDate) {
                currentStatuses[d.symbol] = d.status;
              }
            }
          }

          patchState(state, {
            persistedStatuses: persisted,
            statuses: currentStatuses,
            decisionsLoading: false,
          });
        },
        error: (err) => {
          console.error('[TriageStore] Failed to load persisted decisions:', err);
          patchState(state, { decisionsLoading: false, decisionsError: err?.message ?? 'Load failed' });
        },
      });
    },

    /** Clear review/accept queues — resets those symbols to PENDING locally and in Firestore. */
    clear(marketDate: string): void {
      const previousStatuses = state.statuses();
      const previousPersisted = state.persistedStatuses();
      const symbolsToClear = Object.entries(previousStatuses)
        .filter(([_, status]) => status === ReviewStatus.REVIEW || status === ReviewStatus.ACCEPT)
        .map(([symbol]) => symbol);

      // Update persistedStatuses cache so any subsequent loadPersistedDecisions
      // won't restore these symbols as REVIEW from the in-memory cache.
      let persisted = previousPersisted;
      for (const symbol of symbolsToClear) {
        persisted = mergePersistedStatus(persisted, symbol, marketDate, ReviewStatus.PENDING);
      }

      // Clear local state for ALL statuses and update persisted cache
      patchState(state, { statuses: {}, persistedStatuses: persisted });

      // Persist PENDING for symbols that were REVIEW or ACCEPT
      if (symbolsToClear.length > 0) {
        const inputs = symbolsToClear.map((symbol) => ({
          symbol,
          date: marketDate,
          status: ReviewStatus.PENDING as RhReviewStatus,
          source: 'clear-triage',
        }));
        triageService.setDecisionsBatch(inputs).subscribe({
          error: (err) => {
            console.error('[TriageStore] Failed to persist clear:', err);
            patchState(state, {
              statuses: previousStatuses,
              persistedStatuses: previousPersisted,
              decisionsError: err?.message ?? 'Clear persist failed',
            });
            snackBar.open('Failed to clear review list — reverted', 'Dismiss', { duration: 5000 });
          },
        });
      }
    },

    // --- Convenience methods for daily PACR actions ---

    /** Mark a symbol as REVIEW and persist. */
    markForReview(symbol: string, marketDate: string): void  { this.setStatus(symbol, ReviewStatus.REVIEW,   marketDate, 'triage-store'); },
    /** Mark a symbol as ACCEPT and persist. */
    acceptSymbol(symbol: string, marketDate: string): void   { this.setStatus(symbol, ReviewStatus.ACCEPT,   marketDate, 'triage-store'); },
    /** Mark a symbol as CONSIDER and persist. */
    considerSymbol(symbol: string, marketDate: string): void { this.setStatus(symbol, ReviewStatus.CONSIDER, marketDate, 'triage-store'); },
    /** Mark a symbol as REJECT and persist. */
    rejectSymbol(symbol: string, marketDate: string): void   { this.setStatus(symbol, ReviewStatus.REJECT,   marketDate, 'triage-store'); },
    /** Mark a symbol as WATCH and persist. */
    watchSymbol(symbol: string, marketDate: string): void    { this.setStatus(symbol, ReviewStatus.WATCH,    marketDate, 'triage-store'); },
    /** Reset a symbol's daily status back to PENDING and persist. */
    resetSymbol(symbol: string, marketDate: string): void    { this.setStatus(symbol, ReviewStatus.PENDING,  marketDate, 'triage-store'); },
  })),

  withHooks((store) => ({
    onInit() {
      const today = todayDate();
      const startDate = daysAgoPt(30);

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
