import {onRequest, onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {GoogleAuth} from "google-auth-library";
import {db, FieldValue} from "./firebase-admin-init";
import { GetTrackedSymbolsResponse, TrackedSymbolDTO, PartnerEndpointPath, PartnerMarketHolidaysResponse, PartnerIntradaySnapshotResponse, PartnerListTrackedSymbolsResponse, PartnerCompanyOverviewResponse, PartnerHistoricalOptionsResponse, PartnerHistoricalOptionsContractV2Response } from './types/partner';
import { parseOccContractId } from '@options-contract/contracts';
import { DEFAULT_PARTNER_CALLER_SA, IAM_CREDENTIALS_BASE_URL, OAUTH_CLOUD_PLATFORM_SCOPE, IAM_SERVICE_ACCOUNTS_PATH, IamCredentialsMethod } from './config/constants';
import { persistWarning } from './logging/warn';
import { ENABLE_CONSOLE_LOGGING, RsCloudFunctionName } from './webhooks/webhooks-config';

// Base host retained for compatibility, but audiences should be function URLs per SA quickstart
export const PARTNER_AUDIENCE =
  process.env.PARTNER_AUDIENCE ||
  "https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net";

// Function URLs (use these for both request URL and ID token audience)
const PARTNER_TRACKED_SYMBOLS_URL =
  process.env.PARTNER_TRACKED_SYMBOLS_URL ||
  `${PARTNER_AUDIENCE.replace(/\/$/, "")}/${PartnerEndpointPath.TRACKED_SYMBOLS}`;

const PARTNER_TS_URL =
  process.env.PARTNER_TS_URL ||
  `${PARTNER_AUDIENCE.replace(/\/$/, "")}/${PartnerEndpointPath.TIME_SERIES}`;

const PARTNER_MARKET_HOLIDAYS_URL =
  process.env.PARTNER_MARKET_HOLIDAYS_URL ||
  `${PARTNER_AUDIENCE.replace(/\/$/, "")}/${PartnerEndpointPath.MARKET_HOLIDAYS}`;

const PARTNER_INTRADAY_SNAPSHOT_URL =
  process.env.PARTNER_INTRADAY_SNAPSHOT_URL ||
  `${PARTNER_AUDIENCE.replace(/\/$/, "")}/${PartnerEndpointPath.INTRADAY_SNAPSHOT}`;

// Optional separate audience overrides (default to URLs above)
const PARTNER_TRACKED_SYMBOLS_AUDIENCE =
  process.env.PARTNER_TRACKED_SYMBOLS_AUDIENCE || PARTNER_TRACKED_SYMBOLS_URL;
const PARTNER_TS_AUDIENCE = process.env.PARTNER_TS_AUDIENCE || PARTNER_TS_URL;
const PARTNER_MARKET_HOLIDAYS_AUDIENCE =
  process.env.PARTNER_MARKET_HOLIDAYS_AUDIENCE || PARTNER_MARKET_HOLIDAYS_URL;

const PARTNER_INTRADAY_SNAPSHOT_AUDIENCE =
  process.env.PARTNER_INTRADAY_SNAPSHOT_AUDIENCE || PARTNER_INTRADAY_SNAPSHOT_URL;

const PARTNER_COMPANY_OVERVIEW_URL =
  process.env.PARTNER_COMPANY_OVERVIEW_URL ||
  `${PARTNER_AUDIENCE.replace(/\/$/, '')}/${PartnerEndpointPath.COMPANY_OVERVIEW}`;

const PARTNER_COMPANY_OVERVIEW_AUDIENCE =
  process.env.PARTNER_COMPANY_OVERVIEW_AUDIENCE || PARTNER_COMPANY_OVERVIEW_URL;

const PARTNER_HISTORICAL_OPTIONS_URL =
  process.env.PARTNER_HISTORICAL_OPTIONS_URL ||
  `${PARTNER_AUDIENCE.replace(/\/$/, '')}/${PartnerEndpointPath.HISTORICAL_OPTIONS}`;

const PARTNER_HISTORICAL_OPTIONS_AUDIENCE =
  process.env.PARTNER_HISTORICAL_OPTIONS_AUDIENCE || PARTNER_HISTORICAL_OPTIONS_URL;

const PARTNER_HISTORICAL_OPTIONS_CONTRACT_V2_URL =
  process.env.PARTNER_HISTORICAL_OPTIONS_CONTRACT_V2_URL ||
  `${PARTNER_AUDIENCE.replace(/\/\$/, '')}/${PartnerEndpointPath.HISTORICAL_OPTIONS_CONTRACT_V2}`;

const PARTNER_HISTORICAL_OPTIONS_CONTRACT_V2_AUDIENCE =
  process.env.PARTNER_HISTORICAL_OPTIONS_CONTRACT_V2_AUDIENCE || PARTNER_HISTORICAL_OPTIONS_CONTRACT_V2_URL;

// Service account email for rel-str prod
const CALLER_SA = process.env.PARTNER_CALLER_SA || DEFAULT_PARTNER_CALLER_SA;

/** Error thrown by partner API calls; carries the HTTP status code for typed handling. */
export class PartnerHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'PartnerHttpError';
  }
}

