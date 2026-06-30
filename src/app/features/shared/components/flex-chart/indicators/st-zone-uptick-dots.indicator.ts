/**
 * ST-Zone Uptick Dots — Main Chart Signal Overlay
 *
 * Plots signal dots on the main price chart when a zone value upticks
 * for the first time during a long window open (or downticks during
 * a short window open).
 *
 * SIGNAL RULES
 * ------------
 * Long (HTF zone > 0): zone was falling/flat, then upticks once → signal.
 *   No repeat until zone falls or goes flat again, then upticks.
 * Short (HTF zone < 0): zone was rising/flat, then downticks once → signal.
 *   No repeat until zone rises or goes flat again, then downticks.
 *
 * DATA FLOW
 * ---------
 * Pre-computed in signal-detail using:
 *   1. LTF zone data (V1 or V2) — from calculator
 *   2. HTF zone data (SOT, pre-computed) — for window open check
 *   3. LTF price bars — for dot Y placement (high/low ± ATR offset)
 */

import type { IndicatorOption, PriceBar } from '../flex-chart.types';
import { StIndicator } from '../flex-chart.types';

// =============================================================================
// 1. CHART CONFIGURATION
// =============================================================================

export const ST_ZONE_V1_UPTICK_DOTS_INDICATOR: IndicatorOption = {
  id: 'st-zone-v1-uptick-dots',
  label: 'Zone V1 Signals',
  type: StIndicator.ZONE_UPTICK_DOTS,
  defaultPane: 'overlay',
  params: [],
  defaultOptions: {
    name: 'V1 Signals',
  },
};

export const ST_ZONE_V2_UPTICK_DOTS_INDICATOR: IndicatorOption = {
  id: 'st-zone-v2-uptick-dots',
  label: 'Zone V2 Signals',
  type: StIndicator.ZONE_UPTICK_DOTS,
  defaultPane: 'overlay',
  params: [],
  defaultOptions: {
    name: 'V2 Signals',
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


/**
 * Detect zone uptick signals and return scatter dot points for the main chart.
 *
 * @param ltfZoneData  - LTF zone indicator output (V1 or V2)
 * @param htfZoneData  - Pre-computed HTF zone V2 data (SOT)
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

  // Build bar lookup by date for price data and ATR
  const barMap = new Map<number, { bar: PriceBar; idx: number }>();
  ltfBars.forEach((bar, idx) => barMap.set(bar.x.getTime(), { bar, idx }));

  // Compute ATR for offset
  const atr = computeATR(ltfBars);

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
        // Zone upticked
        if (longState === 'READY') {
          // First uptick → signal
          dots.push({
            x: bar.x,
            y: bar.low - offset,
            color: longColor,
          });
          longState = 'FIRED';
        }
        // If FIRED, do nothing (continuation)
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
        // Zone downticked
        if (shortState === 'READY') {
          // First downtick → signal
          dots.push({
            x: bar.x,
            y: bar.high + offset,
            color: shortColor,
          });
          shortState = 'FIRED';
        }
        // If FIRED, do nothing (continuation)
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
