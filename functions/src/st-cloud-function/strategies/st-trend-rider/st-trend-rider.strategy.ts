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

import { computeStZone } from '../../../indicators/st-zone';
import { computeStZoneV2 } from '../../../indicators/st-zone-v2';
import { computeStTrendBands } from '../../../indicators/st-trend-bands';
import type { OHLCV } from '../../../indicators/st-trend-bands';
import type {
  StrategyMetadata,
  StrategyInput,
  StrategyOutput,
  StrategyConfig,
  StrategyAdapter,
} from '../base-strategy';
import { detectLastBarSignals } from '../signal-detection';

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
 * Execute the ST Trend Rider strategy for the given input.
 * Produces daily and weekly signals gated by the same-timeframe Zone V2 context.
 */
export function execute(input: StrategyInput, _config: StrategyConfig): StrategyOutput[] {
  const { bars, weeklyBars = [] } = input;
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
      dailyZoneV1.zone, dailyOhlcv, dailyZoneV1.zone, 'V1', 'D'
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
      dailyZoneV2.zone, dailyOhlcv, dailyZoneV2.zone, 'V2', 'D'
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
      weeklyZoneV1.zone, weeklyOhlcv, weeklyZoneV1.zone, 'V1', 'W'
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
      weeklyZoneV2.zone, weeklyOhlcv, weeklyZoneV2.zone, 'V2', 'W'
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
