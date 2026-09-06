/**
 * Shared helpers for broker order and position normalizers.
 *
 * These utilities are used by both `broker-order-normalizer.ts` and
 * `broker-position-normalizer.ts`. Extracting them here avoids duplication
 * and keeps each normalizer file focused on its entity.
 */

import type { TradingInstrumentType } from '@trading-case/contracts';
import { TradingInstrumentType as InstrumentType } from '@trading-case/contracts';

/** Return the string if it's a string, otherwise undefined. */
export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Return the string if it's a string, null if null, otherwise undefined. */
export function optionalStringOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

/**
 * Extract the cursor from a Robinhood `next` URL.
 * Returns undefined if the URL is invalid or has no `cursor` param.
 */
export function extractCursor(nextUrl: unknown): string | undefined {
  if (typeof nextUrl !== 'string' || !nextUrl) return undefined;
  try {
    const url = new URL(nextUrl);
    return url.searchParams.get('cursor') ?? undefined;
  } catch {
    return undefined;
  }
}

/** Infer the instrument type from raw broker fields. */
export function inferInstrumentType(raw: Record<string, unknown>): TradingInstrumentType {
  if (Array.isArray(raw.legs) || typeof raw.option_id === 'string' || typeof raw.chain_id === 'string') {
    return InstrumentType.OPTION;
  }
  return InstrumentType.EQUITY;
}
