/**
 * Gallery Card Chart Store
 *
 * Per-symbol bars cache for the gallery card chart cells (#756) — daily
 * eagerly prefetched, weekly lazily on first weekly-chart request (#819).
 * Each card needs only a recent daily window — LocalBarReadService's
 * getRecentDailyBars$ reads a single year shard (two at a year boundary)
 * instead of ChartService.loadBars$'s full D/W/M multi-collection fetch,
 * and ChartStore is single-symbol so it can't serve N cards.
 *
 * Cards share the cache by symbol: a symbol's buy and sell cards, plus
 * repeat mounts on scroll, hit the same entry. Bars are split-adjusted
 * (LocalBarReadService contract).
 */
import { DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState,
} from '@ngrx/signals';
import { forkJoin } from 'rxjs';

import { LocalBarReadService } from '../../../core/services/local-bar-read.service';
import type { PriceBar } from '../../shared/components/flex-chart/flex-chart.types';
import { ohlcToPriceBar } from '../utils/utils';
import { IndicatorSeriesStore } from './indicator-series.store';
import {
  DEFAULT_CHART_INDICATORS,
  DEFAULT_CHART_INTERVALS,
  DEFAULT_CHART_STRATEGIES,
} from './chart.store';

/** Calendar-day window for the card chart — ~150 trading bars. Covers the
 *  40-bar default view plus headroom for +50 bar adjustments and the
 *  period-50 StdDevLines warmup (still a single year-shard read). */
export const CARD_CHART_LOOKBACK_DAYS = 220;

export interface GalleryCardChartState {
  /** Per-symbol daily PriceBars (ascending). */
  bars: Record<string, PriceBar[]>;
  /** Per-symbol weekly PriceBars (ascending) — loaded lazily on first
   *  weekly-chart request so daily prefetch stays a single read/symbol. */
  weeklyBars: Record<string, PriceBar[]>;
  /** Per-symbol symbol-data version (lastDailyBarDate) — the indicator cache key. */
  versions: Record<string, string>;
  /** Per-symbol in-flight flags (daily + version). */
  loading: Record<string, boolean>;
  /** Per-symbol weekly-bars in-flight flags. */
  weeklyLoading: Record<string, boolean>;
  /** Per-symbol daily-load error — null/undefined when healthy. Separate
   *  from weeklyError so a failed interval can't poison the other (#819
   *  review: one shared slot would mark a healthy daily chart unavailable
   *  on a weekly failure and permanently block its retries). */
  error: Record<string, string | null>;
  /** Per-symbol weekly-load error. */
  weeklyError: Record<string, string | null>;
  /** Bumped by clearCache — ensure* captures it at call time and drops
   *  landing writes from a prior epoch so an in-flight fetch can't
   *  resurrect cleared (pre-refresh) entries. Mounted cards track it to
   *  re-ensure after a clear (#819 review r2). */
  epoch: number;
}

const initialState: GalleryCardChartState = {
  bars: {}, weeklyBars: {}, versions: {}, loading: {}, weeklyLoading: {}, error: {}, weeklyError: {},
  epoch: 0,
};

/** Normalize a caller-supplied symbol for cache keys. */
function normalizeSymbol(symbol: string): string {
  return String(symbol || '').trim().toUpperCase();
}

