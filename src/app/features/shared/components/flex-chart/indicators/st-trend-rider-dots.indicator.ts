/**
 * ST Trend Rider Uptick Dots — Main Chart Signal Overlay
 *
 * Plots signal dots on the main price chart when a zone value upticks
 * for the first time during a long window open (or downticks during
 * a short window open). These are the ST Trend Rider entry markers.
 *
 * SIGNAL RULES (ST Trend Rider)
 * ------------------------------
 * Long (Zone V2 > 0): zone was falling/flat while already ≥ +1, then upticks once → signal.
 *   No repeat until zone falls or goes flat again, then upticks.
 * Short (Zone V2 < 0): zone was rising/flat while already ≤ -1, then downticks once → signal.
 *   No repeat until zone rises or goes flat again, then downticks.
 *
 * DATA FLOW
 * ---------
 * Pre-computed in signal-detail using:
 *   1. LTF zone data (V1 or V2) — from calculator
 *   2. Zone V2 same-timeframe data — for ST Trend Rider window open check
 *   3. LTF price bars — for dot Y placement (high/low ± ATR offset)
 */

import type { IndicatorOption, PriceBar } from '../flex-chart.types';
import { StIndicator } from '../flex-chart.types';

// =============================================================================
// 1. CHART CONFIGURATION
// =============================================================================

export const ST_ZONE_V1_UPTICK_DOTS_INDICATOR: IndicatorOption = {
  id: 'st-zone-v1-uptick-dots',
  label: 'ST Trend Rider V1',
  type: StIndicator.ZONE_UPTICK_DOTS,
  defaultPane: 'overlay',
  params: [],
  defaultOptions: {
    name: 'ST Trend Rider V1',
  },
};

export const ST_ZONE_V2_UPTICK_DOTS_INDICATOR: IndicatorOption = {
  id: 'st-zone-v2-uptick-dots',
  label: 'ST Trend Rider V2',
  type: StIndicator.ZONE_UPTICK_DOTS,
  defaultPane: 'overlay',
  params: [],
  defaultOptions: {
    name: 'ST Trend Rider V2',
  },
};

export const ST_ZONE_V1_ZERO_CROSS_DOTS_INDICATOR: IndicatorOption = {
  id: 'st-zone-v1-zero-cross-dots',
  label: 'ST Zero Cross V1',
  type: StIndicator.ZONE_ZERO_CROSS_DOTS,
  defaultPane: 'overlay',
  params: [],
  defaultOptions: {
    name: 'ST Zero Cross V1',
  },
};

export const ST_ZONE_V2_ZERO_CROSS_DOTS_INDICATOR: IndicatorOption = {
  id: 'st-zone-v2-zero-cross-dots',
  label: 'ST Zero Cross V2',
  type: StIndicator.ZONE_ZERO_CROSS_DOTS,
  defaultPane: 'overlay',
  params: [],
  defaultOptions: {
    name: 'ST Zero Cross V2',
  },
};

// =============================================================================
// 2. SIGNAL DETECTION + DOT COMPUTATION
// =============================================================================

export interface UptickDotPoint {
  x: Date;
  y: number;
  color: string;
}

/**
 * Compute a simple ATR(14) for offset sizing.
 */
function computeATR(bars: PriceBar[], period = 14): number[] {
  const atr: number[] = new Array(bars.length).fill(0);
  if (bars.length < 2) return atr;

  // True range for each bar
  const tr: number[] = [bars[0].high - bars[0].low];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }

  // SMA seed
  let sum = 0;
  for (let i = 0; i < Math.min(period, tr.length); i++) sum += tr[i];
  const seed = sum / Math.min(period, tr.length);
  for (let i = 0; i < period && i < bars.length; i++) atr[i] = seed;

  // EMA-style smoothing
  for (let i = period; i < bars.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }

  return atr;
}

const ATR_OFFSET_MULT = 2.5;

/** Shared bar lookup + ATR offset context for dot placement. */
interface DotPlacementContext {
  barMap: Map<number, { bar: PriceBar; idx: number }>;
  atr: number[];
}

/** Build the bar lookup map and ATR array used by both uptick and zero-cross dot detection. */
function buildDotPlacementContext(bars: PriceBar[]): DotPlacementContext {
  const barMap = new Map<number, { bar: PriceBar; idx: number }>();
  bars.forEach((bar, idx) => barMap.set(bar.x.getTime(), { bar, idx }));
  const atr = computeATR(bars);
  return { barMap, atr };
}


/**
 * Detect ST Trend Rider signals and return scatter dot points for the main chart.
 *
 * @param ltfZoneData  - LTF zone indicator output (V1 or V2)
 * @param htfZoneData  - Zone V2 data for the same timeframe window check
 * @param ltfBars      - LTF price bars
 * @param longColor    - Dot color for long signals
 * @param shortColor   - Dot color for short signals
 */
