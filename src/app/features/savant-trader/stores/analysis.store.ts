/**
 * AnalysisStore (Thread #1059, task #1081) — signal store for the
 * trading/analysis surface. Holds the dataset library, the open
 * dataset's rows + present-column manifest, the active filter chain,
 * saved slices, the compare dataset, and loading/error state.
 * Same NgRx signalStore pattern as PaperTradingStore.
 */
import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { catchError, finalize, of, Subscription, switchMap } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';

import { AnalysisService } from '../services/analysis.service';
import {
  applySliceFilters,
  isClosedCohortRow,
  sortAnalysisRows,
  type AnalysisSort,
} from '../utils/analysis-rows.util';
import type {
  AnalysisDatasetDoc,
  AnalysisRunParams,
  AnalysisSlice,
  SliceFilter,
  TradeAnalysisRow,
} from '@paper-trading/analysis';

export type { AnalysisSort, AnalysisSortDir } from '../utils/analysis-rows.util';

// ── State ────────────────────────────────────────────────────────────────────

export interface AnalysisState {
  datasets: AnalysisDatasetDoc[];
  activeDataset: AnalysisDatasetDoc | null;
  rows: TradeAnalysisRow[];
  /** CSV header names actually present in the loaded dataset — slice
   *  predicates on absent columns are skipped with a notice. */
  columns: string[];
  filters: SliceFilter[];
  /** Columns skipped by the last applySlice — drives the UI notice. */
  skippedSliceColumns: string[];
  /** #1083 quarantine: when false, only closed signal-equity rows reach
   *  the workbench view (and future stats). When true, open/provisional
   *  and excluded-cohort rows are included — flagged in the UI. */
  includeOpenRows: boolean;
  sorts: AnalysisSort[];
  slices: AnalysisSlice[];
  compareDatasetId: string | null;
  compareRows: TradeAnalysisRow[];
  /** CSV header names present in the compare dataset — predicates on
   *  absent columns are skipped there too, surfaced via
   *  skippedCompareColumns. */
  compareColumns: string[];
  isLoadingDatasets: boolean;
  isLoadingRows: boolean;
  isLoadingCompare: boolean;
  /** True while the generateTradeDataset callable + follow-up refresh
   *  are in flight — the run-config form disables submit on it. */
  isGenerating: boolean;
  error: string | null;
}

const initialState: AnalysisState = {
  datasets: [],
  activeDataset: null,
  rows: [],
  columns: [],
  filters: [],
  skippedSliceColumns: [],
  includeOpenRows: false,
  sorts: [],
  slices: [],
  compareDatasetId: null,
  compareRows: [],
  compareColumns: [],
  isLoadingDatasets: false,
  isLoadingRows: false,
  isLoadingCompare: false,
  isGenerating: false,
  error: null,
};

const toMessage = (err: unknown, fallback: string): string =>
  (err as { code?: string })?.code === 'unauthenticated'
    ? 'Authentication required to view analysis data'
    : fallback;

// ── Store ────────────────────────────────────────────────────────────────────

