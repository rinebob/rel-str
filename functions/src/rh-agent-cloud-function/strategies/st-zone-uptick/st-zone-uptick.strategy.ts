/**
 * ST-Zone Uptick Strategy
 *
 * Detects zone uptick/downtick signals on both daily and weekly timeframes.
 * Uses the same state machine as the frontend detectZoneUptickDots.
 *
 * Daily signals: daily zone vs weekly HTF zone V2 context
 * Weekly signals: weekly zone vs monthly HTF zone V2 context
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

// =============================================================================
// 1. METADATA
// =============================================================================

export const metadata: StrategyMetadata = {
  id: 'st-zone-uptick',
  name: 'ST Zone Uptick',
  description:
    'Detects first zone uptick during long window open (or first downtick during short window open) using V1 and V2 zone classifications on daily and weekly timeframes.',
  category: 'trend',
  defaultConfig: {},
  minBarsRequired: 45,
  supportedTimeframes: ['1d', '1w'],
  version: '1.0.0',
  author: 'system',
};

// =============================================================================
// 2. SIGNAL DETECTION STATE MACHINE
// =============================================================================

interface ZoneSignal {
  action: 'OPEN_LONG' | 'OPEN_SHORT';
  signalType: string;
  reason: string;
  indicators: Record<string, number | string | null>;
}

/**
 * Run the zone uptick state machine on a zone array with HTF context.
 * Only fires if the LAST bar is the signal bar.
 *
 * @param ltfZone   - Zone values per LTF bar (V1: -3/+3, V2: -4/+4)
 * @param htfZone   - Zone V2 values per HTF bar
 * @param ltfBars   - LTF OHLCV bars (for date alignment)
 * @param htfBars   - HTF OHLCV bars (for date alignment)
 * @param version   - 'V1' or 'V2' for signal type naming
 * @param timeframe - 'D' or 'W' for signal type prefix
 */
function detectLastBarSignals(
  ltfZone: number[],
  htfZone: number[],
  ltfBars: OHLCV[],
  htfBars: OHLCV[],
  version: 'V1' | 'V2',
  timeframe: 'D' | 'W',
): ZoneSignal | null {
  if (ltfZone.length < 2 || htfZone.length === 0) return null;

  // Map HTF zone to LTF bars by finding most recent HTF bar at or before each LTF bar
  // HTF bars are sorted chronologically — use the last HTF zone value as the current context
  // Since cached bars don't have dates in a standardized format, just use the last HTF zone value
  const currentHtfZone = htfZone[htfZone.length - 1];

  // State machine
  let longState: 'READY' | 'FIRED' = 'READY';
  let shortState: 'READY' | 'FIRED' = 'READY';

  // Skip leading zeros (indicator warm-up)
  let start = 0;
  while (start < ltfZone.length && ltfZone[start] === 0) start++;
  if (start >= ltfZone.length - 1) return null;

  let lastSignal: ZoneSignal | null = null;
  let lastSignalIdx = -1;

  for (let i = start + 1; i < ltfZone.length; i++) {
    const prevZone = ltfZone[i - 1];
    const currZone = ltfZone[i];
    const delta = currZone - prevZone;

    // --- Long side (HTF > 0) ---
    if (currentHtfZone > 0) {
      if (delta > 0) {
        if (longState === 'READY') {
          lastSignal = {
            action: 'OPEN_LONG',
            signalType: `${timeframe}_ZONE_${version}_UPTICK`,
            reason: `${version} zone upticked ${prevZone}→${currZone} with ${timeframe === 'D' ? 'weekly' : 'monthly'} HTF zone at +${currentHtfZone}`,
            indicators: {
              [`zone${version}`]: currZone,
              [`zone${version}Prev`]: prevZone,
              htfZone: currentHtfZone,
              delta,
            },
          };
          lastSignalIdx = i;
          longState = 'FIRED';
        }
      } else if (delta < 0) {
        longState = 'READY';
      }
    } else {
      longState = 'READY';
    }

    // --- Short side (HTF < 0) ---
    if (currentHtfZone < 0) {
      if (delta < 0) {
        if (shortState === 'READY') {
          lastSignal = {
            action: 'OPEN_SHORT',
            signalType: `${timeframe}_ZONE_${version}_DOWNTICK`,
            reason: `${version} zone downticked ${prevZone}→${currZone} with ${timeframe === 'D' ? 'weekly' : 'monthly'} HTF zone at ${currentHtfZone}`,
            indicators: {
              [`zone${version}`]: currZone,
              [`zone${version}Prev`]: prevZone,
              htfZone: currentHtfZone,
              delta,
            },
          };
          lastSignalIdx = i;
          shortState = 'FIRED';
        }
      } else if (delta > 0) {
        shortState = 'READY';
      }
    } else {
      shortState = 'READY';
    }
  }

  // Only emit if the signal fired on the LAST bar
  if (lastSignal && lastSignalIdx === ltfZone.length - 1) {
    return lastSignal;
  }

  return null;
}