/** Public DTO and response interfaces are declared in './types/partner' */

/**
 * Generate a Google ID token with includeEmail=true for the given audience using
 * IAM Credentials API `projects/-/serviceAccounts/{sa}:generateIdToken`.
 * Works with local impersonation (GOOGLE_IMPERSONATE_SERVICE_ACCOUNT) and in prod
 * where the function runs under the desired runtime service account.
 */
async function generateIdTokenWithEmail(audience: string, serviceAccountEmail: string): Promise<string> {
  const auth = new GoogleAuth({ scopes: [OAUTH_CLOUD_PLATFORM_SCOPE] });
  // Acquire an access token to call IAM Credentials
  const accessToken = await auth.getAccessToken();
  const url = `${IAM_CREDENTIALS_BASE_URL}/${IAM_SERVICE_ACCOUNTS_PATH}/${encodeURIComponent(serviceAccountEmail)}:${IamCredentialsMethod.GENERATE_ID_TOKEN}`;
  const body = { audience, includeEmail: true };
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`generateIdToken failed: ${resp.status} ${resp.statusText} :: ${text}`);
  }
  const data = (await resp.json()) as { token: string };
  return data.token;
}

export type PartnerInterval = "DAILY" | "WEEKLY" | "MONTHLY";

/** Simple bounded retry with exponential backoff + jitter for transient upstream errors. */
async function fetchWithRetry(url: string, headers: Record<string, string>, maxAttempts = 3): Promise<Response> {
  let lastResp: Response | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch(url, { headers });
    if (resp.ok) return resp;
    lastResp = resp;
    const retriable = [429, 500, 502, 503, 504].includes(resp.status);
    if (!retriable || attempt === maxAttempts) return resp;
    const base = 200 * Math.pow(2, attempt - 1);
    const jitter = Math.floor(Math.random() * 150);
    await new Promise((r) => setTimeout(r, base + jitter));
  }
  // Fallback, should not reach here
  return lastResp as Response;
}

/**
 * Call Savant Partner Time Series API.
 * Params mirror partner docs: symbol, interval, optional range/from/to/limit.
 */
