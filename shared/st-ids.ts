/**
 * @topic #984 — ST Firestore Reorg (task #999)
 *
 * Canonical st- doc-id builders. Every st- writer mints ids through these —
 * the segment layouts live here and nowhere else. Pure functions, shared by
 * BE and FE via the `@st/ids` path alias.
 *
 * Layouts:
 *   st-signals          {SYM}_{barDate}_{signalType}
 *   st-order-tickets    {liv|pap}_{id}                (mode prefix + opaque id)
 *   st-paper-trading/…  {SYM}-{YYMMDD}-{origin}-{expr}[-{exp}-{strike}]-{NN}
 *   st-position-groups  {SYM}-{YYMMDD}-grp-{NN}
 *
 * `{NN}` pads to 2 digits minimum and rolls past 99 — do not cap.
 *
 * Seq allocation contract: `{NN}` is caller-supplied. Writers MUST allocate
 * it under a transaction or via `create()` existence-check retry (the legacy
 * timeSuffix convention) — a bare `set()` with a guessed seq silently
 * overwrites a sibling trade.
 *
 * ⚠ NOT interchangeable with legacy ids:
 * - `signalDedupeKey` (paper-trading-ids.ts) is `{SYM}_{signalType}_{barDate}`
 *   — swapped field order vs `stSignalOccurrenceId`. The order-intents
 *   migration must REBUILD `origin.signalId` via this builder; never pass
 *   through a legacy `trade.signalId`.
 * - `buildTradeId` is `{YYMMDD}-{origin}-{SYM}-{desc}` — date-first, not
 *   symbol-first.
 */
import { formatYYMMDD } from './id-format';
import type { StMode } from './st-types';
import type { StTicketOriginType } from './st-order-tickets';

const BAR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function requireNonEmpty(name: string, v: string): void {
  if (!v) throw new Error(`st-ids: ${name} must be non-empty`);
}

/** '/' is the one character Firestore forbids in doc ids. */
function requireFirestoreSafe(name: string, v: string): void {
  if (v.includes('/')) {
    throw new Error(`st-ids: ${name} must not contain '/' (got '${v}')`);
  }
}

/** '-' would splice phantom segments into the dashed layout. */
function requireNoDash(name: string, v: string): void {
  if (v.includes('-')) {
    throw new Error(`st-ids: ${name} must not contain '-' (got '${v}')`);
  }
}

function requireValidDate(name: string, date: Date): void {
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`st-ids: ${name} must be a valid Date`);
  }
}

/**
 * Signal occurrence doc id: `{SYM}_{barDate}_{signalType}` — one upserted
 * doc per occurrence across intraday/post/nightly rediscovery.
 * barDate is validated so a signalType accidentally passed in its slot
 * (the legacy `signalDedupeKey` arg order!) throws instead of minting a
 * wrong-layout id that parses as valid.
 */
export function stSignalOccurrenceId(symbol: string, barDate: string, signalType: string): string {
  if (!BAR_DATE_RE.test(barDate)) {
    throw new Error(`stSignalOccurrenceId: barDate must be YYYY-MM-DD (got '${barDate}')`);
  }
  requireNonEmpty('symbol', symbol);
  requireFirestoreSafe('symbol', symbol);
  // '_' is the layout separator here — a '_' in symbol corrupts the boundary.
  if (symbol.includes('_')) {
    throw new Error(`stSignalOccurrenceId: symbol must not contain '_' (got '${symbol}')`);
  }
  requireNonEmpty('signalType', signalType);
  requireFirestoreSafe('signalType', signalType);
  return `${symbol.toUpperCase()}_${barDate}_${signalType}`;
}

/** Order-ticket doc id: `{liv|pap}_{id}` — the mode prefix mirrors
 *  `StOrderTicket.mode`; `id` is the caller-minted opaque segment
 *  (uuid, or a symbol-first trade-style id). */
