/**
 * ST-Trend-Strength Signal Detector
 *
 * Detects actionable trade signals from ST-Trend-Strength (diHist) data.
 *
 * SIGNAL RULES
 * ------------
 *
 * 1. THRESHOLD CROSSOVERS
 *    Long:  diHist crosses from below to above -10, 0, or +10
 *    Short: diHist crosses from above to below +10, 0, or -10
 *
 * 2. PULLBACK BREAKOUT
 *    Long:  diHist is positive, pulls back, then breaks above prior swing high
 *           (e.g., 15 → 12 → 18 — signal on the 18 bar)
 *    Short: diHist is negative, pulls back toward zero, then breaks below prior swing low
 *           (e.g., -12 → -9 → -14 — signal on the -14 bar)
 */

import type { SignalMarker, SignalDetector } from './signal.types';
import { SignalDirection } from './signal.types';
import { StIndicator } from '../flex-chart.types';

const THRESHOLDS = [-10, 0, 10];

const THRESHOLD_LABELS: Record<number, string> = {
  [-10]: '-10',
  0: 'zero',
  10: '+10',
};

/**
 * Detect threshold crossover signals.
 * A crossover occurs when diHist moves from one side of a threshold to the other.
 */
function detectThresholdCrossovers(
  indicatorData: { x: Date; y: number }[],
  bars: { x: Date; high: number; low: number; close: number }[]
): SignalMarker[] {
  const signals: SignalMarker[] = [];

  for (let i = 1; i < indicatorData.length; i++) {
    const prev = indicatorData[i - 1].y;
    const curr = indicatorData[i].y;
    const barDate = indicatorData[i].x;
    const bar = bars.find(b => b.x.getTime() === barDate.getTime());
    if (!bar) continue;

    for (const threshold of THRESHOLDS) {
      // Long: crossed from below to above
      if (prev < threshold && curr >= threshold) {
        signals.push({
          x: barDate,
          y: bar.low,
          direction: SignalDirection.LONG,
          source: StIndicator.TREND_STRENGTH,
          signalType: `cross-${THRESHOLD_LABELS[threshold]}`,
          reason: `DI crossed above ${THRESHOLD_LABELS[threshold]} (${prev.toFixed(1)} → ${curr.toFixed(1)})`,
          barIndex: i,
        });
      }

      // Short: crossed from above to below
      if (prev > threshold && curr <= threshold) {
        signals.push({
          x: barDate,
          y: bar.high,
          direction: SignalDirection.SHORT,
          source: StIndicator.TREND_STRENGTH,
          signalType: `cross-${THRESHOLD_LABELS[threshold]}`,
          reason: `DI crossed below ${THRESHOLD_LABELS[threshold]} (${prev.toFixed(1)} → ${curr.toFixed(1)})`,
          barIndex: i,
        });
      }
    }
  }

  return signals;
}

/**
 * Detect pullback-breakout signals.
 *
 * Long pattern:  diHist positive, pulls back (decreases), then breaks above
 *                the swing high that preceded the pullback.
 * Short pattern: diHist negative, pulls back (increases toward zero), then breaks
 *                below the swing low that preceded the pullback.
 *
 * State machine:
 *   SEEKING → found a swing high/low, waiting for pullback
 *   PULLING_BACK → value reversed, tracking pullback depth
 *   Signal fires when value breaks past the prior swing extreme
 */
function detectPullbackBreakouts(
  indicatorData: { x: Date; y: number }[],
  bars: { x: Date; high: number; low: number; close: number }[]
): SignalMarker[] {
  const signals: SignalMarker[] = [];

  // --- Long side (diHist > 0) ---
  let longSwingHigh = -Infinity;
  let longPulledBack = false;

  for (let i = 2; i < indicatorData.length; i++) {
    const curr = indicatorData[i].y;
    const prev = indicatorData[i - 1].y;
    const prevPrev = indicatorData[i - 2].y;

    // Only track when in positive territory
    if (curr <= 0) {
      longSwingHigh = -Infinity;
      longPulledBack = false;
      continue;
    }

    // Detect swing high: prev was higher than both neighbors
    if (prev > prevPrev && prev > curr) {
      longSwingHigh = prev;
      longPulledBack = false;
    }

    // Detect pullback: current is lower than swing high
    if (longSwingHigh > -Infinity && curr < longSwingHigh) {
      longPulledBack = true;
    }

    // Detect breakout: pulled back, now breaking above swing high
    if (longPulledBack && curr > longSwingHigh) {
      const barDate = indicatorData[i].x;
      const bar = bars.find(b => b.x.getTime() === barDate.getTime());
      if (bar) {
        signals.push({
          x: barDate,
          y: bar.low,
          direction: SignalDirection.LONG,
          source: StIndicator.TREND_STRENGTH,
          signalType: 'pullback-breakout',
          reason: `DI breakout above ${longSwingHigh.toFixed(1)} after pullback (${curr.toFixed(1)})`,
          barIndex: i,
        });
      }
      // Reset for next pattern
      longSwingHigh = curr;
      longPulledBack = false;
    }
  }

  // --- Short side (diHist < 0) ---
  let shortSwingLow = Infinity;
  let shortPulledBack = false;

  for (let i = 2; i < indicatorData.length; i++) {
    const curr = indicatorData[i].y;
    const prev = indicatorData[i - 1].y;
    const prevPrev = indicatorData[i - 2].y;

    // Only track when in negative territory
    if (curr >= 0) {
      shortSwingLow = Infinity;
      shortPulledBack = false;
      continue;
    }

    // Detect swing low: prev was lower than both neighbors
    if (prev < prevPrev && prev < curr) {
      shortSwingLow = prev;
      shortPulledBack = false;
    }

    // Detect pullback: current is higher (closer to zero) than swing low
    if (shortSwingLow < Infinity && curr > shortSwingLow) {
      shortPulledBack = true;
    }

    // Detect breakout: pulled back, now breaking below swing low
    if (shortPulledBack && curr < shortSwingLow) {
      const barDate = indicatorData[i].x;
      const bar = bars.find(b => b.x.getTime() === barDate.getTime());
      if (bar) {
        signals.push({
          x: barDate,
          y: bar.high,
          direction: SignalDirection.SHORT,
          source: StIndicator.TREND_STRENGTH,
          signalType: 'pullback-breakout',
          reason: `DI breakdown below ${shortSwingLow.toFixed(1)} after pullback (${curr.toFixed(1)})`,
          barIndex: i,
        });
      }
      // Reset for next pattern
      shortSwingLow = curr;
      shortPulledBack = false;
    }
  }

  return signals;
}

export const detectTrendStrengthSignals: SignalDetector = (indicatorData, bars) => {
  const crossovers = detectThresholdCrossovers(indicatorData, bars);
  const breakouts = detectPullbackBreakouts(indicatorData, bars);
  return [...crossovers, ...breakouts].sort((a, b) => a.x.getTime() - b.x.getTime());
};
