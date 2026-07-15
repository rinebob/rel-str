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

import { RhReviewStatus, ALL_REVIEW_STATUSES, StatusCounts, RhSymbolListName, ViewportMode } from '../common/rh-agent.constants';
import { RhAgentTriageService } from '../services/rh-agent-triage.service';
import { todayDate, daysAgoPt } from '../utils/rh-agent.utils';

const ReviewStatus = RhReviewStatus;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface RhAgentTriageState {
  /** Per-symbol ACR status. Key = symbol ticker. Values: PENDING/ACCEPT/CONSIDER/REJECT/WATCH/etc. */
  statuses: Record<string, RhReviewStatus>;
  /** Per-symbol review flag — "I want to look at this symbol's chart." Independent of ACR. */
  reviewFlags: Record<string, boolean>;
  /** Viewport mode: 'signals' = show only review-flagged symbols, 'browse' = show all list symbols. */
  viewportMode: ViewportMode;
  /** Currently selected list for viewport filtering. */
  activeViewportList: string;
  /** Whether persisted decisions are being loaded. */
  decisionsLoading: boolean;
  /** Error from loading or persisting decisions. */
  decisionsError: string | null;
  /** Cache of all persisted decisions loaded from Firestore: symbol -> date -> status. */
  persistedStatuses: Record<string, Record<string, RhReviewStatus>>;
}

