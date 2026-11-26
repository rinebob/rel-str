/**
 * All SA IV-endpoint types, field-name unions, and request/response
 * interfaces for partnerIvMetricsV2 (per-symbol daily IV series) and
 * partnerIvRankV2 (cross-symbol latest-rank screener).
 *
 * Pure type definitions with no runtime dependencies — importable by both
 * the Firebase functions backend and the Angular frontend via the
 * `@iv-metrics/contracts` alias.
 *
 * Contract semantics carried from the SA discovery docs:
 * - Absent key = no data, never `0`. Every rank/percentile/method field is
 *   optional on rows; `ivN{W}` is required on IvRankRow (always emitted)
 *   but optional on IvMetricsRow (emitted only when the metric exists).
 * - `ivRank{W}` requires `ivN{W} >= 2`; `ivPct{W}` requires `ivN{W} > 0` —
 *   enforced server-side; clients gate on `ivN{W}` before trusting a rank.
 * - Rank fields on historical IvMetricsRow entries are frozen at compute
 *   time — they are NOT "today's rank"; consumers must not re-interpret
 *   them as current.
 */

// ── Windows ────────────────────────────────────

/** The four documented lookback windows (calendar days) for rank fields.
 * 360 calendar ≈ ~247 trading days — do not confuse with bar counts. */
export type IvRankWindow = 30 | 60 | 180 | 360;

/** The window list in ascending order — drives per-window field iteration. */
export const IV_RANK_WINDOWS: readonly IvRankWindow[] = [30, 60, 180, 360];

// ── partnerIvMetricsV2 — per-symbol daily IV series ──────────

/** Requestable metric fields for partnerIvMetricsV2's `metrics` whitelist.
 * `date` is NOT a member — it is always emitted on every row. */
export type IvMetricField =
  | 'iv30'
  | 'iv30Method'
  | 'iv30Contracts'
  | `ivRank${IvRankWindow}`
  | `ivPct${IvRankWindow}`
  | `ivN${IvRankWindow}`;

export interface IvMetricsRequest {
  symbol: string;
  /** YYYY-MM-DD, inclusive. */
  from: string;
  /** YYYY-MM-DD, inclusive; span ≤ 10 years. */
  to: string;
  /** Omitted → all fields returned. */
  metrics?: IvMetricField[];
}

export interface IvMetricsRow {
  /** Trading date, YYYY-MM-DD — always present. */
  date: string;
  /** Constant-maturity ~30-day ATM IV, decimal — 0.24 ≈ 24%. */
  iv30?: number;
  /** How iv30 was derived for the row. */
  iv30Method?: 'interpolated' | 'nearest';
  /** Number of contracts contributing to iv30. */
  iv30Contracts?: number;
  ivRank30?: number;
  ivRank60?: number;
  ivRank180?: number;
  ivRank360?: number;
  ivPct30?: number;
  ivPct60?: number;
  ivPct180?: number;
  ivPct360?: number;
  ivN30?: number;
  ivN60?: number;
  ivN180?: number;
  ivN360?: number;
}

export interface IvMetricsResponse {
  ok: boolean;
  symbol: string;
  from: string;
  to: string;
  /** Echo of the effective whitelist — present only when `metrics` was supplied. */
  metrics?: IvMetricField[];
  rows: IvMetricsRow[];
  timestamp: string;
  processingTimeMs: number;
}

// ── partnerIvRankV2 — whole-table latest-rank screener ───────

/** Sortable fields for partnerIvRankV2's `sort` param. */
export type IvRankSortField =
  | `ivRank${IvRankWindow}`
  | `ivPct${IvRankWindow}`
  | `ivN${IvRankWindow}`;

export type IvRankDirection = 'asc' | 'desc';

export interface IvRankRequest {
  /** Omitted → server default ordering (symbol). */
  sort?: IvRankSortField;
  /** Sort direction; omitted → server default. */
  dir?: IvRankDirection;
  /** Non-negative integer floor on the sort window's ivN — gates thin data. */
  minN?: number;
}

export interface IvRankRow {
  symbol: string;
  /** Trading date the snapshot was computed from, YYYY-MM-DD. */
  asOfDate: string;
  ivRank30?: number;
  ivRank60?: number;
  ivRank180?: number;
  ivRank360?: number;
  ivPct30?: number;
  ivPct60?: number;
  ivPct180?: number;
  ivPct360?: number;
  /** Always emitted — gates whether the rank/pct fields may be trusted. */
  ivN30: number;
  ivN60: number;
  ivN180: number;
  ivN360: number;
  /** ISO-8601 timestamp of the snapshot write, or null. */
  updatedAt: string | null;
}

export interface IvRankResponse {
  ok: boolean;
  count: number;
  /** Echo of request params — present only when supplied. */
  sort?: IvRankSortField;
  dir?: IvRankDirection;
  minN?: number;
  rows: IvRankRow[];
  timestamp: string;
  processingTimeMs: number;
}

// ── Callable request types ───────────────────────────────────

/** `getIvMetrics` callable request — mirrors the helper params verbatim. */
export type GetIvMetricsRequest = IvMetricsRequest;

/** `getIvRank` callable request — mirrors the helper params verbatim. */
export type GetIvRankRequest = IvRankRequest;
