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
import { RhAgentSymbolMetaService } from './rh-agent-symbol-meta.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Dimensions available for grouping the symbol list. */
export type GroupDimension = 'sector' | 'industry' | 'marketCapTier';

/** Triage status for a symbol — local UI state, now persisted to Firestore. */
export type RhReviewStatus =
  | 'PENDING'
  | 'PROMOTE'
  | 'ACCEPT'
  | 'CONSIDER'
  | 'REJECT'
  | 'EXCLUDE'
  | 'LOW_TRADABILITY'
  | 'WATCH'
  | 'ELEVATE';

/** Persistent classification of a symbol's membership in the trading universe. */
export type UniverseStatus = 'IN_UNIVERSE' | 'EXCLUDED' | 'LOW_TRADABILITY' | 'WATCHLIST' | 'PREFERRED';

/** Symbol type classification for the trading universe. */
export type SymbolType = 'STOCK' | 'ETF' | 'FUTURE' | 'FOREX' | 'CRYPTO' | 'OTHER';

/** A symbol row in the grouped list — profile + triage state + universe classification. */
export interface RhSymbolRow {
  profile: RhAgentSymbolProfile;
  /** True if the symbol has a signal for the active marketDate + timeframe. */
  hasSignal: boolean;
  signals?: RhAgentSignalItem[];
  signalsLoading?: boolean;
  reviewStatus: RhReviewStatus;
  /** Persistent universe status from rh-agent-symbol-meta. */
  universeStatus: UniverseStatus;
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
  /** Whether the "show all symbols" mode is active. */
  showAllSymbols: boolean;
  /** All enabled symbols — loaded on demand when showAllSymbols is toggled on. */
  allSymbols: RhAgentSymbolProfile[];
  /** Loading state for the all-symbols query. */
  allSymbolsLoading: boolean;
  /** Persistent symbol meta cache: symbol -> RhSymbolMeta. */
  symbolMeta: Record<string, { universeStatus: UniverseStatus; symbolType: SymbolType }>;
  /** Loading state for symbol meta. */
  symbolMetaLoading: boolean;
  /** Active universe filter. */
  universeFilter: UniverseFilter;
}

/** Filter modes for the grouped review universe. */
export type UniverseFilter = 'ALL' | 'IN_UNIVERSE' | 'EXCLUDED' | 'LOW_TRADABILITY' | 'WATCHLIST' | 'PREFERRED';

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
  showAllSymbols: false,
  allSymbols: [],
  allSymbolsLoading: false,
  symbolMeta: {},
  symbolMetaLoading: false,
  universeFilter: 'ALL',
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

/**
 * Determine whether a symbol with a given universe status should appear
 * under the active grouped review filter.
 *
 * Default view: hide EXCLUDED, show everything else.
 * Explicit filters show only matching status.
 */
function shouldShowInUniverseFilter(status: UniverseStatus, filter: UniverseFilter): boolean {
  if (filter === 'ALL') return status !== 'EXCLUDED';
  return status === filter;
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
    metaService = inject(RhAgentSymbolMetaService),
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
            const symbols = [...map.values()];
            patchState(state, { signalSymbols: symbols, symbolsLoading: false });
            this.loadSymbolMeta(symbols.map((s) => s.symbol));
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

    /** Toggle show-all-symbols mode. Loads all symbols on first activation. */
    toggleShowAllSymbols(): void {
      const next = !state.showAllSymbols();
      patchState(state, { showAllSymbols: next });
      if (next && state.allSymbols().length === 0) {
        this.loadAllSymbols();
      }
    },

    /** Load all enabled symbols from Firestore (no callable). */
    loadAllSymbols(): void {
      patchState(state, { allSymbolsLoading: true });
      service.getAllSymbols()
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (symbols) => {
            patchState(state, { allSymbols: symbols, allSymbolsLoading: false });
            this.loadSymbolMeta(symbols.map((s) => s.symbol));
          },
          error: (err: any) => {
            patchState(state, { allSymbolsLoading: false });
            snackBar.open('Failed to load all symbols', 'Dismiss', { duration: 5000 });
          },
        });
    },

    /** Load persistent symbol meta for a list of symbols. */
    loadSymbolMeta(symbols: string[]): void {
      if (symbols.length === 0) return;
      patchState(state, { symbolMetaLoading: true });

      metaService.loadSymbolMeta(symbols).subscribe({
        next: (meta) => {
          const metaRecord: Record<string, { universeStatus: UniverseStatus; symbolType: SymbolType }> = {};
          for (const [symbol, m] of Object.entries(meta)) {
            metaRecord[symbol] = { universeStatus: m.universeStatus, symbolType: m.symbolType };
          }
          patchState(state, { symbolMeta: metaRecord, symbolMetaLoading: false });
        },
        error: (err: any) => {
          console.error('[RhAgentGroupStore] Failed to load symbol meta:', err);
          patchState(state, { symbolMetaLoading: false });
        },
      });
    },

    /** Set the active universe filter for the grouped review. */
    setUniverseFilter(filter: UniverseFilter): void {
      patchState(state, { universeFilter: filter });
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
      const signalSymbols = state.signalSymbols();
      const dimension = state.groupDimension();
      const statuses = state.getTriageStatuses();
      const historyCache = state.signalHistoryCache();
      const historyLoading = state.signalHistoryLoading();
      const fullGroupToggles = state.fullGroupToggles();
      const showAll = state.showAllSymbols();
      const allSymbols = state.allSymbols();
      const symbolMeta = state.symbolMeta();
      const universeFilter = state.universeFilter();

      // Build signal symbol set for fast lookup
      const signalSet = new Set(signalSymbols.map(s => s.symbol));

      // When showing all: union of signal symbols + NSS symbols (no duplicates)
      const symbols: Array<{ profile: RhAgentSymbolProfile; hasSignal: boolean }> = [
        ...signalSymbols.map(p => ({ profile: p, hasSignal: true })),
        ...(showAll
          ? allSymbols
              .filter(p => !signalSet.has(p.symbol))
              .map(p => ({ profile: p, hasSignal: false }))
          : []),
      ];

      // Build group map
      const groupMap = new Map<string, Array<{ profile: RhAgentSymbolProfile; hasSignal: boolean; universeStatus: UniverseStatus }>>();
      for (const item of symbols) {
        const us = symbolMeta[item.profile.symbol]?.universeStatus ?? 'IN_UNIVERSE';
        if (!shouldShowInUniverseFilter(us, universeFilter)) continue;

        const key = getGroupKey(item.profile, dimension);
        const existing = groupMap.get(key) ?? [];
        existing.push({ ...item, universeStatus: us });
        groupMap.set(key, existing);
      }

      // Sort groups alphabetically; Unknown always last
      const sortedKeys = [...groupMap.keys()].sort((a, b) => {
        if (a === UNKNOWN_GROUP) return 1;
        if (b === UNKNOWN_GROUP) return -1;
        return a.localeCompare(b);
      });

      return sortedKeys.map((key) => {
        const items = groupMap.get(key)!;

        // Sort by marketCap desc within group
        const sorted = [...items].sort(
          (a, b) => (b.profile.marketCap ?? 0) - (a.profile.marketCap ?? 0)
        );

        const rows: RhSymbolRow[] = sorted.map((item) => ({
          profile: item.profile,
          hasSignal: item.hasSignal,
          signals: historyCache[item.profile.symbol],
          signalsLoading: historyLoading[item.profile.symbol] ?? false,
          reviewStatus: statuses[item.profile.symbol] ?? 'PENDING',
          universeStatus: item.universeStatus,
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
