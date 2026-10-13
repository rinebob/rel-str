/**
 * Opt-in Trigger Bands request binding — the shared lean-request pattern used
 * by every surface that lets the user toggle Trigger Bands on.
 *
 * While `enabled` is true and a `symbol`/`version` pair exists, an `effect`
 * issues the lean `IndicatorFamily.TRIGGER_BANDS` callable under its own
 * IndicatorSeriesStore cache key and the returned signal looks the response
 * up. The default response is never refetched or invalidated by it.
 *
 * Must be called from an injection context (constructor or field
 * initializer) — it registers an `effect`.
 */
import { computed, effect, untracked, type Signal } from '@angular/core';

import type {
  ChartInterval,
  IndicatorFamily,
  StrategyFamily,
  SymbolIndicatorSeriesResponse,
} from '../../common/indicator.types';
import {
  TRIGGER_BANDS_CHART_INDICATORS,
  TRIGGER_BANDS_CHART_INTERVALS,
  TRIGGER_BANDS_CHART_STRATEGIES,
} from '../../stores/chart.store';

/** The slice of `IndicatorSeriesStore` the binding needs — structural so
 *  specs can stub it without the full signal-store type. */
export interface TriggerBandsRequestStore {
  loadIfNeeded(
    symbol: string,
    version: string,
    intervals: ChartInterval[],
    indicators: IndicatorFamily[],
    strategies: StrategyFamily[],
  ): void;
  responseFor(): (
    symbol: string,
    version: string,
    intervals: ChartInterval[],
    indicators: IndicatorFamily[],
    strategies: StrategyFamily[],
  ) => SymbolIndicatorSeriesResponse | undefined;
}

/**
 * Bind the lean Trigger Bands request to a surface's opt-in gate.
 * @returns a signal holding the response while `enabled` and the symbol's
 *  bars version are available; `undefined` otherwise (an older backend that
 *  ignores the family returns data without `triggerBands` — nothing draws).
 */
export function bindTriggerBandsRequest(opts: {
  /** Opt-in gate — true only while a TB option is enabled on a supported interval. */
  enabled: Signal<boolean>;
  /** InputSignals may yield `null` — treated the same as `undefined`. */
  symbol: Signal<string | null | undefined>;
  version: Signal<string | null | undefined>;
  store: TriggerBandsRequestStore;
}): Signal<SymbolIndicatorSeriesResponse | undefined> {
  effect(() => {
    if (!opts.enabled()) return;
    const symbol = opts.symbol();
    const version = opts.version();
    if (!symbol || !version) return;
    untracked(() =>
      opts.store.loadIfNeeded(
        symbol,
        version,
        TRIGGER_BANDS_CHART_INTERVALS,
        TRIGGER_BANDS_CHART_INDICATORS,
        TRIGGER_BANDS_CHART_STRATEGIES,
      ),
    );
  });
  return computed(() => {
    if (!opts.enabled()) return undefined;
    const symbol = opts.symbol();
    const version = opts.version();
    if (!symbol || !version) return undefined;
    return opts.store.responseFor()(
      symbol,
      version,
      TRIGGER_BANDS_CHART_INTERVALS,
      TRIGGER_BANDS_CHART_INDICATORS,
      TRIGGER_BANDS_CHART_STRATEGIES,
    );
  });
}
