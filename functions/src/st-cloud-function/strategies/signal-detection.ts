/**
 * Signal Detection — BE emitter layer.
 *
 * The canonical detection + filter engines live in shared/ (#1727 —
 * one body, consumed identically by BE records, BE dotMarkers, and the
 * FE sandbox). This module only shapes shared `ZoneSignalCandidate`s into
 * the `ZoneSignal` records the strategy and marker paths persist:
 * direction → StSignalDirection, candidate.indicators → indicators, and
 * the partition-attached `ibs` into `indicators.ibs`.
 *
 * Detection state machines: @st/signal-detect (filter-agnostic).
 * Emitted/suppressed partition: @st/signal-filter (the only emit path).
 */
import { detectZoneUptickCandidates, detectZoneZeroCrossCandidates } from '@st/signal-detect';
import type { ZoneSignalCandidate } from '@st/signal-detect';
import { partitionByIbs } from '@st/signal-filter';
import type { IbsFilterContext, Partitioned } from '@st/signal-filter';
import { StSignalDirection } from '../signals';
import type { OHLCV } from './base-strategy';

export type { IbsFilterContext };

export interface ZoneSignal {
  action: StSignalDirection;
  signalType: string;
  reason: string;
  index?: number;
  indicators: Record<string, number | string | null>;
}

function toZoneSignal(c: Partitioned<ZoneSignalCandidate>): ZoneSignal {
  return {
    action: c.direction === 'long' ? StSignalDirection.LONG : StSignalDirection.SHORT,
    signalType: c.signalType,
    reason: c.reason,
    index: c.index,
    indicators: { ...c.indicators, ibs: c.ibs },
  };
}

/**
 * Run the ST Trend Rider state machine on a zone array.
 * Only fires if the LAST bar is the signal bar.
 *
 * Delegates to the shared detect + partition (@st/signal-detect,
 * @st/signal-filter) so the worker, the callable, the marker path, and
 * the FE sandbox all run the exact same engine. The windowV2 argument is
 * the same-timeframe zone context for ST Trend Rider, but the parameter
 * is kept so future strategies can supply a true higher-timeframe window
 * if needed.
 *
 * @param ltfZone   - Zone values per LTF bar (V1: -3/+3, V2: -4/+4)
 * @param windowV2  - Zone V2 window context per LTF bar
 * @param ltfBars   - LTF OHLCV bars — index-aligned with ltfZone; the
 *                    partition reads the signal bar's IBS from them
 * @param version   - 'V1' or 'V2' for signal type naming
 * @param timeframe - 'D' or 'W' for signal type prefix
 * @param ibs       - optional IBS filter — see detectAllStTrendRiderSignals
 */
export function detectLastBarSignals(
  ltfZone: number[],
  windowV2: number[],
  ltfBars: OHLCV[],
  version: 'V1' | 'V2',
  timeframe: 'D' | 'W',
  ibs?: IbsFilterContext,
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
 * Detect all ST Trend Rider signals across a full zone array, filtered by
 * the shared IBS partition.
 *
 * Window condition: same-timeframe zone > 0 for longs, < 0 for shorts.
 * Long signal: zone was falling/flat while already >= +1, then upticks (>= 1)
 * while zone > 0. Short mirrors.
 *
 * @param ltfZone   - Zone values per LTF bar (V1: -3/+3, V2: -4/+4)
 * @param windowV2  - Same-timeframe zone values per bar
 * @param ltfBars   - LTF OHLCV bars — index-aligned with ltfZone
 * @param version   - 'V1' or 'V2' for signal type naming
 * @param timeframe - 'D' or 'W' for signal type prefix
 * @param ibs       - optional IBS filter: suppresses emission on bars whose
 *                    close sits in the wrong half of the range (long needs
 *                    IBS ≥ T, short ≤ 1−T). Suppression is emission-only —
 *                    the READY→FIRED transition already happened inside the
 *                    detector so a suppressed uptick can't double-fire.
 *                    `undefined` IBS (young bar / missing OHLC) lets the
 *                    signal through; omit `ibs` for the unfiltered set.
 */
export function detectAllStTrendRiderSignals(
  ltfZone: number[],
  windowV2: number[],
  ltfBars: OHLCV[],
  version: 'V1' | 'V2',
  timeframe: 'D' | 'W',
  ibs?: IbsFilterContext,
): ZoneSignal[] {
  return emitZoneSignals(detectZoneUptickCandidates(ltfZone, windowV2, version, timeframe), ltfBars, timeframe, ibs);
}

/**
 * Detect all zone zero-cross signals across a full zone array.
 *
 * Fires on every sign flip between consecutive bars — no state machine,
 * no confirmation delay. Zero is neutral (transitions to/from zero do not
 * fire). NaN breaks the sequence (no cross fabricated across a gap).
 *
 * @param ltfZone   - Zone values per LTF bar (V1: -3/+3, V2: -4/+4), NaN for null
 * @param ltfBars   - LTF OHLCV bars — index-aligned with ltfZone
 * @param version   - 'V1' or 'V2' for signal type naming
 * @param timeframe - 'D' or 'W' for signal type prefix
 * @param ibs       - optional IBS filter (same semantics as the uptick path)
 */
export function detectAllZoneZeroCrossSignals(
  ltfZone: number[],
  ltfBars: OHLCV[],
  version: 'V1' | 'V2',
  timeframe: 'D' | 'W',
  ibs?: IbsFilterContext,
): ZoneSignal[] {
  return emitZoneSignals(detectZoneZeroCrossCandidates(ltfZone, version, timeframe), ltfBars, timeframe, ibs);
}

/**
 * The one emit composition every detector's output flows through:
 * partition by IBS, shape emitted candidates into ZoneSignal records.
 * New algos add a detector in shared/ + one line here.
 */
function emitZoneSignals(
  candidates: ZoneSignalCandidate[],
  ltfBars: OHLCV[],
  timeframe: 'D' | 'W',
  ibs?: IbsFilterContext,
): ZoneSignal[] {
  return partitionByIbs(candidates, ltfBars, timeframe, ibs).emitted.map(toZoneSignal);
}
