/**
 * Shared utilities for the Robinhood MCP Observation Dashboard.
 *
 * These helpers have no runtime dependencies and can be imported by both the
 * Firebase functions backend and the Angular frontend.
 */

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function maskAccountNumber(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.length <= 4) {
    return '••••';
  }
  return '••••' + value.slice(-4);
}