const initialState: RhAgentTriageState = {
  statuses: {},
  reviewFlags: {},
  viewportMode: 'signals',
  activeViewportList: RhSymbolListName.NONE,
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
    /** Symbols flagged for review — feeds the Review page sidebar. */
    reviewSymbols: computed((): string[] =>
      Object.entries(state.reviewFlags())
        .filter(([_, flagged]) => flagged)
        .map(([symbol]) => symbol)
    ),

    /** Symbols with ACCEPT status — feeds the Order page. */
    acceptedSymbols: computed((): string[] =>
      Object.entries(state.statuses())
        .filter(([_, status]) => status === ReviewStatus.ACCEPT)
        .map(([symbol]) => symbol)
    ),

    /** Count of symbols flagged for review. */
    reviewCount: computed((): number =>
      Object.values(state.reviewFlags()).filter(Boolean).length
    ),

    /** Count of ACCEPT symbols (for badge on "Order Accepted" button). */
    acceptedCount: computed((): number =>
      Object.values(state.statuses()).filter((s) => s === ReviewStatus.ACCEPT).length
    ),

    /** True while persisted decisions are still loading. */
    loading: computed((): boolean => state.decisionsLoading()),

    /** Full status counts — useful for summary chips. */
    statusCounts: computed((): StatusCounts => {
      const values = Object.values(state.statuses());
      const counts = Object.fromEntries(
        ALL_REVIEW_STATUSES.map((status) => [status, values.filter((s) => s === status).length])
      ) as StatusCounts;
      // Include review count from flags (not from statuses)
      counts.REVIEW = Object.values(state.reviewFlags()).filter(Boolean).length;
      return counts;
    }),
  })),

  withMethods((
    state,
    triageService = inject(RhAgentTriageService),
    snackBar = inject(MatSnackBar),
  ) => ({
    /** Set a single symbol's ACR status. Only ACCEPT and REJECT are durable decisions. */
    setStatus(symbol: string, status: RhReviewStatus, marketDate: string, source = 'unknown'): void {
      const previous = state.statuses()[symbol];
      const isDecision = isDurableDecision(status);
      const wasDecision = isDurableDecision(previous);

      const previousStatuses = state.statuses();
      const previousPersisted = state.persistedStatuses();

      let nextPersisted = previousPersisted;
      if (isDecision) {
        nextPersisted = mergePersistedStatus(nextPersisted, symbol, marketDate, status);
      } else if (wasDecision) {
        nextPersisted = removePersistedStatus(nextPersisted, symbol, marketDate);
      }

      patchState(state, {
        statuses: { ...previousStatuses, [symbol]: status },
        persistedStatuses: nextPersisted,
      });

      const rollback = (err: unknown) => {
        console.error(`[TriageStore] Failed to persist status for ${symbol}:`, err);
        const message = err instanceof Error ? err.message : String(err ?? 'Persist failed');
        patchState(state, {
          statuses: previousStatuses,
          persistedStatuses: previousPersisted,
          decisionsError: message,
        });
        snackBar.open(`Failed to save ${symbol} status`, 'Dismiss', { duration: 4000 });
      };

      if (isDecision) {
        triageService.setDecision({ symbol, date: marketDate, status, source }).subscribe({ error: rollback });
      } else if (wasDecision) {
        triageService.deleteDecision(symbol, marketDate).subscribe({ error: rollback });
      }
    },

    /** Set PACR status for multiple symbols at once. Only ACCEPT and REJECT are durable decisions. */
    setGroupStatus(symbols: string[], status: RhReviewStatus, marketDate: string, source = 'unknown'): void {
      const isDecision = isDurableDecision(status);
      const previousStatuses = state.statuses();
      const previousPersisted = state.persistedStatuses();
      const updates: Record<string, RhReviewStatus> = {};
      let nextPersisted = previousPersisted;
      const toDelete: string[] = [];

      for (const symbol of symbols) {
        updates[symbol] = status;
        if (isDecision) {
          nextPersisted = mergePersistedStatus(nextPersisted, symbol, marketDate, status);
        } else if (isDurableDecision(previousStatuses[symbol])) {
          nextPersisted = removePersistedStatus(nextPersisted, symbol, marketDate);
          toDelete.push(symbol);
        }
      }

      patchState(state, {
        statuses: { ...previousStatuses, ...updates },
        persistedStatuses: nextPersisted,
      });

      const rollback = (err: unknown) => {
        console.error(`[TriageStore] Failed to persist group status:`, err);
        const message = err instanceof Error ? err.message : String(err ?? 'Batch persist failed');
        patchState(state, {
          statuses: previousStatuses,
          persistedStatuses: previousPersisted,
          decisionsError: message,
        });
      };

      if (isDecision) {
        const inputs = symbols.map((symbol) => ({ symbol, date: marketDate, status, source }));
        triageService.setDecisionsBatch(inputs).subscribe({ error: rollback });
      } else if (toDelete.length > 0) {
        triageService.deleteDecisionsBatch(toDelete, marketDate).subscribe({ error: rollback });
      }
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

    /** Load persisted ACCEPT/REJECT decisions for a date range and merge into local state. */
    loadPersistedDecisions(startDate: string, endDate: string, currentDate?: string): void {
      patchState(state, { decisionsLoading: true, decisionsError: null });

      triageService.loadDecisionsForDateRange(startDate, endDate).subscribe({
        next: (decisions) => {
          let persisted = state.persistedStatuses();
          const currentStatuses = currentDate ? {} : { ...state.statuses() };

          for (const d of decisions) {
            // Only durable decisions are loaded; screening states stay in memory.
            if (!isDurableDecision(d.status)) continue;
            persisted = mergePersistedStatus(persisted, d.symbol, d.date, d.status);
            if (currentDate && d.date === currentDate) {
              currentStatuses[d.symbol] = d.status;
            }
          }

          patchState(state, {
            persistedStatuses: persisted,
            statuses: currentStatuses,
            decisionsLoading: false,
          });
        },
        error: (err: unknown) => {
          console.error('[TriageStore] Failed to load persisted decisions:', err);
          const message = err instanceof Error ? err.message : String(err ?? 'Load failed');
          patchState(state, { decisionsLoading: false, decisionsError: message });
        },
      });
    },

    /** Clear review flags — unflag all symbols from the review queue (in-memory only). */
    clearReviewFlags(): void {
      patchState(state, { reviewFlags: {} });
    },

    // --- Review flag methods (independent of ACR, dateless) ---

    /** Flag a symbol for review ("I want to look at this chart"). */
    markForReview(symbol: string): void {
      patchState(state, { reviewFlags: { ...state.reviewFlags(), [symbol]: true } });
    },

    /** Unflag a symbol from review. */
    unmarkFromReview(symbol: string): void {
      const next = { ...state.reviewFlags() };
      delete next[symbol];
      patchState(state, { reviewFlags: next });
    },

    /** Flag multiple symbols for review at once. */
    markGroupForReview(symbols: string[]): void {
      const flags = { ...state.reviewFlags() };
      for (const s of symbols) { flags[s] = true; }
      patchState(state, { reviewFlags: flags });
    },

    /** Drop all in-memory statuses and review flags. Use when switching to a different run; durable decisions for the target date will be reloaded. */
    resetForRun(): void {
      patchState(state, { statuses: {}, reviewFlags: {} });
    },

    /** Drop ephemeral screening state (review flags and non-durable statuses) while keeping durable ACCEPT/REJECT decisions in memory. */
    clearEphemeralScreeningState(): void {
      const statuses = state.statuses();
      const durableOnly: Record<string, RhReviewStatus> = {};
      for (const [symbol, status] of Object.entries(statuses)) {
        if (isDurableDecision(status)) durableOnly[symbol] = status;
      }
      patchState(state, { reviewFlags: {}, statuses: durableOnly });
    },

    // --- Viewport methods ---

    /** Set the viewport mode (signals or browse). */
    setViewportMode(mode: ViewportMode): void {
      patchState(state, { viewportMode: mode });
    },

    /** Set the active list filter for viewport. */
    setActiveViewportList(listName: string): void {
      patchState(state, { activeViewportList: listName });
    },

    // --- Convenience methods for daily ACR actions ---

    /** Mark a symbol as ACCEPT and persist the durable decision. */
    acceptSymbol(symbol: string, marketDate: string): void   { this.setStatus(symbol, ReviewStatus.ACCEPT,   marketDate, 'triage-store'); },
    /** Mark a symbol as CONSIDER (ephemeral screening state). */
    considerSymbol(symbol: string, marketDate: string): void { this.setStatus(symbol, ReviewStatus.CONSIDER, marketDate, 'triage-store'); },
    /** Mark a symbol as REJECT and persist the durable decision. */
    rejectSymbol(symbol: string, marketDate: string): void   { this.setStatus(symbol, ReviewStatus.REJECT,   marketDate, 'triage-store'); },
    /** Mark a symbol as WATCH (ephemeral screening state). */
    watchSymbol(symbol: string, marketDate: string): void    { this.setStatus(symbol, ReviewStatus.WATCH,    marketDate, 'triage-store'); },
    /** Reset a symbol's daily status back to PENDING and remove any durable decision. */
    resetSymbol(symbol: string, marketDate: string): void {
      this.setStatus(symbol, ReviewStatus.PENDING, marketDate, 'triage-store');
    },
  })),

  withHooks((store) => ({
    onInit() {
      const today = todayDate();
      const startDate = daysAgoPt(30);

      store.loadPersistedDecisions(startDate, today);
    },
  }))
);

/** True for statuses that represent a durable source-specific decision. */
function isDurableDecision(status: RhReviewStatus): boolean {
  return status === ReviewStatus.ACCEPT || status === ReviewStatus.REJECT;
}

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

/**
 * Immutable removal of a symbol/date entry from the persisted status cache.
 * Drops the symbol key entirely when no dates remain.
 */
function removePersistedStatus(
  persisted: Record<string, Record<string, RhReviewStatus>>,
  symbol: string,
  date: string,
): Record<string, Record<string, RhReviewStatus>> {
  const byDate = persisted[symbol];
  if (!byDate) return persisted;
  const nextByDate = { ...byDate };
  delete nextByDate[date];
  if (Object.keys(nextByDate).length === 0) {
    const next = { ...persisted };
    delete next[symbol];
    return next;
  }
  return { ...persisted, [symbol]: nextByDate };
}
