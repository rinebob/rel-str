/**
 * ST-Zone Multi-Timeframe Signal Detector
 *
 * Generates signals by combining higher-timeframe zone context with
 * lower-timeframe pullback/uptick patterns.
 *
 * SIGNAL RULES (V2 zone values, range -4 to +4)
 * =============================================
 *
 * WEEKLY SIGNALS (Monthly + Weekly):
 * -----------------------------------
 * Long:  Monthly zone is +3 or +4 (strong bull context)
 *        AND weekly pulls back (zone decreases for 1+ bars)
 *        AND weekly ticks up (zone increases)
 *        AND the uptick bar's zone value is > 0
 *
 * Short: Monthly zone is -3 or -4 (strong bear context)
 *        AND weekly pulls back up (zone increases for 1+ bars)
 *        AND weekly ticks down (zone decreases)
 *        AND the downtick bar's zone value is < 0
 *
 * DAILY SIGNALS (Weekly + Daily):
 * --------------------------------
 * Long:  Weekly zone is +3 or +4 (strong bull context)
 *        AND daily pulls back (zone decreases for 1+ bars)
 *        AND daily ticks up (zone increases)
 *        (no requirement for value to be above 0)
 *
 * Short: Weekly zone is -3 or -4 (strong bear context)
 *        AND daily pulls back up (zone increases for 1+ bars)
 *        AND daily ticks down (zone decreases)
 *        (no requirement for value to be below 0)
 */

import type { SignalMarker } from './signal.types';

/** Zone data point */
export interface ZoneDataPoint {
  x: Date;
  y: number;
}

/** Bar data for price placement */
export interface SignalBar {
  x: Date;
  high: number;
  low: number;
  close: number;
}

/** Configuration for MTF zone signal detection */
export interface MtfZoneSignalConfig {
  /** HTF zone threshold for long context (e.g., +3 means HTF must be >= +3) */
  htfLongThreshold: number;
  /** HTF zone threshold for short context (e.g., -3 means HTF must be <= -3) */
  htfShortThreshold: number;
  /** Whether the uptick bar value must be > 0 for longs (and < 0 for shorts) */
  requireAboveZero: boolean;
  /** Label for signal reason (e.g., 'Weekly' or 'Daily') */
  timeframeLabel: string;
  /** Label for the HTF context (e.g., 'Monthly' or 'Weekly') */
  htfLabel: string;
}

/** Preset config: Weekly signals (Monthly context + Weekly pullback) */
export const WEEKLY_SIGNAL_CONFIG: MtfZoneSignalConfig = {
  htfLongThreshold: 3,
  htfShortThreshold: -3,
  requireAboveZero: true,
  timeframeLabel: 'Weekly',
  htfLabel: 'Monthly',
};

/** Preset config: Daily signals (Weekly context + Daily pullback) */
export const DAILY_SIGNAL_CONFIG: MtfZoneSignalConfig = {
  htfLongThreshold: 3,
  htfShortThreshold: -3,
  requireAboveZero: false,
  timeframeLabel: 'Daily',
  htfLabel: 'Weekly',
};

/**
 * Detect multi-timeframe zone signals.
 *
 * @param ltfZoneData - Lower timeframe zone indicator output (e.g., weekly or daily)
 * @param htfZoneData - Higher timeframe zone indicator output (e.g., monthly or weekly)
 * @param ltfBars     - Lower timeframe price bars for signal price placement
 * @param config      - Signal detection configuration
 *
 * HTF data is matched to LTF bars by finding the most recent HTF value
 * at or before each LTF bar's date.
 */
export function detectMtfZoneSignals(
  ltfZoneData: ZoneDataPoint[],
  htfZoneData: ZoneDataPoint[],
  ltfBars: SignalBar[],
  config: MtfZoneSignalConfig,
): SignalMarker[] {
  const signals: SignalMarker[] = [];

  if (ltfZoneData.length < 3 || htfZoneData.length < 1) return signals;

  // Pre-sort HTF data by date for binary search
  const sortedHtf = [...htfZoneData].sort((a, b) => a.x.getTime() - b.x.getTime());

  // For each LTF bar, find the corresponding HTF zone value
  // (most recent HTF bar at or before the LTF bar date)
  function getHtfZone(date: Date): number | null {
    const t = date.getTime();
    let lo = 0, hi = sortedHtf.length - 1;
    let result: number | null = null;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sortedHtf[mid].x.getTime() <= t) {
        result = sortedHtf[mid].y;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return result;
  }

  // Track pullback state
  // A "pullback" for longs = zone decreased for 1+ bars before ticking up
  // A "pullback" for shorts = zone increased for 1+ bars before ticking down
  for (let i = 2; i < ltfZoneData.length; i++) {
    const prev2 = ltfZoneData[i - 2].y;
    const prev = ltfZoneData[i - 1].y;
    const curr = ltfZoneData[i].y;

    const barDate = ltfZoneData[i].x;
    const bar = ltfBars.find(b => b.x.getTime() === barDate.getTime());
    if (!bar) continue;

    const htfZone = getHtfZone(barDate);
    if (htfZone === null) continue;

    // =========== LONG SIGNAL ===========
    // HTF context: zone >= threshold (strong bull)
    // LTF pullback: prev < prev2 (pulled back at least one bar)
    // LTF uptick: curr > prev (ticking up now)
    // Optional: curr > 0
    if (htfZone >= config.htfLongThreshold) {
      const pulledBack = prev < prev2;  // Zone decreased (pullback)
      const tickedUp = curr > prev;      // Zone now increasing (uptick)
      const aboveZeroOk = !config.requireAboveZero || curr > 0;

      if (pulledBack && tickedUp && aboveZeroOk) {
        signals.push({
          x: barDate,
          y: bar.low,
          direction: 'long',
          source: 'st-zone-mtf',
          signalType: 'mtf-pullback-uptick',
          reason: `${config.htfLabel} zone ${htfZone >= 4 ? '+4' : '+3'}, ${config.timeframeLabel} pullback uptick (${prev} → ${curr})`,
          barIndex: i,
        });
      }
    }

    // =========== SHORT SIGNAL ===========
    // HTF context: zone <= threshold (strong bear)
    // LTF pullback: prev > prev2 (pulled back up at least one bar)
    // LTF downtick: curr < prev (ticking down now)
    // Optional: curr < 0
    if (htfZone <= config.htfShortThreshold) {
      const pulledBack = prev > prev2;  // Zone increased (pullback up)
      const tickedDown = curr < prev;    // Zone now decreasing (downtick)
      const belowZeroOk = !config.requireAboveZero || curr < 0;

      if (pulledBack && tickedDown && belowZeroOk) {
        signals.push({
          x: barDate,
          y: bar.high,
          direction: 'short',
          source: 'st-zone-mtf',
          signalType: 'mtf-pullback-downtick',
          reason: `${config.htfLabel} zone ${htfZone <= -4 ? '-4' : '-3'}, ${config.timeframeLabel} pullback downtick (${prev} → ${curr})`,
          barIndex: i,
        });
      }
    }
  }

  return signals;
}
