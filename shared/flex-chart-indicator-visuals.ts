/**
 * ST indicator visual vocabulary — the canonical colors, axis bounds, and
 * reference lines the flex-chart indicators and the server-side screenshot
 * assembler (Topic #746) must agree on.
 *
 * Canonical home for values that were previously duplicated as literals in
 * the FE indicator files (indicator-converters, st-zone-v2, st-trend-
 * strength, st-std-dev-lines, signal-marker-converters) and the
 * screenshot assembler. FE files import from here (alias
 * `@flex-chart/indicator-visuals`); the functions assembler imports the same
 * module — parity is structural, not comment-pinned.
 *
 * NOTE: `st-zone.indicator.ts` (the local V1 calculator) deliberately uses a
 * DIFFERENT ±3 color table — it predates the callable-path ±4 table and is
 * a real FE inconsistency. Only the ±4 table (converter + V2 + captures)
 * lives here; unifying V1's local table is a separate FE decision.
 */

// ── Trend bands (main pane candle overlays) ────────────────────────────────

/** Per-band [bull, bear] color pairs, bands 1–4 — `TREND_BAND_COLORS` in
 *  indicator-computation and the `colors` table in st-trend-bands.indicator
 *  were identical before the hoist. */
export const ST_TREND_BAND_COLORS: [string, string][] = [
  ['#ffeb3b', '#2196f3'], // band 1: yellow up, blue down
  ['#ffeb3b', '#2196f3'], // band 2: yellow up, blue down
  ['#ff9800', '#1565c0'], // band 3: orange up, dark blue down
  ['#ff9800', '#1565c0'], // band 4: orange up, dark blue down
];

// ── Zone scatter colors ─────────────────────────────────────────────────────

/** Callable-path zone color table (indicator-converters `zoneColor` + the
 *  Zone V2 indicator's inline table — identical before the hoist). */
export const ST_ZONE_COLORS: Record<number, string> = {
  4: '#0d47a1',
  3: '#2196f3',
  2: '#4caf50',
  1: '#81c784',
  0: '#9e9e9e',
  [-1]: '#e57373',
  [-2]: '#f44336',
  [-3]: '#e91e63',
  [-4]: '#b71c1c',
};
export const ST_ZONE_FALLBACK_COLOR = '#9e9e9e';

/** Zone V2 pane (lower-3) fixed axis. */
export const ST_ZONE_V2_AXIS_MIN = -7;
export const ST_ZONE_V2_AXIS_MAX = 7;

/** Zero-line refline shared by both zone panes. */
export const ST_ZONE_NEUTRAL_REFLINE = { value: 0, color: '#9e9e9e', dashArray: '4,3' };

// ── Dot markers ─────────────────────────────────────────────────────────────

/** Overlay uptick dots (main pane) — `UptickDotColors` in base-indicators. */
export const ST_UPTICK_DOT_COLORS = {
  v1Long: '#4caf50',
  v1Short: '#f44336',
  v2Long: '#8bc34a',
  v2Short: '#ff9800',
} as const;

/** Trend-strength signal dots (lower-1) — signal-marker-converters. */
export const ST_SIGNAL_DOT_COLORS = {
  long: '#4caf50',
  short: '#f44336',
} as const;

/** Vertical offset above/below the histogram bar — `TS_DOT_OFFSET` in
 *  indicator-computation, `DOT_OFFSET` in st-signal-dots.indicator. */
export const ST_SIGNAL_DOT_OFFSET = 3;

// ── Trend strength (lower-1) ────────────────────────────────────────────────

/** Per-point column colors — primary + HTF companion (0.75 width). */
export const ST_TREND_STRENGTH_COLORS = {
  primaryUp: '#2196f3',
  primaryDown: '#ffeb3b',
  htfUp: '#0d47a1',
  htfDown: '#8a6d00',
} as const;

export const ST_TREND_STRENGTH_AXIS_MIN = -50;
export const ST_TREND_STRENGTH_AXIS_MAX = 50;

/** Threshold reflines — `label` is consumed by the FE options shape; the
 *  renderer ignores it. */
export const ST_TREND_STRENGTH_REFLINES: { value: number; color: string; dashArray: string; label: string }[] = [
  { value: 0, color: '#9e9e9e', dashArray: '4,3', label: 'Zero' },
  { value: 10, color: 'rgba(158,158,158,0.5)', dashArray: '4,3', label: 'Upper' },
  { value: -10, color: 'rgba(158,158,158,0.5)', dashArray: '4,3', label: 'Lower' },
];

// ── Std Dev Lines (main pane overlay) ───────────────────────────────────────

export const ST_STD_DEV_PERIOD = 50;
export const ST_STD_DEV_CENTER_COLOR = '#1976d2';
export const ST_STD_DEV_REGULAR_COLORS = ['#e0e0e0', '#bdbdbd', '#9e9e9e', '#757575', '#424242'];
export const ST_STD_DEV_FIB_COLORS = ['#81c784', '#66bb6a', '#4caf50'];
export const ST_STD_DEV_FILL_OPACITY = 0.08;
export const ST_STD_DEV_REGULAR_DASH = '4,2';
export const ST_STD_DEV_FIB_DASH = '2,2';

// -- Trigger Bands (main pane overlay) -------------------------------------

/** State colours for the Trigger Bands step lines, ported from
 *  rb-st-trigger-bands.pine: neutral band = white; the UPPER band carries the
 *  long side's states, the LOWER the short side's. A pullback borrows the
 *  opposite side's colour (the warning reads against the trend) and a
 *  breakout keeps its own — long: pullback yellow, breakout blue; short:
 *  pullback blue, breakout yellow. TradingView palette: blue #2962ff,
 *  yellow #ffeb3b. NOTE: neutral white is for the dark theme; on the light
 *  appearance it needs a remap before use there. */
export const ST_TRIGGER_BANDS_COLORS = {
  upper: { neutral: '#ffffff', pullback: '#ffeb3b', breakout: '#2962ff' },
  lower: { neutral: '#ffffff', pullback: '#2962ff', breakout: '#ffeb3b' },
} as const;

/** Single stroke width for both band lines — a uniform Donchian channel;
 *  the pullback/breakout state carries colour only, not weight. */
export const ST_TRIGGER_BANDS_LINE_WIDTH = 2;

/** Trigger Bands signal dots, keyed by the backend `signalType`. Same
 *  cross-side vocabulary as the bands (Pine diagnostic plots): breakout =
 *  the side's own colour, pullback = the opposite side's. Two hues only —
 *  the dot's position (long below the bar, short above) carries the side. */
export const ST_TRIGGER_BANDS_DOT_COLORS: Readonly<Record<string, string>> = {
  TRIGGER_BANDS_LONG_BREAKOUT: '#2962ff',
  TRIGGER_BANDS_SHORT_BREAKOUT: '#ffeb3b',
  TRIGGER_BANDS_LONG_PULLBACK: '#ffeb3b',
  TRIGGER_BANDS_SHORT_PULLBACK: '#2962ff',
};

// ── HTF zone window (lower-3 dots + capture main-pane shading) ─────────────

/** `generateHtfWindowData` — long = one green dot at y -6, short = one red
 *  dot at +6, neutral = both. `neutralColor` is capture-only: the assembler
 *  shades neutral bars once rather than double-painting both layers. */
export const ST_HTF_WINDOW = {
  longColor: '#4caf50',
  shortColor: '#f44336',
  neutralColor: '#9e9e9e',
  y: 6,
} as const;
