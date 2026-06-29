/**
 * Signal Detection Utilities
 *
 * Shared state machines used by ST strategies to detect actionable signals on the
 * last bar. These functions are strategy-agnostic and can be reused by future
 * strategies that operate on zone/indicator transitions.
 */
import { StSignalDirection } from '../rh-agent-config';
import type { OHLCV } from './base-strategy';

export interface ZoneSignal {
  action: StSignalDirection;
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
export function detectLastBarSignals(
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
            action: StSignalDirection.LONG,
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
            action: StSignalDirection.SHORT,
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
