/**
 * Savant Trader Triage Store
 *
 * In-memory source of truth for ephemeral screening UI state across all
 * Savant Trader pages: Grouped Review, Review, and Order.
 *
 * #1016 — review-list persistence was removed (TriageService and the
 * savant-trader/data/review-list collection are gone). The persistence
 * calls below are commented out; flags are session-local only until the
 * review pages are repurposed.
 * #1017 — the ACR workflow is gone: durable ACCEPT/REJECT decisions AND
 * ephemeral CONSIDER/WATCH screening statuses were removed.
 *
 * providedIn: 'root' so state survives route navigation.
 */
import { computed } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';

import { ViewportMode, type SymbolListFilter } from '../common/constants';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface TriageState {
  /** Per-symbol review flag — "I want to look at this symbol's chart." Independent of ACR. */
  reviewFlags: Record<string, boolean>;
  /** Viewport mode: 'signals' = show only review-flagged symbols, 'browse' = show all list symbols. */
  viewportMode: ViewportMode;
  /** Currently selected list for viewport filtering. */
  activeViewportList: SymbolListFilter;
}

const initialState: TriageState = {
  reviewFlags: {},
  // #1016 — 'signals' mode filtered on persisted review flags; with
  // review-list removed the flagged queue stays empty, so the page
  // opens on 'browse' until the review surfaces are repurposed.
  viewportMode: 'browse',
  activeViewportList: 'ALL',
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const TriageStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  withComputed((state) => ({
    /** Symbols flagged for review — feeds the Review page sidebar. */
    reviewSymbols: computed((): string[] =>
      Object.entries(state.reviewFlags())
        .filter(([_, flagged]) => flagged)
        .map(([symbol]) => symbol)
    ),

    /** Count of symbols flagged for review. */
    reviewCount: computed((): number =>
      Object.values(state.reviewFlags()).filter(Boolean).length
    ),
  })),

  withMethods((state) => ({
    // #1016 — the load path (Firestore hydrate + loading/error state)
    // was deleted with review-list persistence; group.store keeps a
    // breadcrumb at the seam where loadReviewFlags() used to fire.

    /** Clear review flags — session-local only (#1016). */
    clearReviewFlags(): void {
      patchState(state, { reviewFlags: {} });
    },

    // --- Review flag methods (independent of ACR, session-local) ---

    /** Flag a symbol for review — session-local only (#1016). */
    markForReview(symbol: string): void {
      const sym = symbol.toUpperCase();
      patchState(state, {
        reviewFlags: { ...state.reviewFlags(), [sym]: true },
      });
    },

    /** Unflag a symbol from review — session-local only (#1016). */
    unmarkFromReview(symbol: string): void {
      const sym = symbol.toUpperCase();
      const nextFlags = { ...state.reviewFlags() };
      delete nextFlags[sym];
      patchState(state, { reviewFlags: nextFlags });
    },

    /** Flag multiple symbols for review — session-local only (#1016). */
    markGroupForReview(symbols: string[]): void {
      const flags = { ...state.reviewFlags() };
      for (const s of symbols) { flags[s.toUpperCase()] = true; }
      patchState(state, { reviewFlags: flags });
    },

    /** Run-switch hook — no-op since #1017 dropped the ephemeral
     *  CONSIDER/WATCH screening statuses. Review flags are dateless and
     *  survive run switches. Kept so setActiveRun's call stays at the seam. */
    resetForRun(): void {
      // #1017 — nothing ephemeral remains to reset.
    },

    // --- Viewport methods ---

    /** Set the viewport mode (signals or browse). */
    setViewportMode(mode: ViewportMode): void {
      patchState(state, { viewportMode: mode });
    },

    /** Set the active list filter for viewport. */
    setActiveViewportList(listName: SymbolListFilter): void {
      patchState(state, { activeViewportList: listName });
    },
  }))
);
