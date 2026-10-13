import { TestBed } from '@angular/core/testing';

import { PortfolioDashboardStore } from './portfolio-dashboard.store';
import {
  MockClient,
  MockToolSpec,
  batchAnswers,
  createMockClient,
  fulfilled,
  makeAccount,
  makeEquityPosition,
  makeEquityQuote,
  makeOptionPosition,
  makeOrder,
  makeOptionOrder,
  makePortfolio,
  rejected,
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

    it('defaults selection to the first agentic account, not index 0', async () => {
      client.getAccounts.and.returnValue(resolve([
        makeAccount({ accountNumber: '999', agenticAllowed: false }),
        makeAccount({ accountNumber: '111', agenticAllowed: true }),
      ]));
      await store.loadAccounts();
      expect(store.selectedAccountIndex()).toBe(1);
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
    it('issues one batch call per account carrying portfolio + both position specs', async () => {
      client.getAccounts.and.returnValue(resolve([
        makeAccount({ accountNumber: '111' }),
        makeAccount({ accountNumber: '222' }),
      ]));
      await store.loadAccounts();

      batchAnswers(client, {
        get_portfolio: fulfilled(makePortfolio()),
        get_equity_positions: fulfilled([makeEquityPosition()]),
        get_option_positions: fulfilled([makeOptionPosition()]),
      });

      await store.loadPhase1();

      expect(client.executeBatch).toHaveBeenCalledTimes(2);
      const batchArgs = client.executeBatch.calls.allArgs() as [MockToolSpec[]][];
      const specsFor111 = batchArgs.map(([specs]) => specs).find(
        (specs) => specs[0].args?.['account_number'] === '111',
      )!;
      expect(specsFor111.map((s) => s.tool)).toEqual([
        'get_portfolio',
        'get_equity_positions',
        'get_option_positions',
      ]);
      const specsFor222 = batchArgs.map(([specs]) => specs).find(
        (specs) => specs[0].args?.['account_number'] === '222',
      )!;
      expect(specsFor222.length).toBe(3);

      const acct0 = store.accounts()[0];
      expect(acct0.portfolio.data).toEqual(makePortfolio());
      expect(acct0.equityPositions.data).toEqual([makeEquityPosition()]);
      expect(acct0.optionPositions.data).toEqual([makeOptionPosition()]);
      expect(acct0.portfolio.loading).toBe(false);
      expect(acct0.equityPositions.loading).toBe(false);
    });

    it('sets per-section error independently — one failed item does not affect others', async () => {
      client.getAccounts.and.returnValue(resolve([
        makeAccount({ accountNumber: '111' }),
        makeAccount({ accountNumber: '222' }),
      ]));
      await store.loadAccounts();

      batchAnswers(client, {
        get_portfolio: (spec) =>
          spec.args?.['account_number'] === '111'
            ? rejected('Portfolio failed')
            : fulfilled(makePortfolio()),
        get_equity_positions: fulfilled([makeEquityPosition()]),
        get_option_positions: fulfilled([makeOptionPosition()]),
      });

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

    it('a batch-level failure errors every section in the group', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount({ accountNumber: '111' })]));
      await store.loadAccounts();

      client.executeBatch.and.callFake(() => reject('HTTP 401'));

      await store.loadPhase1();

      const acct = store.accounts()[0];
      expect(acct.portfolio.error).toBe('HTTP 401');
      expect(acct.equityPositions.error).toBe('HTTP 401');
      expect(acct.optionPositions.error).toBe('HTTP 401');
      expect(acct.portfolio.loading).toBe(false);
    });

    it('sets globalLoading false after completion', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount()]));
      await store.loadAccounts();
      batchAnswers(client, {
        get_portfolio: fulfilled(makePortfolio()),
        get_equity_positions: fulfilled([]),
        get_option_positions: fulfilled([]),
      });
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
      batchAnswers(client, {
        get_portfolio: fulfilled(makePortfolio()),
        get_equity_positions: fulfilled([
          makeEquityPosition({ symbol: 'AAPL' }),
          makeEquityPosition({ symbol: 'NVDA' }),
        ]),
        get_option_positions: fulfilled([
          makeOptionPosition({ instrumentId: 'inst-1' }),
        ]),
      });
      await store.loadPhase1();
      client.executeBatch.calls.reset();
    });

    function stubOrderBatch(): void {
      batchAnswers(client, {
        get_equity_orders: fulfilled([makeOrder({ state: 'filled' })]),
        get_option_orders: fulfilled([]),
      });
    }

    it('collects unique symbols and fetches equity quotes once', async () => {
      client.getEquityQuotes.and.returnValue(resolve(new Map([
        ['AAPL', makeEquityQuote({ symbol: 'AAPL' })],
        ['NVDA', makeEquityQuote({ symbol: 'NVDA', lastTradePrice: 200 })],
      ])));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));
      stubOrderBatch();

      await store.loadPhase2();
      expect(client.getEquityQuotes).toHaveBeenCalledTimes(1);
      expect(client.getEquityQuotes).toHaveBeenCalledWith(['AAPL', 'NVDA']);
    });

    it('distributes quote maps to all accounts (independent copies)', async () => {
      const eqQuotes = new Map([['AAPL', makeEquityQuote({ symbol: 'AAPL' })]]);
      client.getEquityQuotes.and.returnValue(resolve(eqQuotes));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));
      stubOrderBatch();

      await store.loadPhase2();
      const acct0Map = store.accounts()[0].equityQuotes.data!;
      const acct1Map = store.accounts()[1].equityQuotes.data!;
      expect(acct0Map.get('AAPL')).toEqual(makeEquityQuote({ symbol: 'AAPL' }));
      expect(acct1Map.get('AAPL')).toEqual(makeEquityQuote({ symbol: 'AAPL' }));
      // Independent Map instances
      expect(acct0Map).not.toBe(acct1Map);
    });

    it('fetches orders per account in one batch call each', async () => {
      client.getEquityQuotes.and.returnValue(resolve(new Map()));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));
      stubOrderBatch();

      await store.loadPhase2();
      expect(client.executeBatch).toHaveBeenCalledTimes(2);
      const batchArgs = client.executeBatch.calls.allArgs() as [MockToolSpec[]][];
      expect(batchArgs[0][0].map((s) => s.tool)).toEqual(['get_equity_orders', 'get_option_orders']);
      expect(batchArgs[0][0][0].args?.['account_number']).toBe('111');
      expect(batchArgs[1][0][0].args?.['account_number']).toBe('222');
      expect(store.accounts()[0].equityOrders.data).toEqual([makeOrder({ state: 'filled' })]);
    });

    it('sets per-section error on order fetch failure independently', async () => {
      client.getEquityQuotes.and.returnValue(resolve(new Map()));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));
      batchAnswers(client, {
        get_equity_orders: rejected('Orders failed'),
        get_option_orders: fulfilled([makeOptionOrder({ state: 'filled' })]),
      });

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
      stubOrderBatch();

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
    function stubFullRefresh(): void {
      batchAnswers(client, {
        get_portfolio: fulfilled(makePortfolio()),
        get_equity_positions: fulfilled([makeEquityPosition()]),
        get_option_positions: fulfilled([]),
        get_equity_orders: fulfilled([]),
        get_option_orders: fulfilled([]),
      });
      client.getEquityQuotes.and.returnValue(resolve(new Map()));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));
    }

    it('re-runs the full load sequence', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount()]));
      stubFullRefresh();

      await store.refresh();

      expect(client.getAccounts).toHaveBeenCalledTimes(1);
      // phase1 batch + phase2 orders batch — one executeBatch call per phase
      expect(client.executeBatch).toHaveBeenCalledTimes(2);
      expect(client.getEquityQuotes).toHaveBeenCalledTimes(1);
      expect(store.accounts().length).toBe(1);
    });

    it('skips concurrent refresh calls', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount()]));
      stubFullRefresh();

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
      stubFullRefresh();

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

    it('re-fetches both order sections in one batch on the combined orders retry', async () => {
      batchAnswers(client, {
        get_equity_orders: fulfilled([makeOrder({ state: 'filled' })]),
        get_option_orders: fulfilled([makeOptionOrder({ state: 'cancelled' })]),
      });
      await store.retrySection(0, 'orders');

      expect(client.executeBatch).toHaveBeenCalledTimes(1);
      const specs = (client.executeBatch.calls.mostRecent().args[0] as MockToolSpec[]);
      expect(specs.map((s) => s.tool)).toEqual(['get_equity_orders', 'get_option_orders']);
      expect(store.accounts()[0].equityOrders.data?.length).toBe(1);
      expect(store.accounts()[0].optionOrders.data?.length).toBe(1);
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

  describe('entryDate derivation', () => {
    beforeEach(async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount({ accountNumber: '111' })]));
      await store.loadAccounts();
      client.getEquityPositions.and.returnValue(resolve([
        makeEquityPosition({ symbol: 'AAPL', quantity: 10 }),
      ]));
    });

    it('attaches the earliest buy fill timestamp to the position', async () => {
      client.getEquityOrders.and.returnValue(resolve([
        makeOrder({ side: 'buy', state: 'filled', symbol: 'AAPL', createdAt: '2026-03-01T10:00:00Z' }),
        makeOrder({ side: 'buy', state: 'filled', symbol: 'AAPL', createdAt: '2026-01-15T10:00:00Z' }),
      ]));
      await store.retrySection(0, 'equityPositions');
      await store.retrySection(0, 'equityOrders');

      expect(store.equityPositionsWithPnL()[0].entryDate).toBe('2026-01-15T10:00:00Z');
    });

    it('is null when order history has no matching fill', async () => {
      client.getEquityOrders.and.returnValue(resolve([
        makeOrder({ side: 'sell', state: 'filled', symbol: 'AAPL' }),
      ]));
      await store.retrySection(0, 'equityPositions');
      await store.retrySection(0, 'equityOrders');

      expect(store.equityPositionsWithPnL()[0].entryDate).toBeNull();
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
