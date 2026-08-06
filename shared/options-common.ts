/**
 * @topic #77 — Spread Time Series Viewer (opened 2026-08-02)
 *
 * Canonical source for OptionType enum and OCC contract ID helpers,
 * shared between the options contract viewer and the spread viewer.
 */

export enum OptionType {
  CALL = 'call',
  PUT = 'put',
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
