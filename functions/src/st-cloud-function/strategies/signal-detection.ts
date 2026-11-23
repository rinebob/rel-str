/**
 * Signal Detection Utilities
 *
 * Shared state machines used by ST strategies to detect actionable signals on the
 * last bar. These functions are strategy-agnostic and can be reused by future
 * strategies that operate on zone/indicator transitions.
 */
import { computeIbs } from '@st/ibs';
import type { IbsAvailabilityContext } from '@st/ibs';
import { StSignalDirection } from '../signals';
import type { OHLCV } from './base-strategy';

export interface ZoneSignal {
  action: StSignalDirection;
  signalType: string;
  reason: string;
  index?: number;
  indicators: Record<string, number | string | null>;
}

/**
 * Run the ST Trend Rider state machine on a zone array.
 * Only fires if the LAST bar is the signal bar.
 *
 * Delegates to detectAllStTrendRiderSignals so the worker and the callable use
 * the exact same state machine. The windowV2 argument is the same-timeframe
 * zone context for ST Trend Rider, but the parameter is kept so future strategies
 * can supply a true higher-timeframe window if needed.
 *
 * @param ltfZone   - Zone values per LTF bar (V1: -3/+3, V2: -4/+4)
 * @param ltfBars   - LTF OHLCV bars (for date alignment)
 * @param windowV2  - Zone V2 window context per LTF bar
 * @param version   - 'V1' or 'V2' for signal type naming
 * @param timeframe - 'D' or 'W' for signal type prefix
 * @param ibs       - optional IBS gate — see detectAllStTrendRiderSignals
 */
export function detectLastBarSignals(
  ltfZone: number[],
  ltfBars: OHLCV[],
  windowV2: number[],
  version: 'V1' | 'V2',
  timeframe: 'D' | 'W',
  ibs?: IbsGateConfig,
): ZoneSignal | null {
  if (ltfZone.length < 2 || windowV2.length === 0) return null;

  const signals = detectAllStTrendRiderSignals(ltfZone, windowV2, ltfBars, version, timeframe, ibs);
  const lastSignal = signals.find(s => s.index === ltfZone.length - 1);
  if (!lastSignal) return null;

  // Drop the internal index; callers expect the classic ZoneSignal shape.
  const { index: _index, ...rest } = lastSignal;
  return rest;
}

/**
 * Optional IBS gate config for the ST Trend Rider confirmation machine.
 * Passing `{}` gates at defaults; omitting the param leaves detection
 * unfiltered (the single gate — callers must not also filter upstream).
 */
export interface IbsGateConfig extends IbsAvailabilityContext {
  /** Long bound = T, short bound = 1 − T (both inclusive). Default 0.5. */
  threshold?: number;
}

/** IBS of `bar`, or `undefined` when IBS can't gate (young bar or missing/non-finite OHLC). */
function barIbs(bar: OHLCV | undefined, timeframe: 'D' | 'W', cfg?: IbsGateConfig): number | undefined {
  if (!bar) return undefined;
  const high = bar.high ?? bar.h;
  const low = bar.low ?? bar.l;
  const close = bar.close ?? bar.c;
  if (
    typeof high !== 'number' || typeof low !== 'number' || typeof close !== 'number' ||
    !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)
  ) {
    return undefined;
  }
  const date = bar.date ?? bar.d ?? bar.t;
  return computeIbs(
    { high, low, close, date: typeof date === 'string' ? date : undefined },
    timeframe,
    { now: cfg?.now, activateAtEtMin: cfg?.activateAtEtMin, activateAtWeekday: cfg?.activateAtWeekday },
  );
}

/**
 * Detect all ST Trend Rider signals across a full zone array.
 *
 * Window condition: same-timeframe zone > 0 for longs, < 0 for shorts.
 * Long signal: zone was falling/flat while already >= +1, then upticks (>= 1) while zone > 0.
 * Short signal: zone was rising/flat while already <= -1, then downticks (>= 1) while zone < 0.
 *
 * @param ltfZone   - Zone values per LTF bar (V1: -3/+3, V2: -4/+4)
 * @param windowV2  - Same-timeframe zone values per bar
 * @param ltfBars   - LTF OHLCV bars (for date alignment)
 * @param version   - 'V1' or 'V2' for signal type naming
 * @param timeframe - 'D' or 'W' for signal type prefix
 * @param ibs       - optional IBS gate: suppresses emission on bars whose close
 *                    sits in the wrong half of the range (long needs IBS ≥ T,
 *                    short needs IBS ≤ 1−T). Suppression is emission-only — the
 *                    READY→FIRED transition still happens so a suppressed uptick
 *                    can't double-fire on the same swing. `undefined` IBS
 *                    (young bar / missing OHLC) lets the signal through.
 */
