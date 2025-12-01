import { computed, inject } from '@angular/core';
import { signalStore, withState, withMethods, withComputed, patchState } from '@ngrx/signals';
import { Auth } from '@angular/fire/auth';
import { firstValueFrom } from 'rxjs';

import type { CandleWithRSColor, ChartSignal, OHLCDatum, RelStrStockList, RsPaneDatum, RsSeriesPoint, RsChartConfig } from '../shared/types/rs.interfaces';
import { Timeframe } from '../shared/types/rs.interfaces';
import { RS_CHART_CONFIG, RS_OPEN_LONG_THRESHOLD, RS_OPEN_SHORT_THRESHOLD, ZOOM_DISABLED_CONFIG, MAIN_RS_CHART_ZOOM_SETTINGS } from '../shared/constants/rs.constants';
import { RelStrDbV2Service } from '../services/rel-str-db-v2.service';
import { RsBarsService } from '../services/rs-bars.service';

/**
 * RsChartStore
 *
 * Signal store responsible for orchestrating data for RsChartView:
 * - Loads a single user list (initially the hard-coded dev list qqq-test-01).
 * - Derives baseline/target pairs and fetches RS archive series per pair.
 * - Fetches OHLC daily bars per symbol via RsBarsService (SavantAPI).
 *
 * This keeps network orchestration and data alignment out of the component so
 * the view can focus purely on rendering and interactions (main vs filmstrip).
 */

interface RsChartState {
  /** Currently loaded list name (e.g. qqq-test-01) */
  currentListId: string | null;
  /** All lists for the current user (sorted by updatedAt desc in the service) */
  lists: RelStrStockList[];
  /** Baseline symbol for the current list */
  baseline: string | null;
  /** Target symbols from the current list */
  symbols: string[];
  /** Pair IDs in pairs-data space: `${BASELINE}-${SYMBOL}` */
  pairs: string[];
  /** RS archive series keyed by pair ID */
  rsSeriesByPair: Record<string, RsSeriesPoint[]>;
  /** OHLC daily bars keyed by symbol */
  ohlcBySymbol: Record<string, OHLCDatum[]>;
  /** Currently selected chart id for main chart */
  selectedChartId: string | null;
  /** Global loading flag for initial load */
  loading: boolean;
  /** Last error message, if any */
  error: string | null;
}

const initialState: RsChartState = {
  currentListId: null,
  lists: [],
  baseline: null,
  symbols: [],
  pairs: [],
  rsSeriesByPair: {},
  ohlcBySymbol: {},
  selectedChartId: null,
  loading: false,
  error: null,
};

