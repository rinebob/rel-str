/**
 * RH Agent Symbol Source
 *
 * Loads the enabled symbol universe and fetches intraday snapshots from the
 * partner. Kept separate from run/job orchestration so callers can use these
 * data sources independently.
 */
import { logger } from 'firebase-functions/v2';
import { RH_AGENT_SYMBOLS_COLLECTION } from './rh-agent-collections';
import { IntradaySnapshot } from './rh-agent-shared-types';
import { db } from '../firebase-admin-init';
import { callPartnerIntradaySnapshotV2 } from '../partner-proxy';

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

/**
 * Fetch an intraday snapshot for the given symbols.
 * Gracefully returns an empty array if the partner endpoint fails.
 */
export async function fetchIntradaySnapshots(
  symbols: string[],
  marketDate: string
): Promise<IntradaySnapshot[]> {
  if (symbols.length === 0) return [];

  logger.info('rh_agent_fetching_intraday', { marketDate, symbolCount: symbols.length });
  try {
    const response = await callPartnerIntradaySnapshotV2(symbols);
    logger.info('rh_agent_intraday_fetched', { marketDate, count: response.count });
    return response.snapshots;
  } catch (error: any) {
    logger.warn('rh_agent_intraday_fetch_failed', { marketDate, error: error?.message });
    return [];
  }
}
