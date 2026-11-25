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
 * SHARED ENGINE (#1727)
 * ---------------------
 * Detection is the canonical shared state machine (@st/signal-detect) —
 * the same body the BE strategy and marker paths run; this module is an
 * emitter, not a reimplementation. With `ibs` passed, candidates partition
 * through the shared filter (@st/signal-filter): long needs ibs ≥ T, short
 * ibs ≤ 1−T (inclusive, Number.EPSILON guard). Suppression is emission-only
 * — the detector consumed READY→FIRED before the partition ran. Omit `ibs`
 * for the unfiltered candidate set.
 *
 * Convergence note: the legacy local SM skipped zone points whose HTF
 * window or bar lookup missed (no state update); the shared engine treats
 * a NaN window as a state reset — BE truth. The HTF lookup below preserves
 * the most-recent-HTF≤t semantics when building the index-aligned window.
 * Same for a bar-miss: a candidate on a zone point with no matching bar
 * consumes READY→FIRED inside the detector, then `toDot` drops it — the
 * latch is spent with nothing rendered (unreachable while zone points and
 * bars derive from the same series; documented so a desync reads as
 * intentional latch-spend, not a lost dot).
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
import { detectZoneUptickCandidates, type ZoneSignalCandidate } from '@st/signal-detect';
import { partitionByIbs, type IbsBarLike, type IbsFilterContext } from '@st/signal-filter';

// =============================================================================
// 1. CHART CONFIGURATION
// =============================================================================

/** IBS filter params shared by both uptick-dots indicators (#1679).
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

/** Display-side IBS filter config (#1679/#1727) — the shared
 *  `IbsFilterContext`: `threshold` matches StrategyConfig.ibsThreshold
 *  semantics (long needs ≥ T, short ≤ 1−T, inclusive) and the inherited
 *  availability fields let a caller pin `now`/activation for specs and
 *  replay — wall clock + default activation when omitted, same as the BE
 *  filter. Omit the whole `ibs` argument for the unfiltered candidate set. */
export type UptickDotsIbsFilter = IbsFilterContext;

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
 * Emitter over the shared engine: zone/HTF series → candidates
 * (@st/signal-detect) → IBS partition (@st/signal-filter) → dot placement.
 *
 * @param ltfZoneData  - LTF zone indicator output (V1 or V2)
 * @param htfZoneData  - Zone V2 data for the same timeframe window check
 * @param ltfBars      - LTF price bars
 * @param longColor    - Dot color for long signals
 * @param shortColor   - Dot color for short signals
 * @param ibs          - Optional IBS filter config; omit for the unfiltered set
 * @param version      - 'V1' | 'V2' — carried into candidate signalTypes
 * @returns            - `{ emitted, suppressed }` — identical placement math,
 *                       suppressed = IBS-rejected candidates for ghost rendering
 */
export function detectZoneUptickDots(
  ltfZoneData: { x: Date; y: number }[],
  htfZoneData: { x: Date; y: number }[],
  ltfBars: PriceBar[],
  longColor: string,
  shortColor: string,
  ibs?: UptickDotsIbsFilter,
  version: 'V1' | 'V2' = 'V1',
): UptickDotResult {
  if (ltfZoneData.length === 0 || htfZoneData.length === 0 || ltfBars.length === 0) {
    return { emitted: [], suppressed: [] };
  }

  // Build bar lookup + ATR offset context
  const { barMap, atr } = buildDotPlacementContext(ltfBars);

  // Shared-engine inputs: index-aligned zone + window arrays. The HTF
  // lookup keeps the legacy most-recent-HTF≤t semantics (binary search on
  // the sorted series) — for the sandbox's same-timeframe use (zone, zone)
  // it reduces to each point's own value.
  const zoneNums = ltfZoneData.map((p) => p.y);
  const sortedHtf = [...htfZoneData].sort((a, b) => a.x.getTime() - b.x.getTime());
  const getHtfZone = (t: number): number | null => {
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
  };
  const windowNums = ltfZoneData.map((p) => getHtfZone(p.x.getTime()) ?? NaN);

  // candidate.index addresses the ZONE array — the partition needs the
  // signal bar at that same index, so feed it the zone-aligned bar view.
  const zoneBars: IbsBarLike[] = ltfZoneData.map(
    (p) => barMap.get(p.x.getTime())?.bar ?? {},
  );

  // 'D' is deliberate for any bar granularity fed here (incl. sandbox
  // TWO_DAY bars): daily availability semantics apply — the filter answers
  // "is this bar's IBS meaningful yet", not "what timeframe produced it".
  const candidates = detectZoneUptickCandidates(zoneNums, windowNums, version, 'D');
  const { emitted, suppressed } = partitionByIbs(candidates, zoneBars, 'D', ibs);

  const toDot = (c: ZoneSignalCandidate): UptickDotPoint | null => {
    const entry = barMap.get(ltfZoneData[c.index].x.getTime());
    if (!entry) return null;
    const offset = atr[entry.idx] * ATR_OFFSET_MULT;
    return {
      x: entry.bar.x,
      y: c.direction === 'long' ? entry.bar.low - offset : entry.bar.high + offset,
      color: c.direction === 'long' ? longColor : shortColor,
    };
  };
  const toDots = (cs: ZoneSignalCandidate[]): UptickDotPoint[] =>
    cs.map(toDot).filter((p): p is UptickDotPoint => p !== null);

  return { emitted: toDots(emitted), suppressed: toDots(suppressed) };
}
