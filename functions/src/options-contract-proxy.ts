import * as logger from "firebase-functions/logger";
import { PartnerEndpointPath, PartnerHistoricalOptionsResponse, PartnerHistoricalOptionsContractV2Response, PartnerListContractsV2Response, ContractCatalogResponse, ContractSummaryResponse } from './types/partner';
import { parseOccContractId } from '@options-contract/contracts';
import type { QueryContractCatalogRequest } from '@options-contract/contracts';
import { PARTNER_AUDIENCE, CALLER_SA, PartnerHttpError, generateIdTokenWithEmail, fetchWithRetry } from './partner-infrastructure';

// ==========================
// URL + audience constants
// ==========================

const PARTNER_HISTORICAL_OPTIONS_URL =
  process.env.PARTNER_HISTORICAL_OPTIONS_URL ||
  `${PARTNER_AUDIENCE.replace(/\/$/, '')}/${PartnerEndpointPath.HISTORICAL_OPTIONS}`;

const PARTNER_HISTORICAL_OPTIONS_AUDIENCE =
  process.env.PARTNER_HISTORICAL_OPTIONS_AUDIENCE || PARTNER_HISTORICAL_OPTIONS_URL;

const PARTNER_HISTORICAL_OPTIONS_CONTRACT_V2_URL =
  process.env.PARTNER_HISTORICAL_OPTIONS_CONTRACT_V2_URL ||
  `${PARTNER_AUDIENCE.replace(/\/$/, '')}/${PartnerEndpointPath.HISTORICAL_OPTIONS_CONTRACT_V2}`;

const PARTNER_HISTORICAL_OPTIONS_CONTRACT_V2_AUDIENCE =
  process.env.PARTNER_HISTORICAL_OPTIONS_CONTRACT_V2_AUDIENCE || PARTNER_HISTORICAL_OPTIONS_CONTRACT_V2_URL;

const PARTNER_LIST_CONTRACTS_V2_URL =
  process.env.PARTNER_LIST_CONTRACTS_V2_URL ||
  `${PARTNER_AUDIENCE.replace(/\/$/, '')}/${PartnerEndpointPath.LIST_CONTRACTS_V2}`;

const PARTNER_LIST_CONTRACTS_V2_AUDIENCE =
  process.env.PARTNER_LIST_CONTRACTS_V2_AUDIENCE || PARTNER_LIST_CONTRACTS_V2_URL;

const PARTNER_CONTRACT_CATALOG_V2_URL =
  process.env.PARTNER_CONTRACT_CATALOG_V2_URL ||
  `${PARTNER_AUDIENCE.replace(/\/$/, '')}/${PartnerEndpointPath.CONTRACT_CATALOG_V2}`;

const PARTNER_CONTRACT_CATALOG_V2_AUDIENCE =
  process.env.PARTNER_CONTRACT_CATALOG_V2_AUDIENCE || PARTNER_CONTRACT_CATALOG_V2_URL;

// ==========================
// Deprecated helpers (scheduled for removal once partnerListContractsV2 is broken in)
// ==========================

/**
 * @deprecated Superseded by partnerListContractsV2 — scheduled for removal once the
 * contract discovery endpoint is broken in and the UI uses listContracts$() instead.
 *
 * Map a length token (e.g. '0DTE', '1W', '1M', '3Y') to a target day range.
 */
function targetDaysFromLength(length: string): number | null {
  switch (length.toUpperCase()) {
    case '0DTE': return 0;
    case '1D': return 1;
    case '2D': return 2;
    case '3D': return 3;
    case '5D': return 5;
    case '1W': return 7;
    case '2W': return 14;
    case '3W': return 21;
    case '1M': return 30;
    case '2M': return 60;
    case '3M': return 90;
    case '6M': return 180;
    case '9M': return 270;
    case '12M': return 365;
    case '1Y': return 365;
    case '2Y': return 730;
    case '3Y': return 1095;
    case 'LEAP': return 365;
    default: return null;
  }
}

