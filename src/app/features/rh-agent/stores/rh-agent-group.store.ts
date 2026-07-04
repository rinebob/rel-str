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
  type RhAgentSymbolProfile,
  type RhAgentSignalItem,
} from '../services/rh-agent.types';
import { RhAgentSignalService } from '../services/rh-agent-signal.service';
import { RhAgentTriageStore } from './rh-agent-triage.store';
import { RhAgentSymbolListStore } from './rh-agent-symbol-list.store';
import { RhAgentSymbolHistoryStore } from './rh-agent-symbol-history.store';
import {
  RhReviewStatus,
  StatusCounts,
  GroupDimension,
} from '../common/rh-agent.constants';
import {
  getGroupKey,
  shouldShowInListFilter,
  UNKNOWN_GROUP,
} from '../utils/rh-agent.utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A symbol row in the grouped list — profile + triage state. */
export interface RhSymbolRow {
  profile: RhAgentSymbolProfile;
  /** True if the symbol has a signal for the active run. */
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
  /** Active run ID being reviewed. */
  activeRunId: string | null;
  /** Market date of the active run (YYYY-MM-DD) — used for triage decision keying. */
  activeRunMarketDate: string | null;
  /** Current grouping dimension. */
  groupDimension: GroupDimension;
  /** All signal symbols returned from the callable (W + D merged). */
  signalSymbols: RhAgentSymbolProfile[];
  /** Loading state for the main symbol list query. */
  symbolsLoading: boolean;
  symbolsError: string | null;
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
}

const initialState: RhAgentGroupState = {
  activeRunId: null,
  activeRunMarketDate: null,
  groupDimension: 'sector',
  signalSymbols: [],
  symbolsLoading: false,
  symbolsError: null,
  fullGroupToggles: {},
  selectedSymbol: null,
  quickChartSymbol: null,
  showAllSymbols: false,
  allSymbols: [],
  allSymbolsLoading: false,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const RhAgentGroupStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withMethods((
    state,
    signalService = inject(RhAgentSignalService),
    snackBar = inject(MatSnackBar),
    destroyRef = inject(DestroyRef),
    triageStore = inject(RhAgentTriageStore),
    symbolListStore = inject(RhAgentSymbolListStore),
    historyStore = inject(RhAgentSymbolHistoryStore),
  ) => ({
    /** Expose triage store statuses for use by computed signals. */
    getTriageStatuses(): Record<string, RhReviewStatus> {
      return triageStore.statuses();
    },

    /** Expose triage store status counts. */
    getTriageStatusCounts(): StatusCounts {
      return triageStore.statusCounts();
    },

    /** Set the active run and reload symbols. */
    setActiveRun(runId: string, marketDate: string): void {
      patchState(state, { activeRunId: runId, activeRunMarketDate: marketDate, signalSymbols: [], selectedSymbol: null });
      triageStore.setActiveRun(runId, marketDate);
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
      const runId = state.activeRunId();
      if (!runId) return;
      patchState(state, { symbolsLoading: true, symbolsError: null });

      // Fetch both timeframes in parallel and merge
      const w$ = signalService.getSymbolsWithSignals(runId, 'W');
      const d$ = signalService.getSymbolsWithSignals(runId, 'D');

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
            symbolListStore.loadSymbolLists();
            const runId = state.activeRunId();
            if (runId) {
              for (const s of symbols) {
                historyStore.loadSignalHistoryForRun(s.symbol, runId);
              }
            }
          },
          error: (err: unknown) => {
            const message = err instanceof Error ? err.message : 'Load failed';
            patchState(state, { symbolsLoading: false, symbolsError: message });
            snackBar.open('Failed to load symbols', 'Dismiss', { duration: 5000 });
          },
        });
    },

    /** Select a symbol — delegates signal history loading to the history store. */
    selectSymbol(symbol: string): void {
      patchState(state, { selectedSymbol: symbol });
      historyStore.loadSignalHistory(symbol);
    },

    /** Clear selected symbol. */
    clearSelectedSymbol(): void {
      patchState(state, { selectedSymbol: null });
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
      signalService.getAllSymbols()
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (symbols) => {
            patchState(state, { allSymbols: symbols, allSymbolsLoading: false });
            symbolListStore.loadSymbolLists();
          },
          error: (err: unknown) => {
            patchState(state, { allSymbolsLoading: false });
            snackBar.open('Failed to load all symbols', 'Dismiss', { duration: 5000 });
            console.error('[RhAgentGroupStore] Failed to load all symbols:', err);
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

  withComputed((state, symbolListStore = inject(RhAgentSymbolListStore), historyStore = inject(RhAgentSymbolHistoryStore)) => ({
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
      const historyCache = historyStore.signalHistoryCache();
      const historyLoading = historyStore.signalHistoryLoading();
      const fullGroupToggles = state.fullGroupToggles();
      const showAll = state.showAllSymbols();
      const allSymbols = state.allSymbols();
      const symbolLists = symbolListStore.symbolLists();
      const activeListFilter = symbolListStore.activeListFilter();

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
      const groupMap = new Map<string, Array<{ profile: RhAgentSymbolProfile; hasSignal: boolean }>>();
      for (const item of symbols) {
        if (!shouldShowInListFilter(item.profile.symbol, symbolLists, activeListFilter)) continue;

        const key = getGroupKey(item.profile, dimension);
        const existing = groupMap.get(key) ?? [];
        existing.push(item);
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

        const runId = state.activeRunId();
        const rows: RhSymbolRow[] = sorted.map((item) => {
          const cacheKey = runId ? `${item.profile.symbol}::${runId}` : item.profile.symbol;
          return {
            profile: item.profile,
            hasSignal: item.hasSignal,
            signals: historyCache[cacheKey],
            signalsLoading: historyLoading[cacheKey] ?? false,
            reviewStatus: statuses[item.profile.symbol] ?? 'PENDING',
          };
        });

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

    /** Currently selected symbol's loaded signals (from the history store cache). */
    selectedSymbolSignals: computed((): RhAgentSignalItem[] => {
      const sym = state.selectedSymbol();
      if (!sym) return [];
      return historyStore.signalHistoryCache()[sym] ?? [];
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
