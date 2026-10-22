/**
 * Manual order staging (Topic #1177 / task #1188) — pure builders for
 * OrderSource.MANUAL tickets, mirroring the signal builders minus
 * provenance: no runId, no signalContext, no decision ids. Symbols are
 * user-entered, so both builders normalize case and validate the charset
 * that lands in the Firestore doc id — [A-Z0-9.-] for the underlying
 * (BRK.B, BF-B are legal tickers) and [A-Z0-9] for the OCC leg (same
 * rule buildOptionSignalTicket enforces on occSymbol).
 */
import {
  EquityOrderTicket,
  InstrumentType,
  OptionOrderTicket,
  OrderSource,
  OrderTicketStatus,
} from '../services/order-ticket.types';
import { buildTicketId } from './signal-order-staging.util';
import { OCC_SYMBOL_PATTERN, OptionContractRef } from './option-ticket-staging.util';

/** Ticker charset the equity/underlying ticket id can safely embed —
 *  dots and hyphens appear in real tickers; '/' would corrupt the doc
 *  path and a space would corrupt the id format. The first char must be
 *  alphanumeric so degenerate inputs ('-', '..', '-AAPL') can't mint a
 *  punctuation-led doc id. */
const UNDERLYING_PATTERN = /^[A-Z0-9][A-Z0-9.\-]*$/;

/** Normalize + validate a user-entered underlying. Returns the
 *  canonical uppercase ticker or null when it can't live in a doc id —
 *  exported so callers can validate BEFORE burning a quote fetch. */
export function normalizeUnderlyingSymbol(symbol: string): string | null {
  const sym = String(symbol ?? '').trim().toUpperCase();
  return UNDERLYING_PATTERN.test(sym) ? sym : null;
}

export interface ManualEquityTicketContext {
  accountNumber: string;
  /** Whole-share quantity string — sized by the caller from the live quote
   *  + config default (same sizing as the gallery card path). */
  quantity: string;
  now: Date;
  buildId: (symbol: string, side: string, now: Date) => string;
  buildRefId: () => string;
}

export interface ManualOptionTicketContext {
  accountNumber: string;
  now: Date;
  buildRefId: () => string;
}

/** Build the user's STAGED manual equity/ETF ticket — a buy-only market
 *  ticket (RH has no equity short surface). `symbol` is user input:
 *  normalized to uppercase, rejected when it can't live in a doc id. */
export function buildManualEquityTicket(
  symbol: string,
  context: ManualEquityTicketContext,
): EquityOrderTicket | null {
  const sym = normalizeUnderlyingSymbol(symbol);
  if (!sym) return null;
  const { accountNumber, quantity, now, buildId, buildRefId } = context;
  return {
    // Same {SYMBOL}-{SIDE}-{ts}PT id shape as signal tickets — a
    // same-symbol same-minute re-stage maps to the same id (reopen),
    // and manual tickets read identically in the store.
    id: buildId(sym, 'BUY', now),
    refId: buildRefId(),
    source: OrderSource.MANUAL,
    status: OrderTicketStatus.STAGED,
    accountNumber,
    side: 'buy',
    orderType: 'market',
    timeInForce: 'gfd',
    marketHours: 'regular_hours',
    // EQUITY is the default for both stock and ETF entry — RH routes them
    // identically; ETF distinction isn't a signal-flow capability either.
    instrumentType: InstrumentType.EQUITY,
    symbol: sym,
    quantity,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/**
 * Build the user's STAGED manual single-leg option ticket. `side` is the
 * position-effect-OPEN direction — 'buy' (BTO) or 'sell' (STO); the same
 * value lands on the ticket and its leg (RH derives credit/debit from the
 * legs). `symbol` is the UNDERLYING (ticketsBySymbol grouping); the OCC
 * contract id lives on the leg AND in the doc id — both are validated
 * before they reach a Firestore path. */
export function buildManualOptionTicket(
  symbol: string,
  contract: OptionContractRef,
  side: 'buy' | 'sell',
  context: ManualOptionTicketContext,
): OptionOrderTicket | null {
  const sym = normalizeUnderlyingSymbol(symbol);
  if (!sym) return null;
  const occSymbol = String(contract?.occSymbol ?? '').toUpperCase();
  if (!OCC_SYMBOL_PATTERN.test(occSymbol)) return null;

  const { accountNumber, now, buildRefId } = context;
  return {
    // OPT-MAN-{BTO|STO}-{occ} — readable, unique per {side, contract}
    // within the PT-minute id resolution, and can't collide with signal
    // ids (OPT-LONG/OPT-SHORT-…). Same-contract same-side same-minute
    // re-stage maps to the same id — the adopt/reopen path.
    id: buildTicketId(sym, `OPT-MAN-${side === 'sell' ? 'STO' : 'BTO'}-${occSymbol}`, now),
    refId: buildRefId(),
    source: OrderSource.MANUAL,
    status: OrderTicketStatus.STAGED,
    accountNumber,
    side,
    orderType: 'limit',
    timeInForce: 'gfd',
    marketHours: 'regular_hours',
    instrumentType: InstrumentType.OPTION,
    symbol: sym,
    legs: [
      {
        side,
        symbol: occSymbol,
        optionId: contract.optionId,
        positionEffect: 'open',
      },
    ],
    quantity: '1', // contracts — the ticket form edits before submit
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}
