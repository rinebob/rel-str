import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';
import type { OHLCDatum } from '../shared/types/rs.interfaces';
import { Timeframe } from '../shared/types/rs.interfaces';

/** Status for a single symbol fetch */
export interface FetchStatus {
  loading: boolean;
  error: string | null;
}

/** Shape of RS data cached client-side */
interface RsDataState {
  /** Currently selected timeframe */
  selectedTimeframe: Timeframe;
  /** OHLC data keyed by symbol */
  dataBySymbol: Record<string, OHLCDatum[]>;
  /** Loading/error status keyed by symbol */
  statusBySymbol: Record<string, FetchStatus>;
  /** ISO timestamp for last successful update across any symbol */
  lastUpdatedIso: string | null;
}

const initialState: RsDataState = {
  selectedTimeframe: Timeframe.DAILY,
  dataBySymbol: {},
  statusBySymbol: {},
  lastUpdatedIso: null,
};

export const RsDataStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store) => ({
    /** Mark the provided symbols as loading */
    setLoading(symbols: string[]) {
      const next = { ...store.statusBySymbol() };
      for (const s of symbols) {
        next[s] = { loading: true, error: null };
      }
      patchState(store, { statusBySymbol: next });
    },

    /** Set data for a symbol and clear its error/loading */
    setData(symbol: string, data: OHLCDatum[]) {
      patchState(store, {
        dataBySymbol: { ...store.dataBySymbol(), [symbol]: data },
        statusBySymbol: { ...store.statusBySymbol(), [symbol]: { loading: false, error: null } },
        lastUpdatedIso: new Date().toISOString(),
      });
    },

    /** Set an error for a symbol */
    setError(symbol: string, error: string) {
      patchState(store, {
        statusBySymbol: { ...store.statusBySymbol(), [symbol]: { loading: false, error } },
      });
    },

    /** Clear data and status for given symbols */
    clearSymbols(symbols: string[]) {
      const dataNext = { ...store.dataBySymbol() };
      const statusNext = { ...store.statusBySymbol() };
      for (const s of symbols) {
        delete dataNext[s];
        delete statusNext[s];
      }
      patchState(store, { dataBySymbol: dataNext, statusBySymbol: statusNext });
    },

    /** Clear all data (used when switching timeframes) */
    clearAllData() {
      patchState(store, {
        dataBySymbol: {},
        statusBySymbol: {},
        lastUpdatedIso: null,
      });
    },

    /** Set the selected timeframe */
    setTimeframe(timeframe: Timeframe) {
      patchState(store, { selectedTimeframe: timeframe });
    },
  }))
);
