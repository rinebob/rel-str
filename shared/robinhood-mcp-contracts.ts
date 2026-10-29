/**
 * Shared wire contracts for the Robinhood MCP Observation Dashboard.
 *
 * These are pure type/enum definitions with no runtime dependencies so they can
 * be imported by both the Firebase functions backend and the Angular frontend.
 *
 * Security note on `parsed` vs `redacted`:
 * - `redacted` is the default view shown to the user. It masks sensitive fields
 *   (account numbers, names, PII) while preserving structure.
 * - `parsed` contains the original tool result JSON. It is returned so the UI
 *   can chain tool calls (e.g. extract `account_number` for the next request).
 *   The observation dashboard is local-only and protected by the Angular
 *   `authGuard`; raw account numbers live in the authenticated browser session
 *   only for the duration of local exploration.
 */

export enum ToolExecutionErrorCategory {
  VALIDATION = 'VALIDATION',
  AUTH = 'AUTH',
  MCP = 'MCP',
  UNKNOWN = 'UNKNOWN',
}

export interface RobinhoodToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  mutation: boolean;
  simulation?: boolean;
  financialMutation?: boolean;
  category?: string;
}

export interface ToolExecutionRequest {
  args?: Record<string, unknown>;
  extraRedactFields?: string[];
}

export interface ToolExecutionSuccess {
  success: true;
  parsed?: unknown;
  redacted: unknown;
  tool: string;
  /**
   * MCP envelope-level `isError` surfaced by the executor — the envelope flag
   * is dropped when the error text parses as JSON, so `parsed` alone cannot
   * detect it. Present only on transport-success results.
   */
  toolError?: string;
}

export interface ToolExecutionFailure {
  success: false;
  error: string;
  category: ToolExecutionErrorCategory;
  /**
   * Internal executor marker — the failure came from the MCP
   * session/transport itself (dead connection, not-connected), never a
   * timed-out call, which may still be executing server-side. The executor
   * retries these once via `sessionCache.recover()`. Set only on errors
   * thrown by the `callTool` await, and stripped at the `/api/rh` route
   * boundary — it is never serialized to clients.
   */
  sessionFailure?: boolean;
}

export type ToolExecutionResult = ToolExecutionSuccess | ToolExecutionFailure;

export type ToolExecutionError = ToolExecutionFailure;

// --- Scanner (preview_scan) wire contracts ---------------------------------
//
// Verified against the bundled tool catalog schema and live captures in
// docs/topics/657-rh-mcp/captures/dep-prev-scan-*.json. preview_scan accepts
// `filters` + `columns` only — there is NO sort or limit arg. Sorting is a
// saved-scan concern (`update_scan_config` sorting_column/sorting_direction);
// preview applies its own default sort, echoed in `sorted_by`.

/**
 * Enum-shaped filter from the get_scanner_filter_specs catalog.
 * Predicate accepts literal forms ('>', '>=', 'ANY_OF', 'IN_LIST', '=', '!=',
 * 'BETWEEN', 'OUTSIDE') or wire enums ('PREDICATE_GREATER_THAN', …) — both
 * verified live; supported_predicates is per-filter.
 */
export interface ScanEnumFilter {
  filter_type: string;
  predicate: string;
  /** Stringified values incl. numbers. 1 for unary, 2 for BETWEEN, N for ANY_OF/IN_LIST. */
  values: string[];
  /** Time granularity for time-series filters (e.g. '1d'). Not used with expression. */
  interval?: string;
  /** Lookback length for filters that need one (e.g. RSI 14). */
  length?: number;
  /** Price-field input (e.g. 'open'/'close' for % Change). */
  plot?: string;
}

/**
 * Expression filter — omit filter_type when set. Boolean screens use
 * predicate '=' with values ['True']; raw expressions can take numeric
 * predicates (e.g. PREDICATE_GREATER_THAN, values ['1']).
 */
export interface ScanExpressionFilter {
  expression: string;
  predicate: string;
  values: string[];
  /** Optional short label shown as the results-column header. */
  display_title?: string;
}

export type ScanFilter = ScanEnumFilter | ScanExpressionFilter;

/**
 * Result column. display_name is the column's identity (standard column name,
 * or label for an expression column). order is relative among passed columns;
 * default columns (Symbol, Name, price, Volume, …) always come first.
 */
export interface ScanColumn {
  display_name: string;
  /** Present ⇒ expression column computing the value. */
  expression?: string;
  /** Default true for new columns; hidden columns still compute. */
  visible?: boolean;
  order?: number;
}

export interface PreviewScanArgs {
  filters: ScanFilter[];
  columns?: ScanColumn[];
}

/** Row from result.results — every column value is stringified, even numerics. */
export interface ScanResultRow {
  ticker: string;
  instrument_id: string;
  /** 'EQUITY' | 'ETF' | 'CRYPTO' | 'FUTURE' | … — open string, not a closed enum. */
  instrument_type: string;
  /** Display-name → stringified value. Consumers must coerce numerics. */
  columns: Record<string, string>;
}