/**
 * @deprecated Superseded by partnerListContractsV2 — scheduled for removal once the
 * contract discovery endpoint is broken in and the UI uses listContracts$() instead.
 *
 * Parse days from a timeUntilExpiration string like "30 days" or "1 year".
 */
function parseTimeUntilExpiration(value: string): number | null {
  if (!value) return null;
  const normalized = value.toLowerCase().trim();
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(day|days|week|weeks|month|months|year|years)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2];
  if (unit.startsWith('year')) return Math.round(amount * 365);
  if (unit.startsWith('month')) return Math.round(amount * 30);
  if (unit.startsWith('week')) return Math.round(amount * 7);
  return Math.round(amount);
}

/**
 * @deprecated Superseded by partnerListContractsV2 — scheduled for removal once the
 * contract discovery endpoint is broken in and the UI uses listContracts$() instead.
 *
 * Resolve a contractID to the variant matching the requested length.
 *
 * Strategy:
 * 1. Query the latest available options chain (no snapshot date) so the
 *    timeUntilExpiration values reflect a current market snapshot.
 * 2. Filter by type/strike/expiration and pick the contract whose
 *    timeUntilExpiration is closest to the requested length.
 * 3. If the latest chain has no match, fall back to the historical chain
 *    for the expiration date itself.
 */
