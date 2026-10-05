/**
 *
 * Shared contracts for on-demand chart screenshot capture (Topic #746 /
 * Thread #747 / task #765).
 *
 * Single source of truth for the `captureChartSnapshot` callable's
 * request/response shape — consumed by `functions/src/screenshot-capture/`
 * (producer) and the `/dev/screenshot` page (consumer). Import via the
 * `@screenshot-capture/contracts` path alias. Path construction and result
 * assembly live in `@screenshot-capture/utils` — this file holds shapes only.
 *
 * Server-side render only: a Cloud Function draws the chart to SVG, derives a
 * PNG, writes both to the default Firebase Storage bucket (GCS) under
 * `st-trade-screenshots/`, and returns the SVG inline plus storage paths.
 * No headless browser anywhere.
 */

// ── Enumerations ───────────────────────────────────────────────────────────

/**
 * Canonical chart interval for the data pipeline. Previously declared
 * identically in `functions/src/st-cloud-function/indicator-computation.ts`
 * and `src/app/features/savant-trader/common/indicator.types.ts` — both now
 * re-export this. Wire values are lowercase to match the existing
 * indicator-series API (`computeSymbolIndicatorSeries`).
 *
 * Known residual duplicate: `ChartIntervalKey` in flex-chart.types.ts is a
 * pre-existing UI-layer twin; merging it is a separate refactor.
 */
export enum ChartInterval {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

/** Intervals the capture pipeline supports — monthly is out of scope for
 *  this thread; enforced at the type level rather than by runtime checks. */
export type CaptureInterval = ChartInterval.DAILY | ChartInterval.WEEKLY;

/** The lifecycle event a capture documents. Path-safe (lowercase, hyphenated)
 *  because values are embedded directly in storage paths. `manual` covers
 *  dev-page and ad-hoc captures; pipeline events arrive in a follow-on Thread. */
export enum CaptureEvent {
  ORDER_PLACED = 'order-placed',
  ORDER_FILLED = 'order-filled',
  POSITION_CLOSED = 'position-closed',
  MANUAL = 'manual',
}

/** Instrument class the chart depicts. `stock` is the only supported value in
 *  this thread; option-position types (verticals, calendars, …) are reserved
 *  for the basket-orders follow-on Thread — the field exists so that contract
 *  does not break when they arrive. */
export enum PositionType {
  STOCK = 'stock',
}

// ── Spec ───────────────────────────────────────────────────────────────────

/** `'all'` renders the full bar series (whole-chart dev view); a number slices
 *  to the last N bars. */
export type VisibleBars = number | 'all';
export const VISIBLE_BARS_ALL = 'all' as const;

/** Intervals captured when the caller does not specify — matches the
 *  quick-charts D+W pair. */
export const DEFAULT_CAPTURE_INTERVALS: readonly CaptureInterval[] = [
  ChartInterval.DAILY,
  ChartInterval.WEEKLY,
];

/** Default bar window — matches the quick-charts 30-bar visible windows. */
export const DEFAULT_CAPTURE_VISIBLE_BARS = 30;

/** Default rendered image dimensions — the quick-charts card size preset. */
export const DEFAULT_CAPTURE_WIDTH = 800;
export const DEFAULT_CAPTURE_HEIGHT = 560;

/** Upper bound on rendered image dimensions — the callable rejects larger
 *  requests (`invalid-argument`) so a caller can't force a giant render. */
export const MAX_CAPTURE_DIMENSION = 4096;

/**
 * Caller-supplied capture request. Everything the image needs is here —
 * the function is stateless w.r.t. callers; `refId` is an opaque caller key
 * (order id, position id, anything) embedded in the path and header.
 */
export interface CaptureChartSpec {
  symbol: string;
  intervals?: readonly CaptureInterval[];
  event: CaptureEvent;
  positionType: PositionType;
  refId?: string;
  /** Rendered image dimensions in px — the dev page's card-layout playground
   *  passes narrow widths to explore squished variants. */
  width?: number;
  height?: number;
  visibleBars?: VisibleBars;
}

// ── Result ─────────────────────────────────────────────────────────────────

/** One captured chart — SVG markup for immediate client use plus the storage
 *  paths for both artifacts (PNG is written once the rasterizer task lands). */
export interface CaptureArtifact {
  interval: CaptureInterval;
  svg: string;
  svgPath: string;
  pngPath?: string;
}

/**
 * `artifacts` is the canonical payload; `svg` and `paths` are derived
 * conveniences (`artifacts[0].svg`, flattened artifact paths). Producers
 * must build this via `buildCaptureChartResult` in `@screenshot-capture/utils`
 * so the derived fields cannot diverge from the artifacts.
 */
export interface CaptureChartResult {
  /** First artifact's SVG — convenience for callers that render inline. */
  svg: string;
  /** Flattened storage paths across all artifacts. */
  paths: string[];
  artifacts: CaptureArtifact[];
}
