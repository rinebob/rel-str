/**
 * ST-Zone Signal Detector
 *
 * Detects actionable trade signals from ST-Zone indicator data.
 *
 * SIGNAL RULES
 * ------------
 * Long entry:  Zone value increases from one bar to the next
 *              (e.g., -3→-2, -2→-1, 0→+1, +2→+3)
 * Short entry: Zone value decreases from one bar to the next
 *              (e.g., +3→+2, +2→+1, 0→-1, -2→-3)
 *
 * No trend filtering — pure zone transitions.
 */

import type { SignalMarker, SignalDetector } from './signal.types';
import { StIndicator } from '../flex-chart.types';

const ZONE_LABELS: Record<number, string> = {
  [-3]: '-3 (Strong Bear)',
  [-2]: '-2 (Moderate Bear)',
  [-1]: '-1 (Mild Bear)',
  0: '0 (Neutral)',
  1: '+1 (Mild Bull)',
  2: '+2 (Moderate Bull)',
  3: '+3 (Strong Bull)',
};

function zoneLabel(zone: number): string {
  return ZONE_LABELS[zone] ?? String(zone);
}

export const detectZoneSignals: SignalDetector = (indicatorData, bars) => {
  const signals: SignalMarker[] = [];

  for (let i = 1; i < indicatorData.length; i++) {
    const prevZone = indicatorData[i - 1].y;
    const currZone = indicatorData[i].y;

    if (currZone === prevZone) continue;

    // Find corresponding bar for price placement
    const barDate = indicatorData[i].x;
    const bar = bars.find(b => b.x.getTime() === barDate.getTime());
    if (!bar) continue;

    if (currZone > prevZone) {
      // Zone increased → long signal
      signals.push({
        x: barDate,
        y: bar.low,
        direction: 'long',
        source: StIndicator.ZONE,
        signalType: 'zone-up',
        reason: `Zone ${zoneLabel(prevZone)} → ${zoneLabel(currZone)}`,
        barIndex: i,
      });
    } else {
      // Zone decreased → short signal
      signals.push({
        x: barDate,
        y: bar.high,
        direction: 'short',
        source: StIndicator.ZONE,
        signalType: 'zone-down',
        reason: `Zone ${zoneLabel(prevZone)} → ${zoneLabel(currZone)}`,
        barIndex: i,
      });
    }
  }

  return signals;
};
