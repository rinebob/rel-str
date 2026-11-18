/**
 *
 * Canonical source for option-related enums and OCC contract ID helpers,
 * shared between the options contract viewer, spread viewer, and position
 * strategy engine — plus `selectContractAtCoordinate`, the SA-parity
 * contract-selection algorithm consumed by selection replay and the
 * live/paper engine adapters.
 *
 * The `HistoricalOptionContract` import below is deliberately `import type`:
 * `options-contract-contracts.ts` imports this file at value level, so a
 * value import back would create a runtime module cycle.
 */

import type { HistoricalOptionContract } from './options-contract-contracts';

export enum OptionType {
  CALL = 'call',
  PUT = 'put',
}

/**
 * Normalize an option-type value to the canonical enum. Alpha Vantage
 * returns 'call'/'put' or 'C'/'P' in any case; anything else → null.
 */
export function normalizeOptionType(v: string | OptionType | null | undefined): OptionType | null {
  const raw = String(v ?? '').trim().toLowerCase();
  if (raw === 'call' || raw === 'c') return OptionType.CALL;
  if (raw === 'put' || raw === 'p') return OptionType.PUT;
  return null;
}

export enum OptionQuoteSource {
  AV_EOD = 'AV_EOD',
  RH_MCP = 'RH_MCP',
  AV_REALTIME = 'AV_REALTIME',
  /** Priced from stored SDS daily bars — backfilled/historical fills. */
  SDS_BARS = 'SDS_BARS',
}

export enum PositionSpreadType {
  CASH_SECURED_PUT = 'CASH_SECURED_PUT',
  COVERED_CALL = 'COVERED_CALL',
}

export enum StrategyFrequency {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
}

export interface ParsedOccContractId {
  symbol: string;
  contractID: string;
  expiration: string;
  optionType: OptionType;
  strike: number;
}

/**
 * Parse an OCC-style contract ID (e.g. "QQQ240719C00450000") into its
 * constituent parts: underlying symbol, expiration date, type, and strike.
 */
export function parseOccContractId(occId: string): ParsedOccContractId | null {
  const id = String(occId || '').trim().toUpperCase();
  if (!id) return null;

  const match = id.match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);
  if (!match) return null;

  const [, symbol, dateStr, typeChar, strikeStr] = match;
  const year = 2000 + Number(dateStr.slice(0, 2));
  const month = dateStr.slice(2, 4);
  const day = dateStr.slice(4, 6);

  return {
    symbol,
    contractID: id,
    expiration: `${year}-${month}-${day}`,
    optionType: typeChar === 'C' ? OptionType.CALL : OptionType.PUT,
    strike: Number(strikeStr) / 1000,
  };
}

/**
 * Build an OCC-style contract ID from its constituent parts.
 * e.g. ("QQQ", "2024-07-19", OptionType.CALL, 450) → "QQQ240719C00450000"
 *
 * @throws if symbol is empty, expiration is not YYYY-MM-DD, or strike is negative.
 */
export function buildOccContractId(
  symbol: string,
  expiration: string,
  optionType: OptionType,
  strike: number,
): string {
  const sym = symbol.trim().toUpperCase();
  if (!sym) throw new Error('buildOccContractId: symbol must be non-empty');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiration)) {
    throw new Error(`buildOccContractId: expiration must be YYYY-MM-DD, got "${expiration}"`);
  }

  if (strike < 0) throw new Error(`buildOccContractId: strike must be non-negative, got ${strike}`);

  const dateStr = expiration.replace(/-/g, '');
  const yy = dateStr.slice(2, 8);
  const typeChar = optionType === OptionType.CALL ? 'C' : 'P';
  const strikeStr = Math.round(strike * 1000)
    .toString()
    .padStart(8, '0');
  return `${sym}${yy}${typeChar}${strikeStr}`;
}

// ==========================
// Coordinate contract selection — SA pick-doc parity (#1497)
// ==========================

/** A concrete selection coordinate — the shared template/variant vocabulary
 *  (`OptionLeg.targetDelta` signed: puts negative, calls positive). */
export interface ContractSelectionCoordinate {
  type: OptionType;
  /** Signed target delta (e.g. -0.20 for a 20-delta put, +0.75 for a
   *  75-delta LEAP call). */
  targetDelta: number;
  /** Target days to expiration, calendar days. */
  dte: number;
}

/** The contract selected at a coordinate — identity + the observed values
 *  the algorithm reasoned over. `mark` is present only when the row's mark
 *  parses; quote fields are never fabricated. */
export interface SelectedContractAtCoordinate {
  contract: HistoricalOptionContract;
  contractId: string;
  expiration: string;
  /** Actual days to expiration on the market date. */
  dte: number;
  strike: number;
  delta: number;
  mark?: number;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/** Canonical YYYY-MM-DD AND a real calendar date — mirrors SA's
 *  `isValidIsoDate` round-trip check. Shape alone is insufficient:
 *  `Date.parse('2026-02-30T00:00:00Z')` normalizes to Mar 2 rather than NaN. */
function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

/** Strict numeric parse — missing/blank/non-numeric → NaN (`Number('')`
 *  would otherwise coerce to 0). Mirrors SA's `parseStrict`. */
function parseStrictNumber(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return NaN;
  return Number(value);
}

/** Calendar days `from` → `to` (both must be valid ISO dates; NaN on
 *  unparseable input). Mirrors SA's `daysTo` — `isValidIsoDate` first, since
 *  V8 leniently parses non-canonical forms like '2026-5-15'. */
function strictIsoDaysBetween(from: string, to: string): number {
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) return NaN;
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY,
  );
}

