import {onRequest, onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {GoogleAuth} from "google-auth-library";
import {db, FieldValue} from "./firebase-admin-init";
import { GetTrackedSymbolsResponse, TrackedSymbolDTO, PartnerEndpointPath } from './types/partner';
import { DEFAULT_PARTNER_CALLER_SA, IAM_CREDENTIALS_BASE_URL, OAUTH_CLOUD_PLATFORM_SCOPE, IAM_SERVICE_ACCOUNTS_PATH, IamCredentialsMethod } from './config/constants';
import { persistWarning } from './logging/warn';
import { RsCloudFunctionName } from './webhooks/webhooks-config';

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

// Optional separate audience overrides (default to URLs above)
const PARTNER_TRACKED_SYMBOLS_AUDIENCE =
  process.env.PARTNER_TRACKED_SYMBOLS_AUDIENCE || PARTNER_TRACKED_SYMBOLS_URL;
const PARTNER_TS_AUDIENCE = process.env.PARTNER_TS_AUDIENCE || PARTNER_TS_URL;

// Service account email for rel-str prod
const CALLER_SA = process.env.PARTNER_CALLER_SA || DEFAULT_PARTNER_CALLER_SA;

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

  // Log the exact upstream request parameters for diagnostics, especially for long windows.
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

/** Call Savant Partner Tracked Symbols endpoint. */
export async function callPartnerTrackedSymbols(): Promise<unknown> {
  // Use function URL for request; audience defaults to URL but is overrideable
  const audience = PARTNER_TRACKED_SYMBOLS_AUDIENCE;
  const idToken = await generateIdTokenWithEmail(audience, CALLER_SA);
  // Default to active-only universe with a reasonable cap; SA can ignore or honor
  const url = `${PARTNER_TRACKED_SYMBOLS_URL}?activeOnly=true&limit=1000`;
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
  return (await resp.json()) as unknown;
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
