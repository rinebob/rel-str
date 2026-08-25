/**
 * Savant Trader Triage Store
 *
 * In-memory source of truth for ephemeral screening UI state across all
 * Savant Trader pages: Grouped Review, Review, and Order.
 *
 * Review flags are persisted via TriageService. CONSIDER/WATCH screening
 * statuses are ephemeral. Durable ACCEPT/REJECT decisions live in
 * OccurrenceDecisionStore and are NOT duplicated here.
 *
 * providedIn: 'root' so state survives route navigation.
 */
import { computed, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  withHooks,
  patchState,
} from '@ngrx/signals';

import { MatSnackBar } from '@angular/material/snack-bar';

import { ReviewDecision, SymbolListName, ViewportMode } from '../common/constants';
import { TriageService } from '../services/triage.service';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface TriageState {
  /** Per-symbol review flag — "I want to look at this symbol's chart." Independent of ACR. */
  reviewFlags: Record<string, boolean>;
  /** Per-symbol ephemeral screening status (CONSIDER/WATCH only). Durable ACCEPT/REJECT live in OccurrenceDecisionStore. */
  screeningStatuses: Record<string, ReviewDecision>;
  /** Viewport mode: 'signals' = show only review-flagged symbols, 'browse' = show all list symbols. */
  viewportMode: ViewportMode;
  /** Currently selected list for viewport filtering. */
  activeViewportList: string;
  /** True while review flags are loading from Firestore. */
  reviewFlagsLoading: boolean;
  /** Error from loading review flags. */
  reviewFlagsError: string | null;
}

const initialState: TriageState = {
  reviewFlags: {},
  screeningStatuses: {},
  viewportMode: 'signals',
  activeViewportList: SymbolListName.NONE,
  reviewFlagsLoading: false,
  reviewFlagsError: null,
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

    /** True while review flags are still loading. */
    loading: computed((): boolean => state.reviewFlagsLoading()),
  })),

  withMethods((
    state,
    triageService = inject(TriageService),
    snackBar = inject(MatSnackBar),
    destroyRef = inject(DestroyRef),
  ) => ({
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

    /** Clear review flags — unflag all symbols from the review queue. Optimistic + persisted. */
    clearReviewFlags(): void {
      const prev = state.reviewFlags();
      const flaggedSymbols = Object.entries(prev).filter(([, f]) => f).map(([s]) => s);
      patchState(state, { reviewFlags: {} });
      if (flaggedSymbols.length === 0) return;
      triageService.setReviewFlagsBatch(flaggedSymbols, false)
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          error: (err: unknown) => {
            patchState(state, { reviewFlags: prev, reviewFlagsError: err instanceof Error ? err.message : String(err) });
            snackBar.open('Failed to clear review flags', 'Dismiss', { duration: 3000 });
            console.error('[TriageStore] clearReviewFlags failed:', err);
          },
        });
    },

    // --- Review flag methods (independent of ACR, dateless) ---

    /** Flag a symbol for review ("I want to look at this chart"). Optimistic + persisted. */
    markForReview(symbol: string): void {
      const prev = state.reviewFlags();
      patchState(state, { reviewFlags: { ...prev, [symbol]: true } });
      triageService.setReviewFlag(symbol)
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          error: (err: unknown) => {
            patchState(state, { reviewFlags: prev, reviewFlagsError: err instanceof Error ? err.message : String(err) });
            snackBar.open('Failed to flag symbol for review', 'Dismiss', { duration: 3000 });
            console.error('[TriageStore] markForReview failed:', err);
          },
        });
    },

    /** Unflag a symbol from review. Optimistic + persisted. */
    unmarkFromReview(symbol: string): void {
      const prev = state.reviewFlags();
      const next = { ...prev };
      delete next[symbol];
      patchState(state, { reviewFlags: next });
      triageService.clearReviewFlag(symbol)
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          error: (err: unknown) => {
            patchState(state, { reviewFlags: prev, reviewFlagsError: err instanceof Error ? err.message : String(err) });
            snackBar.open('Failed to unflag symbol', 'Dismiss', { duration: 3000 });
            console.error('[TriageStore] unmarkFromReview failed:', err);
          },
        });
    },

    /** Flag multiple symbols for review at once. Optimistic + persisted. */
    markGroupForReview(symbols: string[]): void {
      const prev = state.reviewFlags();
      const flags = { ...prev };
      for (const s of symbols) { flags[s] = true; }
      patchState(state, { reviewFlags: flags });
      triageService.setReviewFlagsBatch(symbols, true)
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          error: (err: unknown) => {
            patchState(state, { reviewFlags: prev, reviewFlagsError: err instanceof Error ? err.message : String(err) });
            snackBar.open('Failed to flag symbols for review', 'Dismiss', { duration: 3000 });
            console.error('[TriageStore] markGroupForReview failed:', err);
          },
        });
    },

    // --- Screening status methods (ephemeral CONSIDER/WATCH only) ---

    /** Set an ephemeral screening status (CONSIDER or WATCH) for a symbol. */
    setScreeningStatus(symbol: string, status: ReviewDecision): void {
      patchState(state, {
        screeningStatuses: { ...state.screeningStatuses(), [symbol]: status },
      });
    },

    /** Clear all ephemeral screening statuses. */
    clearScreeningStatuses(): void {
      patchState(state, { screeningStatuses: {} });
    },

    /** Drop all ephemeral state (review flags + screening statuses). Use when switching runs. */
    resetForRun(): void {
      patchState(state, { reviewFlags: {}, screeningStatuses: {} });
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
  })),

  withHooks((store) => ({
    onInit() {
      store.loadReviewFlags();
    },
  }))
);
