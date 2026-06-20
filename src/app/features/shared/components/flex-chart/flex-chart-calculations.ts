/**
 * Flex Chart Calculations
 *
 * Thin dispatcher that routes indicator computation to individual indicator files.
 * All calculation logic lives in indicators/*.indicator.ts — this file only
 * orchestrates and groups results.
 */

import type { PriceBar, ComputedIndicatorSeries, IndicatorConfig } from './flex-chart.types';
import { indicatorCalculators } from './indicators/indicator-registry';

/** Compute all indicators for a given configuration */
export function computeIndicators(
  bars: PriceBar[],
  configs: IndicatorConfig[]
): ComputedIndicatorSeries[] {
  return configs.map((config) => {
    // If pre-calculated data is provided, use it
    if (config.data && config.data.length > 0) {
      return { id: config.id, config, data: config.data };
    }

    // Otherwise calculate from bars
    const calculator = indicatorCalculators[config.type];
    if (!calculator) {
      console.warn(`[FlexChart] No calculator for indicator type: ${config.type}`);
      return { id: config.id, config, data: [] };
    }

    const data = calculator(bars, config.params);
    return { id: config.id, config, data };
  });
}

/** Group indicators by pane */
export function groupIndicatorsByPane(
  series: ComputedIndicatorSeries[]
): Record<string, ComputedIndicatorSeries[]> {
  const grouped: Record<string, ComputedIndicatorSeries[]> = {};

  for (const s of series) {
    // 'overlay' indicators render on the main price pane
    const pane = s.config.pane === 'overlay' ? 'main' : s.config.pane;
    if (!grouped[pane]) {
      grouped[pane] = [];
    }
    grouped[pane].push(s);
  }

  return grouped;
}
