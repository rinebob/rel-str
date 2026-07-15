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
  /** Whether review flags are being loaded. */
  reviewFlagsLoading: boolean;
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
  reviewFlagsLoading: false,
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

    /** True while either decisions or review flags are still loading. */
    loading: computed((): boolean => state.decisionsLoading() || state.reviewFlagsLoading()),

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
    /** Set a single symbol's ACR status and persist it for the given market date. */
    setStatus(symbol: string, status: RhReviewStatus, marketDate: string, source = 'unknown'): void {
      patchState(state, {
        statuses: { ...state.statuses(), [symbol]: status },
        persistedStatuses: mergePersistedStatus(state.persistedStatuses(), symbol, marketDate, status),
      });

      triageService.setDecision({ symbol, date: marketDate, status, source }).subscribe({
        error: (err) => {
          console.error(`[TriageStore] Failed to persist status for ${symbol}:`, err);
          patchState(state, { decisionsError: err?.message ?? 'Persist failed' });
          snackBar.open(`Failed to save ${symbol} status`, 'Dismiss', { duration: 4000 });
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

    /** Load persisted ACR decisions for a date range and merge into local state. */
    loadPersistedDecisions(startDate: string, endDate: string, currentDate?: string): void {
      patchState(state, { decisionsLoading: true, decisionsError: null });

      triageService.loadDecisionsForDateRange(startDate, endDate).subscribe({
        next: (decisions) => {
          let persisted = state.persistedStatuses();
          const currentStatuses = { ...state.statuses() };

          for (const d of decisions) {
            // Skip legacy REVIEW docs — review flags are loaded separately.
            if (d.status === ReviewStatus.REVIEW) continue;
            persisted = mergePersistedStatus(persisted, d.symbol, d.date, d.status);
          }

          // Apply ACR statuses for the current market date.
          if (currentDate) {
            for (const d of decisions) {
              if (d.date === currentDate && d.status !== ReviewStatus.REVIEW) {
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

    /** Clear review flags — unflag all symbols from the review queue. */
    clearReviewFlags(): void {
      const previousFlags = state.reviewFlags();
      const symbolsToClear = Object.entries(previousFlags)
        .filter(([_, flagged]) => flagged)
        .map(([symbol]) => symbol);

      patchState(state, { reviewFlags: {} });

      if (symbolsToClear.length > 0) {
        triageService.setReviewFlagsBatch(symbolsToClear, false).subscribe({
          error: (err) => {
            console.error('[TriageStore] Failed to persist clear:', err);
            patchState(state, { reviewFlags: previousFlags, decisionsError: err?.message ?? 'Clear persist failed' });
            snackBar.open('Failed to clear review list — reverted', 'Dismiss', { duration: 5000 });
          },
        });
      }
    },

    // --- Review flag methods (independent of ACR, dateless) ---

    /** Flag a symbol for review ("I want to look at this chart") and persist. */
    markForReview(symbol: string): void {
      patchState(state, { reviewFlags: { ...state.reviewFlags(), [symbol]: true } });
      triageService.setReviewFlag(symbol).subscribe({
        error: (err) => {
          console.error(`[TriageStore] Failed to persist review flag for ${symbol}:`, err);
          patchState(state, { reviewFlags: { ...state.reviewFlags(), [symbol]: false } });
        },
      });
    },

    /** Unflag a symbol from review. */
    unmarkFromReview(symbol: string): void {
      const prev = state.reviewFlags();
      const next = { ...prev };
      delete next[symbol];
      patchState(state, { reviewFlags: next });
      triageService.clearReviewFlag(symbol).subscribe({
        error: (err) => {
          console.error(`[TriageStore] Failed to persist unmark review for ${symbol}:`, err);
          patchState(state, { reviewFlags: { ...state.reviewFlags(), [symbol]: true } });
        },
      });
    },

    /** Flag multiple symbols for review at once and persist. */
    markGroupForReview(symbols: string[]): void {
      const previousFlags = state.reviewFlags();
      const flags = { ...previousFlags };
      for (const s of symbols) { flags[s] = true; }
      patchState(state, { reviewFlags: flags });

      triageService.setReviewFlagsBatch(symbols, true).subscribe({
        error: (err) => {
          console.error('[TriageStore] Failed to persist group review flags:', err);
          patchState(state, { reviewFlags: previousFlags });
          snackBar.open('Failed to save review flags — reverted', 'Dismiss', { duration: 5000 });
        },
      });
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

  withHooks((store, triageService = inject(RhAgentTriageService)) => ({
    onInit() {
      const today = todayDate();
      const startDate = daysAgoPt(30);

      store.loadPersistedDecisions(startDate, today);

      // Load review flags from the dateless collection.
      patchState(store, { reviewFlagsLoading: true });
      triageService.loadReviewFlags().subscribe({
        next: (symbols) => {
          const flags: Record<string, boolean> = {};
          for (const s of symbols) { flags[s] = true; }
          patchState(store, { reviewFlags: { ...store.reviewFlags(), ...flags }, reviewFlagsLoading: false });
        },
        error: (err) => {
          console.error('[TriageStore] Failed to load review flags:', err);
          patchState(store, { reviewFlagsLoading: false, decisionsError: err?.message ?? 'Review flags load failed' });
        },
      });
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