/**
 * Select one contract at a concrete coordinate using SA's confirmed
 * pick-doc semantics (IMPL-BE module 0, spike #1496) — the two-stage
 * algorithm, not `selectOptionContract`'s weighted joint score:
 *
 * 1. Eligibility = identity fields only: non-empty contractID, valid
 *    expiration with dte ≥ 0, parseable strike, parseable delta.
 *    No mark/liquidity requirement — mark is a fill-time concern.
 * 2. Expiration: the listed expiration nearest the target DTE (calendar
 *    days); equidistant → the longer actual DTE. No fallback to other
 *    expirations.
 * 3. Contract within that expiry: argmin |observedDelta − targetDelta|;
 *    equidistant → larger |delta|; residual → lowest contractId.
 *
 * `null` = SA's `no_match` (chain present, nothing selectable). `no_chain`
 * is caller-emitted — an absent chain means the caller never gets here.
 *
 * Degenerate coordinates (NaN targetDelta/dte) aren't guarded — every
 * comparison fails and the first eligible row wins, exactly as SA behaves;
 * grid-derived coordinates can't produce NaN.
 *
 * @throws on a malformed marketDate (mirrors SA's `pickCellsForDate` throw —
 * both shape and calendar validity, e.g. '2026-02-30' throws).
 */
export function selectContractAtCoordinate(
  marketDate: string,
  candidates: HistoricalOptionContract[],
  coordinate: ContractSelectionCoordinate,
): SelectedContractAtCoordinate | null {
  if (!isValidIsoDate(marketDate)) {
    throw new Error(`selectContractAtCoordinate: malformed marketDate: ${marketDate}`);
  }

  interface EligibleRow {
    contract: HistoricalOptionContract;
    contractId: string;
    expiration: string;
    delta: number;
    strike: number;
    dte: number;
  }

  // Eligible rows of the coordinate's type, grouped by expiration.
  const byExpiration = new Map<string, EligibleRow[]>();
  for (const contract of candidates) {
    // Literal equality, not normalizeOptionType — SA filters on the raw
    // 'put'/'call' wire values; callers feeding non-canonical types (e.g.
    // 'C'/'P') must normalize upstream so behavior matches SA exactly.
    if (contract.type !== coordinate.type) continue;
    const contractId = contract.contractID?.trim();
    if (!contractId) continue;
    const expiration = contract.expiration;
    const delta = parseStrictNumber(contract.delta);
    const strike = parseStrictNumber(contract.strike);
    const dte =
      expiration !== undefined ? strictIsoDaysBetween(marketDate, expiration) : NaN;
    if (!Number.isFinite(delta) || !Number.isFinite(strike) || !Number.isFinite(dte) || dte < 0) {
      continue;
    }
    // A finite dte implies expiration was defined — narrow once.
    const exp = expiration!;
    const eligible: EligibleRow = {
      contract,
      contractId,
      expiration: exp,
      delta,
      strike,
      dte,
    };
    const rows = byExpiration.get(exp);
    if (rows === undefined) byExpiration.set(exp, [eligible]);
    else rows.push(eligible);
  }
  if (byExpiration.size === 0) return null;

  // Nearest-DTE expiration; equidistant → longer actual DTE.
  let bestExpiration: string | null = null;
  let bestDte = 0;
  for (const [expiration, rows] of byExpiration) {
    const dte = rows[0].dte;
    if (
      bestExpiration === null ||
      Math.abs(dte - coordinate.dte) < Math.abs(bestDte - coordinate.dte) ||
      (Math.abs(dte - coordinate.dte) === Math.abs(bestDte - coordinate.dte) && dte > bestDte)
    ) {
      bestExpiration = expiration;
      bestDte = dte;
    }
  }
  const pool = byExpiration.get(bestExpiration!)!;

  // argmin |delta − targetDelta|; equidistant → larger |delta| → lowest contractId.
  let best: EligibleRow | null = null;
  for (const cand of pool) {
    if (best === null) {
      best = cand;
      continue;
    }
    const dist = Math.abs(cand.delta - coordinate.targetDelta);
    const bestDist = Math.abs(best.delta - coordinate.targetDelta);
    if (
      dist < bestDist ||
      (dist === bestDist &&
        (Math.abs(cand.delta) > Math.abs(best.delta) ||
          (Math.abs(cand.delta) === Math.abs(best.delta) && cand.contractId < best.contractId)))
    ) {
      best = cand;
    }
  }

  const mark = parseStrictNumber(best!.contract.mark);
  return {
    contract: best!.contract,
    contractId: best!.contractId,
    expiration: best!.expiration,
    dte: best!.dte,
    strike: best!.strike,
    delta: best!.delta,
    ...(Number.isFinite(mark) ? { mark } : {}),
  };
}