async function resolveContractIdByLength(params: {
  symbol: string;
  contractID: string;
  length: string;
}): Promise<string> {
  const parsed = parseOccContractId(params.contractID);
  if (!parsed) return params.contractID;

  const targetDays = targetDaysFromLength(params.length);
  if (targetDays == null) return params.contractID;

  const snapshots: { date?: string }[] = [
    {}, // latest chain first
    { date: parsed.expiration }, // fallback: historical snapshot on expiration date
  ];

  for (const snapshot of snapshots) {
    try {
      const chain = await callPartnerHistoricalOptions({
        symbol: params.symbol,
        ...snapshot,
      });

      const allContracts = chain?.data?.data ?? [];
      const candidates = allContracts.filter((c) => {
        const cType = String(c.type || '').toUpperCase();
        const cStrike = Number(c.strike);
        return (
          cType === parsed.type &&
          Number.isFinite(cStrike) &&
          Math.abs(cStrike - parsed.strike) < 0.001
        );
      });

      if (candidates.length === 0) {
        const sample = allContracts[0];
        logger.warn('resolveContractIdByLength_no_candidates', {
          symbol: params.symbol,
          parsedType: parsed.type,
          parsedStrike: parsed.strike,
          totalContracts: allContracts.length,
          sampleType: sample?.type,
          sampleStrike: sample?.strike,
          sampleExpiration: sample?.expiration,
          snapshotDate: snapshot.date ?? null,
        });
        continue;
      }

      let best = candidates[0];
      let bestDiff = Infinity;
      for (const candidate of candidates) {
        const days = parseTimeUntilExpiration(
          chain?.analysis?.expirations?.find((e) => e.expiration === candidate.expiration)?.timeUntilExpiration ?? '',
        );
        if (days == null) continue;
        const diff = Math.abs(days - targetDays);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = candidate;
        }
      }

      const resolved = best.contractID?.trim().toUpperCase();
      if (resolved) {
        logger.info('resolveContractIdByLength_success', {
          symbol: params.symbol,
          requestedContractID: params.contractID,
          resolvedContractID: resolved,
          length: params.length,
          targetDays,
          bestDiff,
          snapshotDate: snapshot.date ?? null,
        });
        return resolved;
      }
    } catch (e) {
      logger.warn('resolveContractIdByLength_snapshot_fallback', {
        symbol: params.symbol,
        contractID: params.contractID,
        length: params.length,
        snapshotDate: snapshot.date ?? null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return params.contractID;
}

// ==========================
// Proxy functions
// ==========================

/**
 * Call Savant Partner Historical Options endpoint for one symbol and optional date.
 * Returns the full Alpha Vantage historical options chain for that session.
 */
export async function callPartnerHistoricalOptions(params: {
  symbol: string;
  date?: string;
}): Promise<PartnerHistoricalOptionsResponse> {
  const audience = PARTNER_HISTORICAL_OPTIONS_AUDIENCE;
  const idToken = await generateIdTokenWithEmail(audience, CALLER_SA);

  const search = new URLSearchParams();
  search.set('symbol', params.symbol);
  if (params.date) search.set('date', params.date);

  const url = `${PARTNER_HISTORICAL_OPTIONS_URL}?${search.toString()}`;

  logger.info('partnerHistoricalOptions_request', {
    symbol: params.symbol,
    date: params.date ?? null,
    url,
    audience,
  });

  const resp = await fetchWithRetry(url, { Authorization: `Bearer ${idToken}` });
  const text = await resp.text();

  if (!resp.ok) {
    logger.error('partnerHistoricalOptions_upstream_error', {
      symbol: params.symbol,
      date: params.date ?? null,
      status: resp.status,
      url,
      audience,
      callerSa: CALLER_SA,
      snippet: typeof text === 'string' ? text.slice(0, 500) : undefined,
    });
    throw new PartnerHttpError(
      `partnerHistoricalOptions upstream ${resp.status}: ${text}`,
      resp.status,
    );
  }

  let parsed: PartnerHistoricalOptionsResponse;
  try {
    parsed = JSON.parse(text) as PartnerHistoricalOptionsResponse;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('partnerHistoricalOptions_parse_error', {
      symbol: params.symbol,
      date: params.date ?? null,
      message,
      snippet: text.slice(0, 500),
    });
    throw e;
  }

  const contracts = parsed?.data?.data;
  logger.info('partnerHistoricalOptions_response', {
    symbol: parsed.symbol,
    date: parsed.date,
    contractCount: Array.isArray(contracts) ? contracts.length : 0,
    processingTimeMs: parsed.processingTimeMs,
  });

  return parsed;
}

/**
 * Call Savant Partner Historical Options Contract V2 endpoint for a single contract time series.
 * Returns one contract's daily observations from the GCS corpus.
 */
export async function callPartnerHistoricalOptionsContractV2(params: {
  symbol: string;
  contractID: string;
  startDate?: string;
  endDate?: string;
  length?: string | null;
}): Promise<PartnerHistoricalOptionsContractV2Response> {
  const audience = PARTNER_HISTORICAL_OPTIONS_CONTRACT_V2_AUDIENCE;
  const idToken = await generateIdTokenWithEmail(audience, CALLER_SA);

  let resolvedContractID = params.contractID;
  if (params.length) {
    resolvedContractID = await resolveContractIdByLength({
      symbol: params.symbol,
      contractID: params.contractID,
      length: params.length,
    });
  }

  const search = new URLSearchParams();
  search.set('symbol', params.symbol);
  search.set('contractID', resolvedContractID);
  if (params.startDate) search.set('startDate', params.startDate);
  if (params.endDate) search.set('endDate', params.endDate);

  const url = `${PARTNER_HISTORICAL_OPTIONS_CONTRACT_V2_URL}?${search.toString()}`;

  logger.info('partnerHistoricalOptionsContractV2_request', {
    symbol: params.symbol,
    contractID: params.contractID,
    resolvedContractID,
    length: params.length ?? null,
    startDate: params.startDate ?? null,
    endDate: params.endDate ?? null,
    url,
    audience,
  });

  const resp = await fetchWithRetry(url, { Authorization: `Bearer ${idToken}` });
  const text = await resp.text();

  if (!resp.ok) {
    logger.error('partnerHistoricalOptionsContractV2_upstream_error', {
      symbol: params.symbol,
      contractID: params.contractID,
      startDate: params.startDate ?? null,
      endDate: params.endDate ?? null,
      status: resp.status,
      url,
      audience,
      callerSa: CALLER_SA,
      snippet: typeof text === 'string' ? text.slice(0, 500) : undefined,
    });
    throw new PartnerHttpError(
      `partnerHistoricalOptionsContractV2 upstream ${resp.status}: ${text}`,
      resp.status,
    );
  }

  let parsed: PartnerHistoricalOptionsContractV2Response;
  try {
    parsed = JSON.parse(text) as PartnerHistoricalOptionsContractV2Response;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('partnerHistoricalOptionsContractV2_parse_error', {
      symbol: params.symbol,
      contractID: params.contractID,
      startDate: params.startDate ?? null,
      endDate: params.endDate ?? null,
      message,
      snippet: text.slice(0, 500),
    });
    throw e;
  }

  logger.info('partnerHistoricalOptionsContractV2_response', {
    symbol: parsed.symbol,
    contractID: parsed.contractID,
    expiration: parsed.expiration,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    seriesCount: Array.isArray(parsed.series) ? parsed.series.length : 0,
  });

  return parsed;
}

/**
 * Call Savant Partner List Contracts V2 endpoint to discover available option
 * contract IDs in GCS storage for a given symbol, filtered by expiration/strike/type.
 */
export async function callPartnerListContractsV2(params: {
  symbol: string;
  expiration?: string;
  strike?: number;
  type?: 'C' | 'P';
}): Promise<PartnerListContractsV2Response> {
  const audience = PARTNER_LIST_CONTRACTS_V2_AUDIENCE;
  const idToken = await generateIdTokenWithEmail(audience, CALLER_SA);

  const search = new URLSearchParams();
  search.set('symbol', params.symbol);
  if (params.expiration) search.set('expiration', params.expiration);
  if (params.strike != null) search.set('strike', String(params.strike));
  if (params.type) search.set('type', params.type);

  const url = `${PARTNER_LIST_CONTRACTS_V2_URL}?${search.toString()}`;

  logger.info('partnerListContractsV2_request', {
    symbol: params.symbol,
    expiration: params.expiration ?? null,
    strike: params.strike ?? null,
    type: params.type ?? null,
    url,
    audience,
  });

  const resp = await fetchWithRetry(url, { Authorization: `Bearer ${idToken}` });
  const text = await resp.text();

  if (!resp.ok) {
    logger.error('partnerListContractsV2_upstream_error', {
      symbol: params.symbol,
      expiration: params.expiration ?? null,
      strike: params.strike ?? null,
      type: params.type ?? null,
      status: resp.status,
      url,
      audience,
      callerSa: CALLER_SA,
      snippet: typeof text === 'string' ? text.slice(0, 500) : undefined,
    });
    throw new PartnerHttpError(
      `partnerListContractsV2 upstream ${resp.status}: ${text}`,
      resp.status,
    );
  }

  let parsed: PartnerListContractsV2Response;
  try {
    parsed = JSON.parse(text) as PartnerListContractsV2Response;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('partnerListContractsV2_parse_error', {
      symbol: params.symbol,
      expiration: params.expiration ?? null,
      strike: params.strike ?? null,
      type: params.type ?? null,
      message,
      snippet: text.slice(0, 500),
    });
    throw e;
  }

  logger.info('partnerListContractsV2_response', {
    symbol: parsed.symbol,
    contractCount: parsed.count,
  });

  return parsed;
}

/**
 * Call Savant Partner Contract Catalog V2 endpoint to query contract metadata
 * with filtering, sorting, and pagination. Supports summary mode (length-bucket
 * histogram) and catalog mode (paginated contract entries with latest greeks).
 */
export async function callPartnerContractCatalogV2(
  params: QueryContractCatalogRequest,
): Promise<ContractCatalogResponse | ContractSummaryResponse> {
  const audience = PARTNER_CONTRACT_CATALOG_V2_AUDIENCE;
  const idToken = await generateIdTokenWithEmail(audience, CALLER_SA);

  const search = new URLSearchParams();
  search.set('symbol', params.symbol);
  if (params.summary) search.set('summary', 'true');
  if (params.expiration) search.set('expiration', params.expiration);
  if (params.expirationGte) search.set('expirationGte', params.expirationGte);
  if (params.expirationLte) search.set('expirationLte', params.expirationLte);
  if (params.contractLengthBucket) search.set('contractLengthBucket', params.contractLengthBucket);
  if (params.type) search.set('type', params.type);
  if (params.strike != null) search.set('strike', String(params.strike));
  if (params.strikeGte != null) search.set('strikeGte', String(params.strikeGte));
  if (params.strikeLte != null) search.set('strikeLte', String(params.strikeLte));
  if (params.deltaGte != null) search.set('deltaGte', String(params.deltaGte));
  if (params.deltaLte != null) search.set('deltaLte', String(params.deltaLte));
  if (params.ivGte != null) search.set('ivGte', String(params.ivGte));
  if (params.ivLte != null) search.set('ivLte', String(params.ivLte));
  if (params.minObservationCount != null) search.set('minObservationCount', String(params.minObservationCount));
  if (params.sortBy) search.set('sortBy', params.sortBy);
  if (params.sortOrder) search.set('sortOrder', params.sortOrder);
  if (params.pageSize != null) search.set('pageSize', String(params.pageSize));
  if (params.pageToken) search.set('pageToken', params.pageToken);

  const url = `${PARTNER_CONTRACT_CATALOG_V2_URL}?${search.toString()}`;

  logger.info('partnerContractCatalogV2_request', {
    symbol: params.symbol,
    summary: params.summary ?? false,
    expiration: params.expiration ?? null,
    expirationGte: params.expirationGte ?? null,
    expirationLte: params.expirationLte ?? null,
    contractLengthBucket: params.contractLengthBucket ?? null,
    type: params.type ?? null,
    strike: params.strike ?? null,
    strikeGte: params.strikeGte ?? null,
    strikeLte: params.strikeLte ?? null,
    deltaGte: params.deltaGte ?? null,
    deltaLte: params.deltaLte ?? null,
    ivGte: params.ivGte ?? null,
    ivLte: params.ivLte ?? null,
    minObservationCount: params.minObservationCount ?? null,
    sortBy: params.sortBy ?? null,
    sortOrder: params.sortOrder ?? null,
    pageSize: params.pageSize ?? null,
    hasPageToken: !!params.pageToken,
    url,
    audience,
  });

  const resp = await fetchWithRetry(url, { Authorization: `Bearer ${idToken}` });
  const text = await resp.text();

  if (!resp.ok) {
    logger.error('partnerContractCatalogV2_upstream_error', {
      symbol: params.symbol,
      summary: params.summary ?? false,
      status: resp.status,
      url,
      audience,
      callerSa: CALLER_SA,
      snippet: typeof text === 'string' ? text.slice(0, 500) : undefined,
    });
    throw new PartnerHttpError(
      `partnerContractCatalogV2 upstream ${resp.status}: ${text}`,
      resp.status,
    );
  }

  let parsed: ContractCatalogResponse | ContractSummaryResponse;
  try {
    parsed = JSON.parse(text) as ContractCatalogResponse | ContractSummaryResponse;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('partnerContractCatalogV2_parse_error', {
      symbol: params.symbol,
      summary: params.summary ?? false,
      message,
      snippet: text.slice(0, 500),
    });
    throw e;
  }

  if (params.summary) {
    const summary = parsed as ContractSummaryResponse;
    // Normalize legacy shape: SA may still return Record<string, number> instead of LengthBucket[]
    if (summary.lengthBuckets && !Array.isArray(summary.lengthBuckets)) {
      const legacy = summary.lengthBuckets as unknown as Record<string, number>;
      const BUCKET_ORDER = ['1d','3d','5d','7d','14d','21d','1mo','1.5mo','2mo','3mo','4mo','6mo','9mo','1yr','2yr','3yr'];
      summary.lengthBuckets = BUCKET_ORDER
        .filter((label) => legacy[label] != null)
        .map((label, i) => ({ label, count: legacy[label], sortOrder: i }));
    }
    logger.info('partnerContractCatalogV2_summary_response', {
      symbol: summary.symbol,
      totalContracts: summary.totalContracts,
      expirationCount: summary.expirationCount,
      bucketCount: (summary.lengthBuckets ?? []).length,
    });
  } else {
    const catalog = parsed as ContractCatalogResponse;
    logger.info('partnerContractCatalogV2_catalog_response', {
      symbol: catalog.symbol,
      contractCount: catalog.count,
      hasMore: !!catalog.nextPageToken,
    });
  }

  return parsed;
}
