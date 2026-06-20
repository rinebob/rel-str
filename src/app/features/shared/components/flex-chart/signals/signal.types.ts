/**
 * Signal Types
 *
 * Types for trade signal detection from indicator data.
 * Signals are actionable markers (long/short entries) derived from
 * indicator calculations. Indicators produce numbers; signal detectors
 * produce trading markers.
 */

/** Signal direction */
export type SignalDirection = 'long' | 'short';

/** Signal source identifier */
export type SignalSource = 'st-zone' | 'st-trend-strength';

/** Signal sub-type for trend-strength signals */
export type TrendStrengthSignalType =
  | 'cross-minus-10'   // Crosses -10 threshold
  | 'cross-zero'       // Crosses zero line
  | 'cross-plus-10'    // Crosses +10 threshold
  | 'pullback-breakout'; // Pullback then breakout

/** A detected signal marker to render on the chart */
export interface SignalMarker {
  /** Bar date */
  x: Date;

  /** Price level for marker placement (bar high for long, bar low for short) */
  y: number;

  /** Long or short */
  direction: SignalDirection;

  /** Which indicator produced this signal */
  source: SignalSource;

  /** Sub-type describing the specific pattern */
  signalType: string;

  /** Human-readable reason */
  reason: string;

  /** Bar index in the source data array */
  barIndex: number;
}

/** Signal detector function signature */
export type SignalDetector = (
  indicatorData: { x: Date; y: number }[],
  bars: { x: Date; high: number; low: number; close: number }[]
) => SignalMarker[];
