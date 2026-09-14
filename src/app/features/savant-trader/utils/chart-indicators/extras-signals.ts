/**
 * Savant Trader Chart Indicators — Derived extras signals
 *
 * Computed signal factory for Savant Trader chart extras (HTF windows, signal dots,
 * uptick dots, zero-cross dots). This is the only module in this directory that depends on Angular
 * signals; the conversion helpers underneath it are pure functions.
 */
import { computed, Signal } from '@angular/core';
import { ChartIntervalKey } from '../../../../features/shared/components/flex-chart/flex-chart.types';
import type { PriceBar } from '../../../../features/shared/components/flex-chart/flex-chart.types';
import type { IntervalData } from '../../common/indicator.types';
import type { ChartScatterPoint } from './base-indicators';
import {
  computeZeroCrossDots,
  convertHtfWindowData,
  convertTrendStrengthDotMarkers,
  convertZoneDotMarkers,
} from './signal-marker-converters';

/** Derived signal bundle for Savant Trader chart extras (HTF windows, signal dots, uptick dots, zero-cross dots). */
export interface ExtrasSignals {
  windowDataWeeklyOnDaily: Signal<ChartScatterPoint[]>;
  windowDataMonthlyOnWeekly: Signal<ChartScatterPoint[]>;
  dailySignalDots: Signal<ChartScatterPoint[]>;
  weeklySignalDots: Signal<ChartScatterPoint[]>;
  dailyUptickDotsV1: Signal<ChartScatterPoint[]>;
  dailyUptickDotsV2: Signal<ChartScatterPoint[]>;
  weeklyUptickDotsV1: Signal<ChartScatterPoint[]>;
  weeklyUptickDotsV2: Signal<ChartScatterPoint[]>;
  dailyZeroCrossDotsV1: Signal<ChartScatterPoint[]>;
  dailyZeroCrossDotsV2: Signal<ChartScatterPoint[]>;
  weeklyZeroCrossDotsV1: Signal<ChartScatterPoint[]>;
  weeklyZeroCrossDotsV2: Signal<ChartScatterPoint[]>;
}

/**
 * Create the derived computed signals for Savant Trader chart extras.
 * Centralizes the daily→weekly and weekly→monthly HTF window relationships so
 * signal-detail and quick-charts don't duplicate the same computed signals.
 *
 * @param dailyIntervalData  - Signal for daily interval data
 * @param weeklyIntervalData  - Signal for weekly interval data
 * @param dailyBars           - Signal for daily price bars (for zero-cross ATR placement)
 * @param weeklyBars          - Signal for weekly price bars (for zero-cross ATR placement)
 */
export function createExtrasSignals(
  dailyIntervalData: Signal<IntervalData | undefined>,
  weeklyIntervalData: Signal<IntervalData | undefined>,
  dailyBars: Signal<PriceBar[] | undefined>,
  weeklyBars: Signal<PriceBar[] | undefined>,
): ExtrasSignals {
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
    dailyZeroCrossDotsV1: computed(() => computeZeroCrossDots(dailyIntervalData(), dailyBars() ?? [], true)),
    dailyZeroCrossDotsV2: computed(() => computeZeroCrossDots(dailyIntervalData(), dailyBars() ?? [], false)),
    weeklyZeroCrossDotsV1: computed(() => computeZeroCrossDots(weeklyIntervalData(), weeklyBars() ?? [], true)),
    weeklyZeroCrossDotsV2: computed(() => computeZeroCrossDots(weeklyIntervalData(), weeklyBars() ?? [], false)),
  };
}
