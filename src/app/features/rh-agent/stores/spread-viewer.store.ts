/**
 * @topic #77 — Spread Time Series Viewer (opened 2026-08-02)
 *
 * NgRx SignalStore managing all spread viewer state.
 * Handles symbol/contract index loading, spread building, run submission,
 * job observation, and chart pagination.
 */
import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { Subscription, take } from 'rxjs';

import { SpreadService } from '../services/spread.service';
import { SpreadRunService, type SpreadRunDocData, type SpreadJobDocData } from '../services/spread-run.service';
import { SpreadListService } from '../services/spread-list.service';
import { OptionsContractService } from '../services/options-contract.service';
import { RsBarsService } from '../../services/rs-bars.service';
import { cloneSpreadDefinition } from '../utils/spread-definition.utils';
import type { OHLCDatum } from '../../shared/types/rs.interfaces';
import type { OptionsContractIndexResponse } from '@options-contract/contracts';
import {
  SpreadType,
  SpreadStatus,
  DebitOrCredit,
  type Spread,
  type SpreadDefinition,
  type SpreadTimeSeriesResponse,
  type SpreadRunStatus,
  type SpreadJobStatus,
  type SpreadListDoc,
} from '@spread/contracts';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface SpreadViewerState {
  symbol: string | null;
  contractIndex: OptionsContractIndexResponse | null;
  contractIndexStatus: 'idle' | 'loading' | 'loaded' | 'error';
  spreads: Spread[];
  underlyingBars: OHLCDatum[];
  underlyingStatus: 'idle' | 'loading' | 'loaded' | 'error';
  activeRunId: string | null;
  runProgress: { total: number; succeeded: number; failed: number } | null;
  plottedStartIndex: number;
  plottedPageLength: number;
  showUnderlying: boolean;
  chartMode: 'absolute' | 'normalized';
  namedLists: SpreadListDoc[];
  // ADR-004: named list context + parametric form state
  selectedListId: string | null;
  lastSavedSnapshot: SpreadDefinition[] | null;
  chartDateRange: { start: string | null; end: string | null };
  entryDate: string | null;
  strikeRange: { min: number | null; max: number | null };
  selectedLengthBuckets: Set<string>;
}

