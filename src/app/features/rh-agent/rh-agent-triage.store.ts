/**
 * RH Agent Triage Store
 *
 * Single source of truth for PACR (Promote/Accept/Consider/Reject/Exclude/etc.)
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

import { RhReviewStatus, ALL_REVIEW_STATUSES, StatusCounts } from './common/rh-agent.constants';
import { RhAgentTriageService } from './rh-agent-triage.service';

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
  /** Whether persisted decisions are being loaded. */
  decisionsLoading: boolean;
  /** Error from loading or persisting decisions. */
  decisionsError: string | null;
  /** Cache of all persisted decisions loaded from Firestore: symbol -> date -> status. */
  persistedStatuses: Record<string, Record<string, RhReviewStatus>>;
}

const todayPT = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

const initialState: RhAgentTriageState = {
  statuses: {},
  timeframe: 'W',
  marketDate: todayPT(),
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
      const marketDate = state.marketDate();
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
    setGroupStatus(symbols: string[], status: RhReviewStatus, source = 'unknown'): void {
      const marketDate = state.marketDate();
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

    /** Set the active timeframe. */
    setTimeframe(timeframe: 'W' | 'D'): void {
      patchState(state, { timeframe });
    },

    /** Set the active market date and sync local statuses from persisted cache. */
    setMarketDate(marketDate: string): void {
      const persisted = state.persistedStatuses();
      const dateStatuses: Record<string, RhReviewStatus> = {};
      for (const [symbol, byDate] of Object.entries(persisted)) {
        if (byDate[marketDate]) {
          dateStatuses[symbol] = byDate[marketDate];
        }
      }
      patchState(state, {
        marketDate,
        statuses: { ...state.statuses(), ...dateStatuses },
      });
    },

    /** Load persisted decisions for a date range and merge into local state. */
    loadPersistedDecisions(startDate: string, endDate: string): void {
      patchState(state, { decisionsLoading: true, decisionsError: null });

      triageService.loadDecisionsForDateRange(startDate, endDate).subscribe({
        next: (decisions) => {
          let persisted = state.persistedStatuses();
          const currentStatuses = state.statuses();
          const currentDate = state.marketDate();

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

    promoteSymbol(symbol: string): void  { this.setStatus(symbol, 'PROMOTE', 'triage-store'); },
    acceptSymbol(symbol: string): void   { this.setStatus(symbol, 'ACCEPT', 'triage-store'); },
    considerSymbol(symbol: string): void { this.setStatus(symbol, 'CONSIDER', 'triage-store'); },
    rejectSymbol(symbol: string): void   { this.setStatus(symbol, 'REJECT', 'triage-store'); },
    resetSymbol(symbol: string): void    { this.setStatus(symbol, 'PENDING', 'triage-store'); },
  })),

  withHooks((store) => ({
    onInit() {
      const marketDate = store.marketDate();
      const today = todayPT();
      const start = marketDate <= today ? marketDate : today;
      const end = today;

      // Load current date plus the last 30 days of decisions
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const startDate = start < thirtyDaysAgo.toISOString().slice(0, 10) ? start : thirtyDaysAgo.toISOString().slice(0, 10);

      store.loadPersistedDecisions(startDate, end);
    },
  }))
);

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
