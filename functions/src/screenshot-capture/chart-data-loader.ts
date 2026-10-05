/**
 * Chart data loader — Firestore entry point for the capture pipeline.
 *
 * Loads cached D/W/M bars from `symbol-data/`, computes the full indicator
 * series in-process (never a self-callable), and assembles one
 * `ChartRenderModel` per requested capture interval. Kept separate from
 * `chart-data-assembler.ts` so the pure mapping stays unit-testable without
 * initializing firebase-admin.
 *
 * All three intervals are loaded regardless of the request — the indicator
 * computation needs W context for daily HTF windows and M for weekly.
 */

import { getCachedBarsFromSymbolData } from '../st-cloud-function/data-loader';
import { computeSymbolIndicatorSeries } from '../st-cloud-function/indicator-computation';
import {
  DEFAULT_CAPTURE_INTERVALS,
  DEFAULT_CAPTURE_VISIBLE_BARS,
  VISIBLE_BARS_ALL,
} from '@screenshot-capture/contracts';
import type {
  CaptureChartSpec,
  CaptureInterval,
  VisibleBars,
} from '@screenshot-capture/contracts';
import { assembleRenderModel } from './chart-data-assembler';
import type { ChartRenderModel } from './render-model';

export interface AssembledChart {
  interval: CaptureInterval;
  model: ChartRenderModel;
}

/** Raised when a requested interval lacks the bars to fill the capture
 *  window — mapped to `failed-precondition` at the callable boundary. Kept
 *  a plain Error subclass so this module stays free of firebase-functions. */
export class InsufficientBarsError extends Error {
  constructor(
    readonly symbol: string,
    readonly interval: CaptureInterval,
    readonly available: number,
    readonly required: number,
  ) {
    super(`insufficient ${interval} bars for ${symbol}: ${available} available, ${required} required`);
    this.name = 'InsufficientBarsError';
  }
}

/** Bars required per requested interval: the visible window, or ≥1 for
 *  `'all'`. Pure + exported so the contract is unit-testable without
 *  Firestore. */
export function assertSufficientBars(
  symbol: string,
  intervals: readonly CaptureInterval[],
  visibleBars: VisibleBars | undefined,
  bars: Record<CaptureInterval, readonly unknown[]>,
): void {
  const required = visibleBars === VISIBLE_BARS_ALL
    ? 1
    : visibleBars ?? DEFAULT_CAPTURE_VISIBLE_BARS;
  for (const interval of intervals) {
    const available = bars[interval].length;
    if (available < required) {
      throw new InsufficientBarsError(symbol, interval, available, required);
    }
  }
}

/**
 * Assemble one render model per requested interval for `spec.symbol`.
 * Bars are "current chart" — trimmed to `now`, no as-of truncation.
 */
export async function assembleChartModels(
  spec: CaptureChartSpec,
  now: Date = new Date(),
): Promise<AssembledChart[]> {
  const marketDate = now.toISOString().slice(0, 10);
  const loaded = await getCachedBarsFromSymbolData(spec.symbol, marketDate);
  const bars = {
    daily: loaded.dailyBars,
    weekly: loaded.weeklyBars,
    monthly: loaded.monthlyBars,
  };
  const response = computeSymbolIndicatorSeries(
    spec.symbol,
    bars.daily,
    bars.weekly,
    bars.monthly,
  );

  const intervals = spec.intervals ?? DEFAULT_CAPTURE_INTERVALS;
  assertSufficientBars(spec.symbol, intervals, spec.visibleBars, bars);

  const timestampIso = now.toISOString();

  return intervals.map((interval) => ({
    interval,
    model: assembleRenderModel({
      symbol: spec.symbol,
      interval,
      event: spec.event,
      positionType: spec.positionType,
      refId: spec.refId,
      timestampIso,
      bars: bars[interval],
      intervalData: response.intervals[interval],
      width: spec.width,
      height: spec.height,
      visibleBars: spec.visibleBars,
    }),
  }));
}
