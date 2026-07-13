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
  GroupDimension,
  RhReviewStatus,
  SignalDirection,
  SignalFilter,
  SignalTimeframe,
  SIGNAL_FILTER_ALL,
} from '../common/rh-agent.constants';
import {
  buildFilteredCandidates,
  buildSymbolGroups,
  daysAgoPt,
  profileMatchesSignalFilter,
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
  /** Active signal filter applied to grouped rows. Owned by the page layer. */
  signalFilter: SignalFilter;
  /** Current grouping dimension. */
  groupDimension: GroupDimension;
  /** All signal symbols returned from the callable (W + D merged). */
  signalSymbols: RhAgentSymbolProfile[];
  /** Loading state for the main symbol list query. */
  symbolsLoading: boolean;
  symbolsError: string | null;
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
  signalFilter: SIGNAL_FILTER_ALL,
  groupDimension: GroupDimension.SECTOR,
  signalSymbols: [],
  symbolsLoading: false,
  symbolsError: null,
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
    /** Set the active run, load persisted triage decisions, and reload symbols. */
    setActiveRun(runId: string, marketDate: string): void {
      patchState(state, { activeRunId: runId, activeRunMarketDate: marketDate, signalSymbols: [], selectedSymbol: null });
      triageStore.loadPersistedDecisions(daysAgoPt(30), marketDate, marketDate);
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

    /** Set the active signal filter applied to grouped rows. Owned by the page layer. */
    setSignalFilter(filter: SignalFilter): void {
      patchState(state, { signalFilter: filter });
    },
  })),

  withComputed((state, triageStore = inject(RhAgentTriageStore), symbolListStore = inject(RhAgentSymbolListStore), historyStore = inject(RhAgentSymbolHistoryStore)) => ({
    /**
     * Grouped view — groups built from signalSymbols, sorted by marketCap desc within group.
     * When showAllSymbols is true, non-signal symbols are included; otherwise only signal symbols.
     */
    groups: computed((): RhSymbolGroup[] =>
      buildSymbolGroups({
        signalSymbols: state.signalSymbols(),
        allSymbols: state.allSymbols(),
        showAll: state.showAllSymbols(),
        dimension: state.groupDimension(),
        symbolLists: symbolListStore.symbolLists(),
        activeListFilter: symbolListStore.activeListFilter(),
        statuses: triageStore.statuses(),
        historyCache: historyStore.signalHistoryCache(),
        historyLoading: historyStore.signalHistoryLoading(),
        activeRunId: state.activeRunId(),
        signalFilter: state.signalFilter(),
      })
    ),
  })),

  withComputed((state, historyStore = inject(RhAgentSymbolHistoryStore), symbolListStore = inject(RhAgentSymbolListStore)) => ({
    /**
     * Profiles that pass the active list and signal filters, using profile data.
     * Kept separate from the history-backed `groups()` so header counts and the
     * flat symbol list are stable while per-symbol signal histories finish loading.
     */
    filteredProfiles: computed((): RhAgentSymbolProfile[] => {
      const candidates = buildFilteredCandidates({
        signalSymbols: state.signalSymbols(),
        allSymbols: state.allSymbols(),
        showAll: state.showAllSymbols(),
        symbolLists: symbolListStore.symbolLists(),
        activeListFilter: symbolListStore.activeListFilter(),
      });
      const filter = state.signalFilter();
      return candidates.filter((p) => profileMatchesSignalFilter(p, filter));
    }),
  })),

  withComputed((state) => ({
    /**
     * Counts derived from the stable profile-filtered set.
     * These update only when the symbol list, list filter, or signal filter changes.
     */
    filteredProfileCounts: computed((): { total: number; weekly: number; daily: number; long: number; short: number } => {
      const filter = state.signalFilter();
      let total = 0;
      let weekly = 0;
      let daily = 0;
      let long = 0;
      let short = 0;

      for (const profile of state.filteredProfiles()) {
        total++;

        const hasWeekly = !!profile.lastWeeklySignalDate;
        const hasDaily = !!profile.lastDailySignalDate;
        const weeklyLong = profile.lastWeeklySignalDirection === SignalDirection.LONG;
        const weeklyShort = profile.lastWeeklySignalDirection === SignalDirection.SHORT;
        const dailyLong = profile.lastDailySignalDirection === SignalDirection.LONG;
        const dailyShort = profile.lastDailySignalDirection === SignalDirection.SHORT;

        if (filter.timeframe !== SignalTimeframe.DAILY) {
          if (filter.direction === SignalDirection.ALL) {
            if (hasWeekly) weekly++;
          } else if (profile.lastWeeklySignalDirection === filter.direction) {
            weekly++;
          }
        }

        if (filter.timeframe !== SignalTimeframe.WEEKLY) {
          if (filter.direction === SignalDirection.ALL) {
            if (hasDaily) daily++;
          } else if (profile.lastDailySignalDirection === filter.direction) {
            daily++;
          }
        }

        if (filter.timeframe === SignalTimeframe.WEEKLY) {
          if (weeklyLong) long++;
          if (weeklyShort) short++;
        } else if (filter.timeframe === SignalTimeframe.DAILY) {
          if (dailyLong) long++;
          if (dailyShort) short++;
        } else {
          if (weeklyLong || dailyLong) long++;
          if (weeklyShort || dailyShort) short++;
        }
      }

      return { total, weekly, daily, long, short };
    }),

    /**
     * Stable flat list of visible symbols for prev/next navigation.
     * Derived from profile-filtered data so it does not flicker while histories load.
     */
    flatFilteredSymbols: computed((): string[] =>
      state.filteredProfiles().map((p) => p.symbol).sort()
    ),
  })),

  withComputed((state, historyStore = inject(RhAgentSymbolHistoryStore)) => ({
    /** Total visible symbol count across all groups. */
    totalSignalCount: computed(() => state.filteredProfileCounts().total),

    /** Count of visible symbols with a weekly signal. */
    weeklySignalCount: computed(() => state.filteredProfileCounts().weekly),

    /** Count of visible symbols with a daily signal. */
    dailySignalCount: computed(() => state.filteredProfileCounts().daily),

    /** Long/short breakdown across visible rows. */
    longCount: computed(() => state.filteredProfileCounts().long),

    shortCount: computed(() => state.filteredProfileCounts().short),

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
  })),
);