/** Entry from result.filters_applied — the parsed echo of each filter. */
export interface ScanAppliedFilter {
  /** Display name for enum filters (e.g. 'Asset type'). */
  filter_type: string;
  /** Wire enum (e.g. 'FILTER_TYPE_INSTRUMENT_TYPE'); 'FILTER_TYPE_CUSTOM' for expressions. */
  filter_type_enum: string;
  predicate: string;
  values: string[];
  expression?: string;
}

export interface PreviewScanResult {
  /** Matching universe size — capped (~400 observed on the MCP path; UI discloses ~1500). */
  total_items: number;
  /** At most 200 rows (UI row cap). */
  results: ScanResultRow[];
  /** Display string, e.g. 'Last desc'. */
  sorted_by?: string;
  filters_applied?: ScanAppliedFilter[];
}

/** Top-level parsed payload: { data: { result }, guide }. */
export interface PreviewScanResponse {
  data: { result: PreviewScanResult };
  guide?: string;
}

/** Row cap disclosed for scanner result display. */
export const PREVIEW_SCAN_ROW_CAP = 200;

// --- Equity historicals (get_equity_historicals) wire contracts ------------
//
// Verified against the live tool schema and captures in
// docs/topics/657-rh-mcp/captures/ro-eq-hist-*.json + err-hist-*.json.
// Note: this tool does NOT take Robinhood's classic `symbol`/`span` args —
// it takes a `symbols` array + RFC3339 time range, and returns
// `data.results[]` keyed per symbol (not a `historicals` array).

/**
 * Fixed bar intervals — the full set the server accepts (no aggregation of
 * intermediates; request the next-finer interval and aggregate client-side).
 * 1-minute bar is 'minute', not '1minute'.
 */
export type EquityHistoricalInterval =
  | '15second' | '30second' | 'minute' | '5minute' | '10minute' | '30minute'
  | 'hour' | '4hour'
  | 'day' | 'week' | 'month' | '3month' | '6month' | 'year'
  | '5year' | '10year' | '20year' | '50year';

/**
 * Request args. `symbols` (≤10) and `start_time` are required;
 * `end_time` defaults to now when omitted.
 * The scanner popup sends `interval: 'day'` — when interval is omitted the
 * server auto-selects one targeting ~2,500 bars across the range.
 */
export interface EquityHistoricalsRequest {
  /** One or more symbols, uppercase, ≤10 per call. */
  symbols: string[];
  /** RFC3339 UTC, e.g. '2026-01-01T00:00:00Z'. Required. */
  start_time: string;
  /** RFC3339 UTC. Optional — defaults to current time. */
  end_time?: string;
  /**
   * Fixed interval set (see EquityHistoricalInterval). Explicit intervals are
   * capped at ~5,000 upstream bars — the call is rejected pre-upstream when
   * the range would exceed it (ro-eq-hist-02 note; the cap does not apply
   * when interval is auto-selected).
   */
  interval?: EquityHistoricalInterval;
  /** Session bounds; 'regular' (RTH) is the default. */
  bounds?: 'regular' | 'extended' | 'trading' | '24_5' | '24_7' | 'hyper_trading';
  /**
   * Corporate-action adjustment. 'split' is the default (right for
   * backtesting). 'all' (split + dividend) requires interval ≥ day —
   * captured 400 on interval=minute (ro-eq-hist-11). NOTE: the tool's
   * own schema description claims 'all' is "intraday only" — the live
   * captures contradict that; the captures are correct.
   */
  adjustment_type?: 'none' | 'split' | 'all';
}

/** One OHLCV bar — prices arrive as strings, FE owns numeric coercion. */
export interface EquityHistoricalBar {
  /** ISO-8601 timestamp — day bars carry 'YYYY-MM-DDT00:00:00Z'. */
  begins_at: string;
  open_price: string;
  close_price: string;
  high_price: string;
  low_price: string;
  volume: number;
  /** Session tag observed: 'reg' | 'pre' | 'post' | 'overnight'. */
  session: string;
  /** True ⇒ server-synthesized gap-fill bar carrying no new information. */
  interpolated?: boolean;
}

/**
 * Per-symbol entry inside `data.results`. All four fields are present on
 * every success capture — `interval` is the value the server used (echoes
 * the request or its auto-selection), so it stays `string`, not the
 * request union.
 */
export interface EquityHistoricalsSymbolResult {
  symbol: string;
  interval: string;
  bounds: string;
  bars: EquityHistoricalBar[];
}

/** Top-level parsed payload: { data: { results[] }, guide }. */
export interface EquityHistoricalsResult {
  data: { results: EquityHistoricalsSymbolResult[] };
  /** Server-authored usage notes (present on every success capture). */
  guide?: string;
}
