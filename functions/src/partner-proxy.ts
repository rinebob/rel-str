import {onRequest, onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {db, FieldValue} from "./firebase-admin-init";
import { GetTrackedSymbolsResponse, TrackedSymbolDTO, PartnerEndpointPath, PartnerMarketHolidaysResponse, PartnerIntradaySnapshotResponse, PartnerListTrackedSymbolsResponse, PartnerCompanyOverviewResponse } from './types/partner';
import { persistWarning } from './logging/warn';
import { ENABLE_CONSOLE_LOGGING, RsCloudFunctionName } from './webhooks/webhooks-config';
import { PARTNER_AUDIENCE, CALLER_SA, PartnerHttpError, PartnerInterval, generateIdTokenWithEmail, fetchWithRetry } from './partner-infrastructure';

// Re-export for backward compatibility — webhooks-config.ts and symbol-fetch.ts import PartnerInterval from here
export type { PartnerInterval };

// ==========================
// General partner endpoint URL + audience constants
// ==========================

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
