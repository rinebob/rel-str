/**
 * SA pick-doc client (Topic #1238, Thread #1240, task #1279).
 *
 * Fetches the SA delta-pick cell doc for a coordinate and merges the
 * year-sharded responses into one `PickDocument`. Thin wrapper on the
 * partner-proxy ID-token machinery — same auth path as
 * `partnerHistoricalOptions*` (generateIdTokenWithEmail + fetchWithRetry).
 *
 * Confirmed contract (av-proxy-api options-delta-picks discovery doc):
 * the endpoint serves one year shard per call —
 * `partnerOptionsDeltaPicksV1?symbol=&type=&delta=&dte=&year=` — the
 * delta param is the magnitude ×100 (`delta=20` → the -0.20 put cell);
 * off-grid params → 400 BAD_REQUEST; a missing year shard → 404
 * NOT_FOUND (skipped as a coverage gap); a bare 404 with no partner
 * code → propagates (a Google-infra miss is a transport/config
 * failure, not a gap — #1401); a symbol outside the options-enabled
 * universe → 404 OPTIONS_NOT_ENABLED (propagates — a symbol-level
 * failure, not a gap). Success wraps the cell-year doc in
 * `{ok: true, …}`; a 200 lacking `ok:true` + a `days` map is a malformed
 * response → 502.
 * `startDate` is NOT a request param: it selects which year shards to
 * fetch; the caller filters `days` against its own window. Coverage
 * starts 2026-01-01 — earlier years will never have shards.
 */

import * as logger from 'firebase-functions/logger';
import type { OptionType } from '@options/common';
import type { PickDocCoordinate, PickDocument } from '@options-replay/contracts';
import {
  PARTNER_AUDIENCE,
  CALLER_SA,
  PartnerHttpError,
  PARTNER_CODE_NOT_FOUND,
  extractPartnerCode,
  generateIdTokenWithEmail,
  fetchWithRetry,
} from '../partner-infrastructure';

// ==========================
// URL + audience constants
// ==========================

/** Deployed endpoint path — per SA's discovery doc (name confirmed
 *  `partnerOptionsDeltaPicksV1` at ship). */
const PICK_DOC_ENDPOINT_PATH = 'partnerOptionsDeltaPicksV1';

const PARTNER_PICK_DOC_URL =
  process.env.PARTNER_PICK_DOC_URL ||
  `${PARTNER_AUDIENCE.replace(/\/$/, '')}/${PICK_DOC_ENDPOINT_PATH}`;

const PARTNER_PICK_DOC_AUDIENCE =
  process.env.PARTNER_PICK_DOC_AUDIENCE || PARTNER_PICK_DOC_URL;

// ==========================
// Request + transport seam
// ==========================

/** One year-shard request — the SA endpoint's param surface. */
export interface PickDocShardRequest {
  /** Uppercase underlying symbol. */
  symbol: string;
  /** 'put' | 'call' — OptionType string values are the wire values. */
  type: OptionType;
  /** Target delta magnitude × 100 — the PICK_GRID key (-0.20 → 20). */
  deltaPct: number;
  /** Target DTE (calendar days). */
  dte: number;
  /** Year shard. */
  year: number;
}

/** Injectable transport — TEST-BE seam 1. Tests substitute a fixture
 *  implementation; production uses `partnerPickDocTransport`. */
export type PickDocTransport = (req: PickDocShardRequest) => Promise<PickDocument>;

/** Grid deltaPct from a signed target delta: puts -0.20 → 20, calls +0.30 → 30. */
export function pickDocDeltaPct(targetDelta: number): number {
  return Math.round(Math.abs(targetDelta) * 100);
}

/** SA cellId for a coordinate: `{SYM}-{type}-{deltaPct}-{dte}`. Used in
 *  error messages + logs so a failure names the coordinate. */
export function pickDocCellId(symbol: string, coordinate: PickDocCoordinate): string {
  return `${symbol.trim().toUpperCase()}-${coordinate.type}-${pickDocDeltaPct(coordinate.targetDelta)}-${coordinate.expiry.dte}`;
}

// ==========================
// Fetch + merge
// ==========================

export interface FetchPickDocInput {
  symbol: string;
  coordinate: PickDocCoordinate;
  /** First day of the run window — selects the first year shard to fetch. */
  startDate: string;
  /** Window end — defaults to today; selects the last year shard. */
  endDate?: string;
}

/**
 * Fetch and merge the pick doc for a coordinate over `[startDate, endDate?]`.
 * One shard request per calendar year in the span; a missing year shard —
 * 404 with `partnerCode` NOT_FOUND — is skipped (the year simply has no
 * materialized data). Every other failure propagates, including bare 404s:
 * a Google-infra miss (endpoint absent, wrong URL, pre-deploy window) is a
 * transport/config failure, not a coverage gap (#1401). If every year is a
 * NOT_FOUND gap, throws a PartnerHttpError naming the coordinate — the
 * caller marks the list doc `failed`.
 */
