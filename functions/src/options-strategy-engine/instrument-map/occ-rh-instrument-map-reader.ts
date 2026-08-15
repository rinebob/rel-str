/**
 * @topic #114 — Options Strategy Engine — Hybrid Quote Provider
 *
 * Firestore reader for the global OCC → Robinhood MCP instrument map.
 */

import type { OccRhInstrumentMapEntry } from '@options-strategy-engine/contracts';
import { db } from '../../firebase-admin-init';
import { OPTIONS_RH_INSTRUMENT_MAP_COLLECTION } from '../collections';
import type { OccRhInstrumentMapReader } from './occ-rh-instrument-map-types';

export function createDefaultOccRhInstrumentMapReader(): OccRhInstrumentMapReader {
  return async (occId: string): Promise<OccRhInstrumentMapEntry | null> => {
    const snap = await db.collection(OPTIONS_RH_INSTRUMENT_MAP_COLLECTION).doc(occId).get();
    if (!snap.exists) {
      return null;
    }
    return snap.data() as OccRhInstrumentMapEntry;
  };
}
