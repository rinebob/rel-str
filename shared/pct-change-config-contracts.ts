/**
 * Shared contracts for the pct change config feature.
 *
 * Consumed by both FE (config service, store, components) and BE (Firestore
 * rules reference the path structure). PctChangeFilter lives in the FE utils
 * since BE only writes security rules and does not need the filter type.
 */
import { OptionType } from './options-common';

export { OptionType } from './options-common';

/** How target dates are determined. */
export type TargetType = 'pct-change' | 'swing-extremes' | 'user-dates';

/** Sub-mode for pct-change target type. */
export type PctMode = 'list' | 'gradation';

/** Sub-mode for user-dates target type. */
export type UserDatesMode = 'manual' | 'interval';

/** Direction for gradation pct-change mode. */
export type PctDirection = 'up' | 'down';

/** Request to resolve target dates from percentage moves (list or gradation). */
export interface ResolvePctChangeRequest {
  mode: PctMode;
  values: number[];
  step?: number;
  count?: number;
  direction?: PctDirection;
}

/**
 * Filter applied to matched contracts before building the grid.
 * Shared between FE utils and config docs.
 */
export interface PctChangeFilter {
  type: OptionType;
  durationGteDays?: number;
  durationLteDays?: number;
  strikeGte?: number;
  strikeLte?: number;
  deltaGte?: number;
  deltaLte?: number;
}

/**
 * Persisted pct change config document.
 * Stored at: configs/option-chain-pct-change/configs/{configId}
 * Doc ID: {symbol}-{startDate}-{numberOfTargets}-{targetType}-{uid}
 */
export interface PctChangeConfigDoc {
  symbol: string;
  startDate: string;          // YYYY-MM-DD
  type: OptionType;          // call or put
  targetType: TargetType;
  targetDates: string[];     // resolved dates (YYYY-MM-DD)

  // pct-change mode
  pctMode?: PctMode;
  pctValues?: number[];      // list mode: [-3, 5, 10]
  pctStep?: number;          // gradation mode: 5
  pctCount?: number;         // gradation mode: 4
  pctDirection?: PctDirection;

  // swing-extremes mode
  zigzagDeviation?: number;
  zigzagDepth?: number;
  zigzagBackstep?: number;
  swingCount?: number;

  // user-dates mode
  userDatesMode?: UserDatesMode;
  intervalCount?: number;
  intervalDays?: number;

  // filters
  filter: PctChangeFilter;
}
