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
}

export interface ToolExecutionFailure {
  success: false;
  error: string;
  category: ToolExecutionErrorCategory;
}

export type ToolExecutionResult = ToolExecutionSuccess | ToolExecutionFailure;

export type ToolExecutionError = ToolExecutionFailure;
