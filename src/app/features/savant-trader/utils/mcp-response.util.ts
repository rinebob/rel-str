/**
 * Shared utilities for extracting values from untyped MCP tool responses.
 *
 * MCP responses arrive as `unknown` and their shape varies by tool. These
 * helpers probe common nesting patterns (root, `data`, `results[0]`) and
 * candidate field names so callers don't duplicate the same traversal logic.
 */

/** Extract a number from an unknown value (handles string→number parsing). */
export function extractNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return isNaN(n) ? null : n;
  }
  return null;
}

/** Extract a string from an unknown value. */
export function extractString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Extract a number from a nested object path, e.g. `item.quote.last_trade_price`.
 * Each segment is traversed as a property access; the final field is parsed
 * as a number.
 */
export function getNestedNumber(obj: unknown, ...path: string[]): number | null {
  let current: unknown = obj;
  for (let i = 0; i < path.length; i++) {
    if (!current || typeof current !== 'object') return null;
    const record = current as Record<string, unknown>;
    current = record[path[i]];
  }
  return extractNumber(current);
}

/** Extract a string from a nested object path. */
export function getNestedString(obj: unknown, ...path: string[]): string | null {
  let current: unknown = obj;
  for (let i = 0; i < path.length; i++) {
    if (!current || typeof current !== 'object') return null;
    const record = current as Record<string, unknown>;
    current = record[path[i]];
  }
  return extractString(current);
}
