/**
 * RH Agent Chart Indicators — Derived extras signals
 *
 * Computed signal factory for RH Agent chart extras (HTF windows, signal dots,
 * uptick dots). This is the only module in this directory that depends on Angular
 * signals; the conversion helpers underneath it are pure functions.
 */
import { computed, Signal } from '@angular/core';
import { ChartIntervalKey } from '../../../../features/shared/components/flex-chart/flex-chart.types';
import type { IntervalData } from '../../common/rh-agent-indicator.types';
import type { ChartScatterPoint } from './base-indicators';
import {
  convertHtfWindowData,
  convertTrendStrengthDotMarkers,
  convertZoneDotMarkers,
} from './signal-marker-converters';

/** Derived signal bundle for RH Agent chart extras (HTF windows, signal dots, uptick dots). */
export interface RhAgentExtrasSignals {
  windowDataWeeklyOnDaily: Signal<ChartScatterPoint[]>;
  windowDataMonthlyOnWeekly: Signal<ChartScatterPoint[]>;
  dailySignalDots: Signal<ChartScatterPoint[]>;
  weeklySignalDots: Signal<ChartScatterPoint[]>;
  dailyUptickDotsV1: Signal<ChartScatterPoint[]>;
  dailyUptickDotsV2: Signal<ChartScatterPoint[]>;
  weeklyUptickDotsV1: Signal<ChartScatterPoint[]>;
  weeklyUptickDotsV2: Signal<ChartScatterPoint[]>;
}

/**
 * Create the derived computed signals for RH Agent chart extras.
 * Centralizes the daily→weekly and weekly→monthly HTF window relationships so
 * signal-detail and quick-charts don't duplicate the same eight computed signals.
 */
export function createRhAgentExtrasSignals(
  dailyIntervalData: Signal<IntervalData | undefined>,
  weeklyIntervalData: Signal<IntervalData | undefined>,
): RhAgentExtrasSignals {
  return {
    windowDataWeeklyOnDaily: computed(() =>
      convertHtfWindowData(dailyIntervalData(), ChartIntervalKey.WEEKLY)),
    windowDataMonthlyOnWeekly: computed(() =>
      convertHtfWindowData(weeklyIntervalData(), ChartIntervalKey.MONTHLY)),
    dailySignalDots: computed(() => convertTrendStrengthDotMarkers(dailyIntervalData())),
    weeklySignalDots: computed(() => convertTrendStrengthDotMarkers(weeklyIntervalData())),
    dailyUptickDotsV1: computed(() => convertZoneDotMarkers(dailyIntervalData(), true)),
    dailyUptickDotsV2: computed(() => convertZoneDotMarkers(dailyIntervalData(), false)),
    weeklyUptickDotsV1: computed(() => convertZoneDotMarkers(weeklyIntervalData(), true)),
    weeklyUptickDotsV2: computed(() => convertZoneDotMarkers(weeklyIntervalData(), false)),
  };
}
