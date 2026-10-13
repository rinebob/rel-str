/**
 * Option contract helpers for the single-leg option order ticket
 * (Topic #942 / task #961): OCC paste parsing, chain → expiration union,
 * select → instrument args, and the premium fatfinger math.
 *
 * Pure functions only — resolution itself (getOptionInstruments → single
 * active tradable result → getOptionQuotes) lives in the ticket component.
 */
import { OptionType, parseOccContractId } from '@options-contract/contracts';
import {
  OptionChain,
  OptionInstrumentFilters,
} from '../../../core/robinhood-mcp/types/robinhood-mcp.types';

/** The contract-resolution triplet a successful paste produces — the
 *  selects path builds the same (symbol, expiration, strike, type) values
 *  straight into OptionInstrumentFilters via selectsToInstrumentArgs. */
export interface ParsedOptionPaste {
  /** Underlying ticker. */
  symbol: string;
  /** YYYY-MM-DD. */
  expiration: string;
  strike: number;
  type: 'call' | 'put';
}

/** Fatfinger cap when TradingConfig.optionMaxPremiumCashPercent is absent —
 *  matches the field's documented default. */
export const DEFAULT_OPTION_MAX_PREMIUM_CASH_PERCENT = 25;

/** Union of every chain's expiration dates, sorted ascending. */
export function chainsToExpirations(chains: OptionChain[]): string[] {
  return [...new Set(chains.flatMap((c) => c.expirationDates))].sort();
}

/** Select triplet → getOptionInstruments filters (single expiration — the
 *  strikes-at-one-expiration page-size assumption from IMPL-948). */
export function selectsToInstrumentArgs(
  symbol: string,
  expiration: string,
  strike: number,
  type: 'call' | 'put',
): OptionInstrumentFilters {
  return {
    chainSymbol: symbol.toUpperCase(),
    expirationDates: [expiration],
    strikePrice: strike,
    type,
  };
}

/** Parse a pasted OCC contract id ("AAPL   251016C00150000",
 *  "aapl251016c00150000") into the resolution triplet — same call as
 *  `OptionsContractService.parseOccId`, tolerating pasted whitespace.
 *  Returns null on unparseable input — the UI shows an inline error. */
export function parseOptionPaste(text: string): ParsedOptionPaste | null {
  // OCC pads the symbol field with spaces; a paste can carry any
  // whitespace — strip it all before the strict pattern match.
  const compact = String(text ?? '').replace(/\s+/g, '');
  const parsed = parseOccContractId(compact);
  if (!parsed) return null;
  return {
    symbol: parsed.symbol,
    expiration: parsed.expiration,
    strike: parsed.strike,
    type: parsed.optionType === OptionType.CALL ? 'call' : 'put',
  };
}

/** Total premium cash outlay for a buy-to-open: qty × price × 100,
 *  rounded to cents for display/fatfinger use. */
export function premiumNotional(quantity: number, price: number): number {
  return Math.round(quantity * price * 100 * 100) / 100;
}

/** Fatfinger guard — true when the order's premium exceeds the configured
 *  fraction of available cash. `percent` is a percentage (25 = 25%);
 *  absent config → 25. Exactly at the boundary does NOT block.
 *  Fails CLOSED on ANY non-finite input — a guard must not pass garbage
 *  through: NaN cash (failed account parse) or NaN percent (Firestore
 *  can persist NaN; the default only covers an absent arg) would
 *  otherwise compare false and silently disable the check. */
export function fatfingerBlock(
  premium: number,
  availableCash: number,
  percent: number = DEFAULT_OPTION_MAX_PREMIUM_CASH_PERCENT,
): boolean {
  if (
    !Number.isFinite(premium) ||
    !Number.isFinite(availableCash) ||
    !Number.isFinite(percent)
  ) {
    return true;
  }
  return premium > availableCash * (percent / 100);
}
