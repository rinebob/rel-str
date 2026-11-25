/**
 * @topic #261 — Trading Indicator Library, Thread #1665
 * @task #1727 — SHARED: hoist signal engines + IBS filter stage
 *
 * ST Zone signal detectors — the ONE canonical implementation consumed by
 * BE signal records (st-signals), BE dotMarkers, the FE sandbox dots, and
 * (as a hand mirror under the parity audit) Pine.
 *
 * Detectors are filter-agnostic: they emit every candidate the algorithm
 * produces and know nothing about IBS. `partitionByIbs` (@st/signal-filter)
 * is the only path from candidate to emitted — a signal algo cannot bypass
 * the filter because `emitted` exists only behind the partition.
 *
 * Emission-only semantics live in the state machine itself: the uptick
 * detector consumes READY→FIRED on every candidate, so an IBS-suppressed
 * uptick cannot double-fire on the next delta (the latch happened before
 * the partition ever ran). Zero-cross has no state machine — a suppressed
 * cross simply never emits; the sign flip can't re-fire.
 */

export type ZoneSignalDirection = 'long' | 'short';

/** A detected-but-not-yet-filtered signal. `index` addresses the caller's
 *  zone array AND the same-indexed bars array handed to partitionByIbs. */
export interface ZoneSignalCandidate {
  index: number;
  direction: ZoneSignalDirection;
  signalType: string;
  reason: string;
  indicators: Record<string, number | string | null>;
  // No `ibs` field — the detector is filter-agnostic by type: `ibs` enters
  // the type graph only via `Partitioned<T>` in @st/signal-filter, attached
  // when the partition runs. A candidate can never carry a pre-set IBS.
}

/**
 * Detect all ST Trend Rider candidates across a full zone array.
 *
 * Window condition: same-timeframe zone > 0 for longs, < 0 for shorts.
 * Long candidate: zone was falling/flat while already >= +1, then upticks
 * while the window is open. Short mirrors. READY→FIRED is consumed on
 * EVERY candidate — including ones the IBS partition will suppress — so
 * suppression can never re-fire.
 *
 * @param ltfZone   - Zone values per LTF bar (V1: -3/+3, V2: -4/+4)
 * @param windowV2  - Same-timeframe zone values per bar (index-aligned;
 *                    NaN window resets state, matching historical BE truth)
 * @param version   - 'V1' or 'V2' for signal type naming
 * @param timeframe - 'D' or 'W' for signal type prefix
 */
export function detectZoneUptickCandidates(
  ltfZone: number[],
  windowV2: number[],
  version: 'V1' | 'V2',
  timeframe: 'D' | 'W',
): ZoneSignalCandidate[] {
  if (ltfZone.length < 2 || windowV2.length === 0) return [];

  const candidates: ZoneSignalCandidate[] = [];
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
          candidates.push({
            index: i,
            direction: 'long',
            signalType: `${timeframe}_ST_TREND_RIDER_${version}_LONG`,
            reason: `ST Trend Rider: ${version} zone upticked ${prevZone}→${currZone} with window zone V2 at +${currentWindowV2}`,
            indicators: {
              [`zone${version}`]: currZone,
              [`zone${version}Prev`]: prevZone,
              windowV2: currentWindowV2,
              delta,
            },
          });
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
          candidates.push({
            index: i,
            direction: 'short',
            signalType: `${timeframe}_ST_TREND_RIDER_${version}_SHORT`,
            reason: `ST Trend Rider: ${version} zone downticked ${prevZone}→${currZone} with window zone V2 at ${currentWindowV2}`,
            indicators: {
              [`zone${version}`]: currZone,
              [`zone${version}Prev`]: prevZone,
              windowV2: currentWindowV2,
              delta,
            },
          });
        }
      } else if (delta > 0) {
        shortState = 'READY';
      }
    } else {
      shortState = 'READY';
    }
  }

  return candidates;
}

/**
 * Detect all zone zero-cross candidates across a full zone array.
 *
 * Fires on every sign flip between consecutive bars — no state machine,
 * no confirmation delay. Zero is neutral (transitions to/from zero do not
 * fire). NaN breaks the sequence (no cross fabricated across a gap).
 *
 * @param ltfZone   - Zone values per LTF bar (V1: -3/+3, V2: -4/+4), NaN for null
 * @param version   - 'V1' or 'V2' for signal type naming
 * @param timeframe - 'D' or 'W' for signal type prefix
 */
export function detectZoneZeroCrossCandidates(
  ltfZone: number[],
  version: 'V1' | 'V2',
  timeframe: 'D' | 'W',
): ZoneSignalCandidate[] {
  if (ltfZone.length < 2) return [];

  const candidates: ZoneSignalCandidate[] = [];

  for (let i = 1; i < ltfZone.length; i++) {
    const prevZone = ltfZone[i - 1];
    const currZone = ltfZone[i];

    // NaN breaks the sequence (null zones from BE become NaN)
    if (Number.isNaN(prevZone) || Number.isNaN(currZone)) continue;

    // Zero is neutral — transitions to/from zero do not fire
    if (prevZone < 0 && currZone > 0) {
      candidates.push({
        index: i,
        direction: 'long',
        signalType: `${timeframe}_ST_TREND_RIDER_${version}_LONG`,
        reason: `ST Trend Rider: ${version} zone crossed zero ${prevZone}→${currZone}`,
        indicators: {
          [`zone${version}`]: currZone,
          [`zone${version}Prev`]: prevZone,
        },
      });
    } else if (prevZone > 0 && currZone < 0) {
      candidates.push({
        index: i,
        direction: 'short',
        signalType: `${timeframe}_ST_TREND_RIDER_${version}_SHORT`,
        reason: `ST Trend Rider: ${version} zone crossed zero ${prevZone}→${currZone}`,
        indicators: {
          [`zone${version}`]: currZone,
          [`zone${version}Prev`]: prevZone,
        },
      });
    }
  }

  return candidates;
}