export function detectZoneUptickDots(
  ltfZoneData: { x: Date; y: number }[],
  htfZoneData: { x: Date; y: number }[],
  ltfBars: PriceBar[],
  longColor: string,
  shortColor: string,
): UptickDotPoint[] {
  if (ltfZoneData.length === 0 || htfZoneData.length === 0 || ltfBars.length === 0) return [];

  // Build bar lookup + ATR offset context
  const { barMap, atr } = buildDotPlacementContext(ltfBars);

  // Map HTF zone per LTF zone data point (by date, not index)
  const sortedHtf = [...htfZoneData].sort((a, b) => a.x.getTime() - b.x.getTime());
  function getHtfZone(t: number): number | null {
    let lo = 0, hi = sortedHtf.length - 1;
    let val: number | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sortedHtf[mid].x.getTime() <= t) {
        val = sortedHtf[mid].y;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return val;
  }

  const dots: UptickDotPoint[] = [];

  // State machine
  // For longs: READY means zone was falling/flat, FIRED means uptick already signalled
  // For shorts: READY means zone was rising/flat, FIRED means downtick already signalled
  let longState: 'READY' | 'FIRED' = 'READY';
  let shortState: 'READY' | 'FIRED' = 'READY';

  for (let i = 1; i < ltfZoneData.length; i++) {
    const prevZone = ltfZoneData[i - 1].y;
    const currZone = ltfZoneData[i].y;
    const delta = currZone - prevZone;

    const zoneTime = ltfZoneData[i].x.getTime();
    const htfZone = getHtfZone(zoneTime);

    if (htfZone === null) continue;

    // Find corresponding price bar by date
    const entry = barMap.get(zoneTime);
    if (!entry) continue;
    const { bar, idx } = entry;

    const offset = atr[idx] * ATR_OFFSET_MULT;

    // --- Long side (HTF > 0) ---
    if (htfZone > 0) {
      if (delta > 0) {
        // Zone upticked — only valid if the prior value was already above zero (≥ +1)
        if (longState === 'READY' && prevZone >= 1) {
          // First valid uptick → signal
          dots.push({
            x: bar.x,
            y: bar.low - offset,
            color: longColor,
          });
          longState = 'FIRED';
        }
        // If FIRED or prior zone was on the wrong side, do nothing (continuation / invalid)
      } else if (delta < 0) {
        // Zone downticked → reset to READY
        longState = 'READY';
      }
      // delta === 0 (flat): no state change
    } else {
      // HTF not positive, reset long state
      longState = 'READY';
    }

    // --- Short side (HTF < 0) ---
    if (htfZone < 0) {
      if (delta < 0) {
        // Zone downticked — only valid if the prior value was already below zero (≤ -1)
        if (shortState === 'READY' && prevZone <= -1) {
          // First valid downtick → signal
          dots.push({
            x: bar.x,
            y: bar.high + offset,
            color: shortColor,
          });
          shortState = 'FIRED';
        }
        // If FIRED or prior zone was on the wrong side, do nothing (continuation / invalid)
      } else if (delta > 0) {
        // Zone upticked → reset to READY
        shortState = 'READY';
      }
      // delta === 0 (flat): no state change
    } else {
      // HTF not negative, reset short state
      shortState = 'READY';
    }
  }

  return dots;
}

/**
 * Detect Trend Rider Zero Cross signals and return scatter dot points for the
 * main chart. Fires when the zone value flips sign between consecutive bars —
 * no state machine, no confirmation delay. The earliest Trend Rider entry
 * signal: the moment the regime shifts.
 *
 * @param zoneData    - Zone indicator output (V1 or V2)
 * @param bars        - Price bars for dot Y placement (high/low ± ATR offset)
 * @param longColor   - Dot color for bullish zero-cross (sign flip negative→positive)
 * @param shortColor  - Dot color for bearish zero-cross (sign flip positive→negative)
 */
export function detectZoneZeroCrossDots(
  zoneData: { x: Date; y: number | undefined }[],
  bars: PriceBar[],
  longColor: string,
  shortColor: string,
): UptickDotPoint[] {
  if (zoneData.length === 0 || bars.length === 0) return [];

  // Build bar lookup + ATR offset context
  const { barMap, atr } = buildDotPlacementContext(bars);

  const dots: UptickDotPoint[] = [];

  for (let i = 1; i < zoneData.length; i++) {
    const prevZone = zoneData[i - 1].y;
    const currZone = zoneData[i].y;

    // Skip if either zone is missing (null/undefined) — breaks the sequence
    // so a cross is only detected between two consecutive defined values
    if (prevZone === undefined || currZone === undefined) continue;

    // Sign flip detection — zero is treated as neutral and does not trigger
    const bullishCross = prevZone < 0 && currZone > 0;
    const bearishCross = prevZone > 0 && currZone < 0;
    if (!bullishCross && !bearishCross) continue;

    const zoneTime = zoneData[i].x.getTime();
    const entry = barMap.get(zoneTime);
    if (!entry) continue;
    const { bar, idx } = entry;

    const offset = atr[idx] * ATR_OFFSET_MULT;

    if (bullishCross) {
      dots.push({ x: bar.x, y: bar.low - offset, color: longColor });
    } else {
      dots.push({ x: bar.x, y: bar.high + offset, color: shortColor });
    }
  }

  return dots;
}
