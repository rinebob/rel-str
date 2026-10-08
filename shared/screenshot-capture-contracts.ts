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

/** Instrument class the *position* represents — the chart itself is always
 *  the underlying symbol; this tag rides in the storage path so option-leg
 *  and spread captures are distinguishable from share captures without a
 *  separate rendering surface. Values are path-safe (lowercase, hyphenated). */
export enum PositionType {
  STOCK = 'stock',
  VERTICAL_DEBIT_SPREAD = 'vertical-debit-spread',
  CALENDAR = 'calendar',
  OPTION_SINGLE = 'option-single',
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

/** Lower bounds — below these the plot collapses (width minus
 *  PLOT_LEFT + AXIS_GUTTER_WIDTH ≤ ~32px) or the pane stack degenerates
 *  (header 26 + x-axis 18 leaves no pane height). The callable rejects
 *  smaller requests rather than emitting well-formed nonsense. */
export const MIN_CAPTURE_WIDTH = 96;
export const MIN_CAPTURE_HEIGHT = 64;

/** Pane-stack geometry shared with the dev page — it sizes variant
 *  `visibleBars` from the plot width (width − PLOT_LEFT − AXIS_GUTTER_WIDTH).
 *  Canonical home is here; `functions/.../svg-layout.ts` re-exports them. */
export const CAPTURE_PLOT_LEFT = 4;
export const CAPTURE_AXIS_GUTTER_WIDTH = 60;

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
  /** Campaign-level grouping id (Position Group / cohort / strategy position)
   *  — becomes a directory level under `{symbol}/` in the storage path so all
   *  captures for one group list under a single prefix. Absent for ad-hoc
   *  captures with no grouping context. */
  groupId?: string;
  /** Rendered image dimensions in px — the dev page's card-layout playground
   *  passes narrow widths to explore squished variants. */
  width?: number;
  height?: number;
  visibleBars?: VisibleBars;
  /** Render-and-return only — no GCS writes. DEFAULTS TO TRUE: storage
   *  writes are opt-in (`renderOnly: false`) so playground/zoom calls from
   *  the dev page don't litter the bucket. */
  renderOnly?: boolean;
}

// ── Result ─────────────────────────────────────────────────────────────────

/** One captured chart — SVG markup for immediate client use plus the storage
 *  paths for both artifacts. Paths are absent on render-only requests —
 *  nothing was written. */
export interface CaptureArtifact {
  interval: CaptureInterval;
  svg: string;
  svgPath?: string;
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

// ── Lifecycle tracking (Thread #826 — order lifecycle capture) ─────────────

/**
 * Flat root collection for the screenshot index — one doc per lifecycle
 * capture, id `{groupId}-{refId}-{event}`. Backend-written by
 * `captureLifecycleEvent`; FE reads it for the screenshot library.
 */
export const ST_SCREENSHOTS_COLLECTION = 'st-screenshots';

/** Carrier-doc field holding the dedup ledger + manifest map — lives on
 *  `st-order-intents` docs and engine/paper position docs. */
export const CAPTURED_EVENTS_FIELD = 'capturedEvents';

/** One `capturedEvents` map entry — the dedup slot for one lifecycle event. */
export interface CapturedEventEntry {
  status: 'pending' | 'captured' | 'failed';
  /** ISO timestamp of the claim — the stale-claim clock reads this. */
  claimedAt: string;
  capturedAt?: string;
  failedAt?: string;
  paths?: string[];
  error?: string;
}

/** Where a capture's dedup ledger lives. `intent` = an `st-order-intents`
 *  doc; `engine-position` = an engine/paper-trade position doc. */
export type LifecycleCarrierKind = 'intent' | 'engine-position';

export interface LifecycleCarrier {
  kind: LifecycleCarrierKind;
  docPath: string;
}

/** One `st-screenshots` index doc — the flat query surface for the library. */
export interface ScreenshotIndexEntry {
  groupId?: string;
  positionId: string;
  refId: string;
  event: CaptureEvent;
  symbol: string;
  positionType: PositionType;
  carrier: LifecycleCarrier;
  capturedAt: string;
  paths: string[];
}

/** The role an order intent plays against a position — drives the lifecycle
 *  events an intent carriers. */
export type OrderIntentRole = 'open' | 'close';

/**
 * Tracking fields an `st-order-intents` doc carries for screenshot
 * lifecycle capture. The FE writes `role`/`linkedPositionId` at ticket
 * creation (#849); the backend writes `lastSeenState` (detector
 * bookkeeping) and `capturedEvents` (dedup ledger + manifest) itself.
 */
export interface OrderIntentTrackingFields {
  role?: OrderIntentRole;
  /** Close tickets → the opening intent's refId / group root. */
  linkedPositionId?: string;
  /** Signal id — group linkage on signal-pipeline tickets. */
  signalId?: string;
  /** Last order state the external detector observed — re-observation
   *  bookkeeping so a terminal re-read doesn't double-fire. */
  lastSeenState?: string;
  capturedEvents?: Record<string, CapturedEventEntry>;
}
