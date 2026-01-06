
import { Observable } from "rxjs";
import { Timeframe } from '../shared/types/rs.interfaces';


// Service

/**
 * Contract describing the input used to request a heatmap slice.
 */
export interface HeatmapQuery {
  listId: string;
  baseline: string;
  symbols: string[];
  interval: Timeframe;
  phaseMode: 'canonicalOnly' | 'preAndPost' | 'intradayZoom';
  rangeDays?: number;
}

/**
 * Column metadata for a heatmap slice.
 */
export interface HeatmapColumnMeta {
  date: string;
  phase: 'pre' | 'post';
  isToday: boolean;
  lastUpdateTime?: number;
  isPreCloseStream?: boolean;
}

/**
 * Row metadata for a heatmap slice.
 */
export interface HeatmapRowMeta {
  pairId: string;
  symbol: string;
  baseline: string;
}

/**
 * Normalized data contract returned from the backend for a given query.
 */
export interface HeatmapSlice {
  query: HeatmapQuery;
  rows: HeatmapRowMeta[];
  columns: HeatmapColumnMeta[];
  rsValues: (number | null)[][];
  meta: {
    isComplete: boolean;
    missingDates: string[];
  };
}

/**
 * Interface describing the data access surface for the heatmap view.
 */
export abstract class HeatmapDataService {
  /**
   * Retrieve a historical + current-day slice for the given query.
   */
  abstract getHeatmapSlice$(query: HeatmapQuery): Observable<HeatmapSlice>;
}



// Store
/**
 * Lifecycle states for the heatmap view.
 */
export enum HeatmapState {
  IDLE = 'idle',
  LOADING_HISTORY = 'loading-history',
  LOADING_TODAY = 'loading-today',
  READY = 'ready',
  ERROR = 'error',
}

/**
 * Sort specification for the heatmap view.
 */
export interface HeatmapSortSpec {
  columnIndex: number | null;
  direction: 'asc' | 'desc';
}

/**
 * Status of the current heatmap load.
 */
export interface HeatmapStatus {
  state: HeatmapState;
  errorMessage?: string;
}

/**
 * Matrix-oriented cell view model including the date key for header/tooltips.
 */
export interface HeatmapMatrixCellVM {
  value: number | null;
  color: string;
  date: string | null;
}

/**
 * Row in the matrix representation used by the heatmap layout.
 * The first row is typically kind='header' with label 'Symbol/Date',
 * followed by kind='data' rows for each pair.
 */
export interface HeatmapMatrixRowVM {
  kind: 'header' | 'data';
  label: string;
  cells: HeatmapMatrixCellVM[];
}

/**
 * Aggregated view-model for the heatmap view.
 */
export interface HeatmapViewModel {
  query: HeatmapQuery | null;
  status: HeatmapStatus;
  sort: HeatmapSortSpec;
  monthBands: Array<{ label: string; span: number; alt: boolean }>;
  matrix: HeatmapMatrixRowVM[];
}
