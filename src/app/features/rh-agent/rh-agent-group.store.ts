/**
 * RH Agent Group Store
 *
 * Manages the symbol-centric grouped review state.
 * Primary data model for Phase 5 grouped review UI.
 *
 * Responsibilities:
 * - Load symbols with signals for a given marketDate + timeframe
 * - Group symbols by the selected dimension (sector, industry, marketCapTier, exchange)
 * - Track per-symbol signal history (loaded on demand)
 * - Track ACR triage status per symbol (local UI state)
 * - Track "show full group" toggle per group
 * - Track selected symbol for detail panel
 */
import { inject, computed, DestroyRef } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatSnackBar } from '@angular/material/snack-bar';

import {
  RhAgentService,
  RhAgentSymbolProfile,
  RhAgentSignalItem,
} from './rh-agent.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Dimensions available for grouping the symbol list. */
export type GroupDimension = 'sector' | 'industry' | 'marketCapTier';

/** Triage status for a symbol — local UI state, not yet persisted. */
export type RhReviewStatus = 'PENDING' | 'PROMOTE' | 'ACCEPT' | 'CONSIDER' | 'REJECT';

/** A symbol row in the grouped list — profile + triage state. */
export interface RhSymbolRow {
  profile: RhAgentSymbolProfile;
  /** True if the symbol has a signal for the active marketDate + timeframe. */
  hasSignal: boolean;
  signals?: RhAgentSignalItem[];
  signalsLoading?: boolean;
  reviewStatus: RhReviewStatus;
}

