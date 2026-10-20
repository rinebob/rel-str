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