export const AnalysisStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withComputed((state) => ({
    isLoading: computed(
      () => state.isLoadingDatasets() || state.isLoadingRows(),
    ),

    /** The workbench's visible universe: the closed signal-equity
     *  cohort unless includeOpenRows lifts the quarantine. */
    viewRows: computed(() =>
      state.includeOpenRows()
        ? state.rows()
        : state.rows().filter(isClosedCohortRow),
    ),

    /** The compare dataset's index doc, or null. */
    compareDataset: computed(
      () =>
        state.datasets().find((d) => d.id === state.compareDatasetId()) ?? null,
    ),
  })),

  withComputed((state) => ({
    /** Rows the quarantine is hiding — drives the toggle's badge. */
    hiddenRowCount: computed(
      () => state.rows().length - state.viewRows().length,
    ),

    /** Rows through the active filter chain (AND). */
    filteredRows: computed(() =>
      applySliceFilters(state.viewRows(), state.filters()),
    ),

    /** Compare rows through the SAME quarantine + filter chain — the
     *  overlay set. Predicates on columns the compare dataset lacks are
     *  skipped (same semantics as applySlice on the primary set) so a
     *  missing column can't silently empty the compare side. */
    filteredCompareRows: computed(() => {
      const have = new Set(state.compareColumns());
      const chain = state.filters().filter((f) => have.has(f.column));
      return applySliceFilters(
        state.includeOpenRows()
          ? state.compareRows()
          : state.compareRows().filter(isClosedCohortRow),
        chain,
      );
    }),

    /** Active-filter columns absent from the compare dataset — the
     *  persistent notice counterpart to applySlice's snackbar. */
    skippedCompareColumns: computed(() =>
      state.compareColumns().length === 0
        ? []
        : state
            .filters()
            .filter((f) => !state.compareColumns().includes(f.column))
            .map((f) => f.column),
    ),
  })),

  withComputed((state) => ({
    /** Filtered rows through the sort chain — the workbench view. */
    sortedRows: computed(() =>
      sortAnalysisRows(state.filteredRows(), state.sorts()),
    ),
  })),

  withMethods(
    (
      state,
      service = inject(AnalysisService),
      snackBar = inject(MatSnackBar),
    ) => {
      let datasetsSub: Subscription | null = null;
      let rowsSub: Subscription | null = null;
      let compareSub: Subscription | null = null;
      let generateSub: Subscription | null = null;

      return {
      // ── dataset library ──────────────────────────────────────────────

      loadDatasets(): void {
        datasetsSub?.unsubscribe();
        patchState(state, { isLoadingDatasets: true, error: null });
        datasetsSub = service
          .listDatasets$()
          .pipe(
            catchError((err) => {
              const msg = toMessage(err, 'Failed to load datasets');
              patchState(state, { error: msg });
              snackBar.open(msg, 'Dismiss', { duration: 5000 });
              return of([] as AnalysisDatasetDoc[]);
            }),
            finalize(() => patchState(state, { isLoadingDatasets: false })),
          )
          .subscribe((datasets) => patchState(state, { datasets }));
      },

      /** Load a dataset's CSV rows into the workbench — resets filters
       *  and sort so a new dataset starts clean. Cancels any in-flight
       *  load so a slower previous fetch can't overwrite the newer
       *  selection's rows. */
      openDataset(dataset: AnalysisDatasetDoc): void {
        rowsSub?.unsubscribe();
        // Self-compare guard: promoting the compare target to the open
        // dataset clears the compare slot — same-set-on-both-sides is
        // meaningless and the picker only filters at selection time.
        if (state.compareDatasetId() === dataset.id) {
          compareSub?.unsubscribe();
          patchState(state, {
            compareDatasetId: null,
            compareRows: [],
            compareColumns: [],
          });
        }
        patchState(state, {
          isLoadingRows: true,
          error: null,
          activeDataset: dataset,
          filters: [],
          skippedSliceColumns: [],
          includeOpenRows: false,
          sorts: [],
        });
        rowsSub = service
          .loadDataset$(dataset)
          .pipe(
            catchError((err) => {
              const msg = toMessage(err, 'Failed to load dataset');
              patchState(state, { error: msg });
              snackBar.open(msg, 'Dismiss', { duration: 5000 });
              return of({ rows: [] as TradeAnalysisRow[], columns: [] as string[] });
            }),
            finalize(() => patchState(state, { isLoadingRows: false })),
          )
          .subscribe((loaded) =>
            patchState(state, { rows: loaded.rows, columns: loaded.columns }),
          );
      },

      closeDataset(): void {
        rowsSub?.unsubscribe(); // a late resolve must not repopulate rows
        patchState(state, {
          activeDataset: null,
          rows: [],
          columns: [],
          filters: [],
          skippedSliceColumns: [],
          includeOpenRows: false,
          sorts: [],
        });
      },

      updateTagsNotes(datasetId: string, tags: string[], notes?: string | null): void {
        service.updateTagsNotes$(datasetId, tags, notes).subscribe({
          next: () =>
            patchState(state, {
              datasets: state
                .datasets()
                .map((d) =>
                  d.id === datasetId
                    ? { ...d, tags, ...(notes !== undefined ? { notes: notes ?? undefined } : {}) }
                    : d,
                ),
            }),
          error: (err) => {
            const msg = toMessage(err, 'Failed to update dataset');
            patchState(state, { error: msg });
            snackBar.open(msg, 'Dismiss', { duration: 5000 });
          },
        });
      },

      /** Delete doc + object; drops it from the library and clears it
       *  from the workbench and compare slot if it was either. */
      deleteDataset(dataset: AnalysisDatasetDoc): void {
        service.deleteDataset$(dataset).subscribe({
          next: () => {
            // An in-flight compare fetch for the deleted doc must not
            // land rows after the clear (phantom compare state + a
            // skip-note with no compare active).
            if (state.compareDatasetId() === dataset.id) compareSub?.unsubscribe();
            patchState(state, {
              datasets: state.datasets().filter((d) => d.id !== dataset.id),
              ...(state.activeDataset()?.id === dataset.id
                ? {
                    activeDataset: null,
                    rows: [],
                    columns: [],
                    filters: [],
                    skippedSliceColumns: [],
                    includeOpenRows: false,
                    sorts: [],
                  }
                : {}),
              ...(state.compareDatasetId() === dataset.id
                ? { compareDatasetId: null, compareRows: [], compareColumns: [] }
                : {}),
            });
          },
          error: (err) => {
            const msg = toMessage(err, 'Failed to delete dataset');
            patchState(state, { error: msg });
            snackBar.open(msg, 'Dismiss', { duration: 5000 });
          },
        });
      },

      /** Enqueue a dataset generation (task #1082): callable → optional
       *  tags/notes on the new index doc → library refresh so the
       *  minted 'generating' entry surfaces immediately. */
      generateDataset(
        params: AnalysisRunParams,
        meta?: { tags?: string[]; notes?: string },
      ): void {
        generateSub?.unsubscribe();
        patchState(state, { isGenerating: true, error: null });
        generateSub = service
          .generateDataset$(params)
          .pipe(
            switchMap((datasetId) =>
              meta && (meta.tags?.length || meta.notes)
                ? service
                    .updateTagsNotes$(datasetId, meta.tags ?? [], meta.notes)
                    .pipe(catchError(() => of(void 0))) // doc minted — don't lose the refresh
                : of(void 0),
            ),
            switchMap(() => service.listDatasets$()),
            catchError((err) => {
              const msg = toMessage(err, 'Failed to start dataset generation');
              patchState(state, { error: msg });
              snackBar.open(msg, 'Dismiss', { duration: 5000 });
              return of(null);
            }),
            finalize(() => patchState(state, { isGenerating: false })),
          )
          .subscribe((datasets) => {
            if (datasets) patchState(state, { datasets });
          });
      },

      // ── filters ──────────────────────────────────────────────────────

      addFilter(filter: SliceFilter): void {
        patchState(state, { filters: [...state.filters(), filter] });
      },

      removeFilter(index: number): void {
        patchState(state, {
          filters: state.filters().filter((_, i) => i !== index),
        });
      },

      clearFilters(): void {
        patchState(state, { filters: [], skippedSliceColumns: [] });
      },

      /** Replace the whole filter chain — the workbench table's
       *  per-column controls emit chain-level updates. */
      setFilters(filters: SliceFilter[]): void {
        patchState(state, { filters, skippedSliceColumns: [] });
      },

      /** #1083 quarantine toggle — lifting it reveals open/provisional
       *  and excluded-cohort rows (UI marks them). */
      setIncludeOpenRows(include: boolean): void {
        patchState(state, { includeOpenRows: include });
      },

      // ── sort chain — same cycle as #1067: asc → desc → removed;
      //  additive keeps the chain and toggles this column's key. ────────

      toggleSort(column: AnalysisSort['column'], additive = false): void {
        const cur = state.sorts();
        const i = cur.findIndex((s) => s.column === column);
        if (!additive) {
          patchState(state, {
            sorts:
              i === -1
                ? [{ column, dir: 'asc' }]
                : cur[i].dir === 'asc'
                  ? [{ column, dir: 'desc' }]
                  : [],
          });
          return;
        }
        const list = [...cur];
        if (i === -1) list.push({ column, dir: 'asc' });
        else if (list[i].dir === 'asc') list[i] = { column, dir: 'desc' };
        else list.splice(i, 1);
        patchState(state, { sorts: list });
      },

      // ── slices ───────────────────────────────────────────────────────

      loadSlices(): void {
        service
          .listSlices$()
          .pipe(
            catchError((err) => {
              const msg = toMessage(err, 'Failed to load slices');
              patchState(state, { error: msg });
              snackBar.open(msg, 'Dismiss', { duration: 5000 });
              return of([] as AnalysisSlice[]);
            }),
          )
          .subscribe((slices) => patchState(state, { slices }));
      },

      /** Serialize the current filter chain as a named slice. */
      saveSlice(name: string, note?: string): void {
        service
          .saveSlice$(name, state.filters(), note)
          .pipe(
            catchError((err) => {
              const msg = toMessage(err, 'Failed to save slice');
              patchState(state, { error: msg });
              snackBar.open(msg, 'Dismiss', { duration: 5000 });
              return of(null);
            }),
          )
          .subscribe((slice) => {
            if (slice) patchState(state, { slices: [...state.slices(), slice] });
          });
      },

      /** Install a slice's predicates as the active filters. Predicates
       *  on columns the loaded dataset lacks are skipped — per contract —
       *  and recorded on skippedSliceColumns for the UI notice. */
      applySlice(slice: AnalysisSlice): void {
        const have = new Set(state.columns());
        const kept = slice.filters.filter((f) => have.has(f.column));
        const skipped = slice.filters
          .filter((f) => !have.has(f.column))
          .map((f) => f.column);
        patchState(state, {
          filters: kept,
          skippedSliceColumns: skipped,
        });
        if (skipped.length > 0) {
          snackBar.open(
            `Slice predicates skipped — column not in dataset: ${skipped.join(', ')}`,
            'Dismiss',
            { duration: 6000 },
          );
        }
      },

      deleteSlice(sliceId: string): void {
        service.deleteSlice$(sliceId).subscribe({
          next: () =>
            patchState(state, {
              slices: state.slices().filter((s) => s.id !== sliceId),
            }),
          error: (err) => {
            const msg = toMessage(err, 'Failed to delete slice');
            patchState(state, { error: msg });
            snackBar.open(msg, 'Dismiss', { duration: 5000 });
          },
        });
      },

      // ── compare ──────────────────────────────────────────────────────

      /** Load a second dataset's rows for side-by-side/overlay compare.
       *  Cancels any in-flight compare load; the previous target's rows
       *  + columns clear immediately so the new chip label can never
       *  render over the old set while the fetch is in flight. */
      loadCompareDataset(dataset: AnalysisDatasetDoc): void {
        if (dataset.id === state.activeDataset()?.id) return; // no self-compare
        compareSub?.unsubscribe();
        patchState(state, {
          isLoadingCompare: true,
          compareDatasetId: dataset.id,
          compareRows: [],
          compareColumns: [],
        });
        compareSub = service
          .loadDataset$(dataset)
          .pipe(
            catchError((err) => {
              const msg = toMessage(err, 'Failed to load compare dataset');
              patchState(state, { error: msg, compareDatasetId: null });
              snackBar.open(msg, 'Dismiss', { duration: 5000 });
              return of({ rows: [] as TradeAnalysisRow[], columns: [] as string[] });
            }),
            finalize(() => patchState(state, { isLoadingCompare: false })),
          )
          .subscribe((loaded) =>
            patchState(state, {
              compareRows: loaded.rows,
              compareColumns: loaded.columns,
            }),
          );
      },

      clearCompare(): void {
        compareSub?.unsubscribe();
        patchState(state, {
          compareDatasetId: null,
          compareRows: [],
          compareColumns: [],
        });
      },
      };
    },
  ),
);
