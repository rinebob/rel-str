/**
 * PortfolioDashboardStore — NgRx SignalStore managing all portfolio dashboard state.
 *
 * State: per-account sections (portfolio, positions, quotes, orders) with
 * independent loading/error. Computed selectors join positions with quotes
 * for PnL, filter orders by state, and compute stop-loss protection.
 *
 * Error policy: loadAccounts rethrows (caller decides how to surface a total
 * account-load failure). loadPhase1/loadPhase2 swallow per-section errors into
 * SectionData.error so partial dashboard data remains visible. refresh()
 * catches top-level failures, sets loadError, and ensures globalLoading is false.
 */

import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';

import { RobinhoodMcpClient } from '../../core/robinhood-mcp/robinhood-mcp-client.service';
import {
  PortfolioSnapshot,
  EquityPosition,
  OptionPosition,
  EquityQuote,
  OptionQuote,
  BrokerOrder,
  PnlTrade,
  PnlTradeSpan,
} from '../../core/robinhood-mcp/types/robinhood-mcp.types';
import { computePnL, computeProtectedSymbols } from './utils/portfolio-pnl.util';
import {
  LIVE_ORDER_STATES,
  TERMINAL_ORDER_STATES,
} from './utils/order-states.util';
import {
  AccountState,
  AggregateSummary,
  DashboardState,
  EquityPositionWithPnL,
  OptionPositionWithPnL,
  SectionData,
  SectionName,
} from './portfolio-dashboard.types';
import {
  collectAllEquitySymbols,
  collectAllOptionInstrumentIds,
  collectEquitySymbols,
  collectOptionInstrumentIds,
  computeAccountPnL,
  createAccountState,
  updateAccount,
} from './portfolio-dashboard.helpers';

/** Primary agentic account number — sorted to the first tab in the dashboard. */
const PRIMARY_AGENTIC_ACCOUNT_NUMBER = '677616245';

const initialState: DashboardState = {
  accounts: [],
  selectedAccountIndex: 0,
  showClosedPositions: false,
  showOrderHistory: false,
  globalLoading: false,
  loadError: null,
};

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function emptySection<T>(): SectionData<T> {
  return { data: null, loading: false, error: null };
}

function loadingSection<T>(prev: SectionData<T>): SectionData<T> {
  return { data: prev.data, loading: true, error: null };
}

function dataSection<T>(data: T): SectionData<T> {
  return { data, loading: false, error: null };
}

function errorSection<T>(prev: SectionData<T>, msg: string): SectionData<T> {
  return { data: prev.data, loading: false, error: msg };
}