export async function callPartnerTimeSeries(params: {
  symbol: string;
  interval: PartnerInterval;
  range?: string;
  from?: string | number;
  to?: string | number;
  limit?: string | number;
  adjusted?: boolean;
}) {
  // Per SA quickstart, use function URL for request; audience defaults to URL but is overrideable
  const audience = PARTNER_TS_AUDIENCE;
  const idToken = await generateIdTokenWithEmail(audience, CALLER_SA);
  const search = new URLSearchParams();
  search.set("symbol", params.symbol);
  search.set("interval", params.interval);
  if (params.range) search.set("range", String(params.range));
  if (params.from !== undefined) search.set("from", String(params.from));
  if (params.to !== undefined) search.set("to", String(params.to));
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.adjusted !== undefined) search.set("adjusted", String(params.adjusted));
  const url = `${PARTNER_TS_URL}?${search.toString()}`;

  // NOTE: Controlled via ENABLE_CONSOLE_LOGGING to avoid excessive emulator/prod noise.
  if (ENABLE_CONSOLE_LOGGING) {
    logger.info("partnerTimeSeries_request", {
      symbol: params.symbol,
      interval: params.interval,
      range: params.range ?? null,
      from: params.from ?? null,
      to: params.to ?? null,
      limit: params.limit ?? null,
      adjusted: params.adjusted ?? null,
      url,
      audience,
    });
  }

  const resp = await fetchWithRetry(url, { Authorization: `Bearer ${idToken}` });
  if (!resp.ok) {
    const text = await resp.text();
    logger.error("partnerTimeSeries upstream error", {
      status: resp.status,
      url,
      audience,
      callerSa: CALLER_SA,
      snippet: typeof text === "string" ? text.slice(0, 500) : undefined,
    });
    throw new Error(`partnerTimeSeries upstream ${resp.status}: ${text}`);
  }
  return (await resp.json()) as unknown;
}

/** Call Savant Partner Market Holidays endpoint for a given year. */
export async function callPartnerMarketHolidays(params: { year: number | string }): Promise<PartnerMarketHolidaysResponse> {
  const yearStr = String(params.year).slice(0, 4);
  const audience = PARTNER_MARKET_HOLIDAYS_AUDIENCE;
  const idToken = await generateIdTokenWithEmail(audience, CALLER_SA);
  const search = new URLSearchParams();
  search.set('year', yearStr);
  const url = `${PARTNER_MARKET_HOLIDAYS_URL}?${search.toString()}`;

  logger.info('partnerMarketHolidays_request', { year: yearStr, url, audience });

  const resp = await fetchWithRetry(url, { Authorization: `Bearer ${idToken}` });
  const text = await resp.text();
  if (!resp.ok) {
    logger.error('partnerMarketHolidays_upstream_error', {
      status: resp.status,
      url,
      audience,
      callerSa: CALLER_SA,
      snippet: typeof text === 'string' ? text.slice(0, 500) : undefined,
    });
    throw new Error(`partnerMarketHolidays upstream ${resp.status}: ${text}`);
  }

  let parsed: PartnerMarketHolidaysResponse;
  try {
    parsed = JSON.parse(text) as PartnerMarketHolidaysResponse;
  } catch (e: any) {
    logger.error('partnerMarketHolidays_parse_error', { year: yearStr, message: e?.message, snippet: text.slice(0, 500) });
    throw e;
  }

  logger.info('partnerMarketHolidays_response', {
    year: parsed.year,
    holidays: Array.isArray(parsed.holidays) ? parsed.holidays.length : 0,
    processingTimeMs: parsed.processingTimeMs ?? null,
  });

  return parsed;
}

/**
 * Call Savant Partner Intraday Snapshot API.
 * Bulk endpoint for fetching current intraday prices for all symbols.
 */
export async function callPartnerIntradaySnapshotV2(symbols: string[]): Promise<PartnerIntradaySnapshotResponse> {
  const audience = PARTNER_INTRADAY_SNAPSHOT_AUDIENCE;
  const idToken = await generateIdTokenWithEmail(audience, CALLER_SA);
  const url = PARTNER_INTRADAY_SNAPSHOT_URL;

  const body = { symbols };

  logger.info('partnerIntradaySnapshot_request', { symbolCount: symbols.length, url, audience });

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  if (!resp.ok) {
    logger.error('partnerIntradaySnapshot_upstream_error', {
      status: resp.status,
      url,
      audience,
      callerSa: CALLER_SA,
      symbolCount: symbols.length,
      snippet: typeof text === 'string' ? text.slice(0, 500) : undefined,
    });
    throw new Error(`partnerIntradaySnapshot upstream ${resp.status}: ${text}`);
  }

  let parsed: PartnerIntradaySnapshotResponse;
  try {
    parsed = JSON.parse(text) as PartnerIntradaySnapshotResponse;
  } catch (e: any) {
    logger.error('partnerIntradaySnapshot_parse_error', { message: e?.message, snippet: text.slice(0, 500) });
    throw e;
  }

  logger.info('partnerIntradaySnapshot_response', {
    marketDate: parsed.marketDate,
    count: parsed.count,
  });

  return parsed;
}

