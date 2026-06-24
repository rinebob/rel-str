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
import { forkJoin } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';

import {
  RhAgentService,
  RhAgentSymbolProfile,
  RhAgentSignalItem,
} from './rh-agent.service';
import { RhAgentTriageStore } from './rh-agent-triage.store';

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
  /** Market date being reviewed (YYYY-MM-DD). */
  marketDate: string;
  /** Current grouping dimension. */
  groupDimension: GroupDimension;
  /** All signal symbols returned from the callable (W + D merged). */
  signalSymbols: RhAgentSymbolProfile[];
  /** Loading state for the main symbol list query. */
  symbolsLoading: boolean;
  symbolsError: string | null;
  /** Per-symbol signal history cache: symbol → signals[] */
  signalHistoryCache: Record<string, RhAgentSignalItem[]>;
  /** Per-symbol loading flags. */
  signalHistoryLoading: Record<string, boolean>;
  /** Per-group "show full group" toggle. */
  fullGroupToggles: Record<string, boolean>;
  /** Currently selected symbol for the detail panel. */
  selectedSymbol: string | null;
  /** Symbol currently displayed in the quick-charts panel. */
  quickChartSymbol: string | null;
}

/** Yesterday in PT — used as default marketDate until intraday bars are wired. */
const yesterdayDate = (): string => {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
};

const initialState: RhAgentGroupState = {
  marketDate: yesterdayDate(),
  groupDimension: 'sector',
  signalSymbols: [],
  symbolsLoading: false,
  symbolsError: null,
  signalHistoryCache: {},
  signalHistoryLoading: {},
  fullGroupToggles: {},
  selectedSymbol: null,
  quickChartSymbol: null,
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

  withMethods((
    state,
    service = inject(RhAgentService),
    snackBar = inject(MatSnackBar),
    destroyRef = inject(DestroyRef),
    triageStore = inject(RhAgentTriageStore),
  ) => ({
    /** Expose triage store statuses for use by computed signals. */
    getTriageStatuses(): Record<string, RhReviewStatus> {
      return triageStore.statuses();
    },

    /** Expose triage store status counts. */
    getTriageStatusCounts() {
      return triageStore.statusCounts();
    },

    /** Set the market date and reload. */
    setMarketDate(marketDate: string): void {
      patchState(state, { marketDate, signalSymbols: [], signalHistoryCache: {}, selectedSymbol: null });
      triageStore.setMarketDate(marketDate);
      this.loadSymbolsWithSignals();
    },

    /** Change group dimension (no reload needed — regrouping is computed). */
    setGroupDimension(dimension: GroupDimension): void {
      patchState(state, { groupDimension: dimension });
    },

    /**
     * Load signal symbols for current marketDate — fetches both W and D,
     * merges by symbol (union). A symbol appears if it has either timeframe signal.
     * Profile fields from the W result take precedence (arbitrary — they're the same doc).
     */
    loadSymbolsWithSignals(): void {
      const marketDate = state.marketDate();
      patchState(state, { symbolsLoading: true, symbolsError: null });

      // Fetch both timeframes in parallel and merge
      const w$ = service.getSymbolsWithSignals(marketDate, 'W');
      const d$ = service.getSymbolsWithSignals(marketDate, 'D');

      forkJoin([w$, d$])
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: ([weeklySymbols, dailySymbols]) => {
            // Merge: build map keyed by symbol, W first then D overlay
            const map = new Map<string, RhAgentSymbolProfile>();
            for (const s of weeklySymbols) map.set(s.symbol, s);
            for (const s of dailySymbols) {
              if (!map.has(s.symbol)) map.set(s.symbol, s);
            }
            patchState(state, { signalSymbols: [...map.values()], symbolsLoading: false });
          },
          error: (err: any) => {
            patchState(state, { symbolsLoading: false, symbolsError: err?.message ?? 'Load failed' });
            snackBar.open('Failed to load symbols', 'Dismiss', { duration: 5000 });
          },
        });
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

    /**
     * Load signal history for a symbol into the cache.
     * Reads all signals (W + D) directly from Firestore subcollection.
     */
    loadSignalHistory(symbol: string): void {
      patchState(state, {
        signalHistoryLoading: { ...state.signalHistoryLoading(), [symbol]: true },
      });

      service.getSymbolSignalHistory(symbol)
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (signals) => {
            console.log(`[RhAgentGroupStore] Signal history for ${symbol}: ${signals.length} signals`);
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

    /** Set the symbol shown in the quick-charts panel. */
    setQuickChartSymbol(symbol: string | null): void {
      patchState(state, { quickChartSymbol: symbol });
    },

    /** Toggle the "show full group" flag for a group key. */
    toggleFullGroup(groupKey: string): void {
      const current = state.fullGroupToggles();
      patchState(state, {
        fullGroupToggles: { ...current, [groupKey]: !(current[groupKey] ?? false) },
      });
    },
  })),

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
      const statuses = state.getTriageStatuses();
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

        // Count long/short from both timeframes
        const longCount = rows.filter((r) =>
          r.profile.lastWeeklySignalDirection === 'LONG' ||
          r.profile.lastDailySignalDirection === 'LONG'
        ).length;
        const shortCount = rows.filter((r) =>
          r.profile.lastWeeklySignalDirection === 'SHORT' ||
          r.profile.lastDailySignalDirection === 'SHORT'
        ).length;

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

    /** Count of symbols with a weekly signal (informational, not a filter). */
    weeklySignalCount: computed(() =>
      state.signalSymbols().filter((p) => !!p.lastWeeklySignalDate).length
    ),

    /** Count of symbols with a daily signal (informational, not a filter). */
    dailySignalCount: computed(() =>
      state.signalSymbols().filter((p) => !!p.lastDailySignalDate).length
    ),

    /** Long/short breakdown across both timeframes. */
    longCount: computed(() =>
      state.signalSymbols().filter((p) =>
        p.lastWeeklySignalDirection === 'LONG' || p.lastDailySignalDirection === 'LONG'
      ).length
    ),

    shortCount: computed(() =>
      state.signalSymbols().filter((p) =>
        p.lastWeeklySignalDirection === 'SHORT' || p.lastDailySignalDirection === 'SHORT'
      ).length
    ),

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

    /** Review status counts — delegates to triage store. */
    statusCounts: computed(() => state.getTriageStatusCounts()),
  })),
);
