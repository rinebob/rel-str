import { RsDirection } from '../types/signal.types';

export interface DailySignalDetection {
  open?: { direction: RsDirection };
  close?: { direction: RsDirection };
}

export interface DailySignalThresholds {
  openLong: number;
  closeLong: number;
  openShort: number;
  closeShort: number;
}

/**
 * Pure detector for daily RS-based open/close signals for a single pair/day.
 * Uses yesterday vs today RS and per-direction thresholds.
 * Enforces close-then-open ordering at the CALL SITE (consumer should process close before open).
 */
export function detectDailySignalsForPairDay(
  rsYesterday: number,
  rsToday: number,
  thresholds: DailySignalThresholds,
): DailySignalDetection {
  const { openLong, closeLong, openShort, closeShort } = thresholds;

  const crossedOpenLong = rsYesterday < openLong && rsToday >= openLong;
  const crossedCloseLong = rsYesterday >= closeLong && rsToday < closeLong;

  const crossedOpenShort = rsYesterday > openShort && rsToday <= openShort;
  const crossedCloseShort = rsYesterday <= closeShort && rsToday > closeShort;

  const result: DailySignalDetection = {};

  if (crossedCloseLong) {
    result.close = { direction: RsDirection.LONG };
  } else if (crossedCloseShort) {
    result.close = { direction: RsDirection.SHORT };
  }

  if (crossedOpenLong) {
    result.open = { direction: RsDirection.LONG };
  } else if (crossedOpenShort) {
    result.open = { direction: RsDirection.SHORT };
  }

  return result;
}
