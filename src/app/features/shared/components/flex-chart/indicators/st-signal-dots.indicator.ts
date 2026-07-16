/**
 * ST-Signal-Dots — Annotates Trend-Strength histogram with signal markers
 *
 * Places small colored dots above (long) or below (short) the histogram bar
 * where ST-Trend-Strength signals fire (threshold crossovers and pullback breakouts).
 *
 * Rendered as scatter dots on the same pane as ST-Trend-Strength (lower-1).
 * No connecting line.
 *
 * DATA FLOW
 * ---------
 * Pre-computed in signal-detail using:
 *   1. ST-Trend-Strength indicator data (diHist values)
 *   2. Price bars (for signal detection)
 *   3. detectTrendStrengthSignals() → SignalMarker[]
 *   4. computeSignalDots() maps signals → scatter points at histValue ± offset
 */

import type { IndicatorOption, PriceBar } from '../flex-chart.types';
import { StIndicator } from '../flex-chart.types';
import type { SignalMarker } from '../signals/signal.types';
import { SignalDirection } from '../signals/signal.types';

// =============================================================================
// 1. CHART CONFIGURATION
// =============================================================================

export const ST_SIGNAL_DOTS_INDICATOR: IndicatorOption = {
  id: 'st-signal-dots',
  label: 'Signal Dots',
  type: StIndicator.SIGNAL_DOTS,
  defaultPane: 'lower-1',
  params: [],
  defaultOptions: {
    name: 'Signals',
  },
};

// =============================================================================
// 2. DOT COMPUTATION (called externally, not via calculator pipeline)
// =============================================================================

const LONG_COLOR = '#4caf50';
const SHORT_COLOR = '#f44336';
const DOT_OFFSET = 3;

export interface SignalDotPoint {
  x: Date;
  y: number;
  color: string;
}

/**
 * Compute signal dot positions from trend-strength signals and histogram data.
 *
 * @param signals        - Detected trend-strength signals
 * @param strengthData   - ST-Trend-Strength indicator output (diHist values)
 * @returns Scatter points positioned above/below the histogram bar
 */
export function computeSignalDots(
  signals: SignalMarker[],
  strengthData: { x: Date; y: number }[],
): SignalDotPoint[] {
  if (signals.length === 0 || strengthData.length === 0) return [];

  // Build a date→index map for strength data
  const dateToIdx = new Map<number, number>();
  strengthData.forEach((d, i) => dateToIdx.set(d.x.getTime(), i));

  const dots: SignalDotPoint[] = [];

  for (const sig of signals) {
    // Match signal to strength bar by barIndex or date
    let histValue: number;
    if (sig.barIndex >= 0 && sig.barIndex < strengthData.length) {
      histValue = strengthData[sig.barIndex].y;
    } else {
      const idx = dateToIdx.get(sig.x.getTime());
      if (idx === undefined) continue;
      histValue = strengthData[idx].y;
    }

    if (sig.direction === SignalDirection.LONG) {
      dots.push({
        x: sig.x,
        y: histValue + DOT_OFFSET,
        color: LONG_COLOR,
      });
    } else {
      dots.push({
        x: sig.x,
        y: histValue - DOT_OFFSET,
        color: SHORT_COLOR,
      });
    }
  }

  return dots;
}