export async function fetchPickDoc(
  input: FetchPickDocInput,
  transport: PickDocTransport = partnerPickDocTransport,
): Promise<PickDocument> {
  const symbol = input.symbol.trim().toUpperCase();
  const cellId = pickDocCellId(symbol, input.coordinate);
  // A malformed date must not fall through to the all-404 path — that error
  // means "pick doc missing", which would misattribute a bad input upstream.
  // The regex pins a strict YYYY-MM-DD shape: `Number('20266-…'.slice(0,4))`
  // would silently accept a 5-digit year.
  const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
  const endDate = input.endDate ?? new Date().toISOString().slice(0, 10);
  const firstYear = Number(input.startDate.slice(0, 4));
  const lastYear = Number(endDate.slice(0, 4));
  if (!DATE_SHAPE.test(input.startDate) || !DATE_SHAPE.test(endDate) || firstYear > lastYear) {
    throw new PartnerHttpError(
      `pick doc fetch failed for ${cellId}: invalid date window [${input.startDate}, ${endDate}]`,
      400,
    );
  }
  const shardReq: Omit<PickDocShardRequest, 'year'> = {
    symbol,
    type: input.coordinate.type,
    deltaPct: pickDocDeltaPct(input.coordinate.targetDelta),
    dte: input.coordinate.expiry.dte,
  };

  const shards: PickDocument[] = [];
  for (let year = firstYear; year <= lastYear; year++) {
    try {
      shards.push(await transport({ ...shardReq, year }));
    } catch (e) {
      // A missing year shard is a coverage gap, not a fetch failure — a run
      // window may legitimately span a year the symbol wasn't materialized.
      // SA marks a shard miss as 404 + {code:'NOT_FOUND'}; a bare 404 with no
      // partnerCode is a Google-infra miss (endpoint absent, wrong URL,
      // pre-deploy window) — propagate so it reads as the transport/config
      // failure it is, not a data gap (#1401).
      if (
        e instanceof PartnerHttpError &&
        e.status === 404 &&
        e.partnerCode === PARTNER_CODE_NOT_FOUND
      ) {
        logger.warn('partnerPickDoc_shard_skipped', {
          symbol,
          year,
          partnerCode: e.partnerCode,
        });
        continue;
      }
      throw e;
    }
  }

  if (shards.length === 0) {
    // Every year answered the partner's NOT_FOUND — the coordinate is absent
    // over the whole window, not a transport miss. Carrying the code lets
    // the worker classify this as permanent (retrying can't materialize a
    // shard) vs a bare-404 infra failure, which is retryable (#1401).
    throw new PartnerHttpError(
      `pick doc fetch failed for ${cellId}: no year shard found in [${firstYear}, ${lastYear}]`,
      404,
      PARTNER_CODE_NOT_FOUND,
    );
  }

  return mergeYearShards(shards);
}

/** Merge year shards into one PickDocument — days maps union, meta spans. */
function mergeYearShards(shards: PickDocument[]): PickDocument {
  const [first, ...rest] = shards;
  const merged: PickDocument = { ...first, days: { ...first.days } };
  for (const shard of rest) {
    Object.assign(merged.days, shard.days);
    if (shard.firstDate < merged.firstDate) merged.firstDate = shard.firstDate;
    if (shard.lastDate > merged.lastDate) merged.lastDate = shard.lastDate;
    merged.pickCount += shard.pickCount;
    merged.missCount += shard.missCount;
    // Grid is versioned per doc; the freshest shard wins on a version bump.
    merged.gridVersion = Math.max(merged.gridVersion, shard.gridVersion);
    if (shard.updatedAt && (!merged.updatedAt || shard.updatedAt > merged.updatedAt)) {
      merged.updatedAt = shard.updatedAt;
    }
  }
  return merged;
}

// ==========================
// Production transport
// ==========================

/** Partner-endpoint transport — HTTPS GET + ID token, same conventions as
 *  `callPartnerHistoricalOptions`. Confirmed wire shape (SA discovery doc):
 *  `delta` = magnitude ×100; success wraps the cell doc in `{ok:true,…}`. */
export const partnerPickDocTransport: PickDocTransport = async (req) => {
  const idToken = await generateIdTokenWithEmail(PARTNER_PICK_DOC_AUDIENCE, CALLER_SA);

  const search = new URLSearchParams();
  search.set('symbol', req.symbol);
  search.set('type', req.type);
  search.set('delta', String(req.deltaPct));
  search.set('dte', String(req.dte));
  search.set('year', String(req.year));

  const url = `${PARTNER_PICK_DOC_URL}?${search.toString()}`;

  logger.info('partnerPickDoc_request', {
    symbol: req.symbol,
    year: req.year,
    url,
    audience: PARTNER_PICK_DOC_AUDIENCE,
  });

  const resp = await fetchWithRetry(url, { Authorization: `Bearer ${idToken}` });
  const text = await resp.text();

  if (!resp.ok) {
    logger.error('partnerPickDoc_upstream_error', {
      symbol: req.symbol,
      year: req.year,
      status: resp.status,
      url,
      callerSa: CALLER_SA,
      snippet: typeof text === 'string' ? text.slice(0, 500) : undefined,
    });
    throw new PartnerHttpError(
      `partnerPickDoc upstream ${resp.status}: ${text.slice(0, 500)}`,
      resp.status,
      extractPartnerCode(text),
    );
  }

  try {
    const body = JSON.parse(text) as { ok?: boolean } & Partial<PickDocument>;
    if (body.ok !== true || body.days == null) {
      throw new PartnerHttpError(
        `partnerPickDoc malformed 200 (ok=${String(body.ok)}): ${text.slice(0, 200)}`,
        502,
        extractPartnerCode(text),
      );
    }
    // Success envelope: { ok: true, ...cellYearDocFields } — strip ok.
    const { ok: _ok, ...doc } = body;
    return doc as PickDocument;
  } catch (e: unknown) {
    if (e instanceof PartnerHttpError) throw e;
    const message = e instanceof Error ? e.message : String(e);
    throw new PartnerHttpError(`partnerPickDoc invalid JSON: ${message}`, 502);
  }
};
