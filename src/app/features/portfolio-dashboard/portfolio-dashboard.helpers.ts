/**
 * Pure helper functions for PortfolioDashboardStore.
 *
 * Account initialization, immutable account-array updates, and
 * symbol/instrument-ID collection from loaded positions.
 */

import {
  AccountInfo,
  EquityPosition,
  EquityQuote,
  OptionPosition,
  OptionQuote,
} from '../../core/robinhood-mcp/types/robinhood-mcp.types';
import { computePnL } from './utils/portfolio-pnl.util';
import { AccountState, SectionData } from './portfolio-dashboard.types';

/** Create an AccountState with all sections empty (null data, no loading). */
export function createAccountState(account: AccountInfo): AccountState {
  const empty: SectionData<unknown> = { data: null, loading: false, error: null };
  return {
    accountNumber: account.accountNumber,
    accountName: account.accountName,
    accountType: account.accountType,
    portfolio: { ...empty } as SectionData<never>,
    equityPositions: { ...empty } as SectionData<never>,
    optionPositions: { ...empty } as SectionData<never>,
    equityQuotes: { ...empty } as SectionData<never>,
    optionQuotes: { ...empty } as SectionData<never>,
    equityOrders: { ...empty } as SectionData<never>,
    optionOrders: { ...empty } as SectionData<never>,
  };
}

/** Immutable update of one account in the accounts array. */
export function updateAccount(
  accounts: AccountState[],
  index: number,
  updater: (a: AccountState) => AccountState,
): AccountState[] {
  return accounts.map((a, i) => (i === index ? updater(a) : a));
}

/** Collect unique equity symbols from an account's loaded positions. */
export function collectEquitySymbols(acct: AccountState): string[] {
  const symbols = new Set<string>();
  if (acct.equityPositions.data) {
    for (const p of acct.equityPositions.data) {
      if (p.symbol) symbols.add(p.symbol);
    }
  }
  return Array.from(symbols);
}

/** Collect unique option instrument IDs from an account's loaded positions. */
export function collectOptionInstrumentIds(acct: AccountState): string[] {
  const ids = new Set<string>();
  if (acct.optionPositions.data) {
    for (const p of acct.optionPositions.data) {
      if (p.instrumentId) ids.add(p.instrumentId);
    }
  }
  return Array.from(ids);
}

/** Collect unique equity symbols across all accounts. */
export function collectAllEquitySymbols(accounts: AccountState[]): string[] {
  const symbols = new Set<string>();
  for (const acct of accounts) {
    if (acct.equityPositions.data) {
      for (const p of acct.equityPositions.data) {
        if (p.symbol) symbols.add(p.symbol);
      }
    }
  }
  return Array.from(symbols);
}

/** Collect unique option instrument IDs across all accounts. */
export function collectAllOptionInstrumentIds(accounts: AccountState[]): string[] {
  const ids = new Set<string>();
  for (const acct of accounts) {
    if (acct.optionPositions.data) {
      for (const p of acct.optionPositions.data) {
        if (p.instrumentId) ids.add(p.instrumentId);
      }
    }
  }
  return Array.from(ids);
}

/** Sum PnL across an account's equity and option positions. */
export function computeAccountPnL(acct: AccountState): number {
  let total = 0;
  const eqPositions = acct.equityPositions.data;
  const eqQuotes = acct.equityQuotes.data;
  if (eqPositions && eqQuotes) {
    for (const pos of eqPositions) {
      if (pos.quantity === null || pos.quantity === 0) continue;
      const quote = eqQuotes.get(pos.symbol);
      if (!quote || quote.lastTradePrice === null) continue;
      const isShort = pos.quantity < 0;
      const result = computePnL(pos.averageBuyPrice, quote.lastTradePrice, Math.abs(pos.quantity), isShort);
      if (result.pnl !== null) total += result.pnl;
    }
  }
  const optPositions = acct.optionPositions.data;
  const optQuotes = acct.optionQuotes.data;
  if (optPositions && optQuotes) {
    for (const pos of optPositions) {
      if (pos.quantity === null || pos.quantity === 0) continue;
      const quote = optQuotes.get(pos.instrumentId);
      if (!quote || quote.lastTradePrice === null) continue;
      const isShort = pos.quantity < 0;
      const result = computePnL(pos.averageCost, quote.lastTradePrice, Math.abs(pos.quantity), isShort);
      if (result.pnl !== null) total += result.pnl;
    }
  }
  return total;
}
