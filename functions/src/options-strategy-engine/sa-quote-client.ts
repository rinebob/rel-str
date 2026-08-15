/**
 * @topic #108 — Options Position Strategy Engine
 *
 * Client for SA's real-time options quote endpoint (backed by Alpha Vantage
 * REALTIME_OPTIONS). The endpoint is pending; this module isolates the HTTP
 * call behind a narrow interface so only this file needs revision when SA
 * delivers the exact response shape.
 *
 * Both full-chain contract selection and single-contract mark updates use the
 * same underlying AV REALTIME_OPTIONS endpoint:
 *   - Full chain: symbol + require_greeks=true
 *   - Single contract: symbol + contract={contractID}
 */

import * as logger from 'firebase-functions/logger';
import {
  PartnerEndpointPath,
  type HistoricalOptionContract,
} from '../types/partner';
import {
  CALLER_SA,
  generateIdTokenWithEmail,
  fetchWithRetry,
  PartnerHttpError,
  PARTNER_AUDIENCE,
} from '../partner-infrastructure';

const PARTNER_REALTIME_OPTIONS_URL =
  process.env.PARTNER_REALTIME_OPTIONS_URL ||
  `${PARTNER_AUDIENCE.replace(/\/$/, '')}/${PartnerEndpointPath.REALTIME_OPTIONS}`;

const PARTNER_REALTIME_OPTIONS_AUDIENCE =
  process.env.PARTNER_REALTIME_OPTIONS_AUDIENCE || PARTNER_REALTIME_OPTIONS_URL;

interface RealtimeOptionsRequest {
  symbol: string;
  contractID?: string;
  requireGreeks?: boolean;
}

/**
 * Extract a HistoricalOptionContract[] from the upstream response.
 *
 * AV REALTIME_OPTIONS returns a wrapped object; SA may pass it through
 * unchanged or flatten it. We accept several common shapes so the rest of the
 * engine doesn't care which one SA actually emits.
 */
function extractContracts(raw: unknown): HistoricalOptionContract[] {
  if (Array.isArray(raw)) {
    return raw as HistoricalOptionContract[];
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.data)) {
      return obj.data as HistoricalOptionContract[];
    }
    const nested = obj.data as Record<string, unknown> | undefined;
    if (nested && Array.isArray(nested.data)) {
      return nested.data as HistoricalOptionContract[];
    }
  }
  return [];
}

async function callPartnerRealtimeOptions(
  params: RealtimeOptionsRequest,
): Promise<HistoricalOptionContract[]> {
  const audience = PARTNER_REALTIME_OPTIONS_AUDIENCE;
  const idToken = await generateIdTokenWithEmail(audience, CALLER_SA);

  const search = new URLSearchParams();
  search.set('symbol', params.symbol);
  if (params.contractID) {
    search.set('contract', params.contractID);
  }
  if (params.requireGreeks !== false) {
    search.set('require_greeks', 'true');
  }

  const url = `${PARTNER_REALTIME_OPTIONS_URL}?${search.toString()}`;

  logger.info('partnerRealtimeOptions_request', {
    symbol: params.symbol,
    contractID: params.contractID ?? null,
    requireGreeks: params.requireGreeks ?? true,
    url,
    audience,
  });

  const resp = await fetchWithRetry(url, { Authorization: `Bearer ${idToken}` });
  const text = await resp.text();

  if (!resp.ok) {
    logger.error('partnerRealtimeOptions_upstream_error', {
      symbol: params.symbol,
      contractID: params.contractID ?? null,
      status: resp.status,
      url,
      audience,
      callerSa: CALLER_SA,
      snippet: typeof text === 'string' ? text.slice(0, 500) : undefined,
    });
    throw new PartnerHttpError(
      `partnerRealtimeOptions upstream ${resp.status}: ${text}`,
      resp.status,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('partnerRealtimeOptions_parse_error', {
      symbol: params.symbol,
      contractID: params.contractID ?? null,
      message,
      snippet: text.slice(0, 500),
    });
    throw e;
  }

  const contracts = extractContracts(raw);
  logger.info('partnerRealtimeOptions_response', {
    symbol: params.symbol,
    contractID: params.contractID ?? null,
    contractCount: contracts.length,
  });

  return contracts;
}

/**
 * Fetch the full real-time options chain for a symbol (with greeks).
 * Used by the open pass to select a contract by delta/DTE.
 */
export async function getRealtimeOptionsChain(
  symbol: string,
): Promise<HistoricalOptionContract[]> {
  return callPartnerRealtimeOptions({ symbol, requireGreeks: true });
}

/**
 * Fetch a single already-selected real-time option contract quote.
 * Returns null if the contract is not present in the upstream response.
 */
export async function getRealtimeOptionsQuote(
  symbol: string,
  contractID: string,
): Promise<HistoricalOptionContract | null> {
  const contracts = await callPartnerRealtimeOptions({
    symbol,
    contractID,
    requireGreeks: true,
  });
  const target = contractID.trim().toUpperCase();
  const match = contracts.find(
    (c) => (c.contractID ?? '').trim().toUpperCase() === target,
  );
  return match ?? null;
}
