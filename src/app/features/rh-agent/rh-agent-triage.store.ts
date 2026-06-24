/**
 * RH Agent Triage Store
 *
 * Single source of truth for PACR (Promote/Accept/Consider/Reject) state
 * across all RH Agent pages: Grouped Review, Review, and Order.
 *
 * Session-scoped — state resets on page refresh or timeframe/date change.
 * No Firestore persistence (yet).
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

import { RhReviewStatus } from './rh-agent-group.store';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface RhAgentTriageState {
  /** Per-symbol PACR status. Key = symbol ticker. */
  statuses: Record<string, RhReviewStatus>;
  /** Active timeframe carried from Grouped Review. */
  timeframe: 'W' | 'D';
  /** Active market date (YYYY-MM-DD) carried from Grouped Review. */
  marketDate: string;
}

const todayPT = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

const initialState: RhAgentTriageState = {
  statuses: {},
  timeframe: 'W',
  marketDate: todayPT(),
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const RhAgentTriageStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  withComputed((state) => ({
    /** Symbols with PROMOTE status — feeds the Review page. */
    promotedSymbols: computed((): string[] =>
      Object.entries(state.statuses())
        .filter(([_, status]) => status === 'PROMOTE')
        .map(([symbol]) => symbol)
    ),

    /** Symbols with ACCEPT status — feeds the Order page. */
    acceptedSymbols: computed((): string[] =>
      Object.entries(state.statuses())
        .filter(([_, status]) => status === 'ACCEPT')
        .map(([symbol]) => symbol)
    ),

    /** Count of PROMOTE symbols (for badge on "Review Promoted" button). */
    promotedCount: computed((): number =>
      Object.values(state.statuses()).filter((s) => s === 'PROMOTE').length
    ),

    /** Count of ACCEPT symbols (for badge on "Order Accepted" button). */
    acceptedCount: computed((): number =>
      Object.values(state.statuses()).filter((s) => s === 'ACCEPT').length
    ),

    /** Full status counts — useful for summary chips. */
    statusCounts: computed(() => {
      const values = Object.values(state.statuses());
      return {
        PENDING:  values.filter((s) => s === 'PENDING').length,
        PROMOTE:  values.filter((s) => s === 'PROMOTE').length,
        ACCEPT:   values.filter((s) => s === 'ACCEPT').length,
        CONSIDER: values.filter((s) => s === 'CONSIDER').length,
        REJECT:   values.filter((s) => s === 'REJECT').length,
      };
    }),
  })),

  withMethods((state) => ({
    /** Set a single symbol's PACR status. */
    setStatus(symbol: string, status: RhReviewStatus): void {
      patchState(state, {
        statuses: { ...state.statuses(), [symbol]: status },
      });
    },

    /** Set PACR status for multiple symbols at once (group-level action). */
    setGroupStatus(symbols: string[], status: RhReviewStatus): void {
      const current = state.statuses();
      const updates: Record<string, RhReviewStatus> = {};
      for (const symbol of symbols) {
        updates[symbol] = status;
      }
      patchState(state, { statuses: { ...current, ...updates } });
    },

    /** Set the active timeframe. */
    setTimeframe(timeframe: 'W' | 'D'): void {
      patchState(state, { timeframe });
    },

    /** Set the active market date. */
    setMarketDate(marketDate: string): void {
      patchState(state, { marketDate });
    },

    /** Clear all triage state — full reset. */
    clear(): void {
      patchState(state, { statuses: {} });
    },

    // --- Convenience methods (match RhAgentGroupStore pattern) ---

    promoteSymbol(symbol: string): void  { this.setStatus(symbol, 'PROMOTE'); },
    acceptSymbol(symbol: string): void   { this.setStatus(symbol, 'ACCEPT'); },
    considerSymbol(symbol: string): void { this.setStatus(symbol, 'CONSIDER'); },
    rejectSymbol(symbol: string): void   { this.setStatus(symbol, 'REJECT'); },
    resetSymbol(symbol: string): void    { this.setStatus(symbol, 'PENDING'); },
  }))
);
