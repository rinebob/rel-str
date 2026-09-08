/**
 * Broker Position normalizer.
 *
 * Normalizes raw Robinhood MCP position responses into the shared
 * `RawSymbolPosition` contract. Handles:
 * - direct and nested response shapes (`parsed.data.position`);
 * - position-list containers (`results`);
 * - cursor extraction from pagination URLs;
 * - redacted raw response retention.
 *
 * This module does NOT decide local case ownership or fabricate local fields.
 */

import type {
  RawSymbolPosition,
  RawSymbolPositionPage,
} from '../../../../shared/broker-types';
import { isPlainObject } from '@robinhood-mcp/utils';
import { BrokerAdapterError } from './broker-adapter-errors';
import {
  optionalString,
  extractCursor,
  inferInstrumentType,
} from './broker-adapter-helpers';

// ---------------------------------------------------------------------------
// Position extraction
// ---------------------------------------------------------------------------

/**
 * Extract a single position object from various response shapes.
 * Returns null if no recognizable position object is found.
 */
function extractPositionFromParsed(parsed: unknown): Record<string, unknown> | null {
  if (!isPlainObject(parsed)) return null;

  // Direct position response
  if (typeof parsed.symbol === 'string' && typeof parsed.quantity === 'string') {
    return parsed;
  }

  // Nested: parsed.data.position
  const data = parsed.data;
  if (isPlainObject(data)) {
    const position = data.position;
    if (isPlainObject(position) && typeof position.symbol === 'string') {
      return position;
    }
    // Direct inside data
    if (typeof data.symbol === 'string' && typeof data.quantity === 'string') {
      return data;
    }
  }

  return null;
}

/**
 * Extract a list of position objects from various list-response shapes.
 * Returns null if no list container is found.
 */
function extractPositionList(parsed: unknown): unknown[] | null {
  if (!isPlainObject(parsed)) return null;

  if (Array.isArray(parsed.results)) return parsed.results;

  const data = parsed.data;
  if (isPlainObject(data)) {
    if (Array.isArray(data.results)) return data.results;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a raw Robinhood position response (direct or nested) into a
 * `RawSymbolPosition`. Throws `BrokerAdapterError` if symbol is missing.
 *
 * @param raw - The parsed/redacted MCP tool response
 * @param accountNumber - The account number used for the request (authoritative)
 */
export function normalizeSymbolPosition(raw: unknown, accountNumber: string): RawSymbolPosition {
  const extracted = extractPositionFromParsed(raw);
  if (!extracted) {
    throw new BrokerAdapterError('Could not extract symbol position from response');
  }

  const symbol = extracted.symbol;
  if (typeof symbol !== 'string' || !symbol) {
    throw new BrokerAdapterError('Position response is missing required symbol');
  }

  return {
    accountNumber: accountNumber || optionalString(extracted.account_number) || '',
    symbol,
    instrumentType: inferInstrumentType(extracted),
    quantity: optionalString(extracted.quantity) ?? '0',
    intradayQuantity: optionalString(extracted.intraday_quantity),
    averageBuyPrice: optionalString(extracted.average_buy_price),
    sharesAvailableForSells: optionalString(extracted.shares_available_for_sells),
    sharesHeldForSells: optionalString(extracted.shares_held_for_sells),
    positionType: optionalString(extracted.position_type),
    observedAt: optionalString(extracted.updated_at) ?? new Date().toISOString(),
  };
}

/**
 * Normalize a position-list response into a `RawSymbolPositionPage`.
 * Items that fail normalization are counted in `skipped`.
 */
export function normalizePositionListResponse(raw: unknown, accountNumber: string): RawSymbolPositionPage {
  const positions = extractPositionList(raw) ?? [];
  let skipped = 0;
  const normalized = positions.map((p) => {
    try {
      return normalizeSymbolPosition(p, accountNumber);
    } catch {
      skipped++;
      return null;
    }
  }).filter((p): p is RawSymbolPosition => p !== null);

  const nextCursor = isPlainObject(raw) ? extractCursor(raw.next) : undefined;

  return { positions: normalized, nextCursor, skipped: skipped || undefined };
}
