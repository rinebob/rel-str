/**
 * RH Agent Group Store
 *
 * Manages the symbol-centric grouped review state.
 * Primary data model for Phase 5 grouped review UI.
 *
 * Responsibilities:
 * - Load symbols with signals for a given run ID
 * - Group symbols by the selected dimension (sector, industry, marketCapTier)
 * - Track selected symbol for the detail panel
 * - Track quick-chart symbol and show-all mode
 */
import { inject, effect, computed, DestroyRef } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  withHooks,
  patchState,
} from '@ngrx/signals';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';

import {
  type RhAgentSymbolProfile,
  type RhAgentSignalItem,
  type RhAgentRun,
} from '../services/rh-agent.types';
import { RhAgentSignalService } from '../services/rh-agent-signal.service';
import { RhAgentStore } from './rh-agent.store';
import { RhAgentTriageStore } from './rh-agent-triage.store';
import { RhAgentSymbolListStore } from './rh-agent-symbol-list.store';
import { RhAgentSymbolHistoryStore } from './rh-agent-symbol-history.store';
import { RhAgentOccurrenceDecisionStore } from './rh-agent-occurrence-decision.store';
import {
  GroupDimension,
  RhAgentReviewDecision,
  SignalTimeframe,
  SignalDirection,
} from '../common/rh-agent.constants';
import {
  buildFilteredCandidates,
  buildSymbolGroups,
  computeProfileCounts,
  profileMatchesSignalFilter,
} from '../utils/rh-agent.utils';
import { SignalReviewUiStore } from './signal-review-ui.store';

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
  reviewStatus: RhAgentReviewDecision;
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
  /** Cached market date of the active run (YYYY-MM-DD). Prefer the canonical value from viewedRun(). */
  _activeRunMarketDate: string | null;
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
  _activeRunMarketDate: null,
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
    occurrenceStore = inject(RhAgentOccurrenceDecisionStore),
    symbolListStore = inject(RhAgentSymbolListStore),
    historyStore = inject(RhAgentSymbolHistoryStore),
  ) => ({
    /** Set the active run, clear in-memory triage state, load durable occurrence decisions, and reload symbols. */
    setActiveRun(runId: string, marketDate: string): void {
      patchState(state, { activeRunId: runId, _activeRunMarketDate: marketDate, signalSymbols: [], selectedSymbol: null });
      triageStore.resetForRun();
      occurrenceStore.clearDecisions();
      occurrenceStore.loadDecisionsForRun(runId);
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
  })),

  withComputed((state, triageStore = inject(RhAgentTriageStore), symbolListStore = inject(RhAgentSymbolListStore), historyStore = inject(RhAgentSymbolHistoryStore), uiStore = inject(SignalReviewUiStore)) => ({
    /**
     * Grouped view — groups built from signalSymbols, sorted by marketCap desc within group.
     * Reads signalFilter directly from SignalReviewUiStore — single source of truth, no copy.
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
        signalFilter: uiStore.signalFilter(),
      })
    ),
  })),

  withComputed((state, symbolListStore = inject(RhAgentSymbolListStore), uiStore = inject(SignalReviewUiStore)) => ({
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
      return candidates.filter((p) => profileMatchesSignalFilter(p, uiStore.signalFilter()));
    }),
  })),

  withComputed((state, uiStore = inject(SignalReviewUiStore)) => ({
    /**
     * Counts derived from the stable profile-filtered set.
     * These update only when the symbol list, list filter, or signal filter changes.
     */
    filteredProfileCounts: computed(() =>
      computeProfileCounts(state.filteredProfiles(), uiStore.signalFilter())
    ),

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

  withComputed((state, agentStore = inject(RhAgentStore)) => ({
    /** The full run document for the currently viewed run, if available in the runs stream. */
    viewedRun: computed((): RhAgentRun | null => {
      const id = state.activeRunId();
      if (!id) return null;
      return agentStore.runs().find((r) => r.id === id) ?? null;
    }),
  })),

  withComputed((state, agentStore = inject(RhAgentStore)) => ({
    /**
     * Market date of the viewed run.
     * Derived from canonical run metadata when available; falls back to the cached value set by setActiveRun.
     */
    activeRunMarketDate: computed((): string | null =>
      state.viewedRun()?.marketDate ?? state._activeRunMarketDate()
    ),

    /** True when the viewed run is the latest completed actionable run. */
    isActionableRun: computed(() => {
      const viewedId = state.activeRunId();
      const latestId = agentStore.latestCompletedRun()?.id;
      return !!viewedId && !!latestId && viewedId === latestId;
    }),
  })),

  withHooks((store, agentStore = inject(RhAgentStore), uiStore = inject(SignalReviewUiStore), triageStore = inject(RhAgentTriageStore), occurrenceStore = inject(RhAgentOccurrenceDecisionStore)) => {
    /** Tracks the previous latest completed run ID to detect new-run transitions. */
    let previousLatestRunId: string | null = null;

    return {
      onInit() {
        /**
         * When a newer completed run becomes latest and the viewed run was the
         * previous latest, clear only ephemeral screening state. Historical research
         * and navigation remain available.
         */
        effect(() => {
          const latestId = agentStore.latestCompletedRun()?.id ?? null;
          const previousId = previousLatestRunId;
          previousLatestRunId = latestId;

          if (!latestId || !previousId || latestId === previousId) return;

          // Durable decisions for the previous latest run are no longer current,
          // regardless of which run is currently being viewed.
          occurrenceStore.markRunNotCurrent(previousId);

          const viewedId = store.activeRunId();
          if (viewedId !== previousId) return;

          uiStore.setTimeframeFilter(SignalTimeframe.ALL);
          uiStore.setDirectionFilter(SignalDirection.ALL);
          uiStore.setAllExpanded(false, []);
          patchState(store, { selectedSymbol: null, quickChartSymbol: null });
          triageStore.clearEphemeralScreeningState();
        });

        effect(() => {
          const runId = store.activeRunId();
          const decisions = occurrenceStore.occurrenceDecisions();
          if (!runId) return;

          // Aggregate per-symbol status from possibly multiple occurrences.
          // EXECUTED wins over ACCEPT, which wins over REJECT.
          const ranked = [
            RhAgentReviewDecision.EXECUTED,
            RhAgentReviewDecision.ACCEPT,
            RhAgentReviewDecision.REJECT,
          ];
          const statusMap: Record<string, RhAgentReviewDecision> = {};
          for (const decision of Object.values(decisions)) {
            if (decision.runId !== runId) continue;
            const current = statusMap[decision.symbol];
            const next = decision.executedAt
              ? RhAgentReviewDecision.EXECUTED
              : decision.decisionType;
            if (!current) {
              statusMap[decision.symbol] = next;
            } else if (ranked.indexOf(next) < ranked.indexOf(current)) {
              statusMap[decision.symbol] = next;
            }
          }
          triageStore.setStatuses(statusMap);
        });
      },
    };
  }),
);
