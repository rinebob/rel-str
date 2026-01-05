import { computed, inject } from '@angular/core';
import { patchState, signalStoreFeature, withComputed, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { distinctUntilChanged, EMPTY, switchMap, tap } from 'rxjs';
import { HeatmapSlice, HeatmapQuery, HeatmapStatus, HeatmapSortSpec, HeatmapState, HeatmapViewModel, HeatmapCellVM, HeatmapHeaderCellVM, HeatmapRowVM } from './constants-heatmap-view';
import { HeatmapViewDataService } from './heatmap-view-data.service';


/**
 * Internal state for the heatmap view store.
 */
export interface HeatmapViewState {
  query: HeatmapQuery | null;
  status: HeatmapStatus;
  slice: HeatmapSlice | null;
  sort: HeatmapSortSpec;
}

const initialStatus: HeatmapStatus = {
  state: HeatmapState.IDLE,
};

const initialState: HeatmapViewState = {
  query: null,
  status: initialStatus,
  slice: null,
  sort: {
    columnIndex: null,
    direction: 'desc',
  },
};

/**
 * Signal Store feature providing state and behavior for the new heatmap view.
 */
export function withHeatmapViewStore() {
  return signalStoreFeature(
    withState<HeatmapViewState>(initialState),

    withMethods((store, dataService = inject(HeatmapViewDataService)) => {
      const loadForQuery = rxMethod<HeatmapQuery | null>((query$) =>
        query$.pipe(
          distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
          switchMap((query) => {
            if (!query) {
              patchState(store, {
                status: { state: HeatmapState.IDLE },
                slice: null,
              });
              return EMPTY;
            }

            patchState(store, {
              status: { state: HeatmapState.LOADING_HISTORY },
            });

            return dataService.getHeatmapSlice$(query).pipe(
              tap((slice) => {
                const nextState = slice.meta.isComplete
                  ? HeatmapState.READY
                  : HeatmapState.LOADING_TODAY;

                patchState(store, {
                  slice,
                  status: {
                    state: nextState,
                  },
                });
              }),
            );
          }),
        ),
      );

      return {
        /**
         * Replace the current query. This triggers the async load pipeline.
         */
        setQuery(query: HeatmapQuery | null): void {
          patchState(store, { query });
          loadForQuery(query);
        },

        /**
         * Update the active sort specification.
         */
        setSort(sort: HeatmapSortSpec): void {
          patchState(store, { sort });
        },
      };
    }),

    withComputed((store) => ({
      /**
       * Derived view model exposed to the component tree.
       */
      vm: computed<HeatmapViewModel>(() => {
        const query = store.query();
        const status = store.status();
        const slice = store.slice();
        const sort = store.sort();

        if (!slice) {
          return {
            query,
            status,
            headerCells: [],
            rows: [],
            sort,
          };
        }

        const headerCells: HeatmapHeaderCellVM[] = slice.columns.map((column: typeof slice.columns[number], index: number) => ({
          label: column.date,
          subLabel: column.phase,
          tooltip: column.lastUpdateTime
            ? `${column.date} · ${new Date(column.lastUpdateTime).toLocaleString()}`
            : column.date,
          isToday: column.isToday,
          isLastColumn: index === slice.columns.length - 1,
        }));

        const rows: HeatmapRowVM[] = slice.rows.map((row, rowIndex: number) => {
          const values = slice.rsValues[rowIndex] ?? [];

          const cells: HeatmapCellVM[] = values.map((value: number | null) => ({
            value,
            color: value == null ? 'transparent' : value >= 0.8 ? '#00a000' : value >= 0.5 ? '#80c000' : '#c08000',
          }));

          return {
            symbol: row.symbol,
            baseline: row.baseline,
            cells,
          };
        });

        return {
          query,
          status,
          headerCells,
          rows,
          sort,
        };
      }),
    })),
  );
}