export const GalleryCardChartStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withMethods((
    state,
    barRead = inject(LocalBarReadService),
    indicatorStore = inject(IndicatorSeriesStore),
    destroyRef = inject(DestroyRef),
  ) => ({
    /**
     * Load a symbol's recent daily bars + symbol-data version if not already
     * cached or in flight, then warm the indicator-series callable with the
     * default chart filters (same cache key as quick-charts — a symbol viewed
     * on both pages shares the entry). getRecentDailyBars$ swallows fetch
     * failures into [] — a card treats empty bars as 'unavailable' rather
     * than a distinct error state.
     */
    ensureBars(symbol: string): void {
      const sym = normalizeSymbol(symbol);
      if (!sym) return;
      // errors settle as 'unavailable' — include the error key in the dedupe
      // guard or the card's mount effect re-fires on every patch and retries
      // a failing symbol forever.
      if (state.bars()[sym] !== undefined || state.loading()[sym] || state.error()[sym]) return;

      patchState(state, {
        loading: { ...state.loading(), [sym]: true },
        error: { ...state.error(), [sym]: null },
      });
      const epoch = state.epoch();

      forkJoin({
        bars: barRead.getRecentDailyBars$(sym, CARD_CHART_LOOKBACK_DAYS),
        version: barRead.getSymbolDataVersion$(sym),
      })
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: ({ bars, version }) => {
            // Stale-write guard (#819 r2): a clearCache mid-flight bumped the
            // epoch — this landing belongs to the old cache, don't resurrect it.
            if (state.epoch() !== epoch) return;
            // ChartService falls back to the last bar date when the root doc
            // lacks lastDailyBarDate — same here so the cache key stays
            // consistent across pages.
            const v = version || bars[bars.length - 1]?.d || '';
            const lastBar = bars[bars.length - 1]?.d;
            if (version && lastBar && version !== lastBar) {
              // Parity with chart.service's root-vs-shard drift check — the
              // indicator cache keys on `version`; a stale shard pairing
              // would surface as injectCallableIndicatorData's end-date warn.
              console.warn(
                `[gallery-card-chart] ${sym} symbol-data mismatch: root lastDailyBarDate=${version}, but daily bars end ${lastBar}`,
              );
            }
            patchState(state, {
              bars: { ...state.bars(), [sym]: bars.map(ohlcToPriceBar) },
              versions: { ...state.versions(), [sym]: v },
              loading: { ...state.loading(), [sym]: false },
            });
            if (v) {
              indicatorStore.loadIfNeeded(
                sym,
                v,
                DEFAULT_CHART_INTERVALS,
                DEFAULT_CHART_INDICATORS,
                DEFAULT_CHART_STRATEGIES,
              );
            }
          },
          // Defensive — the service resolves [] on failure; if it ever throws
          // through, record it so the card can render the error placeholder.
          error: (err: unknown) => {
            if (state.epoch() !== epoch) return;
            patchState(state, {
              loading: { ...state.loading(), [sym]: false },
              error: { ...state.error(), [sym]: err instanceof Error ? err.message : String(err) },
            });
          },
        });
    },

    /**
     * Load a symbol's weekly bars lazily — called by a mounted card chart
     * whenever its interval is weekly (header Chart toggle or the per-card
     * D/W chip), so daily prefetch stays one read per symbol.
     * The `weekly/all` doc is a single read; the indicator callable already
     * returns weekly + monthly interval data under the same cache key, so
     * no extra callable fires.
     */
    ensureWeeklyBars(symbol: string): void {
      const sym = normalizeSymbol(symbol);
      if (!sym) return;
      if (state.weeklyBars()[sym] !== undefined || state.weeklyLoading()[sym] || state.weeklyError()[sym]) return;

      patchState(state, {
        weeklyLoading: { ...state.weeklyLoading(), [sym]: true },
        weeklyError: { ...state.weeklyError(), [sym]: null },
      });
      const epoch = state.epoch();

      barRead.getWeeklyBars$(sym)
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (bars) => {
            if (state.epoch() !== epoch) return;
            patchState(state, {
              weeklyBars: { ...state.weeklyBars(), [sym]: bars.map(ohlcToPriceBar) },
              weeklyLoading: { ...state.weeklyLoading(), [sym]: false },
            });
          },
          error: (err: unknown) => {
            if (state.epoch() !== epoch) return;
            patchState(state, {
              weeklyLoading: { ...state.weeklyLoading(), [sym]: false },
              weeklyError: { ...state.weeklyError(), [sym]: err instanceof Error ? err.message : String(err) },
            });
          },
        });
    },

    /** Eager warm — call on idle with every visible card symbol. */
    prefetch(symbols: Iterable<string>): void {
      for (const s of symbols) this.ensureBars(s);
    },

    /** Clear the whole cache and bump the epoch — mounted cards' ensure
     *  effects track the epoch and re-fetch; in-flight writes from the old
     *  epoch are dropped on landing so they can't resurrect cleared
     *  entries. Entries are session-permanent otherwise — call on run
     *  change/refresh so a new trading day's bars aren't hidden. */
    clearCache(): void {
      patchState(state, { ...initialState, epoch: state.epoch() + 1 });
    },
  })),

  withComputed((state) => ({
    barsFor: () => (symbol: string) => state.bars()[normalizeSymbol(symbol)],
    weeklyBarsFor: () => (symbol: string) => state.weeklyBars()[normalizeSymbol(symbol)],
    versionFor: () => (symbol: string) => state.versions()[normalizeSymbol(symbol)] ?? '',
    errorFor: () => (symbol: string) => state.error()[normalizeSymbol(symbol)] ?? null,
    weeklyErrorFor: () => (symbol: string) => state.weeklyError()[normalizeSymbol(symbol)] ?? null,
  })),
);
