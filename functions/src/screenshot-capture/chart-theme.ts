/**
 * Screenshot chart palette — the shared dark palette
 * (`shared/flex-chart-theme.ts`, `@flex-chart/theme`) plus capture-only
 * additions. One canonical source is consumed by both the FE flex-chart
 * component and this renderer, so palette drift is impossible by
 * construction.
 */

import { CHART_PALETTES } from '@flex-chart/theme';
import type { ChartPalette } from '@flex-chart/theme';

export type ScreenshotPalette = ChartPalette;

export const SCREENSHOT_DARK_PALETTE: ScreenshotPalette = CHART_PALETTES.dark;

/** Capture-only color — has no FE counterpart. Marks the lifecycle-event bar. */
export const EVENT_MARKER_COLOR = '#ffb300';

/** Remap a light-vocabulary series color through the dark palette — the
 *  `ChartDataAdapter.themeColor` equivalent. Unknown colors pass through. */
export function remapSeriesColor(color: string): string {
  return SCREENSHOT_DARK_PALETTE.colorRemap[color.toLowerCase()] ?? color;
}