/** A rendered group in the expansion panel list. */
export interface RhSymbolGroup {
  /** Group key — e.g. 'Technology', 'large', 'NASDAQ' */
  key: string;
  rows: RhSymbolRow[];
  /** Whether "Full Group" is toggled on (show all, not just signal symbols). */
  showFullGroup: boolean;
  /** Long signal count for the active timeframe. */
  longCount: number;
  /** Short signal count for the active timeframe. */
  shortCount: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface RhAgentGroupState {
  /** Active timeframe for the review pass. */
  timeframe: 'W' | 'D';
  /** Market date being reviewed (YYYY-MM-DD). */
  marketDate: string;
  /** Current grouping dimension. */
  groupDimension: GroupDimension;
  /** All signal symbols returned from the callable. */
  signalSymbols: RhAgentSymbolProfile[];
  /** Signal counts per timeframe (for the W/D toggle badges). */
  weeklySignalCount: number;
  dailySignalCount: number;
  /** Loading state for the main symbol list query. */
  symbolsLoading: boolean;
  symbolsError: string | null;
  /** Per-symbol signal history cache: symbol → signals[] */
  signalHistoryCache: Record<string, RhAgentSignalItem[]>;
  /** Per-symbol loading flags. */
  signalHistoryLoading: Record<string, boolean>;
  /** Local triage status per symbol. */
  reviewStatuses: Record<string, RhReviewStatus>;
  /** Per-group "show full group" toggle. */
  fullGroupToggles: Record<string, boolean>;
  /** Currently selected symbol for the detail panel. */
  selectedSymbol: string | null;
}

const todayDate = (): string => {
  const now = new Date();
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
};

const initialState: RhAgentGroupState = {
  timeframe: 'W',
  marketDate: todayDate(),
  groupDimension: 'sector',
  signalSymbols: [],
  weeklySignalCount: 0,
  dailySignalCount: 0,
  symbolsLoading: false,
  symbolsError: null,
  signalHistoryCache: {},
  signalHistoryLoading: {},
  reviewStatuses: {},
  fullGroupToggles: {},
  selectedSymbol: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UNKNOWN_GROUP = '(Unknown)';

function getGroupKey(profile: RhAgentSymbolProfile, dimension: GroupDimension): string {
  switch (dimension) {
    case 'sector':        return profile.sector        || UNKNOWN_GROUP;
    case 'industry':      return profile.industry      || UNKNOWN_GROUP;
    case 'marketCapTier': return profile.marketCapTier  || UNKNOWN_GROUP;
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const RhAgentGroupStore = signalStore(
  withState(initialState),

  withComputed((state) => ({
    /**
     * Grouped view — groups built from signalSymbols, sorted by marketCap desc within group.
     * Each group respects its fullGroupToggle (Full Group shows all, default shows signal-only).
     * Since we only have signal symbols from the backend, Full Group is a future hook
     * that will include context symbols once static ETF lists are wired in.
     */
    groups: computed((): RhSymbolGroup[] => {
      const symbols = state.signalSymbols();
      const dimension = state.groupDimension();
      const statuses = state.reviewStatuses();
      const historyCache = state.signalHistoryCache();
      const historyLoading = state.signalHistoryLoading();
      const fullGroupToggles = state.fullGroupToggles();

      // Build group map
      const groupMap = new Map<string, RhAgentSymbolProfile[]>();
      for (const profile of symbols) {
        const key = getGroupKey(profile, dimension);
        const existing = groupMap.get(key) ?? [];
        existing.push(profile);
        groupMap.set(key, existing);
      }

      // Sort groups alphabetically; Unknown always last
      const sortedKeys = [...groupMap.keys()].sort((a, b) => {
        if (a === UNKNOWN_GROUP) return 1;
        if (b === UNKNOWN_GROUP) return -1;
        return a.localeCompare(b);
      });

      return sortedKeys.map((key) => {
        const profiles = groupMap.get(key)!;

        // Sort by marketCap desc within group
        const sorted = [...profiles].sort(
          (a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0)
        );

        const rows: RhSymbolRow[] = sorted.map((profile) => ({
          profile,
          hasSignal: true,
          signals: historyCache[profile.symbol],
          signalsLoading: historyLoading[profile.symbol] ?? false,
          reviewStatus: statuses[profile.symbol] ?? 'PENDING',
        }));

        const tf = state.timeframe();
        const dirField = tf === 'W' ? 'lastWeeklySignalDirection' : 'lastDailySignalDirection';
        const longCount = rows.filter((r) => (r.profile as any)[dirField] === 'LONG').length;
        const shortCount = rows.filter((r) => (r.profile as any)[dirField] === 'SHORT').length;

        return {
          key,
          rows,
          showFullGroup: fullGroupToggles[key] ?? false,
          longCount,
          shortCount,
        };
      });
    }),

    /** Total signal count across all groups. */
    totalSignalCount: computed(() => state.signalSymbols().length),

    /** Long/short breakdown for the active timeframe. */
    longCount: computed(() => {
      const tf = state.timeframe();
      const dirField = tf === 'W' ? 'lastWeeklySignalDirection' : 'lastDailySignalDirection';
      return state.signalSymbols().filter((p) => (p as any)[dirField] === 'LONG').length;
    }),

    shortCount: computed(() => {
      const tf = state.timeframe();
      const dirField = tf === 'W' ? 'lastWeeklySignalDirection' : 'lastDailySignalDirection';
      return state.signalSymbols().filter((p) => (p as any)[dirField] === 'SHORT').length;
    }),

    /** Currently selected symbol's loaded signals (from cache). */
    selectedSymbolSignals: computed((): RhAgentSignalItem[] => {
      const sym = state.selectedSymbol();
      if (!sym) return [];
      return state.signalHistoryCache()[sym] ?? [];
    }),

    /** Profile of the currently selected symbol. */
    selectedSymbolProfile: computed((): RhAgentSymbolProfile | null => {
      const sym = state.selectedSymbol();
      if (!sym) return null;
      return state.signalSymbols().find((p) => p.symbol === sym) ?? null;
    }),

    /** Review status counts. */
    statusCounts: computed(() => {
      const statuses = Object.values(state.reviewStatuses());
      return {
        PENDING:  statuses.filter((s) => s === 'PENDING').length,
        PROMOTE:  statuses.filter((s) => s === 'PROMOTE').length,
        ACCEPT:   statuses.filter((s) => s === 'ACCEPT').length,
        CONSIDER: statuses.filter((s) => s === 'CONSIDER').length,
        REJECT:   statuses.filter((s) => s === 'REJECT').length,
      };
    }),
  })),

  withMethods((
    state,
    service = inject(RhAgentService),
    snackBar = inject(MatSnackBar),
    destroyRef = inject(DestroyRef),
  ) => ({
    /** Set the active timeframe and reload symbols. */
    setTimeframe(timeframe: 'W' | 'D'): void {
      patchState(state, { timeframe, signalSymbols: [], signalHistoryCache: {}, selectedSymbol: null });
      this.loadSymbolsWithSignals();
    },

    /** Set the market date and reload. */
    setMarketDate(marketDate: string): void {
      patchState(state, { marketDate, signalSymbols: [], signalHistoryCache: {}, selectedSymbol: null });
      this.loadSymbolsWithSignals();
      this.loadSignalCounts();
    },

    /** Change group dimension (no reload needed — regrouping is computed). */
    setGroupDimension(dimension: GroupDimension): void {
      patchState(state, { groupDimension: dimension });
    },

    /** Load signal symbols for current marketDate + timeframe. */
    loadSymbolsWithSignals(): void {
      const { marketDate, timeframe } = state;
      patchState(state, { symbolsLoading: true, symbolsError: null });

      service
        .getSymbolsWithSignals(marketDate(), timeframe())
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (symbols) => {
            patchState(state, { signalSymbols: symbols, symbolsLoading: false });
          },
          error: (err: any) => {
            patchState(state, { symbolsLoading: false, symbolsError: err?.message ?? 'Load failed' });
            snackBar.open('Failed to load symbols', 'Dismiss', { duration: 5000 });
          },
        });
    },

    /** Load W and D signal counts for the badge on the timeframe toggle. */
    loadSignalCounts(): void {
      const marketDate = state.marketDate();
      service.getSymbolsWithSignals(marketDate, 'W')
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({ next: (s) => patchState(state, { weeklySignalCount: s.length }), error: () => {} });
      service.getSymbolsWithSignals(marketDate, 'D')
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({ next: (s) => patchState(state, { dailySignalCount: s.length }), error: () => {} });
    },

    /** Select a symbol — loads signal history on demand if not cached. */
    selectSymbol(symbol: string): void {
      patchState(state, { selectedSymbol: symbol });
      if (!state.signalHistoryCache()[symbol]) {
        this.loadSignalHistory(symbol);
      }
    },

    /** Clear selected symbol. */
    clearSelectedSymbol(): void {
      patchState(state, { selectedSymbol: null });
    },

    /** Load signal history for a symbol into the cache. */
    loadSignalHistory(symbol: string): void {
      const timeframe = state.timeframe();
      patchState(state, {
        signalHistoryLoading: { ...state.signalHistoryLoading(), [symbol]: true },
      });

      service
        .getSymbolSignalHistory(symbol, timeframe, 14)
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (signals) => {
            patchState(state, {
              signalHistoryCache: { ...state.signalHistoryCache(), [symbol]: signals },
              signalHistoryLoading: { ...state.signalHistoryLoading(), [symbol]: false },
            });
          },
          error: (err: any) => {
            patchState(state, {
              signalHistoryCache: { ...state.signalHistoryCache(), [symbol]: [] },
              signalHistoryLoading: { ...state.signalHistoryLoading(), [symbol]: false },
            });
            console.error(`[RhAgentGroupStore] Failed to load signal history for ${symbol}:`, err);
          },
        });
    },

    /** Toggle the "show full group" flag for a group key. */
    toggleFullGroup(groupKey: string): void {
      const current = state.fullGroupToggles();
      patchState(state, {
        fullGroupToggles: { ...current, [groupKey]: !(current[groupKey] ?? false) },
      });
    },

    // --- Triage actions ---

    setReviewStatus(symbol: string, status: RhReviewStatus): void {
      patchState(state, {
        reviewStatuses: { ...state.reviewStatuses(), [symbol]: status },
      });
    },

    promoteSymbol(symbol: string): void  { this.setReviewStatus(symbol, 'PROMOTE'); },
    acceptSymbol(symbol: string): void   { this.setReviewStatus(symbol, 'ACCEPT'); },
    considerSymbol(symbol: string): void { this.setReviewStatus(symbol, 'CONSIDER'); },
    rejectSymbol(symbol: string): void   { this.setReviewStatus(symbol, 'REJECT'); },
    resetSymbol(symbol: string): void    { this.setReviewStatus(symbol, 'PENDING'); },
  }))
);
