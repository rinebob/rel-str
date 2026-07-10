/**
 * RH Agent Symbol Source
 *
 * Loads the enabled symbol universe and fetches intraday snapshots from the
 * partner. Kept separate from run/job orchestration so callers can use these
 * data sources independently.
 */
import { db } from '../firebase-admin-init';
import { RH_AGENT_SYMBOLS_COLLECTION } from './rh-agent-collections';

/**
 * Load enabled symbols from Firestore.
 * If specific symbols provided, filters to those.
 */
export async function loadEnabledSymbols(requestedSymbols?: string[]): Promise<string[]> {
  const snapshot = await db
    .collection(RH_AGENT_SYMBOLS_COLLECTION)
    .where('enabled', '==', true)
    .get();

  const symbols = snapshot.docs.map((doc) => doc.data().symbol as string);

  if (requestedSymbols && requestedSymbols.length > 0) {
    return symbols.filter((s) => requestedSymbols.includes(s));
  }

  return symbols;
}

