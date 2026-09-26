/**
 * @topic #553 — Paper Trading Infra (task #564)
 *
 * Canonical RH MCP response shapes + extraction helpers for the paper-trading
 * read tools (`get_equity_quotes`, `get_option_chains`, `get_option_instruments`,
 * `get_option_quotes`). One dialect — the instrument-map resolver, option
 * quote provider, and signal-expression fill pass all parse through here so a
 * response-shape drift is fixed once.
 */

import { isPlainObject } from '@robinhood-mcp/utils';

export const MCP_PREFIX = 'mcp__robinhood-trading__';
/** `get_option_quotes` instrument-id batch bound. */
export const QUOTE_BATCH = 20;

export interface RhChain {
  id?: string;
  symbol?: string;
  expiration_dates?: string[];
}

export interface RhInstrument {
  id?: string;
  chain_id?: string;
  chain_symbol?: string;
  expiration_date?: string;
  strike_price?: string;
  type?: string;
}

/**
 * Quote payload inside a `get_option_quotes` item. `instrument_id` may appear
 * at the item level OR nested inside `quote`/`close` — handle both.
 */
export interface RhOptionQuote {
  instrument_id?: string;
  adjusted_mark_price?: string;
  mark_price?: string;
  ask_price?: string;
  bid_price?: string;
  last_trade_price?: string;
  previous_close_price?: string;
  implied_volatility?: string;
  delta?: string;
  gamma?: string;
  theta?: string;
  vega?: string;
  rho?: string;
  volume?: string | number;
  open_interest?: string | number;
  updated_at?: string;
  last_trade_at?: string;
}

export interface RhOptionClose {
  instrument_id?: string;
  price?: string;
  interpolated?: boolean;
}

export interface RhQuoteItem {
  instrument_id?: string;
  instrument?: string;
  id?: string;
  quote?: RhOptionQuote;
  close?: RhOptionClose;
}

export function parseNum(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Pull the first array found at `data.{keys[]}` or root `{keys[]}` — MCP
 * responses shift the payload wrapper between `data` and top level.
 */
export function extractArray(raw: unknown, keys: string[]): unknown[] {
  if (!isPlainObject(raw)) return [];
  const roots: unknown[] = [raw, raw.data];
  for (const root of roots) {
    if (!isPlainObject(root)) continue;
    for (const key of keys) {
      const v = root[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

export function extractChains(raw: unknown): RhChain[] {
  return extractArray(raw, ['chains']) as RhChain[];
}

export function extractInstruments(raw: unknown): {
  instruments: RhInstrument[];
  next?: string;
} {
  const data = isPlainObject(raw) && isPlainObject(raw.data) ? raw.data : (isPlainObject(raw) ? raw : {});
  return {
    instruments: extractArray(raw, ['instruments']) as RhInstrument[],
    next: typeof data.next === 'string' ? data.next : undefined,
  };
}

export function extractQuoteItems(raw: unknown): RhQuoteItem[] {
  return extractArray(raw, ['results', 'quotes', 'options', 'data']) as RhQuoteItem[];
}

/** Paginate `get_option_instruments` to exhaustion; returns all instruments. */
export async function fetchAllOptionInstruments(
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  baseArgs: Record<string, unknown>,
): Promise<RhInstrument[]> {
  const all: RhInstrument[] = [];
  let cursor: string | undefined;
  do {
    const args = cursor ? { ...baseArgs, cursor } : baseArgs;
    const { instruments, next } = extractInstruments(
      await callTool(`${MCP_PREFIX}get_option_instruments`, args),
    );
    all.push(...instruments);
    cursor = next;
  } while (cursor);
  return all;
}

/** Instrument id for a quote item — item-level, or nested in quote/close. */
export function quoteItemId(item: RhQuoteItem): string | undefined {
  return (
    item.instrument_id ?? item.instrument ?? item.id ??
    item.quote?.instrument_id ?? item.close?.instrument_id
  );
}

/** Mark price for a quote item — adjusted mark → mark → last trade. */
export function quoteMark(item: RhQuoteItem): number | undefined {
  const q = item.quote ?? {};
  return (
    parseNum(q.adjusted_mark_price) ??
    parseNum(q.mark_price) ??
    parseNum(q.last_trade_price)
  );
}

// ── Equity quotes ──────────────────────────────────────────────────────────

function numAt(obj: unknown, ...path: string[]): number | undefined {
  let cur: unknown = obj;
  for (const key of path) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[key];
  }
  return parseNum(cur);
}

function strAt(obj: unknown, ...path: string[]): string | undefined {
  let cur: unknown = obj;
  for (const key of path) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[key];
  }
  return typeof cur === 'string' && cur ? cur : undefined;
}

/**
 * Extract the per-symbol equity price from a `get_equity_quotes` response.
 * `last_trade_price` preferred; falls back to `close.price` (after-hours).
 */
export function extractEquityPrice(parsed: unknown, symbol: string): number | undefined {
  if (!isPlainObject(parsed)) return undefined;
  const root: unknown = isPlainObject(parsed.data) ? parsed.data : parsed;
  const results = isPlainObject(root)
    ? [root.results, root.quotes, root.data].find(Array.isArray)
    : undefined;
  if (!Array.isArray(results)) return undefined;
  for (const item of results) {
    const sym = strAt(item, 'quote', 'symbol') ?? strAt(item, 'symbol');
    if (sym?.toUpperCase() !== symbol.toUpperCase()) continue;
    const price =
      numAt(item, 'quote', 'last_trade_price') ??
      numAt(item, 'quote', 'last_non_reg_trade_price') ??
      numAt(item, 'quote', 'last_price') ??
      numAt(item, 'quote', 'price') ??
      numAt(item, 'close', 'price');
    return price;
  }
  return undefined;
}
