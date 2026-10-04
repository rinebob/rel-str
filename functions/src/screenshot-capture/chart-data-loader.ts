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
import { DEFAULT_CAPTURE_INTERVALS } from '@screenshot-capture/contracts';
import type {
  CaptureChartSpec,
  CaptureInterval,
} from '@screenshot-capture/contracts';
import { assembleRenderModel } from './chart-data-assembler';
import type { ChartRenderModel } from './render-model';

export interface AssembledChart {
  interval: CaptureInterval;
  model: ChartRenderModel;
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
