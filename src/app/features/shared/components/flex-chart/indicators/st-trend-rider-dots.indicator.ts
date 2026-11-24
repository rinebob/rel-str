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
 * IBS GATE (#1679)
 * ----------------
 * With `ibs` passed, each candidate is partitioned by its signal bar's IBS:
 * long needs ibs ≥ threshold, short ibs ≤ 1−threshold (inclusive, same
 * Number.EPSILON guard as the BE gate in signal-detection.ts). Suppressed
 * candidates still consume the state's only shot — suppression is
 * emission-only, identical to the backend. Omit `ibs` for the unfiltered
 * candidate set (every candidate emits).
 *
 * DATA FLOW
 * ---------
 * The only runtime caller is the flex-chart sandbox's TWO_DAY path
 * (prod surfaces consume backend `dotMarkers`, not this function):
 *   1. LTF zone data (V1 or V2) — from calculator
 *   2. Zone V2 same-timeframe data — for ST Trend Rider window open check
 *   3. LTF price bars — for dot Y placement (high/low ± ATR offset)
 */

import type { IndicatorOption, PriceBar } from '../flex-chart.types';
import { StIndicator } from '../flex-chart.types';
import { computeIbs, type IbsAvailabilityContext } from '@st/ibs';

// =============================================================================
// 1. CHART CONFIGURATION
// =============================================================================

/** IBS gate params shared by both uptick-dots indicators (#1679).
 *  `showSuppressedSignals` renders IBS-rejected candidates as ghost dots;
 *  `ibsThreshold` is display-eval only — the BE truth lives in
 *  StrategyConfig.ibsThreshold. */
const UPTICK_DOTS_IBS_PARAMS: IndicatorOption['params'] = [
  { key: 'showSuppressedSignals', label: 'Show Suppressed Signals', default: false },
  { key: 'ibsThreshold', label: 'IBS Threshold', default: 0.5, min: 0, max: 1, input: 'number' },
];

export const ST_ZONE_V1_UPTICK_DOTS_INDICATOR: IndicatorOption = {
  id: 'st-zone-v1-uptick-dots',
  label: 'ST Trend Rider V1',
  type: StIndicator.ZONE_UPTICK_DOTS,
  defaultPane: 'overlay',
  params: [...UPTICK_DOTS_IBS_PARAMS],
  defaultOptions: {
    name: 'ST Trend Rider V1',
  },
};

export const ST_ZONE_V2_UPTICK_DOTS_INDICATOR: IndicatorOption = {
  id: 'st-zone-v2-uptick-dots',
  label: 'ST Trend Rider V2',
  type: StIndicator.ZONE_UPTICK_DOTS,
  defaultPane: 'overlay',
  params: [...UPTICK_DOTS_IBS_PARAMS],
  defaultOptions: {
    name: 'ST Trend Rider V2',
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

/** #1679 — emitted/suppressed partition of detected uptick dots. Emitted
 *  dots render exactly as the legacy flat list did; suppressed points are
 *  IBS-rejected candidates carrying identical placement math — consumers
 *  render them as ghosts only when `showSuppressedSignals` is on. */
export interface UptickDotResult {
  emitted: UptickDotPoint[];
  suppressed: UptickDotPoint[];
}

/** Display-side IBS gate config (#1679) — mirrors the BE `IbsGateConfig`
 *  shape: `threshold` matches StrategyConfig.ibsThreshold semantics (long
 *  needs ≥ T, short ≤ 1−T, inclusive) and the inherited availability
 *  fields let a caller pin `now`/activation for specs and replay — wall
 *  clock + default activation when omitted, same as the BE gate. Omit the
 *  whole `ibs` argument for the unfiltered candidate set. */
export interface UptickDotsIbsConfig extends IbsAvailabilityContext {
  threshold?: number;
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

/** Build the bar lookup map and ATR array used by uptick dot detection. */
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
 * @param ibs          - Optional IBS gate config; omit for the unfiltered set
 * @returns            - `{ emitted, suppressed }` — identical placement math,
 *                       suppressed = IBS-rejected candidates for ghost rendering
 */
export function detectZoneUptickDots(
  ltfZoneData: { x: Date; y: number }[],
  htfZoneData: { x: Date; y: number }[],
  ltfBars: PriceBar[],
  longColor: string,
  shortColor: string,
  ibs?: UptickDotsIbsConfig,
): UptickDotResult {
  if (ltfZoneData.length === 0 || htfZoneData.length === 0 || ltfBars.length === 0) {
    return { emitted: [], suppressed: [] };
  }
  const ibsThreshold = ibs?.threshold ?? 0.5;
  /** Signal-bar IBS for the gate — undefined (uncomputable or unavailable
   *  under the activation clock) passes the candidate through, matching
   *  the BE gate in signal-detection.ts. 'D' availability semantics
   *  apply to any bar granularity the caller feeds. The finite guard
   *  mirrors the BE one — malformed OHLC can't gate (NaN would otherwise
   *  fail both comparisons and suppress where BE emits). */
  const barIbs = (bar: PriceBar): number | undefined => {
    if (ibs === undefined) return undefined;
    const { high, low, close } = bar;
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
      return undefined;
    }
    return computeIbs(
      { high, low, close, date: bar.date },
      'D',
      { now: ibs.now, activateAtEtMin: ibs.activateAtEtMin, activateAtWeekday: ibs.activateAtWeekday },
    );
  };

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

  const emitted: UptickDotPoint[] = [];
  const suppressed: UptickDotPoint[] = [];

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
          // First valid uptick → candidate; IBS gate partitions the dot.
          // Suppression is emission-only — FIRED is consumed either way,
          // so a suppressed uptick can't double-fire on the next delta.
          const v = barIbs(bar);
          (v === undefined || v >= ibsThreshold ? emitted : suppressed).push({
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
          // First valid downtick → candidate; short bound mirrors the BE
          // gate (≤ 1−T, EPSILON ulp guard for the float complement).
          const v = barIbs(bar);
          (v === undefined || v <= 1 - ibsThreshold + Number.EPSILON ? emitted : suppressed).push({
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

  return { emitted, suppressed };
}