/**
 * Call Savant Partner Company Overview endpoint for a single symbol.
 * Returns 404 for non-equity symbols (ETFs, indexes) — caller should handle gracefully.
 */
export async function callPartnerCompanyOverview(symbol: string): Promise<PartnerCompanyOverviewResponse> {
  const audience = PARTNER_COMPANY_OVERVIEW_AUDIENCE;
  const idToken = await generateIdTokenWithEmail(audience, CALLER_SA);
  const url = `${PARTNER_COMPANY_OVERVIEW_URL}?symbol=${encodeURIComponent(symbol)}`;

  logger.info('partnerCompanyOverview_request', { symbol, url, audience });

  const resp = await fetchWithRetry(url, { Authorization: `Bearer ${idToken}` });
  const text = await resp.text();

  if (!resp.ok) {
    logger.error('partnerCompanyOverview_upstream_error', {
      symbol, status: resp.status, url, callerSa: CALLER_SA,
      snippet: typeof text === 'string' ? text.slice(0, 300) : undefined,
    });
    throw new PartnerHttpError(`partnerCompanyOverview upstream ${resp.status}: ${text}`, resp.status);
  }

  let parsed: PartnerCompanyOverviewResponse;
  try {
    parsed = JSON.parse(text) as PartnerCompanyOverviewResponse;
  } catch (e: any) {
    logger.error('partnerCompanyOverview_parse_error', { symbol, message: e?.message, snippet: text.slice(0, 300) });
    throw e;
  }

  logger.info('partnerCompanyOverview_response', {
    symbol: parsed.symbol, sector: parsed.data?.['Sector'], processingTimeMs: parsed.processingTimeMs,
  });

  return parsed;
}

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

/** Parse days from a timeUntilExpiration string like "30 days" or "1 year". */
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

      const candidates = (chain?.data?.data ?? []).filter((c) => {
        const cType = String(c.type || '').toUpperCase();
        const cStrike = Number(c.strike);
        const cExpiration = String(c.expiration || '').trim();
        return (
          cType === parsed.type &&
          Number.isFinite(cStrike) &&
          Math.abs(cStrike - parsed.strike) < 0.001 &&
          cExpiration === parsed.expiration
        );
      });

      if (candidates.length === 0) continue;

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

/** Call Savant Partner Tracked Symbols endpoint. Returns full universe. */
export async function callPartnerTrackedSymbols(): Promise<PartnerListTrackedSymbolsResponse> {
  const audience = PARTNER_TRACKED_SYMBOLS_AUDIENCE;
  const idToken = await generateIdTokenWithEmail(audience, CALLER_SA);
  // Fetch all symbols (no limit) - activeOnly=true for tradeable symbols only
  const url = `${PARTNER_TRACKED_SYMBOLS_URL}?activeOnly=true`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  if (!resp.ok) {
    const text = await resp.text();
    logger.error("partnerTrackedSymbols upstream error", {
      status: resp.status,
      url,
      audience,
      callerSa: CALLER_SA,
      snippet: typeof text === "string" ? text.slice(0, 500) : undefined,
    });
    throw new Error(`partnerTrackedSymbols upstream ${resp.status}: ${text}`);
  }
  return (await resp.json()) as PartnerListTrackedSymbolsResponse;
}

/**
 * HTTPS function: partnerProxyTest
 * Calls savant Partner Time Series API using OIDC from the rel-str
 * service account. Returns the proxied payload for diagnostics.
 */
