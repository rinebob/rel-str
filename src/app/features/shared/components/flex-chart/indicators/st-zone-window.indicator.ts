/**
 * ST-Zone Window — HTF Long/Short Window Open Indicator
 *
 * THEORY
 * ------
 * Visual indicator showing when the higher-timeframe zone context is
 * bullish or bearish. Plotted on the lower timeframe chart in the same
 * pane as Zone V2.
 *
 * - Long window open (HTF zone > 0): green dot at +6
 * - Short window open (HTF zone < 0): red dot at -6
 * - Neutral (HTF zone == 0): both +6 and -6 dots plotted
 *
 * Always has a value on every bar.
 *
 * DATA FLOW
 * ---------
 * This indicator uses **pre-computed HTF zone data** (Option B / SOT).
 * The calculator is not used via the standard indicator pipeline.
 * Instead, signal-detail computes the window data and passes it as
 * pre-calculated `config.data`.
 *
 * CHART RENDERING
 * ---------------
 * - Pane: same as Zone V2
 * - Series: scatter (dots only, no connecting line)
 * - Axis: -7 to +7
 */

import type { IndicatorOption, PriceBar } from '../flex-chart.types';
import { StIndicator } from '../flex-chart.types';

// =============================================================================
// 1. CHART CONFIGURATION
// =============================================================================

export const ST_ZONE_WINDOW_MONTHLY_INDICATOR: IndicatorOption = {
  id: 'st-zone-window-monthly',
  label: 'Zone Window (M)',
  type: StIndicator.ZONE_WINDOW,
  defaultPane: 'lower-3',
  axisScale: 'fixed',
  params: [],
  defaultOptions: {
    name: 'M Window',
  },
};

export const ST_ZONE_WINDOW_WEEKLY_INDICATOR: IndicatorOption = {
  id: 'st-zone-window-weekly',
  label: 'Zone Window (W)',
  type: StIndicator.ZONE_WINDOW,
  defaultPane: 'lower-3',
  axisScale: 'fixed',
  params: [],
  defaultOptions: {
    name: 'W Window',
  },
};

// =============================================================================
// 2. WINDOW DATA COMPUTATION (called externally, not via calculator pipeline)
// =============================================================================

const LONG_COLOR = '#4caf50';
const SHORT_COLOR = '#f44336';

export interface WindowDataPoint {
  x: Date;
  y: number;
  color: string;
}

/**
 * Compute window dots by mapping pre-computed HTF zone data onto LTF bars.
 *
 * @param htfZoneData - Pre-computed HTF zone V2 output (SOT)
 * @param ltfBars     - LTF price bars (for x-axis dates)
 * @returns Array of scatter data points at ±6
 */
export function computeZoneWindowData(
  htfZoneData: { x: Date; y: number }[],
  ltfBars: PriceBar[],
): WindowDataPoint[] {
  if (htfZoneData.length === 0 || ltfBars.length === 0) return [];

  // Sort HTF data by date for binary search
  const sorted = [...htfZoneData].sort((a, b) => a.x.getTime() - b.x.getTime());

  const result: WindowDataPoint[] = [];

  for (const bar of ltfBars) {
    const t = bar.x.getTime();

    // Binary search: find most recent HTF zone at or before this bar's date
    let lo = 0, hi = sorted.length - 1;
    let htfZone: number | null = null;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].x.getTime() <= t) {
        htfZone = sorted[mid].y;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (htfZone === null) continue;

    if (htfZone > 0) {
      result.push({ x: bar.x, y: -6, color: LONG_COLOR });
    } else if (htfZone < 0) {
      result.push({ x: bar.x, y: 6, color: SHORT_COLOR });
    } else {
      // Neutral: plot both
      result.push({ x: bar.x, y: -6, color: LONG_COLOR });
      result.push({ x: bar.x, y: 6, color: SHORT_COLOR });
    }
  }

  return result;
}
