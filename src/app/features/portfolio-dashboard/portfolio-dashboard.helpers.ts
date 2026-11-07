/**
 * Pure helper functions + shared constants for the portfolio feature.
 *
 * Account initialization, immutable account-array updates, and
 * symbol/instrument-ID collection for PortfolioDashboardStore — plus the
 * cross-page chrome rules the dashboard and allocation pages share
 * (#1441 parity): account-tab ordering and the privacy-toggle key.
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

/** Primary agentic account number — sorted to the first tab on BOTH the
 *  portfolio dashboard and the allocation page (#1441 parity). */
export const PRIMARY_AGENTIC_ACCOUNT_NUMBER = '677616245';

/** Account-tab ordering shared by the dashboard + allocation pages —
 *  primary agentic account first, everything else in API order. Returns
 *  a new array. */
export function sortAccountsPrimaryFirst(accounts: readonly AccountInfo[]): AccountInfo[] {
  return [...accounts].sort((a, b) => {
    if (a.accountNumber === PRIMARY_AGENTIC_ACCOUNT_NUMBER) return -1;
    if (b.accountNumber === PRIMARY_AGENTIC_ACCOUNT_NUMBER) return 1;
    return 0;
  });
}

/** localStorage key for the dollar-amount privacy toggle — one opt-in
 *  covers the dashboard + allocation pages (#1441). */
export const PD_SHOW_AMOUNTS_KEY = 'pd-show-amounts';

/** Create an AccountState with all sections empty (null data, no loading). */
export function createAccountState(account: AccountInfo): AccountState {
  const empty: SectionData<unknown> = { data: null, loading: false, error: null };
  return {
    accountNumber: account.accountNumber,
    accountName: account.accountName,
    accountType: account.accountType,
    agenticAllowed: account.agenticAllowed,
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
