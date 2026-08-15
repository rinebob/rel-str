/**
 * @topic #114 — Options Strategy Engine — Hybrid Quote Provider
 *
 * Writer for the global OCC → Robinhood MCP instrument map.
 */

import type { OptionContractRef, OccRhInstrumentMapEntry } from '@options-strategy-engine/contracts';
import { db } from '../../firebase-admin-init';
import { OPTIONS_RH_INSTRUMENT_MAP_COLLECTION } from '../collections';
import type { OccRhInstrumentMapWriter } from './occ-rh-instrument-map-types';

function addMonths(date: Date, months: number): Date {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0));
  result.setUTCMonth(result.getUTCMonth() + months);
  // Clamp to last day of the target month to avoid overflow.
  const day = Math.min(date.getUTCDate(), new Date(result.getUTCFullYear(), result.getUTCMonth() + 1, 0).getDate());
  result.setUTCDate(day);
  return result;
}

export function computeInstrumentMapExpiresAt(expiration: string): string {
  const base = new Date(`${expiration}T00:00:00.000Z`);
  const ttl = addMonths(base, 3);
  return ttl.toISOString();
}

/**
 * Build a complete `OccRhInstrumentMapEntry` from a normalized quote and
 * resolved Robinhood IDs.
 */
export function buildOccRhInstrumentMapEntry(
  quote: OptionContractRef,
  instrumentId: string,
  chainId: string,
  firstTradedDate?: string,
): OccRhInstrumentMapEntry {
  return {
    occId: quote.contractID,
    instrumentId,
    chainId,
    chainSymbol: quote.symbol,
    expiration: quote.expiration,
    strike: quote.strike,
    type: quote.type,
    firstTradedDate,
    createdAt: new Date().toISOString(),
    expiresAt: computeInstrumentMapExpiresAt(quote.expiration),
  };
}

export function createDefaultOccRhInstrumentMapWriter(): OccRhInstrumentMapWriter {
  return async (entry) => {
    await db
      .collection(OPTIONS_RH_INSTRUMENT_MAP_COLLECTION)
      .doc(entry.occId)
      .set(entry, { merge: true });
  };
}

export async function writeOccRhInstrumentMapEntry(
  entry: OccRhInstrumentMapEntry,
  write: OccRhInstrumentMapWriter = createDefaultOccRhInstrumentMapWriter(),
): Promise<void> {
  await write(entry);
}
