
import { Observable } from "rxjs";


// Service

/**
 * Contract describing the input used to request a heatmap slice.
 */
export interface HeatmapQuery {
  listId: string;
  baseline: string;
  symbols: string[];
  interval: 'DAILY' | 'WEEKLY' | 'MONTHLY';
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
 * View-model cell representation used by the Angular components.
 */
export interface HeatmapCellVM {
  value: number | null;
  color: string;
  tooltip?: string;
}

/**
 * View-model row representation used by the Angular components.
 */
export interface HeatmapRowVM {
  symbol: string;
  baseline: string;
  cells: HeatmapCellVM[];
}

/**
 * View-model header cell representation used by the Angular components.
 */
export interface HeatmapHeaderCellVM {
  label: string;
  subLabel?: string;
  tooltip?: string;
  isToday: boolean;
  isLastColumn: boolean;
}

/**
 * Aggregated view-model for the heatmap view.
 */
export interface HeatmapViewModel {
  query: HeatmapQuery | null;
  status: HeatmapStatus;
  headerCells: HeatmapHeaderCellVM[];
  rows: HeatmapRowVM[];
  sort: HeatmapSortSpec;
}
