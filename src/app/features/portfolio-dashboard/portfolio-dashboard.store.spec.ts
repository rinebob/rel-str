import { TestBed } from '@angular/core/testing';

import { PortfolioDashboardStore } from './portfolio-dashboard.store';
import {
  MockClient,
  createMockClient,
  makeAccount,
  makeEquityPosition,
  makeEquityQuote,
  makeOptionPosition,
  makeOrder,
  makeOptionOrder,
  makePortfolio,
  makePnlTrade,
  makePnlTradeHistory,
  resolve,
  reject,
  setupStore,
} from './portfolio-dashboard.spec-fixtures';
import { BrokerOrder, EquityQuote } from '../../core/robinhood-mcp/types/robinhood-mcp.types';

describe('PortfolioDashboardStore', () => {
  let store: InstanceType<typeof PortfolioDashboardStore>;
  let client: MockClient;

  beforeEach(() => {
    TestBed.resetTestingModule();
    client = createMockClient();
    store = setupStore(client);
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('initializes with expected default state', () => {
      expect(store.accounts()).toEqual([]);
      expect(store.selectedAccountIndex()).toBe(0);
      expect(store.showClosedPositions()).toBe(false);
      expect(store.showOrderHistory()).toBe(false);
      expect(store.globalLoading()).toBe(false);
      expect(store.loadError()).toBeNull();
      expect(store.selectedAccount()).toBeNull();
      expect(store.aggregateSummary()).toEqual({
        totalValue: null,
        totalExposure: null,
        totalCash: null,
        totalBuyingPower: null,
        totalPnL: null,
      });
      expect(store.equityPositionsWithPnL()).toEqual([]);
      expect(store.openOrders()).toEqual([]);
      expect(store.stopLossProtectedSymbols().size).toBe(0);
    });
  });

  // ── loadAccounts ──────────────────────────────────────────────────────────

  describe('loadAccounts', () => {
    it('populates accounts with correct count and names', async () => {
      client.getAccounts.and.returnValue(resolve([
        makeAccount({ accountNumber: '111', accountName: 'Account A' }),
        makeAccount({ accountNumber: '222', accountName: 'Account B' }),
      ]));
      await store.loadAccounts();

      expect(store.accounts().length).toBe(2);
      expect(store.accounts()[0].accountNumber).toBe('111');
      expect(store.accounts()[0].accountName).toBe('Account A');
      expect(store.accounts()[1].accountNumber).toBe('222');
      expect(store.accounts()[1].accountName).toBe('Account B');
    });

    it('resets selectedAccountIndex to 0', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount()]));
      await store.loadAccounts();
      expect(store.selectedAccountIndex()).toBe(0);
    });

    it('sets globalLoading false after success', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount()]));
      await store.loadAccounts();
      expect(store.globalLoading()).toBe(false);
    });

    it('sets globalLoading false on error and rethrows', async () => {
      client.getAccounts.and.returnValue(reject('Network error'));
      let threw = false;
      try { await store.loadAccounts(); } catch { threw = true; }
      expect(threw).toBe(true);
      expect(store.globalLoading()).toBe(false);
    });

    it('initializes all sections with null data and no loading', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount()]));
      await store.loadAccounts();
      const acct = store.accounts()[0];
      expect(acct.portfolio).toEqual({ data: null, loading: false, error: null });
      expect(acct.equityPositions).toEqual({ data: null, loading: false, error: null });
      expect(acct.optionPositions).toEqual({ data: null, loading: false, error: null });
      expect(acct.equityQuotes).toEqual({ data: null, loading: false, error: null });
      expect(acct.optionQuotes).toEqual({ data: null, loading: false, error: null });
      expect(acct.equityOrders).toEqual({ data: null, loading: false, error: null });
      expect(acct.optionOrders).toEqual({ data: null, loading: false, error: null });
    });

    it('handles empty accounts (no agentic-allowed)', async () => {
      client.getAccounts.and.returnValue(resolve([]));
      await store.loadAccounts();
      expect(store.accounts()).toEqual([]);
      expect(store.selectedAccount()).toBeNull();
    });
  });

  // ── loadPhase1 ─────────────────────────────────────────────────────────────

  describe('loadPhase1', () => {
    it('fetches portfolio + equity positions + option positions for each account', async () => {
      client.getAccounts.and.returnValue(resolve([
        makeAccount({ accountNumber: '111' }),
        makeAccount({ accountNumber: '222' }),
      ]));
      await store.loadAccounts();

      client.getPortfolio.and.returnValue(resolve(makePortfolio()));
      client.getEquityPositions.and.returnValue(resolve([makeEquityPosition()]));
      client.getOptionPositions.and.returnValue(resolve([makeOptionPosition()]));

      await store.loadPhase1();

      expect(client.getPortfolio).toHaveBeenCalledTimes(2);
      expect(client.getPortfolio).toHaveBeenCalledWith('111');
      expect(client.getPortfolio).toHaveBeenCalledWith('222');
      expect(client.getEquityPositions).toHaveBeenCalledTimes(2);
      expect(client.getOptionPositions).toHaveBeenCalledTimes(2);
      expect(client.getOptionPositions).toHaveBeenCalledWith('222', false);

      const acct0 = store.accounts()[0];
      expect(acct0.portfolio.data).toEqual(makePortfolio());
      expect(acct0.equityPositions.data).toEqual([makeEquityPosition()]);
      expect(acct0.optionPositions.data).toEqual([makeOptionPosition()]);
      expect(acct0.portfolio.loading).toBe(false);
      expect(acct0.equityPositions.loading).toBe(false);
    });

    it('sets per-section error independently — one failure does not affect others', async () => {
      client.getAccounts.and.returnValue(resolve([
        makeAccount({ accountNumber: '111' }),
        makeAccount({ accountNumber: '222' }),
      ]));
      await store.loadAccounts();

      client.getPortfolio.and.callFake((acct: string) =>
        acct === '111' ? reject('Portfolio failed') : resolve(makePortfolio()),
      );
      client.getEquityPositions.and.returnValue(resolve([makeEquityPosition()]));
      client.getOptionPositions.and.returnValue(resolve([makeOptionPosition()]));

      await store.loadPhase1();

      // Account 0: portfolio failed, but positions succeeded
      expect(store.accounts()[0].portfolio.error).toBe('Portfolio failed');
      expect(store.accounts()[0].portfolio.data).toBeNull();
      expect(store.accounts()[0].equityPositions.data).toEqual([makeEquityPosition()]);
      expect(store.accounts()[0].equityPositions.error).toBeNull();
      expect(store.accounts()[0].optionPositions.data).toEqual([makeOptionPosition()]);
      expect(store.accounts()[0].optionPositions.error).toBeNull();
      // Account 1: all succeeded
      expect(store.accounts()[1].portfolio.data).toEqual(makePortfolio());
      expect(store.accounts()[1].portfolio.error).toBeNull();
    });

    it('sets globalLoading false after completion', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount()]));
      await store.loadAccounts();
      client.getPortfolio.and.returnValue(resolve(makePortfolio()));
      client.getEquityPositions.and.returnValue(resolve([]));
      client.getOptionPositions.and.returnValue(resolve([]));
      await store.loadPhase1();
      expect(store.globalLoading()).toBe(false);
    });
  });

  // ── loadPhase2 ─────────────────────────────────────────────────────────────

  describe('loadPhase2', () => {
    beforeEach(async () => {
      client.getAccounts.and.returnValue(resolve([
        makeAccount({ accountNumber: '111' }),
        makeAccount({ accountNumber: '222' }),
      ]));
      await store.loadAccounts();
      client.getPortfolio.and.returnValue(resolve(makePortfolio()));
      client.getEquityPositions.and.returnValue(resolve([
        makeEquityPosition({ symbol: 'AAPL' }),
        makeEquityPosition({ symbol: 'NVDA' }),
      ]));
      client.getOptionPositions.and.returnValue(resolve([
        makeOptionPosition({ instrumentId: 'inst-1' }),
      ]));
      await store.loadPhase1();
    });

    it('collects unique symbols and fetches equity quotes once', async () => {
      client.getEquityQuotes.and.returnValue(resolve(new Map([
        ['AAPL', makeEquityQuote({ symbol: 'AAPL' })],
        ['NVDA', makeEquityQuote({ symbol: 'NVDA', lastTradePrice: 200 })],
      ])));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));
      client.getEquityOrders.and.returnValue(resolve([]));
      client.getOptionOrders.and.returnValue(resolve([]));

      await store.loadPhase2();
      expect(client.getEquityQuotes).toHaveBeenCalledTimes(1);
      expect(client.getEquityQuotes).toHaveBeenCalledWith(['AAPL', 'NVDA']);
    });

    it('distributes quote maps to all accounts (independent copies)', async () => {
      const eqQuotes = new Map([['AAPL', makeEquityQuote({ symbol: 'AAPL' })]]);
      client.getEquityQuotes.and.returnValue(resolve(eqQuotes));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));
      client.getEquityOrders.and.returnValue(resolve([]));
      client.getOptionOrders.and.returnValue(resolve([]));

      await store.loadPhase2();
      const acct0Map = store.accounts()[0].equityQuotes.data!;
      const acct1Map = store.accounts()[1].equityQuotes.data!;
      expect(acct0Map.get('AAPL')).toEqual(makeEquityQuote({ symbol: 'AAPL' }));
      expect(acct1Map.get('AAPL')).toEqual(makeEquityQuote({ symbol: 'AAPL' }));
      // Independent Map instances
      expect(acct0Map).not.toBe(acct1Map);
    });

    it('fetches orders per account', async () => {
      client.getEquityQuotes.and.returnValue(resolve(new Map()));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));
      client.getEquityOrders.and.returnValue(resolve([makeOrder({ state: 'filled' })]));
      client.getOptionOrders.and.returnValue(resolve([]));

      await store.loadPhase2();
      expect(client.getEquityOrders).toHaveBeenCalledTimes(2);
      expect(client.getEquityOrders).toHaveBeenCalledWith('111');
      expect(client.getEquityOrders).toHaveBeenCalledWith('222');
      expect(store.accounts()[0].equityOrders.data).toEqual([makeOrder({ state: 'filled' })]);
    });

    it('sets per-section error on order fetch failure independently', async () => {
      client.getEquityQuotes.and.returnValue(resolve(new Map()));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));
      client.getEquityOrders.and.returnValue(reject('Orders failed'));
      client.getOptionOrders.and.returnValue(resolve([makeOptionOrder({ state: 'filled' })]));

      await store.loadPhase2();
      expect(store.accounts()[0].equityOrders.error).toBe('Orders failed');
      expect(store.accounts()[0].equityOrders.data).toBeNull();
      // optionOrders succeeded independently
      expect(store.accounts()[0].optionOrders.data?.length).toBe(1);
      expect(store.accounts()[0].optionOrders.error).toBeNull();
    });

    it('sets per-section error on quote fetch failure without leaving loading stuck', async () => {
      client.getEquityQuotes.and.returnValue(reject('Quotes failed'));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));
      client.getEquityOrders.and.returnValue(resolve([]));
      client.getOptionOrders.and.returnValue(resolve([]));

      await store.loadPhase2();
      expect(store.accounts()[0].equityQuotes.error).toBe('Quotes failed');
      expect(store.accounts()[0].equityQuotes.loading).toBe(false);
      expect(store.accounts()[0].equityQuotes.data).toBeNull();
      // optionQuotes succeeded
      expect(store.accounts()[0].optionQuotes.data).toEqual(new Map());
      expect(store.accounts()[0].optionQuotes.error).toBeNull();
      expect(store.globalLoading()).toBe(false);
    });
  });

  // ── refresh ────────────────────────────────────────────────────────────────

  describe('refresh', () => {
    it('re-runs the full load sequence', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount()]));
      client.getPortfolio.and.returnValue(resolve(makePortfolio()));
      client.getEquityPositions.and.returnValue(resolve([makeEquityPosition()]));
      client.getOptionPositions.and.returnValue(resolve([]));
      client.getEquityQuotes.and.returnValue(resolve(new Map()));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));
      client.getEquityOrders.and.returnValue(resolve([]));
      client.getOptionOrders.and.returnValue(resolve([]));

      await store.refresh();

      expect(client.getAccounts).toHaveBeenCalledTimes(1);
      expect(client.getPortfolio).toHaveBeenCalledTimes(1);
      expect(client.getEquityPositions).toHaveBeenCalledTimes(1);
      expect(client.getEquityQuotes).toHaveBeenCalledTimes(1);
      expect(client.getEquityOrders).toHaveBeenCalledTimes(1);
      expect(store.accounts().length).toBe(1);
    });

    it('skips concurrent refresh calls', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount()]));
      client.getPortfolio.and.returnValue(resolve(makePortfolio()));
      client.getEquityPositions.and.returnValue(resolve([]));
      client.getOptionPositions.and.returnValue(resolve([]));
      client.getEquityQuotes.and.returnValue(resolve(new Map()));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));
      client.getEquityOrders.and.returnValue(resolve([]));
      client.getOptionOrders.and.returnValue(resolve([]));

      // Fire two refresh calls concurrently
      await Promise.all([store.refresh(), store.refresh()]);

      // Only one full sequence should have run
      expect(client.getAccounts).toHaveBeenCalledTimes(1);
    });

    it('sets loadError and clears globalLoading when loadAccounts fails', async () => {
      client.getAccounts.and.returnValue(reject('Network error'));

      await store.refresh();

      expect(store.loadError()).toBe('Network error');
      expect(store.globalLoading()).toBe(false);
    });

    it('clears loadError on successful refresh after failure', async () => {
      // First refresh fails
      client.getAccounts.and.returnValue(reject('Network error'));
      await store.refresh();
      expect(store.loadError()).toBe('Network error');

      // Second refresh succeeds
      client.getAccounts.and.returnValue(resolve([makeAccount()]));
      client.getPortfolio.and.returnValue(resolve(makePortfolio()));
      client.getEquityPositions.and.returnValue(resolve([]));
      client.getOptionPositions.and.returnValue(resolve([]));
      client.getEquityQuotes.and.returnValue(resolve(new Map()));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));
      client.getEquityOrders.and.returnValue(resolve([]));
      client.getOptionOrders.and.returnValue(resolve([]));

      await store.refresh();
      expect(store.loadError()).toBeNull();
    });
  });

  // ── retrySection ───────────────────────────────────────────────────────────

  describe('retrySection', () => {
    beforeEach(async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount({ accountNumber: '111' })]));
      await store.loadAccounts();
    });

    it('re-fetches only the specified section', async () => {
      client.getPortfolio.and.returnValue(resolve(makePortfolio({ totalValue: 999999 })));
      await store.retrySection(0, 'portfolio');
      expect(client.getPortfolio).toHaveBeenCalledTimes(1);
      expect(client.getPortfolio).toHaveBeenCalledWith('111');
      expect(store.accounts()[0].portfolio.data?.totalValue).toBe(999999);
      expect(store.accounts()[0].portfolio.loading).toBe(false);
      expect(store.accounts()[0].portfolio.error).toBeNull();
    });

    it('re-fetches equityOrders section', async () => {
      client.getEquityOrders.and.returnValue(resolve([makeOrder({ state: 'filled' })]));
      await store.retrySection(0, 'equityOrders');
      expect(client.getEquityOrders).toHaveBeenCalledTimes(1);
      expect(store.accounts()[0].equityOrders.data?.length).toBe(1);
    });

    it('sets error on failure', async () => {
      client.getPortfolio.and.returnValue(reject('Retry failed'));
      await store.retrySection(0, 'portfolio');
      expect(store.accounts()[0].portfolio.error).toBe('Retry failed');
      expect(store.accounts()[0].portfolio.loading).toBe(false);
    });

    it('does nothing for invalid account index', async () => {
      await store.retrySection(99, 'portfolio');
      expect(client.getPortfolio).not.toHaveBeenCalled();
    });
  });

  // ── selectAccount / toggles ─────────────────────────────────────────────────

  describe('selectAccount', () => {
    it('updates selectedAccountIndex', async () => {
      client.getAccounts.and.returnValue(resolve([
        makeAccount({ accountNumber: '111' }),
        makeAccount({ accountNumber: '222' }),
      ]));
      await store.loadAccounts();
      store.selectAccount(1);
      expect(store.selectedAccountIndex()).toBe(1);
      expect(store.selectedAccount()?.accountNumber).toBe('222');
    });
  });

  describe('toggleClosedPositions', () => {
    it('flips showClosedPositions', () => {
      expect(store.showClosedPositions()).toBe(false);
      store.toggleClosedPositions();
      expect(store.showClosedPositions()).toBe(true);
      store.toggleClosedPositions();
      expect(store.showClosedPositions()).toBe(false);
    });

    it('loads closed trades on-demand when toggling on', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount({ accountNumber: '111' })]));
      await store.loadAccounts();

      client.getPnlTradeHistory.and.returnValue(resolve(makePnlTradeHistory({
        accountNumber: '111',
        trades: [makePnlTrade({ symbol: 'AAPL', side: 'sell' })],
      })));

      store.toggleClosedPositions();
      await new Promise((r) => setTimeout(r, 0));

      expect(client.getPnlTradeHistory).toHaveBeenCalledWith('111', '3month');
      const acct = store.accounts()[0];
      expect(acct.closedTrades.data).toEqual([makePnlTrade({ symbol: 'AAPL', side: 'sell' })]);
      expect(acct.closedTrades.loading).toBe(false);
      expect(acct.closedTrades.error).toBeNull();
    });

    it('does not reload closed trades if already loaded', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount({ accountNumber: '111' })]));
      await store.loadAccounts();

      client.getPnlTradeHistory.and.returnValue(resolve(makePnlTradeHistory()));
      store.toggleClosedPositions();
      await new Promise((r) => setTimeout(r, 0));
      expect(client.getPnlTradeHistory).toHaveBeenCalledTimes(1);

      // Toggle off then on again — should not reload
      store.toggleClosedPositions();
      store.toggleClosedPositions();
      await new Promise((r) => setTimeout(r, 0));
      expect(client.getPnlTradeHistory).toHaveBeenCalledTimes(1);
    });

    it('filters to sell-side equity trades only', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount({ accountNumber: '111' })]));
      await store.loadAccounts();

      client.getPnlTradeHistory.and.returnValue(resolve(makePnlTradeHistory({
        trades: [
          makePnlTrade({ symbol: 'AAPL', side: 'sell' }),
          makePnlTrade({ symbol: 'GOOG', side: 'buy' }),
          makePnlTrade({ symbol: '', side: 'sell' }),
          makePnlTrade({ symbol: 'TSLA', side: '' }),
        ],
      })));

      store.toggleClosedPositions();
      await new Promise((r) => setTimeout(r, 0));

      const trades = store.accounts()[0].closedTrades.data ?? [];
      expect(trades.length).toBe(1);
      expect(trades[0].symbol).toBe('AAPL');
    });

    it('sets error on closedTrades when getPnlTradeHistory fails', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount({ accountNumber: '111' })]));
      await store.loadAccounts();

      client.getPnlTradeHistory.and.returnValue(reject('MCP error'));
      store.toggleClosedPositions();
      await new Promise((r) => setTimeout(r, 0));

      const acct = store.accounts()[0];
      expect(acct.closedTrades.data).toBeNull();
      expect(acct.closedTrades.error).toBe('MCP error');
    });
  });

  describe('closedTradesWithPnL', () => {
    it('maps closed trades to EquityPositionWithPnL with pnl and pnlPercent', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount({ accountNumber: '111' })]));
      await store.loadAccounts();

      client.getPnlTradeHistory.and.returnValue(resolve(makePnlTradeHistory({
        trades: [makePnlTrade({ symbol: 'AAPL', quantity: 10, price: 175, realizedGain: 250 })],
      })));

      store.toggleClosedPositions();
      await new Promise((r) => setTimeout(r, 0));

      const closed = store.closedTradesWithPnL();
      expect(closed.length).toBe(1);
      expect(closed[0].symbol).toBe('AAPL');
      expect(closed[0].quantity).toBe(10);
      expect(closed[0].currentPrice).toBe(175);
      expect(closed[0].pnl).toBe(250);
      expect(closed[0].closed).toBe(true);
      // cost basis = (175 * 10) - 250 = 1500; avgBuyPrice = 1500 / 10 = 150
      expect(closed[0].averageBuyPrice).toBe(150);
      // pnlPercent = 250/1500 * 100 = 16.67
      expect(closed[0].pnlPercent).toBeCloseTo(16.67, 1);
    });
  });

  describe('toggleOrderHistory', () => {
    it('flips showOrderHistory', () => {
      expect(store.showOrderHistory()).toBe(false);
      store.toggleOrderHistory();
      expect(store.showOrderHistory()).toBe(true);
    });
  });
});