export const PortfolioDashboardStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  withComputed((state) => ({
    selectedAccount: computed(() => {
      const accounts = state.accounts();
      const idx = state.selectedAccountIndex();
      return accounts[idx] ?? null;
    }),

    aggregateSummary: computed((): AggregateSummary => {
      const accounts = state.accounts();
      let totalValue = 0;
      let totalExposure = 0;
      let totalCash = 0;
      let totalBuyingPower = 0;
      let totalPnL = 0;
      let hasValue = false;
      let hasExposure = false;
      let hasCash = false;
      let hasBuyingPower = false;
      let hasPnL = false;

      for (const acct of accounts) {
        const p = acct.portfolio.data;
        if (p?.totalValue !== null && p?.totalValue !== undefined) {
          totalValue += p.totalValue;
          hasValue = true;
        }
        if (p?.equityValue !== null && p?.equityValue !== undefined) {
          totalExposure += p.equityValue;
          hasExposure = true;
        }
        if (p?.cash !== null && p?.cash !== undefined) {
          totalCash += p.cash;
          hasCash = true;
        }
        if (p?.buyingPower !== null && p?.buyingPower !== undefined) {
          totalBuyingPower += p.buyingPower;
          hasBuyingPower = true;
        }
        const acctPnL = computeAccountPnL(acct);
        if (acctPnL !== 0 || acct.equityQuotes.data || acct.optionQuotes.data) {
          totalPnL += acctPnL;
          hasPnL = true;
        }
      }

      return {
        totalValue: hasValue ? totalValue : null,
        totalExposure: hasExposure ? totalExposure : null,
        totalCash: hasCash ? totalCash : null,
        totalBuyingPower: hasBuyingPower ? totalBuyingPower : null,
        totalPnL: hasPnL ? totalPnL : null,
      };
    }),

    equityPositionsWithPnL: computed((): EquityPositionWithPnL[] => {
      const acct = state.accounts()[state.selectedAccountIndex()];
      if (!acct) return [];
      const positions = acct.equityPositions.data;
      if (!positions) return [];
      const quotes = acct.equityQuotes.data;

      return positions.map((p) => {
        const currentPrice = quotes?.get(p.symbol)?.lastTradePrice ?? null;
        const qty = p.quantity;
        const closed = qty === null || qty === 0;
        if (closed || currentPrice === null) {
          return { ...p, currentPrice, pnl: null, pnlPercent: null, closed };
        }
        const isShort = qty < 0;
        const result = computePnL(p.averageBuyPrice, currentPrice, Math.abs(qty), isShort);
        return { ...p, currentPrice, pnl: result.pnl, pnlPercent: result.pnlPercent, closed };
      });
    }),

    /** Closed trades from `get_pnl_trade_history`, mapped to EquityPositionWithPnL. */
    closedTradesWithPnL: computed((): EquityPositionWithPnL[] => {
      const acct = state.accounts()[state.selectedAccountIndex()];
      if (!acct) return [];
      const trades = acct.closedTrades.data;
      if (!trades) return [];
      return trades.map((t): EquityPositionWithPnL => {
        const pnl = t.realizedGain;
        const proceeds = t.price != null && t.quantity != null ? t.price * t.quantity : null;
        const costBasis = proceeds != null && pnl != null ? proceeds - pnl : null;
        const averageBuyPrice = costBasis != null && t.quantity != null && t.quantity !== 0
          ? costBasis / Math.abs(t.quantity)
          : null;
        const pnlPercent = costBasis != null && costBasis !== 0 && pnl != null
          ? (pnl / costBasis) * 100
          : null;
        return {
          symbol: t.symbol,
          quantity: t.quantity,
          averageBuyPrice,
          sharesHeldForSells: null,
          currentPrice: t.price,
          pnl,
          pnlPercent,
          closed: true,
        };
      });
    }),

    optionPositionsWithPnL: computed((): OptionPositionWithPnL[] => {
      const acct = state.accounts()[state.selectedAccountIndex()];
      if (!acct) return [];
      const positions = acct.optionPositions.data;
      if (!positions) return [];
      const quotes = acct.optionQuotes.data;

      return positions.map((p) => {
        const currentPrice = quotes?.get(p.instrumentId)?.lastTradePrice ?? null;
        const qty = p.quantity;
        const closed = qty === null || qty === 0;
        if (closed || currentPrice === null) {
          return { ...p, currentPrice, pnl: null, pnlPercent: null, closed };
        }
        const isShort = qty < 0;
        const result = computePnL(p.averageCost, currentPrice, Math.abs(qty), isShort);
        return { ...p, currentPrice, pnl: result.pnl, pnlPercent: result.pnlPercent, closed };
      });
    }),

    openOrders: computed((): BrokerOrder[] => {
      const acct = state.accounts()[state.selectedAccountIndex()];
      if (!acct) return [];
      const equity = acct.equityOrders.data ?? [];
      const option = acct.optionOrders.data ?? [];
      return [...equity, ...option].filter((o) => LIVE_ORDER_STATES.has(o.state));
    }),

    orderHistory: computed((): BrokerOrder[] => {
      const acct = state.accounts()[state.selectedAccountIndex()];
      if (!acct) return [];
      const equity = acct.equityOrders.data ?? [];
      const option = acct.optionOrders.data ?? [];
      return [...equity, ...option].filter((o) => TERMINAL_ORDER_STATES.has(o.state));
    }),

    stopLossProtectedSymbols: computed((): Set<string> => {
      const acct = state.accounts()[state.selectedAccountIndex()];
      if (!acct) return new Set();
      const orders = acct.equityOrders.data ?? [];
      const positions = acct.equityPositions.data ?? [];
      return computeProtectedSymbols(orders, positions);
    }),
  })),

  withComputed((state) => ({
    /** Equity positions for display — open positions, plus closed trades when showClosed is on. */
    displayedEquityPositions: computed((): EquityPositionWithPnL[] => {
      const open = state.equityPositionsWithPnL();
      if (!state.showClosedPositions()) return open;
      const closed = state.closedTradesWithPnL();
      return [...open, ...closed];
    }),
  })),

  withMethods((store) => {
    const client = inject(RobinhoodMcpClient);
    let refreshing = false;

    async function loadAccounts(): Promise<void> {
      const accounts = await client.getAccounts();
      // Sort the primary agentic account to the first tab.
      const sorted = [...accounts].sort((a, b) => {
        if (a.accountNumber === PRIMARY_AGENTIC_ACCOUNT_NUMBER) return -1;
        if (b.accountNumber === PRIMARY_AGENTIC_ACCOUNT_NUMBER) return 1;
        return 0;
      });
      patchState(store, {
        accounts: sorted.map(createAccountState),
        selectedAccountIndex: 0,
      });
    }

    async function loadPhase1(): Promise<void> {
      const accounts = store.accounts();
      patchState(store, {
        accounts: accounts.map((a) => ({
          ...a,
          portfolio: loadingSection(a.portfolio),
          equityPositions: loadingSection(a.equityPositions),
          optionPositions: loadingSection(a.optionPositions),
        })),
      });

      await Promise.all(accounts.map(async (acct, i) => {
        const results = await Promise.allSettled([
          client.getPortfolio(acct.accountNumber),
          client.getEquityPositions(acct.accountNumber),
          client.getOptionPositions(acct.accountNumber, false),
        ]);
        const [portfolioR, equityR, optionR] = results;
        patchState(store, {
          accounts: updateAccount(store.accounts(), i, (a) => ({
            ...a,
            portfolio: portfolioR.status === 'fulfilled'
              ? dataSection(portfolioR.value)
              : errorSection(a.portfolio, errMessage(portfolioR.reason)),
            equityPositions: equityR.status === 'fulfilled'
              ? dataSection(equityR.value)
              : errorSection(a.equityPositions, errMessage(equityR.reason)),
            optionPositions: optionR.status === 'fulfilled'
              ? dataSection(optionR.value)
              : errorSection(a.optionPositions, errMessage(optionR.reason)),
          })),
        });
      }));
    }

    async function loadPhase2(): Promise<void> {
      const accounts = store.accounts();
      const equitySymbols = collectAllEquitySymbols(accounts);
      const optionInstrumentIds = collectAllOptionInstrumentIds(accounts);

      patchState(store, {
        accounts: accounts.map((a) => ({
          ...a,
          equityQuotes: loadingSection(a.equityQuotes),
          optionQuotes: loadingSection(a.optionQuotes),
          equityOrders: loadingSection(a.equityOrders),
          optionOrders: loadingSection(a.optionOrders),
        })),
      });

      // Fetch quotes once — copy Map per account so retrySection is independent.
      let equityQuotes: Map<string, EquityQuote> | null = null;
      let equityQuotesError: string | null = null;
      let optionQuotes: Map<string, OptionQuote> | null = null;
      let optionQuotesError: string | null = null;

      try {
        equityQuotes = await client.getEquityQuotes(equitySymbols);
      } catch (err) {
        equityQuotesError = errMessage(err);
      }
      try {
        optionQuotes = await client.getOptionQuotes(optionInstrumentIds);
      } catch (err) {
        optionQuotesError = errMessage(err);
      }

      patchState(store, {
        accounts: store.accounts().map((a) => ({
          ...a,
          equityQuotes: equityQuotes
            ? dataSection(new Map(equityQuotes))
            : errorSection(a.equityQuotes, equityQuotesError!),
          optionQuotes: optionQuotes
            ? dataSection(new Map(optionQuotes))
            : errorSection(a.optionQuotes, optionQuotesError!),
        })),
      });

      // Fetch orders per account with independent error handling.
      await Promise.all(accounts.map(async (acct, i) => {
        const results = await Promise.allSettled([
          client.getEquityOrders(acct.accountNumber),
          client.getOptionOrders(acct.accountNumber),
        ]);
        const [equityR, optionR] = results;
        patchState(store, {
          accounts: updateAccount(store.accounts(), i, (a) => ({
            ...a,
            equityOrders: equityR.status === 'fulfilled'
              ? dataSection(equityR.value)
              : errorSection(a.equityOrders, errMessage(equityR.reason)),
            optionOrders: optionR.status === 'fulfilled'
              ? dataSection(optionR.value)
              : errorSection(a.optionOrders, errMessage(optionR.reason)),
          })),
        });
      }));
    }

    async function refresh(): Promise<void> {
      if (refreshing) return;
      refreshing = true;
      patchState(store, { loadError: null, globalLoading: true });
      try {
        await loadAccounts();
        await loadPhase1();
        await loadPhase2();
      } catch (err) {
        patchState(store, { loadError: errMessage(err) });
      } finally {
        patchState(store, { globalLoading: false });
        refreshing = false;
      }
    }

    async function retrySection(accountIndex: number, section: SectionName): Promise<void> {
      const acct = store.accounts()[accountIndex];
      if (!acct) return;

      // 'orders' is a combined retry for both equityOrders and optionOrders.
      if (section === 'orders') {
        patchState(store, {
          accounts: updateAccount(store.accounts(), accountIndex, (a) => ({
            ...a,
            equityOrders: loadingSection(a.equityOrders),
            optionOrders: loadingSection(a.optionOrders),
          })),
        });
        const results = await Promise.allSettled([
          client.getEquityOrders(acct.accountNumber),
          client.getOptionOrders(acct.accountNumber),
        ]);
        const [equityR, optionR] = results;
        patchState(store, {
          accounts: updateAccount(store.accounts(), accountIndex, (a) => ({
            ...a,
            equityOrders: equityR.status === 'fulfilled'
              ? dataSection(equityR.value)
              : errorSection(a.equityOrders, errMessage(equityR.reason)),
            optionOrders: optionR.status === 'fulfilled'
              ? dataSection(optionR.value)
              : errorSection(a.optionOrders, errMessage(optionR.reason)),
          })),
        });
        return;
      }

      patchState(store, {
        accounts: updateAccount(store.accounts(), accountIndex, (a) => ({
          ...a,
          [section]: loadingSection(a[section] as SectionData<unknown>),
        })),
      });

      try {
        let data: PortfolioSnapshot | EquityPosition[] | OptionPosition[] | Map<string, EquityQuote> | Map<string, OptionQuote> | BrokerOrder[] | PnlTrade[];
        switch (section) {
          case 'portfolio':
            data = await client.getPortfolio(acct.accountNumber);
            break;
          case 'equityPositions':
            data = await client.getEquityPositions(acct.accountNumber);
            break;
          case 'optionPositions':
            data = await client.getOptionPositions(acct.accountNumber, false);
            break;
          case 'equityQuotes':
            data = await client.getEquityQuotes(collectEquitySymbols(acct));
            break;
          case 'optionQuotes':
            data = await client.getOptionQuotes(collectOptionInstrumentIds(acct));
            break;
          case 'equityOrders':
            data = await client.getEquityOrders(acct.accountNumber);
            break;
          case 'optionOrders':
            data = await client.getOptionOrders(acct.accountNumber);
            break;
          case 'closedTrades': {
            const history = await client.getPnlTradeHistory(acct.accountNumber, '3month');
            data = history.trades.filter((t) => t.side === 'sell' && t.symbol);
            break;
          }
          default: {
            const _exhaustive: never = section;
            throw new Error(`Unknown section: ${_exhaustive}`);
          }
        }
        patchState(store, {
          accounts: updateAccount(store.accounts(), accountIndex, (a) => ({
            ...a,
            [section]: dataSection(data),
          })),
        });
      } catch (err) {
        patchState(store, {
          accounts: updateAccount(store.accounts(), accountIndex, (a) => ({
            ...a,
            [section]: errorSection(a[section] as SectionData<unknown>, errMessage(err)),
          })),
        });
      }
    }

    async function loadClosedTrades(accountIndex: number, span: PnlTradeSpan = '3month'): Promise<void> {
      const acct = store.accounts()[accountIndex];
      if (!acct) return;

      patchState(store, {
        accounts: updateAccount(store.accounts(), accountIndex, (a) => ({
          ...a,
          closedTrades: loadingSection(a.closedTrades),
        })),
      });

      try {
        const history = await client.getPnlTradeHistory(acct.accountNumber, span);
        // Filter to sell-side equity trades (exclude empty-side options assignments).
        const equityTrades = history.trades.filter((t) => t.side === 'sell' && t.symbol);
        patchState(store, {
          accounts: updateAccount(store.accounts(), accountIndex, (a) => ({
            ...a,
            closedTrades: dataSection(equityTrades),
          })),
        });
      } catch (err) {
        patchState(store, {
          accounts: updateAccount(store.accounts(), accountIndex, (a) => ({
            ...a,
            closedTrades: errorSection(a.closedTrades, errMessage(err)),
          })),
        });
      }
    }

    return {
      loadAccounts,
      loadPhase1,
      loadPhase2,
      refresh,
      retrySection,
      loadClosedTrades,
      selectAccount(index: number): void {
        patchState(store, { selectedAccountIndex: index });
      },
      toggleClosedPositions(): void {
        const showing = !store.showClosedPositions();
        patchState(store, { showClosedPositions: showing });
        // Load closed trades on-demand when toggling on.
        if (showing) {
          const idx = store.selectedAccountIndex();
          const acct = store.accounts()[idx];
          if (acct && acct.closedTrades.data === null && !acct.closedTrades.loading) {
            loadClosedTrades(idx);
          }
        }
      },
      toggleOrderHistory(): void {
        patchState(store, { showOrderHistory: !store.showOrderHistory() });
      },
    };
  }),
);
