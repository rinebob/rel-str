/**
 * Option Chain Pct Change Store
 *
 * NgRx SignalStore managing state for the option chain pct change grid.
 * Fetches N+1 chain snapshots in parallel, caches them in-memory for
 * interactive filter recompute, and derives PctChangeGrids via a
 * computed signal from the cached snapshots + current filter.
 */
import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { catchError, forkJoin, from, mergeMap, Observable, of, Subscription, toArray } from 'rxjs';
import { map, take } from 'rxjs/operators';

import { OptionsContractService } from '../../services/options-contract.service';
import type { StSignalItem } from '../../services/types';
import { SymbolHistoryStore } from '../../stores/symbol-history.store';
import { SwingAnalysisService } from '../../swing-analysis/swing-analysis.service';
import type { SwingAnalysisDoc } from '../../swing-analysis/swing-analysis.types';
import { LocalBarReadService } from '../../../../core/services/local-bar-read.service';
import { PctChangeConfigService } from './services/pct-change-config.service';
import type { PctChangeConfigWithId } from './services/pct-change-config.service';
import { OptionType } from '@options-contract/contracts';
import type { HistoricalOptionContract, GetHistoricalOptionsChainResponse } from '@options-contract/contracts';
import type {
  TargetType,
  PctMode,
  UserDatesMode,
  PctDirection,
  ResolvePctChangeRequest,
} from '@shared/pct-change-config-contracts';
import {
  buildGrids,
  cellKey,
  extractContractSeries,
  chainContracts,
  closestPriorCloses,
  newId,
  SNAPSHOT_FETCH_CONCURRENCY,
  type PctChangeCell,
  type PctChangeGrid,
  type PctChangeFilter,
  type ContractSeriesPoint,
} from './utils/pct-change.utils';
import { buildConfigId, resolvePctChangeTargets as resolvePctChangeDatesFromBars, buildPercentages, computeForwardEndDate } from './utils/pct-change-config.utils';
import type { SwingCompareRun } from './utils/swing-compare.utils';
import { describeSnapshotError } from './utils/snapshot-errors.utils';
import {
  swingCompareComputedBlock,
  swingCompareMethods,
} from './swing-compare.feature';
import type { Swing } from '../../../shared/components/flex-chart/indicators/st-zigzag.types';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** The snapshot scope a chart-popup series is computed over — absent on
 *  main-flow selections (main startDate/targetDates/type apply); present
 *  on run-grid selections (the run's own dates + option type). */
export interface SeriesScope {
  startDate: string;
  targetDates: string[];
  type: OptionType;
}

/** Identity of the grid cell whose contract is selected for the chart popup. */
export interface SelectedContractCell {
  contractID: string;
  strike: number;
  expiration: string;
  /** The target date of the grid the cell was selected in. */
  targetDate: string;
  /** Run-grid scope — when present the chart series uses these dates/type
   *  instead of the main flow's. */
  seriesScope?: SeriesScope;
}

/** The contract identity a cell carries — a PctChangeCell is assignable to this. */
export type ContractCellRef = Pick<PctChangeCell, 'contractID' | 'strike' | 'expiration'>;

/** Build the stored selection from a cell ref + its grid's target date.
 *  Picks fields explicitly — callers may pass a full PctChangeCell whose
 *  extra fields must not leak into state. */
const toSelectedCell = (
  cell: ContractCellRef,
  targetDate: string,
  seriesScope?: SeriesScope,
): SelectedContractCell => ({
  contractID: cell.contractID,
  strike: cell.strike,
  expiration: cell.expiration,
  targetDate,
  ...(seriesScope ? { seriesScope } : {}),
});

/** Scope equality — undefined/main-flow scopes and identical run scopes
 *  both count as the same selection. */
const sameScope = (a?: SeriesScope, b?: SeriesScope): boolean => {
  if (!a || !b) return a === b;
  return (
    a.startDate === b.startDate &&
    a.type === b.type &&
    a.targetDates.join(',') === b.targetDates.join(',')
  );
};

/** Field-for-field identity check between the stored selection and a cell
 *  ref in a given grid. The canonical field set lives here so it can't
 *  drift across call sites. `seriesScope` must match too — a run-grid
 *  cell sharing targetDate/contract with a main-flow selection is a
 *  different cell. */
export const sameSelectedCell = (
  sel: SelectedContractCell | null,
  cell: ContractCellRef,
  targetDate: string,
  seriesScope?: SeriesScope,
): sel is SelectedContractCell =>
  sel != null &&
  sel.contractID === cell.contractID &&
  sel.strike === cell.strike &&
  sel.expiration === cell.expiration &&
  sel.targetDate === targetDate &&
  sameScope(sel.seriesScope, seriesScope);

export interface OptionChainPctChangeState {
  /** Input: symbol to analyze. */
  symbol: string;
  /** Input: start date (YYYY-MM-DD). */
  startDate: string;
  /** Input: target dates (YYYY-MM-DD), 1..N. */
  targetDates: string[];
  /** Input: call or put filter. */
  type: OptionType;
  /** Input: filter applied to matched contracts. */
  filter: PctChangeFilter;

  /** Config: target type selection. */
  targetType: TargetType;
  /** Config: pct-change sub-mode. */
  pctMode: PctMode;
  /** Config: pct values (list mode). */
  pctValues: number[];
  /** Config: pct step (gradation mode). */
  pctStep: number;
  /** Config: pct count (gradation mode). */
  pctCount: number;
  /** Config: pct direction (gradation mode). */
  pctDirection: PctDirection;
  /** Config: user-dates sub-mode. */
  userDatesMode: UserDatesMode;
  /** Config: interval count (user-dates interval mode). */
  intervalCount: number;
  /** Config: interval days (user-dates interval mode). */
  intervalDays: number;

  /** Saved configs loaded from Firestore. */
  savedConfigs: PctChangeConfigWithId[];

  /** Saved swing sets for the current symbol (flat `st-swing-sets` docs). */
  savedAnalyses: SwingAnalysisDoc[];

  /** Swing-compare: the 'Baseline Set' — large swings bounding the frame
   *  (picked in the frame-swing dialog). */
  baselineSetId: string | null;
  /** Swing-compare: the 'Target Set' — small-swing pivots feeding the
   *  date list (picked in the compare section). */
  targetSetId: string | null;
  /** Swing-compare: the selected frame swing — its [start,end] bounds the
   *  date list. */
  frameSwing: Swing | null;
  /** Swing-compare: saved run definitions, rendered side by side. */
  runs: SwingCompareRun[];
  /** Shared date → chain-snapshot cache — the single-analysis flow and
   *  run sections read from the same map; `ensureSnapshots` is the
   *  incremental filler, `runAnalysis` writes start+targets wholesale. */
  snapshotCache: Record<string, HistoricalOptionContract[]>;
  /** Per-date fetch failures from `ensureSnapshots` (e.g. a partner 502
   *  on a missing corpus date) — lets run sections show "unavailable"
   *  instead of loading forever. Symbol-scoped: cleared on symbol change
   *  and reset; a successful refetch deletes the key. */
  snapshotErrors: Record<string, string>;

  /** Per-date snapshot source reported by SA — "gcs" (corpus hit) or
   *  "live" (upstream fetch). Follows the snapshotErrors lifecycle:
   *  symbol-scoped, cleared alongside it. Optional upstream — absent
   *  dates mean "source unknown". */
  snapshotSources: Record<string, 'gcs' | 'live' | undefined>;

  /** Currently selected config id, or null. */
  selectedConfigId: string | null;

  /** Fetch state. */
  loading: boolean;
  error: string | null;

  /** Underlying close prices keyed by date (YYYY-MM-DD). */
  underlyingPrices: Record<string, number>;

  /** Chart popup: the selected contract cell, or null. */
  selectedCell: SelectedContractCell | null;
  /** Cross-grid contract highlight — set by clicking a cell body. Cleared
   *  on outside click or when the analysis inputs change. */
  highlightedContract: { strike: number; expiration: string } | null;
  /** Chart popup: true while the overlay is pinned open (blocks other selections). */
  isContractPinned: boolean;

  /** Monotonic counter bumped on each successful pct-change resolve —
   *  lets the page reopen the Target Dates panel only on resolve, not on
   *  config select or manual date edits. */
  resolveNonce: number;
}

/** Swing-compare-clearing patch — spread into every patchState that
 *  empties `savedAnalyses` for a symbol change (setSymbol, selectConfig),
 *  so the set selections, frame swing, and built runs can't dangle. */
const SWING_COMPARE_CLEARED: Pick<
  OptionChainPctChangeState,
  'savedAnalyses' | 'baselineSetId' | 'targetSetId' | 'frameSwing' | 'runs' | 'snapshotErrors' | 'snapshotSources'
> = {
  savedAnalyses: [],
  baselineSetId: null,
  targetSetId: null,
  frameSwing: null,
  runs: [],
  snapshotErrors: {},
  snapshotSources: {},
};

/** Selection-clearing patch — spread into any patchState that invalidates
 *  the contract universe (snapshots, symbol, type, or the grid set). */
const SELECTION_CLEARED: Pick<
  OptionChainPctChangeState,
  'selectedCell' | 'isContractPinned' | 'highlightedContract'
> = {
  selectedCell: null,
  highlightedContract: null,
  isContractPinned: false,
};

/** Default delta band — |delta| ≤ 0.6 keeps deep-ITM noise out by
 *  default (calls cap at +0.6, puts floor at −0.6 since put deltas are
 *  negative; the filter compares |delta|, so deltaGte=-0.6 is a no-op
 *  bound and deltaLte does the work). Applies to both manual and
 *  swing-compare runs. */
export const DEFAULT_DELTA_FILTER = { deltaGte: -0.6, deltaLte: 0.6 };

/** Drop undefined-valued keys — Firestore setDoc rejects undefined. */
function stripUndefinedFilter(filter: PctChangeFilter): PctChangeFilter {
  return Object.fromEntries(
    Object.entries(filter).filter(([, v]) => v !== undefined),
  ) as PctChangeFilter;
}

const initialState: OptionChainPctChangeState = {
  symbol: 'QQQ',
  startDate: '2025-04-07',
  targetDates: [],
  type: OptionType.CALL,
  filter: { type: OptionType.CALL, ...DEFAULT_DELTA_FILTER },
  targetType: 'pct-change',
  pctMode: 'list',
  pctValues: [],
  pctStep: 5,
  pctCount: 4,
  pctDirection: 'up',
  userDatesMode: 'manual',
  intervalCount: 5,
  intervalDays: 5,
  savedConfigs: [],
  savedAnalyses: [],
  baselineSetId: null,
  targetSetId: null,
  frameSwing: null,
  runs: [],
  snapshotCache: {},
  snapshotErrors: {},
  snapshotSources: {},
  selectedConfigId: null,
  loading: false,
  error: null,
  underlyingPrices: {},
  selectedCell: null,
  highlightedContract: null,
  isContractPinned: false,
  resolveNonce: 0,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const OptionChainPctChangeStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  withComputed((state) => ({
    /**
     * Grids are a pure function of cached snapshots + current inputs.
     * Auto-recomputes when filters, target dates, or cached snapshots change.
     */
    grids: computed((): PctChangeGrid[] =>
      buildGrids(
        state.snapshotCache(),
        state.underlyingPrices(),
        state.filter(),
        state.startDate().trim(),
        // Errored target dates render as error rows, not empty grids.
        state.targetDates().filter((d) => !(d in state.snapshotErrors())),
      ),
    ),

    /** Target dates whose snapshot fetch failed — rendered as error rows. */
    failedTargetDates: computed(() =>
      state.targetDates().filter((d) => d in state.snapshotErrors()),
    ),

    /** Key (strike-expiration) of the cross-grid highlighted contract —
     *  grids outline the matching cell. Shared with run sections. */
    highlightedKey: computed(() => {
      const h = state.highlightedContract();
      return h ? cellKey(h.strike, h.expiration) : null;
    }),
  })),

  withComputed((state, historyStore = inject(SymbolHistoryStore)) => ({
    /** True when grids have been computed. */
    hasResults: computed(() => state.grids().length > 0),

    /**
     * Signal history for the current symbol — derived from the shared
     * SymbolHistoryStore cache (keyed by symbol), not local state, so a
     * late-resolving fetch can never land under the wrong symbol.
     */
    signals: computed((): StSignalItem[] =>
      historyStore.signalHistoryCache()[state.symbol()] ?? [],
    ),

    /** True when symbol, startDate, and at least one target date are set. */
    canRun: computed(() => {
      const sym = state.symbol().trim();
      const start = state.startDate().trim();
      const targets = state.targetDates();
      return sym.length > 0 && start.length > 0 && targets.length > 0;
    }),

    /**
     * The selected contract's price/delta series across the cached
     * start + target snapshots — drives the chart popup. Empty when no
     * cell is selected or no snapshots are loaded.
     */
    selectedContractSeries: computed((): ContractSeriesPoint[] => {
      const sel = state.selectedCell();
      const cache = state.snapshotCache();
      // Run-grid cells carry their own date/type scope; main-flow cells
      // use the main inputs. Either way, only that scope's target dates
      // feed the series — unrelated cache entries can't leak in.
      const scope = sel?.seriesScope;
      const startDate = scope?.startDate ?? state.startDate().trim();
      const startSnapshot = cache[startDate];
      if (!sel || !startSnapshot) return [];
      const targetSnapshots: Record<string, HistoricalOptionContract[]> = {};
      for (const dt of scope?.targetDates ?? state.targetDates()) {
        targetSnapshots[dt] = cache[dt] ?? [];
      }
      return extractContractSeries(
        {
          contractID: sel.contractID,
          symbol: state.symbol(),
          strike: sel.strike,
          expiration: sel.expiration,
        },
        scope?.type ?? state.type(),
        startDate,
        startSnapshot,
        targetSnapshots,
      );
    }),
  })),

  // Swing-compare computeds live in swing-compare.feature.ts — keeps this
  // file under the size guideline.
  withComputed((state) => swingCompareComputedBlock(state)),

  withMethods((store, optionsContractService = inject(OptionsContractService), barReadService = inject(LocalBarReadService), configService = inject(PctChangeConfigService), swingAnalysisService = inject(SwingAnalysisService), historyStore = inject(SymbolHistoryStore)) => {
    // Track the in-flight runAnalysis subscription so we can cancel stale
    // requests when runAnalysis is called again before the previous one
    // completes, or when reset is called mid-flight.
    let runSub: Subscription | null = null;
    // Track the in-flight resolvePctChangeTargets subscription so reset
    // can cancel it mid-flight.
    let resolveSub: Subscription | null = null;
    // Track the in-flight saved-analyses fetch so setSymbol/selectConfig/
    // reset can cancel a stale request before its result overwrites newer
    // state. Signals don't need this — they're derived from the shared
    // SymbolHistoryStore cache keyed by symbol.
    let swingSub: Subscription | null = null;
    // Dates with an in-flight ensureSnapshots fetch — prevents duplicate
    // requests when several run sections expand before the first resolves.
    const pendingSnapshotDates = new Set<string>();
    // In-flight ensureSnapshots subscriptions — cancelled on symbol
    // change/reset so a late result can't repopulate a cleared cache.
    const snapshotSubs = new Set<Subscription>();

    /** Shared impl — sibling methods aren't visible on `store` inside
     *  withMethods, so setSymbol/selectConfig and the public method both
     *  call this. Signals load through the shared SymbolHistoryStore cache
     *  (deduped per symbol); saved analyses go through swingSub so a stale
     *  fetch can be cancelled on symbol change. */
    const loadSwingDataImpl = (): void => {
      const symbol = store.symbol().trim().toUpperCase();
      swingSub?.unsubscribe();
      swingSub = null;
      if (!symbol) {
        patchState(store, { savedAnalyses: [] });
        return;
      }
      swingSub = swingAnalysisService.loadSavedAnalyses(symbol).pipe(take(1)).subscribe({
        next: (docs) => {
          patchState(store, { savedAnalyses: docs });
          swingSub = null;
        },
        error: (err: unknown) => {
          patchState(store, { savedAnalyses: [] });
          console.error(`[PctChangeStore] Failed to load swing sets for ${symbol}:`, err);
          swingSub = null;
        },
      });
      historyStore.loadSignalHistory(symbol);
    };

    return {
      // Swing-compare methods — implementation in swing-compare.feature.ts.
      ...swingCompareMethods(store, {
        optionsContractService,
        barReadService,
        pending: pendingSnapshotDates,
        subs: snapshotSubs,
      }),

      /** Set the symbol input. Invalidates cached snapshots. When the
       *  symbol actually changes, also clears + reloads swing data
       *  (saved swing sets + signal history). */
      setSymbol(symbol: string): void {
        const sym = String(symbol || '').trim().toUpperCase();
        const symbolChanged = sym !== store.symbol();
        patchState(store, {
          symbol: sym,
          snapshotCache: {},
          underlyingPrices: {},
          ...(symbolChanged ? SWING_COMPARE_CLEARED : {}),
          ...SELECTION_CLEARED,
        });
        if (symbolChanged) {
          snapshotSubs.forEach((s) => s.unsubscribe());
          snapshotSubs.clear();
          pendingSnapshotDates.clear();
          loadSwingDataImpl();
        }
      },

      /**
       * Load saved swing sets + signal history for the current symbol.
       * Feeds the swing-compare section — independent of the main analysis
       * flow, so failures only empty the lists (logged), never set `error`.
       */
      loadSwingData(): void {
        loadSwingDataImpl();
      },

      // Swing-compare methods live in swing-compare.feature.ts — keeps this
      // file under the size guideline.

      /** Set the start date input. Invalidates cached snapshots. */
      setStartDate(date: string): void {
        patchState(store, {
          startDate: String(date || '').trim(),
          snapshotCache: {},
          underlyingPrices: {},
          ...SELECTION_CLEARED,
        });
      },

      /** Add a target date. No-op if already present. */
      addTargetDate(date: string): void {
        const dt = String(date || '').trim();
        if (!dt || store.targetDates().includes(dt)) return;
        patchState(store, {
          targetDates: [...store.targetDates(), dt],
          snapshotCache: {},
          underlyingPrices: {},
          ...SELECTION_CLEARED,
        });
      },

      /** Remove a target date. */
      removeTargetDate(date: string): void {
        const dt = String(date || '').trim();
        patchState(store, {
          targetDates: store.targetDates().filter((d) => d !== dt),
          snapshotCache: {},
          underlyingPrices: {},
          ...SELECTION_CLEARED,
        });
      },

      /** Replace all target dates at once (used by target-type-selector). */
      setTargetDates(dates: string[]): void {
        patchState(store, {
          targetDates: dates.map((d) => String(d || '').trim()).filter((d) => d),
          snapshotCache: {},
          underlyingPrices: {},
          ...SELECTION_CLEARED,
        });
      },

      /** Set the call/put type filter. Also updates the filter.type field. */
      setType(type: OptionType): void {
        patchState(store, {
          type,
          filter: { ...store.filter(), type },
          ...SELECTION_CLEARED,
        });
      },

      /** Update filter fields (duration, strike, delta ranges). */
      setFilter(partial: Partial<Omit<PctChangeFilter, 'type'>>): void {
        patchState(store, {
          filter: { ...store.filter(), ...partial },
        });
      },

      // -----------------------------------------------------------------
      // Contract selection (chart popup)
      // -----------------------------------------------------------------

      /**
       * Transient hover selection — shows the contract's chart while the
       * icon is hovered. Ignored while a contract is pinned.
       */
      previewContract(cell: ContractCellRef, targetDate: string, seriesScope?: SeriesScope): void {
        if (store.isContractPinned()) return;
        patchState(store, { selectedCell: toSelectedCell(cell, targetDate, seriesScope) });
      },

      /**
       * Click selection — pins the overlay open until cleared. Ignored
       * while a contract is already pinned.
       */
      pinContract(cell: ContractCellRef, targetDate: string, seriesScope?: SeriesScope): void {
        if (store.isContractPinned()) return;
        patchState(store, {
          selectedCell: toSelectedCell(cell, targetDate, seriesScope),
          isContractPinned: true,
        });
      },

      /** Clear the selection and unpin — called on outside-click. */
      clearContractSelection(): void {
        patchState(store, { selectedCell: null, isContractPinned: false });
      },

      /**
       * Deliberate cell-click selection — highlights the contract across
       * every grid (including the source) until cleared or overwritten.
       * Independent of the popup's preview/pin lifecycle.
       */
      highlightContract(cell: ContractCellRef): void {
        patchState(store, {
          highlightedContract: { strike: cell.strike, expiration: cell.expiration },
        });
      },

      /** Clear the cross-grid highlight — called on outside-click. */
      clearHighlight(): void {
        patchState(store, { highlightedContract: null });
      },

      /**
       * Run the analysis: fetch N+1 snapshots in parallel, cache them.
       * Grids auto-recompute from the cached snapshots via the computed signal.
       */
      runAnalysis(): void {
        if (!store.canRun()) {
          patchState(store, {
            error: 'symbol, startDate, and at least one target date are required',
            snapshotCache: {},
            ...SELECTION_CLEARED,
          });
          return;
        }

        const symbol = store.symbol().trim().toUpperCase();
        const startDate = store.startDate().trim();
        const targetDates = store.targetDates();

        // Cancel any in-flight run to prevent stale overwrites.
        runSub?.unsubscribe();
        runSub = null;

        patchState(store, {
          loading: true,
          error: null,
          snapshotCache: {},
          snapshotErrors: {},
          snapshotSources: {},
          underlyingPrices: {},
          ...SELECTION_CLEARED,
        });

        // Fetch start + all targets, capped — the partner rejects
        // concurrent bursts with fast 502s (same rationale as
        // swing-compare's ensureSnapshots). mergeMap emits in completion
        // order, so carry the input index and re-sort on the way out.
        const start$ = optionsContractService.getHistoricalOptionsChain$(symbol, startDate);
        type TargetResult =
          | { i: number; ok: true; res: GetHistoricalOptionsChainResponse }
          | { i: number; ok: false; err: unknown };
        const targetReqs$ = from(targetDates).pipe(
          mergeMap(
            (dt, i): Observable<TargetResult> =>
              optionsContractService.getHistoricalOptionsChain$(symbol, dt).pipe(
                map((res) => ({ i, ok: true as const, res })),
                // Per-date catch — one bad target degrades to an error row,
                // it must not sink the run.
                catchError((err: unknown) => of({ i, ok: false as const, err })),
              ),
            SNAPSHOT_FETCH_CONCURRENCY,
          ),
          toArray(),
        );

        // Fetch underlying daily bars covering the full date range.
        const allDates = [startDate, ...targetDates].sort();
        const barFrom = allDates[0];
        const barTo = allDates[allDates.length - 1];
        const bars$ = barReadService.getDailyBarsForRange$(symbol, barFrom, barTo);

        runSub = forkJoin({
          start: start$,
          targets: targetReqs$,
          bars: bars$,
        })
          .pipe(
            map(({ start, targets, bars }) => {
              const snapshotCache: Record<string, HistoricalOptionContract[]> = {
                [startDate]: chainContracts(start),
              };
              const snapshotSources: Record<string, 'gcs' | 'live'> = {};
              const snapshotErrors: Record<string, string> = {};
              if (start.source === 'gcs' || start.source === 'live') {
                snapshotSources[startDate] = start.source;
              }
              for (const r of targets) {
                const dt = targetDates[r.i];
                if (r.ok) {
                  snapshotCache[dt] = chainContracts(r.res);
                  const s = r.res.source;
                  if (s === 'gcs' || s === 'live') snapshotSources[dt] = s;
                } else {
                  snapshotErrors[dt] = describeSnapshotError(r.err, symbol);
                }
              }
              // Closest prior bar close for each requested date.
              const underlyingPrices = closestPriorCloses(bars, [startDate, ...targetDates]);
              return { snapshotCache, snapshotSources, snapshotErrors, underlyingPrices };
            }),
          )
          .subscribe({
            next: ({ snapshotCache, snapshotSources, snapshotErrors, underlyingPrices }) => {
              patchState(store, {
                loading: false,
                error: null,
                snapshotCache,
                snapshotSources,
                snapshotErrors,
                underlyingPrices,
              });
              runSub = null;
            },
            error: (err: unknown) => {
              patchState(store, {
                loading: false,
                error: `Failed to fetch chain snapshots: ${describeSnapshotError(err, store.symbol())}`,
                snapshotCache: {},
                underlyingPrices: {},
                ...SELECTION_CLEARED,
              });
              runSub = null;
            },
          });
      },

      /** Clear all state and cancel any in-flight fetch. */
      reset(): void {
        runSub?.unsubscribe();
        runSub = null;
        resolveSub?.unsubscribe();
        resolveSub = null;
        swingSub?.unsubscribe();
        swingSub = null;
        snapshotSubs.forEach((s) => s.unsubscribe());
        snapshotSubs.clear();
        pendingSnapshotDates.clear();
        // Keep the loaded config list — it's persisted data, not analysis
        // state. The selection resets with the inputs it populated.
        patchState(store, { ...initialState, savedConfigs: store.savedConfigs() });
      },

      // -----------------------------------------------------------------
      // Config state setters
      // -----------------------------------------------------------------

      /** Set the target type selection. */
      setTargetType(targetType: TargetType): void {
        patchState(store, { targetType });
      },

      /** Set the pct-change sub-mode. */
      setPctMode(mode: PctMode): void {
        patchState(store, { pctMode: mode });
      },

      /** Set all pct params at once (values + gradation) — avoids double patchState. */
      setPctParams(values: number[], step: number, count: number, direction: PctDirection): void {
        patchState(store, { pctValues: values, pctStep: step, pctCount: count, pctDirection: direction });
      },

      /** Set the user-dates sub-mode. */
      setUserDatesMode(mode: UserDatesMode): void {
        patchState(store, { userDatesMode: mode });
      },

      /** Set interval params (user-dates interval mode). */
      setIntervalParams(count: number, intervalDays: number): void {
        patchState(store, { intervalCount: count, intervalDays });
      },

      // -----------------------------------------------------------------
      // Saved config CRUD
      // -----------------------------------------------------------------

      /** Load all saved configs from Firestore into state. */
      loadSavedConfigs(): void {
        configService.loadConfigs().pipe(take(1)).subscribe({
          next: (configs) => patchState(store, { savedConfigs: configs }),
          error: (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            patchState(store, { savedConfigs: [], error: `Failed to load saved configs: ${msg}` });
          },
        });
      },

      /** Select a saved config by id and populate all inputs from it.
       *  Reloads swing data when the config's symbol differs — this path
       *  bypasses setSymbol, so it must trigger the load itself. */
      selectConfig(configId: string): void {
        const cfg = store.savedConfigs().find((c) => c.id === configId);
        if (!cfg) return;
        const symbolChanged = cfg.symbol !== store.symbol();
        patchState(store, {
          selectedConfigId: configId,
          symbol: cfg.symbol,
          startDate: cfg.startDate,
          type: cfg.type,
          // Merge onto the delta defaults — configs saved before the band
          // existed (no delta keys) still get it; configs with explicit
          // delta values override. `type` backstops legacy docs whose
          // filter predates the field — without it the type check drops
          // every contract.
          filter: { ...DEFAULT_DELTA_FILTER, ...cfg.filter, type: cfg.filter?.type ?? cfg.type },
          // Legacy configs may carry 'swing-extremes' — the selector no
          // longer offers it (swing-compare replaced it), so normalize to
          // user-dates to avoid a modeless selector.
          targetType: cfg.targetType === 'swing-extremes' ? 'user-dates' : cfg.targetType,
          targetDates: [...cfg.targetDates],
          pctMode: cfg.pctMode ?? 'list',
          pctValues: cfg.pctValues ?? [],
          pctStep: cfg.pctStep ?? 5,
          pctCount: cfg.pctCount ?? 4,
          pctDirection: cfg.pctDirection ?? 'up',
          userDatesMode: cfg.userDatesMode ?? 'manual',
          intervalCount: cfg.intervalCount ?? 5,
          intervalDays: cfg.intervalDays ?? 5,
          snapshotCache: {},
          underlyingPrices: {},
          ...(symbolChanged ? SWING_COMPARE_CLEARED : {}),
          ...SELECTION_CLEARED,
          error: null,
          loading: false,
        });
        if (symbolChanged) {
          snapshotSubs.forEach((s) => s.unsubscribe());
          snapshotSubs.clear();
          pendingSnapshotDates.clear();
          loadSwingDataImpl();
        }
      },

      /** Deselect the current saved config (clears selectedConfigId only). */
      deselectConfig(): void {
        patchState(store, { selectedConfigId: null });
      },

      /** Build a config doc from current state and save it via the service. */
      saveCurrentConfig(): void {
        if (!store.canRun()) {
          patchState(store, { error: 'Cannot save config: symbol, startDate, and at least one target date are required' });
          return;
        }
        const symbol = store.symbol().trim().toUpperCase();
        const startDate = store.startDate().trim();
        const targetDates = store.targetDates();
        const targetType = store.targetType();
        const uid = newId();
        const id = buildConfigId(symbol, startDate, targetDates.length, targetType, uid);
        const doc: PctChangeConfigWithId = {
          id,
          symbol,
          startDate,
          type: store.type(),
          targetType,
          targetDates,
          pctMode: store.pctMode(),
          pctValues: store.pctValues(),
          pctStep: store.pctStep(),
          pctCount: store.pctCount(),
          pctDirection: store.pctDirection(),
          userDatesMode: store.userDatesMode(),
          intervalCount: store.intervalCount(),
          intervalDays: store.intervalDays(),
          // Strip undefined keys — clearing a filter input produces
          // `deltaGte: undefined` etc., and Firestore's setDoc rejects
          // undefined field values outright.
          filter: stripUndefinedFilter(store.filter()),
        };
        configService.saveConfig(doc).pipe(take(1)).subscribe({
          next: () => {
            const existing = store.savedConfigs().filter((c) => c.id !== id);
            patchState(store, { savedConfigs: [...existing, doc], selectedConfigId: id });
          },
          error: (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            patchState(store, { error: `Failed to save config: ${msg}` });
          },
        });
      },

      /** Delete a saved config by id via the service and remove from state. */
      deleteConfig(configId: string): void {
        configService.deleteConfig(configId).pipe(take(1)).subscribe({
          next: () => {
            const remaining = store.savedConfigs().filter((c) => c.id !== configId);
            const selected = store.selectedConfigId();
            patchState(store, {
              savedConfigs: remaining,
              selectedConfigId: selected === configId ? null : selected,
            });
          },
          error: (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            patchState(store, { error: `Failed to delete config: ${msg}` });
          },
        });
      },

      /**
       * Resolve pct-change target dates from daily bars.
       * Fetches bars, finds the start price, builds percentages, and
       * calls resolvePctChangeTargets. Patches resolved dates into targetDates.
       */
      resolvePctChangeTargets(request: ResolvePctChangeRequest): void {
        const symbol = store.symbol().trim().toUpperCase();
        const startDate = store.startDate().trim();
        if (!symbol || !startDate) {
          patchState(store, { error: 'Symbol and start date are required to resolve pct-change targets' });
          return;
        }

        // Build percentages from the request using the pure utility.
        const percentages = buildPercentages(
          request.mode,
          request.values,
          request.step,
          request.count,
          request.direction,
        );
        if (percentages.length === 0) {
          patchState(store, {
            error: 'Nothing to resolve — enter percentage values (list) or a valid step and count (gradation)',
          });
          return;
        }

        // Cancel any in-flight resolution before starting a new one.
        resolveSub?.unsubscribe();

        // Fetch bars covering ~1 year forward from startDate for resolution.
        const toDate = computeForwardEndDate(startDate);
        resolveSub = barReadService.getDailyBarsForRange$(symbol, startDate, toDate).subscribe({
          next: (bars) => {
            const startBar = [...bars].sort((a, b) => a.d.localeCompare(b.d)).find((b) => b.d >= startDate);
            if (!startBar) {
              patchState(store, { error: 'No bar data available for the start date' });
              resolveSub = null;
              return;
            }
            const resolved = resolvePctChangeDatesFromBars(bars, startDate, startBar.c, percentages);
            if (resolved.length === 0) {
              // Don't clobber existing dates on a zero-result resolve —
              // surface why nothing appeared instead.
              patchState(store, {
                error: `No dates resolved — none of the percentage targets were reached within a year of ${startDate}`,
              });
              resolveSub = null;
              return;
            }
            // Same invalidation as setTargetDates — the contract universe
            // changed, so stale snapshots must not linger.
            patchState(store, {
              targetDates: resolved,
              error: null,
              snapshotCache: {},
              underlyingPrices: {},
              resolveNonce: store.resolveNonce() + 1,
              ...SELECTION_CLEARED,
            });
            resolveSub = null;
          },
          error: (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            patchState(store, { error: `Failed to fetch bars for pct-change resolution: ${msg}` });
            resolveSub = null;
          },
        });
      },
    };
  }),
);
