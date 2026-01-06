import { computed, inject } from '@angular/core';
import { patchState, signalStoreFeature, withComputed, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { distinctUntilChanged, EMPTY, switchMap, tap } from 'rxjs';
import { HeatmapSlice, HeatmapQuery, HeatmapStatus, HeatmapSortSpec, HeatmapState, HeatmapViewModel, HeatmapMatrixCellVM, HeatmapMatrixRowVM } from './constants-heatmap-view';
import { Timeframe } from '../shared/types/rs.interfaces';
import { HeatmapViewDataService } from './heatmap-view-data.service';
import { RsCalcsStore } from '../store/rs-calcs.store';
import { generateColorArray } from '../utils/color-utils';


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

    withComputed((store) => {
      const rsCalcsStore = inject(RsCalcsStore);

      return {
      /**
       * Derived view model exposed to the component tree.
       */
      vm: computed<HeatmapViewModel>(() => {
        const query = store.query();
        const status = store.status();
        const slice = store.slice();
        const sort = store.sort();
        const storeColors = rsCalcsStore.heatmapColors();
        const fallbackColors = generateColorArray(11);
        const heatmapColors = Array.isArray(storeColors) && storeColors.length > 0
          ? storeColors
          : fallbackColors;

        if (!slice) {
          return {
            query,
            status,
            sort,
            monthBands: [],
            matrix: [],
          } satisfies HeatmapViewModel;
        }
        const formatHeaderDate = (dateStr: string): string => {
          const [yy, mm, dd] = dateStr.split('-').map((part) => Number(part));
          const m = Number.isFinite(mm) ? String(mm).padStart(2, '0') : '--';
          const d = Number.isFinite(dd) ? String(dd).padStart(2, '0') : '--';
          return `${m}-${d}`;
        };

        const formatHeaderDow = (dateStr: string): string => {
          const [yy, mm, dd] = dateStr.split('-').map((part) => Number(part));
          if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) {
            return '';
          }
          const d = new Date(Date.UTC(yy, (mm as number) - 1, dd as number));
          const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
          return days[d.getUTCDay()] ?? '';
        };

        const lastIndex = slice.columns.length - 1;

        const monthBands: Array<{ label: string; span: number; alt: boolean }> = (() => {
          if (slice.columns.length === 0) {
            return [];
          }

          const bands: Array<{ label: string; span: number; alt: boolean }> = [];
          const toBandLabel = (dateStr: string): string => {
            const [yy, mm] = dateStr.split('-');

            if (!yy || !mm) {
              return '';
            }

            // For monthly interval, group by year only.
            if (query?.interval === Timeframe.MONTHLY) {
              return yy;
            }

            // For daily/weekly, show 'Mon YYYY' style labels.
            const monthIndex = Number(mm) - 1;
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
            const monthName = Number.isFinite(monthIndex) && monthIndex >= 0 && monthIndex < monthNames.length
              ? monthNames[monthIndex]
              : mm;

            return `${monthName} ${yy}`;
          };

          let currentLabel = toBandLabel(slice.columns[0]?.date ?? '');
          let span = 0;

          for (const col of slice.columns) {
            const label = toBandLabel(col.date);
            if (label === currentLabel) {
              span += 1;
            } else {
              if (span > 0) {
                bands.push({ label: currentLabel, span, alt: bands.length % 2 === 1 });
              }
              currentLabel = label;
              span = 1;
            }
          }

          if (span > 0) {
            bands.push({ label: currentLabel, span, alt: bands.length % 2 === 1 });
          }

          return bands;
        })();

        const matrix: HeatmapMatrixRowVM[] = (() => {
          if (!slice) {
            return [];
          }

          const dates = slice.columns.map(col => col.date);

          const headerRow: HeatmapMatrixRowVM = {
            kind: 'header',
            label: 'Symbol/Date',
            cells: dates.map(date => ({
              value: null,
              color: 'transparent',
              date,
            } satisfies HeatmapMatrixCellVM)),
          };

          const dataRows: HeatmapMatrixRowVM[] = slice.rows.map((row, rowIndex) => {
            const values = slice.rsValues[rowIndex] ?? [];
            const cells: HeatmapMatrixCellVM[] = dates.map((date, colIndex) => {
              const raw = values[colIndex] ?? null;

              // No data for this pair/date: show 0.0 with a neutral gray background
              if (raw == null) {
                return {
                  value: 0,
                  color: '#e0e0e0',
                  date,
                } satisfies HeatmapMatrixCellVM;
              }

              const v = Number(raw);
              if (!Number.isFinite(v)) {
                return {
                  value: 0,
                  color: '#e0e0e0',
                  date,
                } satisfies HeatmapMatrixCellVM;
              }

              let color = '#ffffff';
              if (Array.isArray(heatmapColors) && heatmapColors.length > 0) {
                const clamped = Math.max(0, Math.min(1, v));
                const idx = Math.min(
                  heatmapColors.length - 1,
                  Math.max(0, Math.floor(clamped * (heatmapColors.length - 1))),
                );
                color = heatmapColors[idx] ?? color;
              }

              return {
                value: v,
                color,
                date,
              } satisfies HeatmapMatrixCellVM;
            });

            return {
              kind: 'data',
              label: `${row.baseline}-${row.symbol}`,
              cells,
            } satisfies HeatmapMatrixRowVM;
          });

          return [headerRow, ...dataRows];
        })();

        return {
          query,
          status,
          sort,
          monthBands,
          matrix,
        };
      }),
    }; }),
  );
}
