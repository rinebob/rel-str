/**
 * ST Trend Rider Strategy
 *
 * Detects ST Trend Rider long/short signals on both daily and weekly timeframes.
 * Long signals fire when the same-timeframe zone is above zero and Zone V1 or V2 upticks from above zero.
 * Short signals are the reverse: same-timeframe zone below zero and Zone V1 or V2 downticks from below zero.
 *
 * Daily signals: daily zone V1/V2 vs daily zone V1/V2 window context
 * Weekly signals: weekly zone V1/V2 vs weekly zone V1/V2 window context
 *
 * Returns an array of signals — multiple can fire per symbol per run.
 */

import { computeStZone } from '@st/zone';
import { computeStZoneV2 } from '@st/zone-v2';
import { computeStTrendBands } from '@st/trend-bands';
import type { OHLCV } from '@st/trend-bands';
import type {
  StrategyMetadata,
  StrategyInput,
  StrategyOutput,
  StrategyConfig,
  StrategyAdapter,
} from '../base-strategy';
import { detectLastBarSignals, type IbsFilterContext } from '../signal-detection';

// =============================================================================
// 1. METADATA
// =============================================================================

export const metadata: StrategyMetadata = {
  id: 'st-trend-rider',
  name: 'ST Trend Rider',
  description:
    'ST Trend Rider: long signals fire when Zone V2 is above zero and Zone V1 or V2 upticks from above zero; short signals are the reverse. Uses V1 and V2 zone classifications on daily and weekly timeframes.',
  category: 'trend',
  defaultConfig: {},
  minBarsRequired: 45,
  supportedTimeframes: ['1d', '1w'],
  version: '1.0.0',
  author: 'system',
  configSchema: {
    ibsThreshold: {
      type: 'number',
      min: 0,
      max: 1,
      step: 0.05,
      description: 'IBS filter: longs need signal-bar IBS >= T, shorts <= 1 - T (default 0.5).',
    },
    ibsActivateAtEtMin: {
      type: 'integer',
      min: 0,
      max: 1439,
      step: 15,
      description: 'ET minutes-since-midnight when daily IBS becomes meaningful (default 720 = 12:00 ET).',
    },
    ibsActivateAtWeekday: {
      type: 'integer',
      min: 0,
      max: 6,
      step: 1,
      description: 'Weekday (0=Sun..6=Sat) when weekly IBS becomes meaningful (default 3 = Wed).',
    },
  },
};

// =============================================================================
// 2. NORMALIZE BARS
// =============================================================================

/**
 * Normalize cached bar format to OHLCV.
 * Cached bars may use various field names.
 */
function normalizeBars(bars: any[]): OHLCV[] {
  return bars.map(b => ({
    open: b.open ?? b.o ?? 0,
    high: b.high ?? b.h ?? 0,
    low: b.low ?? b.l ?? 0,
    close: b.close ?? b.c ?? 0,
    volume: b.volume ?? b.v ?? 0,
    date: b.d ?? b.date ?? b.t ?? '',
  }));
}

/** Extract the date string from the last bar, supporting multiple cached bar formats. */
function lastBarDate(bars: any[]): string {
  const last = bars[bars.length - 1];
  return last?.d ?? last?.date ?? last?.t ?? '';
}

// =============================================================================
// 4. MAIN EXECUTION
// =============================================================================

/**
 * Read the IBS filter keys out of the heterogeneous StrategyConfig bag.
 * Recognized keys: `ibsThreshold`, `ibsActivateAtEtMin`, `ibsActivateAtWeekday`
 * (numeric; non-numeric values are ignored, defaults live downstream).
 * `now` is never set — the wall clock is the run's truth.
 */
export function ibsFilterFromConfig(config: StrategyConfig): IbsFilterContext {
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  return {
    threshold: num(config['ibsThreshold']),
    activateAtEtMin: num(config['ibsActivateAtEtMin']),
    activateAtWeekday: num(config['ibsActivateAtWeekday']),
  };
}

/**
 * Execute the ST Trend Rider strategy for the given input.
 * Produces daily and weekly signals gated by the same-timeframe Zone V2 context.
 */
export function execute(input: StrategyInput, config: StrategyConfig): StrategyOutput[] {
  const { bars, weeklyBars = [] } = input;
  const ibs = ibsFilterFromConfig(config);
  const signals: StrategyOutput[] = [];

  // --- Daily ST Trend Rider signals ---
  if (bars.length >= 45) {
    const dailyOhlcv = normalizeBars(bars);
    const dailyBarDate = lastBarDate(bars);

    const dailyBands = computeStTrendBands(dailyOhlcv);
    const dailyZoneV1 = computeStZone(dailyOhlcv, dailyBands);
    const dailyZoneV2 = computeStZoneV2(dailyOhlcv, dailyBands);

    // V1 daily signal — same-timeframe Zone V1 context, no HTF cross-zone check
    const v1Daily = detectLastBarSignals(
      dailyZoneV1.zone, dailyZoneV1.zone, dailyOhlcv, 'V1', 'D', ibs
    );
    if (v1Daily) {
      signals.push({
        action: v1Daily.action,
        confidence: 0,
        reason: v1Daily.reason,
        signalType: v1Daily.signalType,
        barDate: dailyBarDate,
        indicators: v1Daily.indicators,
      });
    }

    // V2 daily signal — same-timeframe Zone V2 context, no HTF cross-zone check
    const v2Daily = detectLastBarSignals(
      dailyZoneV2.zone, dailyZoneV2.zone, dailyOhlcv, 'V2', 'D', ibs
    );
    if (v2Daily) {
      signals.push({
        action: v2Daily.action,
        confidence: 0,
        reason: v2Daily.reason,
        signalType: v2Daily.signalType,
        barDate: dailyBarDate,
        indicators: v2Daily.indicators,
      });
    }
  }

  // --- Weekly ST Trend Rider signals ---
  if (weeklyBars.length >= 45) {
    const weeklyOhlcv = normalizeBars(weeklyBars);
    const weeklyBarDate = lastBarDate(weeklyBars);

    const weeklyBands = computeStTrendBands(weeklyOhlcv);
    const weeklyZoneV1 = computeStZone(weeklyOhlcv, weeklyBands);
    const weeklyZoneV2 = computeStZoneV2(weeklyOhlcv, weeklyBands);

    // V1 weekly signal — same-timeframe Zone V1 context, no HTF cross-zone check
    const v1Weekly = detectLastBarSignals(
      weeklyZoneV1.zone, weeklyZoneV1.zone, weeklyOhlcv, 'V1', 'W', ibs
    );
    if (v1Weekly) {
      signals.push({
        action: v1Weekly.action,
        confidence: 0,
        reason: v1Weekly.reason,
        signalType: v1Weekly.signalType,
        barDate: weeklyBarDate,
        indicators: v1Weekly.indicators,
      });
    }

    // V2 weekly signal — same-timeframe Zone V2 context, no HTF cross-zone check
    const v2Weekly = detectLastBarSignals(
      weeklyZoneV2.zone, weeklyZoneV2.zone, weeklyOhlcv, 'V2', 'W', ibs
    );
    if (v2Weekly) {
      signals.push({
        action: v2Weekly.action,
        confidence: 0,
        reason: v2Weekly.reason,
        signalType: v2Weekly.signalType,
        barDate: weeklyBarDate,
        indicators: v2Weekly.indicators,
      });
    }
  }

  return signals;
}

// =============================================================================
// 5. ADAPTER EXPORT
// =============================================================================

/** Strategy adapter exported to the registry. */
export const adapter: StrategyAdapter = { metadata, execute };
export default adapter;