export function stTicketId(mode: StMode, id: string): string {
  if (mode !== 'live' && mode !== 'paper') {
    throw new Error(`stTicketId: invalid mode '${mode}'`);
  }
  if (!id) {
    throw new Error('stTicketId: id segment must be non-empty');
  }
  requireFirestoreSafe('id', id);
  return `${mode === 'live' ? 'liv' : 'pap'}_${id}`;
}

/** Trade-id origin codes — the `{origin}` segment of trade doc ids. */
export const ORIGIN_TYPE_TO_TRADE_CODE: Readonly<Record<StTicketOriginType, string>> = {
  signal: 'sig',
  program: 'prg',
  manual: 'man',
  management: 'mgmt',
};

function nn(seq: number): string {
  // isSafeInteger — 1e21 is an "integer" but String() renders '1e+21'.
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new Error(`st-ids: sequence must be a positive integer (got ${seq})`);
  }
  return String(seq).padStart(2, '0');
}

/**
 * Trade doc id: `{SYM}-{YYMMDD}-{origin}-{expr}[-{exp}-{strike}]-{NN}`.
 *
 * - `origin` is the canonical origin type; the builder emits its trade code
 *   (sig/prg/man/mgmt).
 * - `expr` is uppercased like the symbol — case variants of the same
 *   expression can't mint duplicate ids. (Which convention `expr` carries —
 *   template key `csp-030-45` vs expression code `CSP` — is a #1003 decision;
 *   both emit correctly, they must just be consistent.)
 * - `exp`/`strike` are the option-contract segment — both present or both
 *   absent; equity trades omit them entirely. `exp` is pinned to 6 or 8
 *   digits (YYMMDD or YYYYMMDD — the convention choice is #1003's). Neither
 *   may contain '-' or '/': `PaperTrade.expiration` is ISO `YYYY-MM-DD`, so
 *   callers must convert first (strip dashes) or the layout gains phantom
 *   segments — and '/' is Firestore-illegal outright.
 */
export function stTradeId(
  symbol: string,
  date: Date,
  origin: StTicketOriginType,
  expr: string,
  exp: string | undefined,
  strike: string | undefined,
  seq: number,
): string {
  if (!Object.hasOwn(ORIGIN_TYPE_TO_TRADE_CODE, origin)) {
    throw new Error(`stTradeId: unknown origin '${origin}'`);
  }
  requireNonEmpty('symbol', symbol);
  requireFirestoreSafe('symbol', symbol);
  requireValidDate('date', date);
  if (!expr) throw new Error('stTradeId: expr must be non-empty');
  requireFirestoreSafe('expr', expr);
  if ((exp == null) !== (strike == null)) {
    throw new Error('stTradeId: exp and strike must be provided together or both omitted');
  }
  if (exp != null) {
    if (!/^\d{6}(\d{2})?$/.test(exp)) {
      throw new Error(`stTradeId: exp must be 6 or 8 digits (got '${exp}')`);
    }
    if (!strike) throw new Error('stTradeId: strike must be non-empty');
    requireNoDash('strike', strike);
    requireFirestoreSafe('strike', strike);
  }
  const base = `${symbol.toUpperCase()}-${formatYYMMDD(date)}-${ORIGIN_TYPE_TO_TRADE_CODE[origin]}-${expr.toUpperCase()}`;
  const contract = exp != null ? `-${exp}-${strike}` : '';
  return `${base}${contract}-${nn(seq)}`;
}

/** Position-group doc id: `{SYM}-{YYMMDD}-grp-{NN}` — the cohort grouping
 *  the equity trade + option-expression trades from one signal order. */
export function stPositionGroupId(symbol: string, date: Date, seq: number): string {
  requireNonEmpty('symbol', symbol);
  requireFirestoreSafe('symbol', symbol);
  requireValidDate('date', date);
  return `${symbol.toUpperCase()}-${formatYYMMDD(date)}-grp-${nn(seq)}`;
}