export function detectAllStTrendRiderSignals(
  ltfZone: number[],
  windowV2: number[],
  ltfBars: OHLCV[],
  version: 'V1' | 'V2',
  timeframe: 'D' | 'W',
  ibs?: IbsGateConfig,
): ZoneSignal[] {
  if (ltfZone.length < 2 || windowV2.length === 0) return [];

  const ibsThreshold = ibs?.threshold ?? 0.5;

  const signals: ZoneSignal[] = [];
  let longState: 'READY' | 'FIRED' = 'READY';
  let shortState: 'READY' | 'FIRED' = 'READY';

  // Skip leading zeros (indicator warm-up)
  let start = 0;
  while (start < ltfZone.length && ltfZone[start] === 0) start++;
  if (start >= ltfZone.length - 1) return [];

  for (let i = start + 1; i < ltfZone.length; i++) {
    const prevZone = ltfZone[i - 1];
    const currZone = ltfZone[i];
    const delta = currZone - prevZone;
    const currentWindowV2 = windowV2[i];

    // --- Long side (Zone V2 > 0) ---
    if (currentWindowV2 > 0) {
      if (delta > 0) {
        // Only valid if the prior zone was already above zero (>= +1)
        if (longState === 'READY' && prevZone >= 1) {
          longState = 'FIRED';
          const ibsValue = barIbs(ltfBars[i], timeframe, ibs);
          if (ibs === undefined || ibsValue === undefined || ibsValue >= ibsThreshold) {
            signals.push({
              action: StSignalDirection.LONG,
              signalType: `${timeframe}_ST_TREND_RIDER_${version}_LONG`,
              reason: `ST Trend Rider: ${version} zone upticked ${prevZone}→${currZone} with window zone V2 at +${currentWindowV2}`,
              index: i,
              indicators: {
                [`zone${version}`]: currZone,
                [`zone${version}Prev`]: prevZone,
                windowV2: currentWindowV2,
                delta,
                ibs: ibsValue ?? null,
              },
            });
          }
        }
      } else if (delta < 0) {
        longState = 'READY';
      }
    } else {
      longState = 'READY';
    }

    // --- Short side (Zone V2 < 0) ---
    if (currentWindowV2 < 0) {
      if (delta < 0) {
        // Only valid if the prior zone was already below zero (<= -1)
        if (shortState === 'READY' && prevZone <= -1) {
          shortState = 'FIRED';
          const ibsValue = barIbs(ltfBars[i], timeframe, ibs);
          // +EPSILON keeps the inclusive bound honest for T where 1−T rounds a
          // ulp below the mathematical bound (e.g. T=0.15 → 0.8499999999999999).
          if (ibs === undefined || ibsValue === undefined || ibsValue <= 1 - ibsThreshold + Number.EPSILON) {
            signals.push({
              action: StSignalDirection.SHORT,
              signalType: `${timeframe}_ST_TREND_RIDER_${version}_SHORT`,
              reason: `ST Trend Rider: ${version} zone downticked ${prevZone}→${currZone} with window zone V2 at ${currentWindowV2}`,
              index: i,
              indicators: {
                [`zone${version}`]: currZone,
                [`zone${version}Prev`]: prevZone,
                windowV2: currentWindowV2,
                delta,
                ibs: ibsValue ?? null,
              },
            });
          }
        }
      } else if (delta > 0) {
        shortState = 'READY';
      }
    } else {
      shortState = 'READY';
    }
  }

  return signals;
}

/**
 * Detect all zone zero-cross signals across a full zone array.
 *
 * Fires on every sign flip between consecutive bars — no state machine gate,
 * no confirmation delay. Zero is neutral (transitions to/from zero do not
 * fire). NaN breaks the sequence (no cross fabricated across a gap).
 *
 * @param ltfZone   - Zone values per LTF bar (V1: -3/+3, V2: -4/+4), NaN for null
 * @param ltfBars   - LTF OHLCV bars (for date alignment)
 * @param version   - 'V1' or 'V2' for signal type naming
 * @param timeframe - 'D' or 'W' for signal type prefix
 */
export function detectAllZoneZeroCrossSignals(
  ltfZone: number[],
  ltfBars: OHLCV[],
  version: 'V1' | 'V2',
  timeframe: 'D' | 'W',
): ZoneSignal[] {
  if (ltfZone.length < 2) return [];

  const signals: ZoneSignal[] = [];

  for (let i = 1; i < ltfZone.length; i++) {
    const prevZone = ltfZone[i - 1];
    const currZone = ltfZone[i];

    // NaN breaks the sequence (null zones from BE become NaN)
    if (Number.isNaN(prevZone) || Number.isNaN(currZone)) continue;

    // Zero is neutral — transitions to/from zero do not fire
    if (prevZone < 0 && currZone > 0) {
      signals.push({
        action: StSignalDirection.LONG,
        signalType: `${timeframe}_ST_TREND_RIDER_${version}_LONG`,
        reason: `ST Trend Rider: ${version} zone crossed zero ${prevZone}→${currZone}`,
        index: i,
        indicators: {
          [`zone${version}`]: currZone,
          [`zone${version}Prev`]: prevZone,
        },
      });
    } else if (prevZone > 0 && currZone < 0) {
      signals.push({
        action: StSignalDirection.SHORT,
        signalType: `${timeframe}_ST_TREND_RIDER_${version}_SHORT`,
        reason: `ST Trend Rider: ${version} zone crossed zero ${prevZone}→${currZone}`,
        index: i,
        indicators: {
          [`zone${version}`]: currZone,
          [`zone${version}Prev`]: prevZone,
        },
      });
    }
  }

  return signals;
}