export const partnerProxyTest = onRequest(
  {
    region: "us-central1",
    serviceAccount: CALLER_SA,
    timeoutSeconds: 60,
  },
  async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || "AAPL";
      const interval = (req.query.interval as string) || "DAILY";
      const range = (req.query.range as string) || "1y";
      const adjusted = req.query.adjusted === 'true';

      const data = await callPartnerTimeSeries({
        symbol,
        interval: interval as PartnerInterval,
        range,
        adjusted,
      });
      logger.info("partnerProxyTest upstream success");

      res.status(200).json(data);
    } catch (err: unknown) {
      const anyErr = err as any;
      const upstreamStatus = anyErr?.response?.status as number | undefined;
      const upstreamData = anyErr?.response?.data as unknown;
      const e = err as {message?: string; code?: string; stack?: string};
      logger.error("partnerProxyTest error", {
        message: e?.message,
        code: e?.code,
        stack: e?.stack,
        upstreamStatus,
        upstreamDataSnippet:
          typeof upstreamData === "string" ? upstreamData.slice(0, 500) : upstreamData,
      });
      res.status(upstreamStatus || 500).json({
        ok: false,
        error: "partnerProxyTest_failed",
        message: e?.message || "Unknown error",
        upstreamStatus,
      });
    }
  }
);

/** Callable: getTrackedSymbols */
export const getTrackedSymbols = onCall({ region: "us-central1" }, async (req): Promise<GetTrackedSymbolsResponse> => {
  const ttlSeconds = Math.max(60, Math.min(3600, Number(req.data?.ttlSeconds ?? 600)));
  const now = Date.now();
  const cacheRef = db.collection("app").doc("trackedSymbolsCache");

  try {
    // Try cache first
    const snap = await cacheRef.get();
    const cache = (snap.exists ? (snap.data() as any) : undefined) || undefined;
    const updatedAt = Number(cache?.updatedAt || 0);
    if (cache?.items && Number.isFinite(updatedAt) && now - updatedAt < ttlSeconds * 1000) {
      return { items: cache.items as TrackedSymbolDTO[], cached: true, updatedAt };
    }
  } catch (e: any) {
    logger.warn("getTrackedSymbols cache read failed", { message: e?.message });
    // Persist as a warning event for UI visibility (best-effort)
    await persistWarning('tracked_symbols_cache_read_failed', { function: RsCloudFunctionName.GET_TRACKED_SYMBOLS, message: e?.message });
  }

  // Fetch from partner
  let upstream: any;
  try {
    upstream = await callPartnerTrackedSymbols();
  } catch (e: any) {
    logger.error("getTrackedSymbols upstream error", { message: e?.message, status: e?.response?.status });
    throw e;
  }

  // Normalize upstream payload to a flat array of symbol records the UI can consume
  const items: TrackedSymbolDTO[] = Array.isArray(upstream)
    ? upstream.map((r: any) => ({
        symbol: String(r?.symbol || r?.id || "").toUpperCase(),
        name: r?.name ?? r?.company ?? undefined,
        exchange: r?.exchange ?? undefined,
        sector: r?.sector ?? undefined,
        supported: r?.supported !== false, // default true unless explicitly false
        isBaseline: r?.isBaseline === true,
      }))
    : Array.isArray(upstream?.items)
      ? upstream.items.map((r: any) => ({
          symbol: String(r?.symbol || r?.id || "").toUpperCase(),
          name: r?.name ?? r?.company ?? undefined,
          exchange: r?.exchange ?? undefined,
          sector: r?.sector ?? undefined,
          supported: r?.supported !== false,
          isBaseline: r?.isBaseline === true,
        }))
      : Array.isArray(upstream?.symbols)
        ? upstream.symbols.map((r: any) => ({
            symbol: String(r?.symbol || r?.id || "").toUpperCase(),
            name: r?.name ?? r?.company ?? undefined,
            exchange: r?.exchange ?? undefined,
            sector: r?.sector ?? undefined,
            supported: r?.supported !== false,
            isBaseline: r?.isBaseline === true,
          }))
        : [];

  const payload = { items, cached: false, updatedAt: now };

  // Best-effort write cache
  try {
    await cacheRef.set({ ...payload, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  } catch (e: any) {
    logger.warn("getTrackedSymbols cache write failed", { message: e?.message });
    await persistWarning('tracked_symbols_cache_write_failed', { function: RsCloudFunctionName.GET_TRACKED_SYMBOLS, message: e?.message });
  }

  return payload;
});