export const RsChartStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed((store) => {
    /**
     * Compute chart signals for all baseline/target pairs based on
     * rsSeriesByPair and ohlcBySymbol.
     */
    const chartSignals = computed<ChartSignal[]>(() => {
      const baseline = store.baseline();
      const symbols = store.symbols();
      const rsByPair = store.rsSeriesByPair();
      const ohlcBySymbol = store.ohlcBySymbol();

      if (!baseline || !symbols?.length) {
        return [];
      }

      const pairs = symbols.map((sym) => `${baseline}-${sym}`);
      const result: ChartSignal[] = [];

      for (const pairId of pairs) {
        const [base, target] = pairId.split('-');
        const rsSeries: RsSeriesPoint[] = rsByPair[pairId] ?? [];
        const targetOhlc: OHLCDatum[] = ohlcBySymbol[target] ?? [];
        const baselineOhlc: OHLCDatum[] = ohlcBySymbol[base] ?? [];

        const config = buildChartConfig(base, target);
        const chartData = prepareChartDataFromLive(targetOhlc, rsSeries);
        const baselineData = baselineOhlc;
        const rsData = prepareThresholdFilteredRsFromSeries(rsSeries);

        result.push({
          id: config.id,
          config,
          chartData,
          baselineData,
          rsData,
        });
      }

      return result;
    });

    /**
     * Main chart for the view, defaulting to the first chart when no explicit
     * selection exists. Main chart uses interactive zoom/pan, filmstrip charts
     * keep zoom disabled.
     */
    const mainChart = computed<ChartSignal | undefined>(() => {
      const all = chartSignals();
      if (!all.length) {
        return undefined;
      }
      const id = store.selectedChartId();
      const base = all.find((c) => c.id === id) ?? all[0];
      if (!base) {
        return undefined;
      }

      // TEMP DEBUG: observe selection vs available chart ids
    //   try {
    //     // eslint-disable-next-line no-console
    //     console.log('[RsChartStore] mainChart', {
    //       selectedId: id,
    //       available: all.map((c) => c.id),
    //       chosenId: base.id,
    //     });
    //   } catch {
    //     // ignore logging errors
    //   }

      const config = {
        ...base.config,
        chartConfig: {
          ...base.config.chartConfig,
          zoomSettings: MAIN_RS_CHART_ZOOM_SETTINGS,
        },
      };

      return { ...base, config };
    });

    /**
     * Filmstrip charts (small charts) exclude the main chart and are sliced to
     * a shorter recent window for clarity.
     */
    const smallCharts = computed<ChartSignal[]>(() => {
      const main = mainChart();
      const all = chartSignals();

      const source = main
        ? all.filter((c) => c.id !== main.id)
        : all.slice(1);

      return sliceForFilmstrip(source).map((c) => ({
        ...c,
        config: {
          ...c.config,
          chartConfig: {
            ...c.config.chartConfig,
            // Disable zoom and crosshair for filmstrip charts to keep them
            // lightweight and avoid Syncfusion crosshair.js null childNodes
            // errors when hovering over frequently recreated tiny charts.
            zoomSettings: ZOOM_DISABLED_CONFIG,
            crosshair: {
              ...(c.config.chartConfig.crosshair ?? {}),
              enable: false,
            },
          },
        },
      }));
    });

    return {
      chartSignals,
      mainChart,
      smallCharts,
    };
  }),
  withMethods((
    store, relStrDbV2Service = inject(RelStrDbV2Service),
    rsBarsService = inject(RsBarsService),
    auth = inject(Auth)
) => ({
    /**
     * Load a user list and eagerly fetch RS + OHLC data for its pairs.
     *
     * For now this targets the hard-coded dev list `qqq-test-01` when
     * listName is omitted. This will later be driven by router params or
     * list selection in the dashboard.
     */
    async loadListForCurrentUser(listName?: string): Promise<void> {
      const uid = auth.currentUser?.uid ?? '';
      if (!uid) {
        patchState(store, { loading: false, error: '[RsChartStore] Missing auth user for list load' });
        return;
      }

      patchState(store, { loading: true, error: null });

      try {
        const lists = await firstValueFrom(relStrDbV2Service.getListsForUser$(uid));
        if (!lists.length) {
          patchState(store, { lists: [], currentListId: null, baseline: null, symbols: [], pairs: [], rsSeriesByPair: {}, ohlcBySymbol: {}, loading: false, error: null });
          return;
        }

        // Prefer explicit listName, then dev list qqq-test-01, else first list.
        const targetName = listName || 'qqq-test-01';
        const target =
          lists.find((l) => l.name === targetName) ??
          lists.find((l) => l.name === 'qqq-test-01') ??
          lists[0];

        const baseline = String(target.baseline || '').toUpperCase();
        const symbols = (target.symbols || []).map((s) => String(s.symbol || '').toUpperCase());

        const pairs = baseline
          ? symbols.map((sym) => `${baseline}-${sym}`)
          : [];

        // Fetch RS archive series for each pair (approx 2 years for dev work).
        const rsResults = await Promise.all(
          pairs.map(async (pairId) => {
            // Use a ~2-year window (trading days) for RS to align with OHLC window.
            const series = await firstValueFrom(relStrDbV2Service.getPairSeriesFromArchiveWindow$(pairId, 730));
            return { pairId, series } as { pairId: string; series: RsSeriesPoint[] };
          }),
        );

        const rsSeriesByPair: Record<string, RsSeriesPoint[]> = {};
        for (const { pairId, series } of rsResults) {
          rsSeriesByPair[pairId] = series;
        }

        // Fetch OHLC series for baseline + all targets via SavantAPI callable.
        const allSymbols = baseline ? [baseline, ...symbols] : symbols;
        const uniqueSymbols = Array.from(new Set(allSymbols.filter((s) => !!s)));

        const ohlcResults = await Promise.all(
          uniqueSymbols.map(async (sym) => {
            const series = await firstValueFrom(rsBarsService.getDailyBars$(sym));
            return { symbol: sym, series } as { symbol: string; series: OHLCDatum[] };
          }),
        );

        const ohlcBySymbol: Record<string, OHLCDatum[]> = {};
        for (const { symbol, series } of ohlcResults) {
          ohlcBySymbol[symbol] = series;
        }

        // TEMP DEBUG: log OHLC coverage for baseline + first symbol
        try {
          const sampleSymbol = symbols[0];
          const baselineSeries = baseline ? ohlcBySymbol[baseline] ?? [] : [];
          const sampleSeries = sampleSymbol ? ohlcBySymbol[sampleSymbol] ?? [] : [];
          // eslint-disable-next-line no-console
          console.log('[RsChartStore] OHLC coverage', {
            baseline,
            baselineCount: baselineSeries.length,
            baselineFirst: baselineSeries[0]?.date,
            baselineLast: baselineSeries[baselineSeries.length - 1]?.date,
            sampleSymbol,
            sampleCount: sampleSeries.length,
            sampleFirst: sampleSeries[0]?.date,
            sampleLast: sampleSeries[sampleSeries.length - 1]?.date,
          });
        } catch {
          // ignore debug logging errors
        }

        patchState(store, {
          lists,
          currentListId: target.name,
          baseline,
          symbols,
          pairs,
          rsSeriesByPair,
          ohlcBySymbol,
          // default selection to the first pair once data is available
          selectedChartId: pairs[0] ? `pair-${pairs[0]}` : null,
          loading: false,
          error: null,
        });
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error('[RsChartStore] loadListForCurrentUser error', e);
        patchState(store, { loading: false, error: String(e?.message || e || 'Unknown error') });
      }
    },

    /**
     * Update the currently selected chart id used to drive the main chart.
     */
    setSelectedChartId(chartId: string | null): void {
      patchState(store, { selectedChartId: chartId });
    },
  })),
);

