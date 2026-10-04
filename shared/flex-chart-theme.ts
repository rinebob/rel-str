/**
 * Chart Theme — flex-chart appearance palettes.
 *
 * `FlexChartConfig.appearance` selects one of these palettes. The dark palette
 * is the product default and follows the TradingView dark chrome (dark
 * surface, light axis text, subtle gridlines, teal/red candles). The light
 * palette preserves the pre-theme look: every value equals the hex/rgba that
 * was hardcoded before theming existed, so `appearance: 'light'` renders
 * bit-identically to the old chart.
 *
 * Palette slots feed two consumers:
 *  - Imperative Syncfusion config (background, axis labelStyle/lineStyle,
 *    gridline + stripLine colors, candle fills).
 *  - CSS custom properties bound on `.flex-chart-wrapper` (`--fc-*`) for the
 *    DOM overlays (crosshair lines/labels, log gutter labels, empty state).
 *
 * Per-indicator series colors are resolved separately (Task #734) — explicit
 * `IndicatorConfig.options.color` values always win over palette slots.
 */

export type ChartAppearance = 'dark' | 'light';

export interface ChartPalette {
  /** ejs-chart surface background (`[background]`). */
  background: string;
  /** Axis label text (X dates, primary Y prices, lower-pane axes). */
  axisText: string;
  /** Axis border line color. */
  axisLine: string;
  /** Major gridline color (linear primary Y + lower-pane axes). */
  gridLine: string;
  /** Log-mode gridlines — stripLines at exact log10(round-price) positions. */
  logTickLine: string;
  /** CSS only: hovered + synced crosshair lines. */
  crosshairLine: string;
  /** CSS only: crosshair date/price label pill background. */
  crosshairLabelBg: string;
  /** CSS only: crosshair label pill text. */
  crosshairLabelText: string;
  /** CSS only: log-mode gutter price labels. */
  logAxisLabel: string;
  /** Border drawn around each chart row — the visible divider between the
   *  main pane and each lower pane. */
  paneDivider: string;
  /** CSS only: empty-state / no-data message text. */
  noDataText: string;
  /** Bullish candle fill (close >= open) — teal, TradingView convention. */
  candleUp: string;
  /** Bearish candle fill (close < open) — red. */
  candleDown: string;
  /** Trend-band candle opacity — low values blend band colors toward the
   *  surface (0.7 costs ~30% brightness → mud on dark). Dark runs opaque;
   *  light keeps the legacy translucent layering. */
  bandOpacity: number;

  /** Generic indicator line color — template fallback only; an explicit
   *  `options.color` on the indicator config still wins. */
  seriesLine: string;
  /** Secondary/signal line fallback (MACD-style companion line). */
  seriesSignal: string;
  /** Column/histogram fallback. */
  seriesColumn: string;
  /** HTF (secondary) column fallback. */
  seriesColumnHtf: string;
  /** Thin connector line drawn behind scatter-dot series. */
  scatterConnector: string;
  /** Remap for hexes emitted inside indicator calculators and precomputed
   *  series data (zone scales, dot colors, band colors, ref lines, baked
   *  `options.color` defaults). Keys are the light-vocabulary hexes
   *  (lowercase); values are the appearance-appropriate replacements.
   *  Hexes with no entry pass through unchanged — the light palette leaves
   *  this empty so `appearance: 'light'` renders bit-identically. */
  colorRemap: Record<string, string>;
}

export const CHART_PALETTES: Record<ChartAppearance, ChartPalette> = {
  dark: {
    background: '#131722',
    axisText: '#b2b5be',
    axisLine: '#363c4e',
    gridLine: 'rgba(240,243,250,0.08)',
    logTickLine: 'rgba(240,243,250,0.14)',
    crosshairLine: '#758696',
    crosshairLabelBg: '#363c4e',
    crosshairLabelText: '#d1d4dc',
    logAxisLabel: '#b2b5be',
    paneDivider: '#ffffff',
    noDataText: '#787b86',
    candleUp: '#26a69a',
    candleDown: '#ef5350',
    bandOpacity: 1.0,
    seriesLine: '#3da5ff',
    seriesSignal: '#ff4081',
    seriesColumn: '#26a69a',
    seriesColumnHtf: '#4d8dff',
    scatterConnector: '#8f97a3',
    colorRemap: {
      // blues → brighter sky blues
      '#2196f3': '#3da5ff',
      '#0d47a1': '#4d8dff',
      '#1565c0': '#3da5ff',
      '#1976d2': '#3399ff',
      // reds/pinks → vivid
      '#f44336': '#ff5252',
      '#ef5350': '#ff5252',
      '#e91e63': '#ff4081',
      '#e57373': '#ff8a80',
      '#b71c1c': '#ff1744',
      // greens → neon
      '#4caf50': '#33d17a',
      '#81c784': '#69e6a3',
      '#66bb6a': '#4ade80',
      // oranges/ambers → yellows (band-up unifies on the trend-strength yellow)
      '#ff9800': '#ffeb3b',
      '#ffc107': '#ffd54f',
      '#8a6d00': '#d4b02e',
      // greys — lifted so they stay visible on the dark surface
      '#9e9e9e': '#8f97a3',
      '#757575': '#8b93a1',
      '#bdbdbd': '#a9b0ba',
      '#424242': '#6b7383',
      'rgba(158,158,158,0.5)': 'rgba(190,198,212,0.45)',
    },
  },
  light: {
    background: 'transparent',
    // Syncfusion Material theme default axis-label color.
    axisText: '#686868',
    axisLine: '#9e9e9e',
    gridLine: 'rgba(158,158,158,0.3)',
    logTickLine: 'rgba(158,158,158,0.35)',
    crosshairLine: '#000000',
    crosshairLabelBg: 'rgba(0,0,0,0.75)',
    crosshairLabelText: '#ffffff',
    logAxisLabel: '#9e9e9e',
    paneDivider: '#b5b5b5',
    noDataText: 'var(--mat-sys-on-surface-variant)',
    candleUp: '#26a69a',
    candleDown: '#ef5350',
    bandOpacity: 0.7,
    seriesLine: '#2196f3',
    seriesSignal: '#e91e63',
    seriesColumn: '#26a69a',
    seriesColumnHtf: '#0d47a1',
    scatterConnector: '#9e9e9e',
    colorRemap: {},
  },
};

/** Resolve the palette for a config appearance; dark is the product default. */
export function resolveChartPalette(appearance: ChartAppearance | undefined): ChartPalette {
  return CHART_PALETTES[appearance ?? 'dark'];
}

export interface LogTickStripLine {
  start: number;
  size: number;
  sizeType: 'Pixel';
  color: string;
  visible: boolean;
  opacity: number;
  zIndex: 'Over';
  horizontalAlignment: 'End';
  verticalAlignment: 'Middle';
}

/** StripLine configs for the log-mode price gridlines — one 1px line per
 *  round-price tick, colored by the active palette. */
export function buildLogTickStripLines(
  ticks: readonly number[],
  palette: ChartPalette,
): LogTickStripLine[] {
  return ticks.map((price) => ({
    start: price,
    size: 1,
    sizeType: 'Pixel' as const,
    color: palette.logTickLine,
    visible: true,
    opacity: 1,
    zIndex: 'Over' as const,
    horizontalAlignment: 'End' as const,
    verticalAlignment: 'Middle' as const,
  }));
}
