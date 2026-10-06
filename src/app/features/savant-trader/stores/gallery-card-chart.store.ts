/**
 * Gallery Card Chart Store
 *
 * Per-symbol daily-bars cache for the gallery card chart cells (#756).
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

/** Calendar-day window for the card chart — ~63 trading days, headroom
 *  past the 40-bar visible window so the signal-firing bar is in range. */
export const CARD_CHART_LOOKBACK_DAYS = 90;

export interface GalleryCardChartState {
  /** Per-symbol daily PriceBars (ascending). */
  bars: Record<string, PriceBar[]>;
  /** Per-symbol symbol-data version (lastDailyBarDate) — the indicator cache key. */
  versions: Record<string, string>;
  /** Per-symbol in-flight flags. */
  loading: Record<string, boolean>;
  /** Per-symbol error message — null/undefined when healthy. */
  error: Record<string, string | null>;
}

const initialState: GalleryCardChartState = { bars: {}, versions: {}, loading: {}, error: {} };

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
      const sym = String(symbol || '').trim().toUpperCase();
      if (!sym) return;
      // errors settle as 'unavailable' — include the error key in the dedupe
      // guard or the card's mount effect re-fires on every patch and retries
      // a failing symbol forever.
      if (state.bars()[sym] !== undefined || state.loading()[sym] || state.error()[sym]) return;

      patchState(state, {
        loading: { ...state.loading(), [sym]: true },
        error: { ...state.error(), [sym]: null },
      });

      forkJoin({
        bars: barRead.getRecentDailyBars$(sym, CARD_CHART_LOOKBACK_DAYS),
        version: barRead.getSymbolDataVersion$(sym),
      })
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: ({ bars, version }) => {
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
            patchState(state, {
              loading: { ...state.loading(), [sym]: false },
              error: { ...state.error(), [sym]: err instanceof Error ? err.message : String(err) },
            });
          },
        });
    },

    /** Eager warm — call on idle with every visible card symbol. */
    prefetch(symbols: Iterable<string>): void {
      for (const s of symbols) this.ensureBars(s);
    },

    /** Clear the cache for a symbol, or the entire cache when no symbol is
     *  provided. Entries are session-permanent otherwise — call on run change
     *  if a new trading day's bars should be picked up mid-session. */
    clearCache(symbol?: string): void {
      if (!symbol) {
        patchState(state, initialState);
        return;
      }
      const sym = String(symbol).trim().toUpperCase();
      const clear = <T>(rec: Record<string, T>) => {
        const next = { ...rec };
        delete next[sym];
        return next;
      };
      patchState(state, {
        bars: clear(state.bars()),
        versions: clear(state.versions()),
        loading: clear(state.loading()),
        error: clear(state.error()),
      });
    },
  })),

  withComputed((state) => ({
    barsFor: () => (symbol: string) => state.bars()[String(symbol || '').trim().toUpperCase()],
    versionFor: () => (symbol: string) => state.versions()[String(symbol || '').trim().toUpperCase()] ?? '',
    errorFor: () => (symbol: string) => state.error()[String(symbol || '').trim().toUpperCase()] ?? null,
  })),
);
