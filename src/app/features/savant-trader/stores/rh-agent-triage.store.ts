/**
 * RH Agent Triage Store
 *
 * In-memory source of truth for ephemeral RACR (Review/Accept/Consider/Reject/etc.)
 * UI state across all RH Agent pages: Grouped Review, Review, and Order.
 *
 * Review flags are persisted via TriageService. ACR statuses are purely
 * local UI feedback; durable ACCEPT/REJECT decisions live in
 * RhAgentOccurrenceDecisionStore.
 *
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

import { ReviewDecision, ALL_REVIEW_STATUSES, StatusCounts, RhSymbolListName, ViewportMode } from '../common/constants';
import { TriageService } from '../services/triage.service';

const ReviewStatus = ReviewDecision;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface RhAgentTriageState {
  /** Per-symbol ACR status. Key = symbol ticker. Values: PENDING/ACCEPT/CONSIDER/REJECT/WATCH/etc. */
  statuses: Record<string, ReviewDecision>;
  /** Per-symbol review flag â€” "I want to look at this symbol's chart." Independent of ACR. */
  reviewFlags: Record<string, boolean>;
  /** Viewport mode: 'signals' = show only review-flagged symbols, 'browse' = show all list symbols. */
  viewportMode: ViewportMode;
  /** Currently selected list for viewport filtering. */
  activeViewportList: string;
  /** True while review flags are loading from Firestore. */
  reviewFlagsLoading: boolean;
  /** Error from loading review flags. */
  reviewFlagsError: string | null;
}

const initialState: RhAgentTriageState = {
  statuses: {},
  reviewFlags: {},
  viewportMode: 'signals',
  activeViewportList: RhSymbolListName.NONE,
  reviewFlagsLoading: false,
  reviewFlagsError: null,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const RhAgentTriageStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  withComputed((state) => ({
    /** Symbols flagged for review â€” feeds the Review page sidebar. */
    reviewSymbols: computed((): string[] =>
      Object.entries(state.reviewFlags())
        .filter(([_, flagged]) => flagged)
        .map(([symbol]) => symbol)
    ),

    /** Symbols with ACCEPT status â€” local ephemeral status for UI feedback. */
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

    /** True while review flags are still loading. */
    loading: computed((): boolean => state.reviewFlagsLoading()),

    /** Full status counts â€” useful for summary chips. */
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
    triageService = inject(TriageService),
    snackBar = inject(MatSnackBar),
  ) => ({
    /** Set a single symbol's ACR status in ephemeral in-memory state. */
    setStatus(symbol: string, status: ReviewDecision): void {
      patchState(state, {
        statuses: { ...state.statuses(), [symbol]: status },
      });
    },

    /** Replace the ephemeral ACR status map in one shot. */
    setStatuses(statuses: Record<string, ReviewDecision>): void {
      patchState(state, { statuses });
    },

    /** Set PACR status for multiple symbols in ephemeral in-memory state. */
    setGroupStatus(symbols: string[], status: ReviewDecision): void {
      const updates: Record<string, ReviewDecision> = {};
      for (const symbol of symbols) {
        updates[symbol] = status;
      }
      patchState(state, {
        statuses: { ...state.statuses(), ...updates },
      });
    },

    /** Load review flags from Firestore and replace local flags. */
    loadReviewFlags(): void {
      patchState(state, { reviewFlagsLoading: true, reviewFlagsError: null });
      triageService.loadReviewFlags().subscribe({
        next: (symbols) => {
          patchState(state, { reviewFlagsLoading: false });
          const flags: Record<string, boolean> = {};
          for (const symbol of symbols) {
            flags[symbol] = true;
          }
          patchState(state, { reviewFlags: flags });
        },
        error: (err: unknown) => {
          console.error('[TriageStore] Failed to load review flags:', err);
          patchState(state, { reviewFlagsLoading: false, reviewFlagsError: err instanceof Error ? err.message : String(err ?? 'Load failed') });
        },
      });
    },

    /** Clear review flags â€” unflag all symbols from the review queue (in-memory only). */
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
      const durableOnly: Record<string, ReviewDecision> = {};
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

    /** Mark a symbol as ACCEPT (ephemeral UI state). */
    acceptSymbol(symbol: string): void   { this.setStatus(symbol, ReviewStatus.ACCEPT); },
    /** Mark a symbol as CONSIDER (ephemeral screening state). */
    considerSymbol(symbol: string): void { this.setStatus(symbol, ReviewStatus.CONSIDER); },
    /** Mark a symbol as REJECT (ephemeral UI state). */
    rejectSymbol(symbol: string): void   { this.setStatus(symbol, ReviewStatus.REJECT); },
    /** Mark a symbol as WATCH (ephemeral screening state). */
    watchSymbol(symbol: string): void    { this.setStatus(symbol, ReviewStatus.WATCH); },
    /** Reset a symbol's daily status back to PENDING. */
    resetSymbol(symbol: string): void {
      this.setStatus(symbol, ReviewStatus.PENDING);
    },
  })),

  withHooks((store) => ({
    onInit() {
      store.loadReviewFlags();
    },
  }))
);

/** True for statuses that represent a durable source-specific decision. */
function isDurableDecision(status: ReviewDecision): boolean {
  return (
    status === ReviewStatus.ACCEPT ||
    status === ReviewStatus.REJECT
  );
}