const initialState: SpreadViewerState = {
  symbol: null,
  contractIndex: null,
  contractIndexStatus: 'idle',
  spreads: [],
  underlyingBars: [],
  underlyingStatus: 'idle',
  activeRunId: null,
  runProgress: null,
  plottedStartIndex: 0,
  plottedPageLength: 20,
  showUnderlying: true,
  chartMode: 'absolute',
  namedLists: [],
  selectedListId: null,
  lastSavedSnapshot: null,
  chartDateRange: { start: null, end: null },
  entryDate: null,
  strikeRange: { min: null, max: null },
  selectedLengthBuckets: new Set<string>(),
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const SpreadViewerStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  withComputed((state) => ({
    /** Spreads that haven't been loaded yet. */
    pendingSpreads: computed(() =>
      state.spreads().filter((s) => s.status === SpreadStatus.PENDING),
    ),

    /** Spreads that have been successfully loaded. */
    loadedSpreads: computed(() =>
      state.spreads().filter((s) => s.status === SpreadStatus.LOADED),
    ),

    /** Current page of loaded spreads for chart rendering. */
    plottedSpreads: computed(() => {
      const loaded = state.spreads().filter((s) => s.status === SpreadStatus.LOADED);
      const start = state.plottedStartIndex();
      const len = state.plottedPageLength();
      return loaded.slice(start, start + len);
    }),

    /** Union of all dates across plotted spreads. */
    allDates: computed(() => {
      const plotted = state.spreads()
        .filter((s) => s.status === SpreadStatus.LOADED)
        .slice(state.plottedStartIndex(), state.plottedStartIndex() + state.plottedPageLength());
      const dateSet = new Set<string>();
      for (const spread of plotted) {
        if (spread.series) {
          for (const obs of spread.series) {
            dateSet.add(obs.date);
          }
        }
      }
      return Array.from(dateSet).sort();
    }),

    /** Whether any pending spreads exist. */
    hasPending: computed(() =>
      state.spreads().some((s) => s.status === SpreadStatus.PENDING),
    ),

    /** Whether a run is currently in progress. */
    isRunInProgress: computed(() => state.activeRunId() !== null),

    /** Total number of loaded spreads. */
    loadedCount: computed(() =>
      state.spreads().filter((s) => s.status === SpreadStatus.LOADED).length,
    ),

    /** Current page number (1-indexed). */
    currentPage: computed(() => {
      const start = state.plottedStartIndex();
      const len = state.plottedPageLength();
      return Math.floor(start / len) + 1;
    }),

    /** Total number of pages. */
    totalPages: computed(() => {
      const loaded = state.spreads().filter((s) => s.status === SpreadStatus.LOADED).length;
      const len = state.plottedPageLength();
      return Math.max(1, Math.ceil(loaded / len));
    }),

    // ── ADR-004: computed signals for parametric form + dirty state ────────

    /** Whether the working buffer differs from the last saved snapshot. */
    isDirty: computed(() => {
      const snapshot = state.lastSavedSnapshot();
      const spreads = state.spreads();
      if (!snapshot) return spreads.length > 0;
      // Shallow check first — different length means definitely dirty
      if (spreads.length !== snapshot.length) return true;
      // Deep comparison only when lengths match
      const currentDefs = spreads.map(toDefinition);
      return JSON.stringify(currentDefs) !== JSON.stringify(snapshot);
    }),

    /** Trading dates available from underlying bars within the chart date range. */
    availableEntryDates: computed(() => {
      const bars = state.underlyingBars();
      const range = state.chartDateRange();
      return bars
        .map((b) => b.date)
        .filter((d): d is string => d != null)
        .filter((d) => {
          if (range.start && d < range.start) return false;
          if (range.end && d > range.end) return false;
          return true;
        })
        .sort();
    }),

    /** Underlying close price on the selected entry date. */
    underlyingPrice: computed(() => {
      const date = state.entryDate();
      if (!date) return null;
      const bar = state.underlyingBars().find((b) => b.date === date);
      return bar ? bar.close : null;
    }),
  })),

  withMethods((store) => {
    const spreadService = inject(SpreadService);
    const spreadRunService = inject(SpreadRunService);
    const spreadListService = inject(SpreadListService);
    const optionsContractService = inject(OptionsContractService);
    const rsBarsService = inject(RsBarsService);

    let runSub: Subscription | null = null;
    let jobsSub: Subscription | null = null;
    let contractIndexSub: Subscription | null = null;
    let underlyingSub: Subscription | null = null;
    let recentSub: Subscription | null = null;
    let namedListsSub: Subscription | null = null;
    let submittedSpreadIds: Set<string> = new Set();

    function fetchUnderlyingBars(symbol: string): void {
      underlyingSub?.unsubscribe();
      patchState(store, { underlyingStatus: 'loading' });
      // ADR-004: fetch full dataset, filter client-side to chartDateRange
      underlyingSub = rsBarsService.getDailyBars$(symbol).subscribe({
        next: (bars) => patchState(store, { underlyingBars: bars, underlyingStatus: 'loaded' }),
        error: () => patchState(store, { underlyingBars: [], underlyingStatus: 'error' }),
      });
    }

    return {
      /** Set the symbol and load contract index + underlying bars. */
      setSymbol(symbol: string): void {
        const sym = symbol.trim().toUpperCase();
        if (!sym) return;
        contractIndexSub?.unsubscribe();
        underlyingSub?.unsubscribe();
        runSub?.unsubscribe();
        jobsSub?.unsubscribe();
        runSub = null;
        jobsSub = null;
        patchState(store, {
          symbol: sym,
          contractIndex: null,
          contractIndexStatus: 'loading',
          spreads: [],
          activeRunId: null,
          runProgress: null,
          plottedStartIndex: 0,
        });

        contractIndexSub = optionsContractService.getContractIndex$(sym).subscribe({
          next: (data) => {
            console.log('[SpreadViewer] contract index loaded:', data.expirations?.length, 'expirations');
            patchState(store, { contractIndex: data, contractIndexStatus: 'loaded' });
          },
          error: (err) => {
            console.error('[SpreadViewer] contract index error:', err);
            patchState(store, { contractIndexStatus: 'error' });
          },
        });

        fetchUnderlyingBars(sym);
      },

      /** Add a spread definition to the list with PENDING status. */
      addSpread(definition: SpreadDefinition): void {
        const spread: Spread = {
          ...definition,
          id: `spread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          status: SpreadStatus.PENDING,
        };
        patchState(store, { spreads: [...store.spreads(), spread] });

        // Persist to recent list (fire-and-forget)
        spreadListService.addToRecent(definition).catch((err) => {
          console.error('[SpreadViewer] addToRecent failed:', err);
        });
      },

      /** Remove a spread from the list by ID. */
      removeSpread(spreadId: string): void {
        patchState(store, {
          spreads: store.spreads().filter((s) => s.id !== spreadId),
        });
      },

      /** Clear all spreads. */
      clearSpreads(): void {
        patchState(store, { spreads: [], plottedStartIndex: 0 });
      },

      /** Submit all pending spreads for loading. Returns true if a run was started. */
      loadSpreads(): boolean {
        if (store.activeRunId() !== null) {
          console.warn('[SpreadViewer] loadSpreads — run already in progress');
          return false;
        }

        const pending = store.spreads().filter((s) => s.status === SpreadStatus.PENDING);
        if (pending.length === 0) {
          console.warn('[SpreadViewer] loadSpreads — no pending spreads');
          return false;
        }

        console.log('[SpreadViewer] loadSpreads — submitting', pending.length, 'pending spreads');

        // Track which spread IDs are in this batch for job mapping
        submittedSpreadIds = new Set(pending.map((s) => s.id));

        // Mark all pending as LOADING
        const spreads = store.spreads().map((s) =>
          s.status === SpreadStatus.PENDING ? { ...s, status: SpreadStatus.LOADING } : s,
        );
        patchState(store, { spreads });

        const definitions = pending.map((s) => {
          const { id, status, series, debitOrCredit, gaps, legMetadata, error, ...def } = s;
          return def as SpreadDefinition;
        });

        console.log('[SpreadViewer] loadSpreads — definitions:', JSON.stringify(definitions).slice(0, 500));

        spreadService.submitSpreadRun$(definitions).subscribe({
          next: (resp) => {
            console.log('[SpreadViewer] submitSpreadRun response:', resp);
            patchState(store, {
              activeRunId: resp.runId,
              runProgress: { total: pending.length, succeeded: 0, failed: 0 },
            });

            // Subscribe to run doc for progress + completion
            runSub = spreadRunService.watchRun$(resp.runId).subscribe({
              next: (runDoc: SpreadRunDocData) => {
                patchState(store, {
                  runProgress: {
                    total: runDoc.expectedJobs,
                    succeeded: runDoc.successJobs,
                    failed: runDoc.failedJobs,
                  },
                });

                if (['COMPLETE', 'PARTIAL', 'FAILED'].includes(runDoc.status)) {
                  console.log('[SpreadViewer] run complete:', runDoc.status, runDoc);
                  runSub?.unsubscribe();
                  jobsSub?.unsubscribe();
                  runSub = null;
                  jobsSub = null;
                  submittedSpreadIds.clear();
                  patchState(store, { activeRunId: null });
                }
              },
              error: () => {
                runSub?.unsubscribe();
                jobsSub?.unsubscribe();
                runSub = null;
                jobsSub = null;
                submittedSpreadIds.clear();
                patchState(store, { activeRunId: null });
              },
            });

            // Subscribe to jobs for per-spread results
            jobsSub = spreadRunService.watchRunJobs$(resp.runId).subscribe({
              next: (jobs: SpreadJobDocData[]) => {
                console.log('[SpreadViewer] jobs update:', jobs.length, 'jobs', jobs.map((j) => ({ idx: j.spreadIndex, status: j.status, hasResult: !!j.result })));
                const currentSpreads = store.spreads();

                // Build a map from spreadIndex to the submitted spread ID
                const submittedList = currentSpreads.filter((s) => submittedSpreadIds.has(s.id));
                const updatedSpreads = currentSpreads.map((spread) => {
                  if (!submittedSpreadIds.has(spread.id)) return spread;

                  const spreadIdx = submittedList.findIndex((s) => s.id === spread.id);
                  const job = jobs.find((j) => j.spreadIndex === spreadIdx);
                  if (!job) return spread;

                  if (job.status === 'SUCCESS' && spread.status !== SpreadStatus.LOADED) {
                    const result = job.result as SpreadTimeSeriesResponse;
                    console.log('[SpreadViewer] job SUCCESS — spreadIndex:', job.spreadIndex, 'series length:', result.series?.length, 'debitOrCredit:', result.debitOrCredit);
                    return {
                      ...spread,
                      status: SpreadStatus.LOADED,
                      series: result.series,
                      debitOrCredit: result.debitOrCredit,
                      gaps: result.gaps,
                      legMetadata: result.legs,
                    };
                  }

                  if (job.status === 'PERMANENT_FAILURE' && spread.status !== SpreadStatus.ERROR) {
                    console.error('[SpreadViewer] job FAILED — spreadIndex:', job.spreadIndex, 'error:', job.error);
                    return {
                      ...spread,
                      status: SpreadStatus.ERROR,
                      error: job.error ?? 'Unknown error',
                    };
                  }

                  return spread;
                });

                patchState(store, { spreads: updatedSpreads });
                const loadedCount = updatedSpreads.filter((s) => s.status === SpreadStatus.LOADED).length;
                console.log('[SpreadViewer] after jobs update — loaded spreads:', loadedCount);
              },
            });
          },
          error: (err: Error) => {
            console.error('[SpreadViewer] submitSpreadRun error:', err);
            // Mark all loading spreads as error
            const spreads = store.spreads().map((s) =>
              s.status === SpreadStatus.LOADING
                ? { ...s, status: SpreadStatus.ERROR as SpreadStatus, error: err.message }
                : s,
            );
            patchState(store, { spreads });
            submittedSpreadIds.clear();
          },
        });

        return true;
      },

      /** Go to next page of plotted spreads. */
      nextPage(): void {
        const current = store.plottedStartIndex();
        const len = store.plottedPageLength();
        const loadedCount = store.spreads().filter((s) => s.status === SpreadStatus.LOADED).length;
        if (current + len < loadedCount) {
          patchState(store, { plottedStartIndex: current + len });
        }
      },

      /** Go to previous page of plotted spreads. */
      prevPage(): void {
        const current = store.plottedStartIndex();
        const len = store.plottedPageLength();
        if (current > 0) {
          patchState(store, { plottedStartIndex: Math.max(0, current - len) });
        }
      },

      /** Toggle underlying overlay visibility. */
      toggleUnderlying(): void {
        patchState(store, { showUnderlying: !store.showUnderlying() });
      },

      /** Set chart mode (absolute or normalized). */
      setChartMode(mode: 'absolute' | 'normalized'): void {
        patchState(store, { chartMode: mode });
      },

      /** Load the user's recent 10 spreads into the spread list. */
      loadRecentList(): void {
        recentSub?.unsubscribe();
        recentSub = spreadListService.loadRecentList$().subscribe({
          next: (defs) => {
            const existing = store.spreads();
            const newSpreads: Spread[] = defs
              .filter((def) => !existing.some((s) => isSameSpread(s, def)))
              .map((def) => ({
                ...def,
                id: `spread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                status: SpreadStatus.PENDING,
              }));
            if (newSpreads.length === 0) return;
            patchState(store, {
              spreads: [...existing, ...newSpreads],
              plottedStartIndex: 0,
            });
          },
          error: (err) => console.error('[SpreadViewer] loadRecentList failed:', err),
        });
      },

      /** Load all named lists for the current user (for dropdown display). */
      loadNamedLists(): void {
        namedListsSub?.unsubscribe();
        namedListsSub = spreadListService.loadNamedLists$().pipe(take(1)).subscribe({
          next: (lists) => {
            console.log('[SpreadViewer] loadNamedLists returned:', lists.length, 'lists', lists);
            patchState(store, { namedLists: lists });
          },
          error: (err) => {
            console.error('[SpreadViewer] loadNamedLists failed:', err);
            patchState(store, { namedLists: [] });
          },
        });
      },

      /** Load a named list's spreads into the spread list. */
      loadNamedList(listId: string): void {
        const list = store.namedLists().find((l) => l.id === listId);
        if (!list) return;
        const existing = store.spreads();
        const newSpreads: Spread[] = list.spreads
          .filter((def) => !existing.some((s) => isSameSpread(s, def)))
          .map((def) => ({
            ...def,
            id: `spread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            status: SpreadStatus.PENDING,
          }));
        if (newSpreads.length === 0) return;
        patchState(store, {
          spreads: [...existing, ...newSpreads],
          plottedStartIndex: 0,
        });
      },

      /** Delete a named list by ID. */
      deleteNamedList(listId: string): void {
        spreadListService.deleteList(listId).then(() => {
          patchState(store, {
            namedLists: store.namedLists().filter((l) => l.id !== listId),
          });
        }).catch((err) => {
          console.error('[SpreadViewer] deleteNamedList failed:', err);
        });
      },

      // ── ADR-004: named list context + parametric form methods ────────────

      /** Open a named list into the working buffer, set selectedListId, snapshot. */
      openList(listId: string): void {
        if (store.activeRunId() !== null) {
          console.warn('[SpreadViewer] openList — run in progress, cannot replace buffer');
          return;
        }
        const list = store.namedLists().find((l) => l.id === listId);
        if (!list) return;
        const newSpreads: Spread[] = list.spreads.map((def) => ({
          ...def,
          id: `spread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          status: SpreadStatus.PENDING,
        }));
        const snapshot = list.spreads.map(cloneSpreadDefinition);
        patchState(store, {
          spreads: newSpreads,
          selectedListId: listId,
          lastSavedSnapshot: snapshot,
          plottedStartIndex: 0,
        });
      },

      /** Save the working buffer back to the selected named list. */
      saveCurrentList(): void {
        const listId = store.selectedListId();
        if (!listId) return;
        const list = store.namedLists().find((l) => l.id === listId);
        if (!list) return;
        const defs = store.spreads().map(toDefinition);
        spreadListService.saveList(list.name, defs).then(() => {
          patchState(store, { lastSavedSnapshot: defs });
        }).catch((err) => {
          console.error('[SpreadViewer] saveCurrentList failed:', err);
        });
      },

      /** Save the working buffer as a new named list. */
      saveAsList(name: string): void {
        const defs = store.spreads().map(toDefinition);
        spreadListService.saveList(name, defs).then(() => {
          spreadListService.loadNamedLists$().pipe(take(1)).subscribe({
            next: (lists) => {
              const newList = lists.find((l) => l.name === name);
              patchState(store, {
                namedLists: lists,
                selectedListId: newList?.id ?? null,
                lastSavedSnapshot: defs,
              });
            },
            error: (err) => console.error('[SpreadViewer] saveAsList loadNamedLists failed:', err),
          });
        }).catch((err) => {
          console.error('[SpreadViewer] saveAsList failed:', err);
        });
      },

      /** Create a new empty named list, set it as selected, and clear the buffer. */
      createNewList(name: string): void {
        spreadListService.saveList(name, []).then(() => {
          spreadListService.loadNamedLists$().pipe(take(1)).subscribe({
            next: (lists) => {
              const newList = lists.find((l) => l.name === name);
              patchState(store, {
                namedLists: lists,
                selectedListId: newList?.id ?? null,
                lastSavedSnapshot: [],
                spreads: [],
                plottedStartIndex: 0,
              });
            },
            error: (err) => console.error('[SpreadViewer] createNewList loadNamedLists failed:', err),
          });
        }).catch((err) => {
          console.error('[SpreadViewer] createNewList failed:', err);
        });
      },

      /** Clear the working buffer (does not affect named lists). */
      clearBuffer(): void {
        patchState(store, { spreads: [], plottedStartIndex: 0 });
      },

      /** Set the chart date range for underlying bars filtering. */
      setChartDateRange(start: string | null, end: string | null): void {
        patchState(store, { chartDateRange: { start, end } });
      },

      /** Set the strike range for catalog query filtering. */
      setStrikeRange(min: number | null, max: number | null): void {
        patchState(store, { strikeRange: { min, max } });
      },

      /** Set the selected contract length buckets for catalog filtering. */
      setLengthBuckets(buckets: Set<string>): void {
        patchState(store, { selectedLengthBuckets: new Set(buckets) });
      },

      /** Set the entry date for the parametric form. */
      setEntryDate(date: string | null): void {
        patchState(store, { entryDate: date });
      },

      /** Advance the entry date forward by a trading-day offset, skipping non-trading days. */
      advanceEntryDate(offset: '1d' | '1w' | '1m'): void {
        const available = store.availableEntryDates();
        if (available.length === 0) return;
        const current = store.entryDate();
        if (!current) {
          patchState(store, { entryDate: available[0] });
          return;
        }
        const stepMap = { '1d': 1, '1w': 5, '1m': 21 } as const;
        const step = stepMap[offset];
        const idx = available.indexOf(current);
        if (idx === -1) {
          // Current date not in available dates — find the next one after it
          const next = available.find((d) => d > current) ?? available[available.length - 1];
          patchState(store, { entryDate: next ?? available[available.length - 1] });
          return;
        }
        const nextIdx = Math.min(idx + step, available.length - 1);
        patchState(store, { entryDate: available[nextIdx] });
      },

      /** Delete a spread from the working buffer by ID. */
      deleteSpreadFromBuffer(spreadId: string): void {
        patchState(store, {
          spreads: store.spreads().filter((s) => s.id !== spreadId),
        });
      },

      /** Reset store to initial state. */
      reset(): void {
        runSub?.unsubscribe();
        jobsSub?.unsubscribe();
        contractIndexSub?.unsubscribe();
        underlyingSub?.unsubscribe();
        recentSub?.unsubscribe();
        namedListsSub?.unsubscribe();
        runSub = null;
        jobsSub = null;
        submittedSpreadIds.clear();
        patchState(store, initialState);
      },
    };
  }),
);

/** Check if a Spread and a SpreadDefinition represent the same spread (by key fields). */
function isSameSpread(spread: Spread, def: SpreadDefinition): boolean {
  return spread.spreadType === def.spreadType
    && spread.symbol === def.symbol
    && spread.legs.length === def.legs.length
    && spread.legs.every((leg, i) =>
      leg.optionType === def.legs[i].optionType
      && leg.strike === def.legs[i].strike
      && leg.expiration === def.legs[i].expiration
      && leg.direction === def.legs[i].direction,
    );
}

/** Strip runtime fields from a Spread to get a plain SpreadDefinition. */
function toDefinition(spread: Spread): SpreadDefinition {
  const { id, status, series, debitOrCredit, gaps, legMetadata, error, ...def } = spread;
  return def as SpreadDefinition;
}