/** Build a base chart configuration for a baseline/target pair. */
function buildChartConfig(base: string, target: string): RsChartConfig {
  return {
    id: `pair-${base}-${target}`,
    name: `${target} vs ${base}`,
    targetSymbol: target,
    baselineSymbol: base,
    timeframe: Timeframe.DAILY,
    chartConfig: RS_CHART_CONFIG,
    showRS: true,
    showBaseline: false,
    showVolume: true,
    showTechnicalIndicators: [],
    height: '500px',
  };
}

/** Limit filmstrip charts to a recent window (~6 months of data). */
function sliceForFilmstrip(charts: ChartSignal[]): ChartSignal[] {
  const MAX_DAYS = 180; // ~6 months of trading days
  return charts.map((c) => {
    const len = c.chartData.length;
    if (len <= MAX_DAYS) {
      return c;
    }
    const startIndex = Math.max(0, len - MAX_DAYS);

    // Keep slicing simple and index-based for the target price series only.
    // Leave baseline and RS data untouched to avoid issues where their
    // arrays are shorter or differently aligned (e.g. TSLA), which could
    // otherwise result in empty series after slicing.
    return {
      ...c,
      chartData: c.chartData.slice(startIndex),
      baselineData: c.baselineData,
      rsData: c.rsData,
    };
  });
}

/**
 * Convert live OHLC + RS series into typed CandleWithRSColor series.
 * Aligns the price window to the RS window and colors by price change vs
 * previous close.
 */
function prepareChartDataFromLive(ohlc: OHLCDatum[], rsSeries: RsSeriesPoint[]): CandleWithRSColor[] {
  if (!ohlc?.length) {
    return [];
  }

  const rsByDate = new Map<string, RsSeriesPoint>();
  for (const r of rsSeries ?? []) {
    if (r?.date) {
      rsByDate.set(String(r.date), r);
    }
  }

  const sortedRsDates = Array.from(rsByDate.keys()).sort();
  const earliestRsDate = sortedRsDates[0];

  const toYmd = (d: Date): string => {
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const clamped = earliestRsDate
    ? ohlc.filter((bar) => {
        const x = bar.x instanceof Date ? bar.x : new Date(bar.x);
        const dateKey = bar.date || toYmd(x);
        return dateKey >= earliestRsDate;
      })
    : ohlc.slice();

  return clamped.map<CandleWithRSColor>((bar, index, arr) => {
    const x = bar.x instanceof Date ? bar.x : new Date(bar.x);
    const prev = index > 0 ? arr[index - 1] : undefined;
    const prevClose = typeof prev?.close === 'number' ? prev.close : bar.open ?? bar.close;
    const close = bar.close;
    const isUp = typeof close === 'number' && typeof prevClose === 'number' && close >= prevClose;
    const rsColor = isUp ? '#2e7d32' : '#c62828';

    return {
      ...bar,
      x,
      rsColor,
    };
  });
}

/** Map RS series into RS pane data, filtering to threshold zones only. */
function prepareThresholdFilteredRsFromSeries(rsSeries: RsSeriesPoint[]): RsPaneDatum[] {
  if (!rsSeries?.length) {
    return [];
  }

  return rsSeries
    .filter((r) => {
      const rank = r.norm ?? r.value;
      if (typeof rank !== 'number') {
        return false;
      }
      const isLongZone = rank >= RS_OPEN_LONG_THRESHOLD;
      const isShortZone = rank <= RS_OPEN_SHORT_THRESHOLD;
      return isLongZone || isShortZone;
    })
    .map((r) => {
      const rank = r.norm ?? r.value;
      let rsColor = '#dddddd';
      if (typeof rank === 'number') {
        if (rank >= RS_OPEN_LONG_THRESHOLD) {
          rsColor = '#2e7d32';
        } else if (rank <= RS_OPEN_SHORT_THRESHOLD) {
          rsColor = '#c62828';
        }
      }

      return {
        date: new Date(`${r.date}T00:00:00.000Z`),
        rank,
        rsColor,
      };
    });
}
