/**
 * SA pick-doc client (Topic #1238, Thread #1240, task #1279).
 *
 * Fetches the SA delta-pick cell doc for a coordinate and merges the
 * year-sharded responses into one `PickDocument`. Thin wrapper on the
 * partner-proxy ID-token machinery — same auth path as
 * `partnerHistoricalOptions*` (generateIdTokenWithEmail + fetchWithRetry).
 *
 * Confirmed contract (spike #1278): the endpoint serves one year shard per
 * call — `options-delta-picks/{SYM}-{type}-{deltaPct}-{dte}/years/{YYYY}` —
 * for params (symbol, type, delta, dte, year); off-grid params → 400; a
 * missing shard → 404. `startDate` is NOT a request param: it selects which
 * year shards to fetch; the caller filters `days` against its own window.
 *
 * OPEN SEAM (av-proxy-api#225): the endpoint is not implemented yet — the
 * function name (`partnerOptionsDeltaPicks` below), whether the delta param
 * is `deltaPct` or signed `delta`, and whether the response wraps the doc in
 * an `{ok}` envelope are all provisional. All three are single-point edits
 * when #225 lands.
 */

import * as logger from 'firebase-functions/logger';
import type { OptionType } from '@options/common';
import type { PickDocCoordinate, PickDocument } from '@options-replay/contracts';
import {
  PARTNER_AUDIENCE,
  CALLER_SA,
  PartnerHttpError,
  extractPartnerCode,
  generateIdTokenWithEmail,
  fetchWithRetry,
} from '../partner-infrastructure';

// ==========================
// URL + audience constants
// ==========================

/** Provisional endpoint path — confirm against av-proxy-api#225 when the
 *  endpoint ships (name is undecided there). */
const PICK_DOC_ENDPOINT_PATH = 'partnerOptionsDeltaPicks';

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
 * One shard request per calendar year in the span; a 404 shard is skipped
 * (the year simply has no materialized data), while any other failure
 * propagates. If no shard exists at all, throws a PartnerHttpError naming
 * the coordinate — the caller marks the list doc `failed`.
 */
export async function fetchPickDoc(
  input: FetchPickDocInput,
  transport: PickDocTransport = partnerPickDocTransport,
): Promise<PickDocument> {
  const symbol = input.symbol.trim().toUpperCase();
  const cellId = pickDocCellId(symbol, input.coordinate);
  const firstYear = Number(input.startDate.slice(0, 4));
  const lastYear = Number((input.endDate ?? new Date().toISOString().slice(0, 10)).slice(0, 4));
  // A malformed date must not fall through to the all-404 path — that error
  // means "pick doc missing", which would misattribute a bad input upstream.
  if (!Number.isFinite(firstYear) || !Number.isFinite(lastYear)) {
    throw new PartnerHttpError(
      `pick doc fetch failed for ${cellId}: invalid date window [${input.startDate}, ${input.endDate}]`,
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
      if (e instanceof PartnerHttpError && e.status === 404) continue;
      throw e;
    }
  }

  if (shards.length === 0) {
    throw new PartnerHttpError(
      `pick doc fetch failed for ${cellId}: no year shard found in [${firstYear}, ${lastYear}]`,
      404,
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
 *  `callPartnerHistoricalOptions`. Provisional param spelling: deltaPct;
 *  response assumed to be the raw CellYearDoc JSON (envelope TBD at #225). */
export const partnerPickDocTransport: PickDocTransport = async (req) => {
  const idToken = await generateIdTokenWithEmail(PARTNER_PICK_DOC_AUDIENCE, CALLER_SA);

  const search = new URLSearchParams();
  search.set('symbol', req.symbol);
  search.set('type', req.type);
  search.set('deltaPct', String(req.deltaPct));
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
      `partnerPickDoc upstream ${resp.status}: ${text}`,
      resp.status,
      extractPartnerCode(text),
    );
  }

  try {
    return JSON.parse(text) as PickDocument;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    throw new PartnerHttpError(`partnerPickDoc invalid JSON: ${message}`, 502);
  }
};
