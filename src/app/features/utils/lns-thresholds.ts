import type { ThresholdConfig, LnsState } from '../store/thresholds.store';

export type LnsSignal = 'ENTER_LONG' | 'EXIT_LONG' | 'ENTER_SHORT' | 'EXIT_SHORT';

export interface LnsDecision {
  readonly state: LnsState;
  readonly signal?: LnsSignal;
}

/**
 * Classify a normalized RS metric into LONG / NEUTRAL / SHORT using
 * hysteresis thresholds and the **prior day's metric**.
 *
 * Signals are emitted only when crossing a threshold, not while
 * remaining inside a band.
 */
export function classifyWithHysteresis(
  prevRawMetric: number | null,
  currRawMetric: number,
  thresholds: ThresholdConfig,
): LnsDecision {
  const curr = Number.isFinite(currRawMetric)
    ? Math.max(0, Math.min(1, currRawMetric))
    : 0;

  const prev = Number.isFinite(prevRawMetric ?? NaN)
    ? Math.max(0, Math.min(1, prevRawMetric as number))
    : null;

  const {
    neutralToLong,
    longToNeutral,
    neutralToShort,
    shortToNeutral,
  } = thresholds;

  // If we don't have a prior metric, classify off today's value only.
  if (prev === null) {
    if (curr >= neutralToLong) {
      return { state: 'LONG' };
    }
    if (curr <= neutralToShort) {
      return { state: 'SHORT' };
    }
    return { state: 'NEUTRAL' };
  }

  // Derive yesterday's state using exit thresholds (hysteresis bands).
  let prevState: LnsState;
  if (prev <= shortToNeutral) {
    prevState = 'SHORT';
  } else if (prev >= longToNeutral) {
    prevState = 'LONG';
  } else {
    prevState = 'NEUTRAL';
  }

  // SHORT band crossovers
  if (prevState === 'SHORT') {
    // Case 3: yesterday below S→N, today above N→L -> exit short + enter long
    if (prev < shortToNeutral && curr >= neutralToLong) {
      return { state: 'LONG', signal: 'ENTER_LONG' };
    }

    // Case 1: yesterday below S→N, today between S→N and N→L -> exit short
    if (prev < shortToNeutral && curr > shortToNeutral && curr < neutralToLong) {
      return { state: 'NEUTRAL', signal: 'EXIT_SHORT' };
    }

    // Otherwise, still short (no crossover into neutral or long)
    if (curr <= shortToNeutral) {
      return { state: 'SHORT' };
    }

    // Fallback: treat as neutral if we somehow land strictly inside the middle
    return { state: 'NEUTRAL' };
  }

  // LONG band crossovers
  if (prevState === 'LONG') {
    // Case 6: yesterday above L→N, today below N→S -> exit long + enter short
    if (prev > longToNeutral && curr <= neutralToShort) {
      return { state: 'SHORT', signal: 'ENTER_SHORT' };
    }

    // Case 4: yesterday above L→N, today between N→S and L→N -> exit long
    if (prev > longToNeutral && curr < longToNeutral && curr > neutralToShort) {
      return { state: 'NEUTRAL', signal: 'EXIT_LONG' };
    }

    // Otherwise, still long (no crossover into neutral or short)
    if (curr >= longToNeutral) {
      return { state: 'LONG' };
    }

    // Fallback: treat as neutral if we somehow land strictly inside the middle
    return { state: 'NEUTRAL' };
  }

  // NEUTRAL band crossovers (prevState === 'NEUTRAL')

  // Case 2: yesterday between S→N and N→L, today above N→L -> enter long
  if (prev >= shortToNeutral && prev < neutralToLong && curr >= neutralToLong) {
    return { state: 'LONG', signal: 'ENTER_LONG' };
  }

  // Case 5: yesterday between L→N and N→S, today below N→S -> enter short
  if (prev <= longToNeutral && prev > neutralToShort && curr <= neutralToShort) {
    return { state: 'SHORT', signal: 'ENTER_SHORT' };
  }

  // Otherwise remain neutral.
  return { state: 'NEUTRAL' };
}

/**
 * Map L/N/S state to a discrete palette index for 3-band palettes.
 *
 * Index convention:
 *   0 -> SHORT
 *   1 -> NEUTRAL
 *   2 -> LONG
 */
export function stateToDiscreteIndex(state: LnsState): number {
  switch (state) {
    case 'SHORT':
      return 0;
    case 'NEUTRAL':
      return 1;
    case 'LONG':
    default:
      return 2;
  }
}