// =============================================================================
// 3. NORMALIZE BARS
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

function lastBarDate(bars: any[]): string {
  const last = bars[bars.length - 1];
  return last?.d ?? last?.date ?? last?.t ?? '';
}

// =============================================================================
// 4. MAIN EXECUTION
// =============================================================================

export function execute(input: StrategyInput, _config: StrategyConfig): StrategyOutput[] {
  const { bars, weeklyBars, monthlyBars } = input;
  const signals: StrategyOutput[] = [];

  // --- Daily signals (daily bars + weekly HTF) ---
  if (bars && bars.length >= 45 && weeklyBars && weeklyBars.length >= 30) {
    const dailyOhlcv = normalizeBars(bars);
    const weeklyOhlcv = normalizeBars(weeklyBars);
    const dailyBarDate = lastBarDate(bars);

    // Compute bands once, reuse for V1 and V2
    const dailyBands = computeStTrendBands(dailyOhlcv);
    const weeklyBands = computeStTrendBands(weeklyOhlcv);

    const dailyZoneV1 = computeStZone(dailyOhlcv, dailyBands);
    const dailyZoneV2 = computeStZoneV2(dailyOhlcv, dailyBands);
    const weeklyZoneV2 = computeStZoneV2(weeklyOhlcv, weeklyBands);

    // V1 daily signal
    const v1Daily = detectLastBarSignals(
      dailyZoneV1.zone, weeklyZoneV2.zone, dailyOhlcv, weeklyOhlcv, 'V1', 'D'
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

    // V2 daily signal
    const v2Daily = detectLastBarSignals(
      dailyZoneV2.zone, weeklyZoneV2.zone, dailyOhlcv, weeklyOhlcv, 'V2', 'D'
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

  // --- Weekly signals (weekly bars + monthly HTF) ---
  if (weeklyBars && weeklyBars.length >= 45 && monthlyBars && monthlyBars.length >= 30) {
    const weeklyOhlcv = normalizeBars(weeklyBars);
    const monthlyOhlcv = normalizeBars(monthlyBars);
    const weeklyBarDate = lastBarDate(weeklyBars);

    const weeklyBands = computeStTrendBands(weeklyOhlcv);
    const monthlyBands = computeStTrendBands(monthlyOhlcv);

    const weeklyZoneV1 = computeStZone(weeklyOhlcv, weeklyBands);
    const weeklyZoneV2 = computeStZoneV2(weeklyOhlcv, weeklyBands);
    const monthlyZoneV2 = computeStZoneV2(monthlyOhlcv, monthlyBands);

    // V1 weekly signal
    const v1Weekly = detectLastBarSignals(
      weeklyZoneV1.zone, monthlyZoneV2.zone, weeklyOhlcv, monthlyOhlcv, 'V1', 'W'
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

    // V2 weekly signal
    const v2Weekly = detectLastBarSignals(
      weeklyZoneV2.zone, monthlyZoneV2.zone, weeklyOhlcv, monthlyOhlcv, 'V2', 'W'
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

const _adapter: StrategyAdapter = { metadata, execute: execute as any };
export default _adapter;
