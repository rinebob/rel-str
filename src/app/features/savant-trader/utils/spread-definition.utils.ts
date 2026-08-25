/**
 * @topic #77 — Spread Time Series Viewer (opened 2026-08-08)
 *
 * Shared utilities for spread definitions.
 */
import type { SpreadDefinition } from '@spread/contracts';

/**
 * Deep-clone a SpreadDefinition, stripping undefined fields so the result
 * is safe for both Firestore writes and JSON.stringify comparisons.
 */
export function cloneSpreadDefinition(def: SpreadDefinition): SpreadDefinition {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(def)) {
    if (value !== undefined) {
      cleaned[key] = JSON.parse(JSON.stringify(value));
    }
  }
  return cleaned as unknown as SpreadDefinition;
}
