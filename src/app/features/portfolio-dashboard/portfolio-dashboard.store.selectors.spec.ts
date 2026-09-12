import { TestBed } from '@angular/core/testing';

import { PortfolioDashboardStore } from './portfolio-dashboard.store';
import {
  MockClient,
  createMockClient,
  makeAccount,
  makeEquityPosition,
  makeEquityQuote,
  makeOptionPosition,
  makeOptionQuote,
  makeOrder,
  makeOptionOrder,
  makePortfolio,
  resolve,
  setupStore,
} from './portfolio-dashboard.spec-fixtures';
import { BrokerOrder, EquityQuote, OptionQuote } from '../../core/robinhood-mcp/types/robinhood-mcp.types';

describe('PortfolioDashboardStore selectors', () => {
  let store: InstanceType<typeof PortfolioDashboardStore>;
  let client: MockClient;

  beforeEach(() => {
    TestBed.resetTestingModule();
    client = createMockClient();
    store = setupStore(client);
  });

  // Helper: load a single account with given positions/quotes/orders
  async function loadSingleAccount(opts: {
    equityPositions?: ReturnType<typeof makeEquityPosition>[];
    optionPositions?: ReturnType<typeof makeOptionPosition>[];
    equityQuotes?: Map<string, EquityQuote>;
    optionQuotes?: Map<string, OptionQuote>;
    equityOrders?: BrokerOrder[];
    optionOrders?: BrokerOrder[];
    portfolio?: ReturnType<typeof makePortfolio>;
  }) {
    client.getAccounts.and.returnValue(resolve([makeAccount()]));
    await store.loadAccounts();
    client.getPortfolio.and.returnValue(resolve(opts.portfolio ?? makePortfolio()));
    client.getEquityPositions.and.returnValue(resolve(opts.equityPositions ?? []));
    client.getOptionPositions.and.returnValue(resolve(opts.optionPositions ?? []));
    await store.loadPhase1();
    client.getEquityQuotes.and.returnValue(resolve(opts.equityQuotes ?? new Map()));
    client.getOptionQuotes.and.returnValue(resolve(opts.optionQuotes ?? new Map()));
    client.getEquityOrders.and.returnValue(resolve(opts.equityOrders ?? []));
    client.getOptionOrders.and.returnValue(resolve(opts.optionOrders ?? []));
    await store.loadPhase2();
  }

  // ── aggregateSummary ───────────────────────────────────────────────────────

  describe('aggregateSummary', () => {
    it('sums totalValue, totalExposure, cash, buyingPower across all accounts', async () => {
      client.getAccounts.and.returnValue(resolve([
        makeAccount({ accountNumber: '111' }),
        makeAccount({ accountNumber: '222' }),
      ]));
      await store.loadAccounts();
      client.getPortfolio.and.callFake((acct: string) =>
        acct === '111'
          ? resolve(makePortfolio({ totalValue: 100000, equityValue: 80000, cash: 20000, buyingPower: 40000 }))
          : resolve(makePortfolio({ totalValue: 50000, equityValue: 40000, cash: 10000, buyingPower: 20000 })),
      );
      client.getEquityPositions.and.returnValue(resolve([]));
      client.getOptionPositions.and.returnValue(resolve([]));
      await store.loadPhase1();
      client.getEquityQuotes.and.returnValue(resolve(new Map()));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));
      client.getEquityOrders.and.returnValue(resolve([]));
      client.getOptionOrders.and.returnValue(resolve([]));
      await store.loadPhase2();

      const summary = store.aggregateSummary();
      expect(summary.totalValue).toBe(150000);
      expect(summary.totalExposure).toBe(120000);
      expect(summary.totalCash).toBe(30000);
      expect(summary.totalBuyingPower).toBe(60000);
    });

    it('returns null for all fields when no portfolio data', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount()]));
      await store.loadAccounts();
      const summary = store.aggregateSummary();
      expect(summary.totalValue).toBeNull();
      expect(summary.totalExposure).toBeNull();
      expect(summary.totalCash).toBeNull();
      expect(summary.totalBuyingPower).toBeNull();
    });

    it('returns cash/buyingPower independently when totalValue is null', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount()]));
      await store.loadAccounts();
      client.getPortfolio.and.returnValue(resolve(makePortfolio({
        totalValue: null, cash: 5000, buyingPower: 10000, equityValue: null,
      })));
      client.getEquityPositions.and.returnValue(resolve([]));
      client.getOptionPositions.and.returnValue(resolve([]));
      await store.loadPhase1();

      const summary = store.aggregateSummary();
      expect(summary.totalValue).toBeNull();
      expect(summary.totalCash).toBe(5000);
      expect(summary.totalBuyingPower).toBe(10000);
    });

    it('sums PnL across equity and option positions', async () => {
      await loadSingleAccount({
        equityPositions: [makeEquityPosition({ symbol: 'AAPL', quantity: 100, averageBuyPrice: 150 })],
        optionPositions: [makeOptionPosition({ instrumentId: 'inst-1', quantity: 1, averageCost: 500 })],
        equityQuotes: new Map([
          ['AAPL', makeEquityQuote({ symbol: 'AAPL', lastTradePrice: 155 })],
        ]),
        optionQuotes: new Map([
          ['inst-1', makeOptionQuote({ instrumentId: 'inst-1', lastTradePrice: 550 })],
        ]),
      });

      const summary = store.aggregateSummary();
      // Equity PnL: (155-150)*100 = 500
      // Option PnL: (550-500)*1 = 50
      expect(summary.totalPnL).toBe(550);
    });
  });

  // ── equityPositionsWithPnL ─────────────────────────────────────────────────

  describe('equityPositionsWithPnL', () => {
    it('joins positions with quotes and computes PnL', async () => {
      await loadSingleAccount({
        equityPositions: [makeEquityPosition({ symbol: 'AAPL', quantity: 100, averageBuyPrice: 150 })],
        equityQuotes: new Map([['AAPL', makeEquityQuote({ symbol: 'AAPL', lastTradePrice: 155 })]]),
      });

      const positions = store.equityPositionsWithPnL();
      expect(positions.length).toBe(1);
      expect(positions[0].symbol).toBe('AAPL');
      expect(positions[0].currentPrice).toBe(155);
      expect(positions[0].pnl).toBe(500);
      expect(positions[0].pnlPercent).toBeCloseTo(3.33, 1);
    });

    it('returns null PnL when no quote available', async () => {
      await loadSingleAccount({
        equityPositions: [makeEquityPosition({ symbol: 'AAPL' })],
        equityQuotes: new Map(),
      });

      const positions = store.equityPositionsWithPnL();
      expect(positions[0].pnl).toBeNull();
      expect(positions[0].currentPrice).toBeNull();
    });
  });

  // ── optionPositionsWithPnL ──────────────────────────────────────────────────

  describe('optionPositionsWithPnL', () => {
    it('joins option positions with option quotes and computes PnL', async () => {
      await loadSingleAccount({
        optionPositions: [makeOptionPosition({ instrumentId: 'inst-1', quantity: 1, averageCost: 500 })],
        optionQuotes: new Map([['inst-1', makeOptionQuote({ instrumentId: 'inst-1', lastTradePrice: 550 })]]),
      });

      const positions = store.optionPositionsWithPnL();
      expect(positions.length).toBe(1);
      expect(positions[0].instrumentId).toBe('inst-1');
      expect(positions[0].currentPrice).toBe(550);
      expect(positions[0].pnl).toBe(50);
    });

    it('returns null PnL when no option quote available', async () => {
      await loadSingleAccount({
        optionPositions: [makeOptionPosition({ instrumentId: 'inst-1' })],
        optionQuotes: new Map(),
      });

      const positions = store.optionPositionsWithPnL();
      expect(positions[0].pnl).toBeNull();
      expect(positions[0].currentPrice).toBeNull();
    });

    it('returns null PnL for option position with missing instrumentId', async () => {
      await loadSingleAccount({
        optionPositions: [makeOptionPosition({ instrumentId: '' })],
        optionQuotes: new Map([['inst-1', makeOptionQuote({ instrumentId: 'inst-1' })]]),
      });

      const positions = store.optionPositionsWithPnL();
      expect(positions[0].pnl).toBeNull();
      expect(positions[0].currentPrice).toBeNull();
    });
  });

  // ── openOrders ──────────────────────────────────────────────────────────────

  describe('openOrders', () => {
    it('filters to live states and merges equity + option orders', async () => {
      await loadSingleAccount({
        equityOrders: [
          makeOrder({ orderId: '1', state: 'confirmed' }),
          makeOrder({ orderId: '2', state: 'filled' }),
        ],
        optionOrders: [
          makeOptionOrder({ orderId: '3', state: 'partially_filled' }),
          makeOptionOrder({ orderId: '4', state: 'cancelled' }),
        ],
      });

      const open = store.openOrders();
      expect(open.length).toBe(2);
      const ids = open.map((o: BrokerOrder) => o.orderId);
      expect(ids).toContain('1');
      expect(ids).toContain('3');
      // Verify both instrument types are present
      expect(open.some((o: BrokerOrder) => o.instrumentType === 'equity')).toBe(true);
      expect(open.some((o: BrokerOrder) => o.instrumentType === 'option')).toBe(true);
    });

    it('includes voided and unknown in neither open nor history', async () => {
      await loadSingleAccount({
        equityOrders: [
          makeOrder({ orderId: 'void-1', state: 'voided' }),
          makeOrder({ orderId: 'unk-1', state: 'unknown' }),
          makeOrder({ orderId: 'live-1', state: 'confirmed' }),
        ],
      });

      const open = store.openOrders();
      expect(open.length).toBe(1);
      expect(open[0].orderId).toBe('live-1');
    });
  });

  // ── orderHistory ────────────────────────────────────────────────────────────

  describe('orderHistory', () => {
    it('filters to terminal states and merges equity + option orders', async () => {
      await loadSingleAccount({
        equityOrders: [
          makeOrder({ orderId: '1', state: 'filled' }),
          makeOrder({ orderId: '2', state: 'confirmed' }),
        ],
        optionOrders: [
          makeOptionOrder({ orderId: '3', state: 'rejected' }),
        ],
      });

      const history = store.orderHistory();
      expect(history.length).toBe(2);
      const ids = history.map((o: BrokerOrder) => o.orderId);
      expect(ids).toContain('1');
      expect(ids).toContain('3');
      expect(history.some((o: BrokerOrder) => o.instrumentType === 'equity')).toBe(true);
      expect(history.some((o: BrokerOrder) => o.instrumentType === 'option')).toBe(true);
    });

    it('includes voided and unknown in terminal states', async () => {
      await loadSingleAccount({
        equityOrders: [
          makeOrder({ orderId: 'void-1', state: 'voided' }),
          makeOrder({ orderId: 'unk-1', state: 'unknown' }),
          makeOrder({ orderId: 'live-1', state: 'confirmed' }),
        ],
      });

      const history = store.orderHistory();
      expect(history.length).toBe(2);
      const ids = history.map((o: BrokerOrder) => o.orderId);
      expect(ids).toContain('void-1');
      expect(ids).toContain('unk-1');
    });
  });

  // ── stopLossProtectedSymbols ────────────────────────────────────────────────

  describe('stopLossProtectedSymbols', () => {
    it('returns set of symbols protected by active stop-loss orders', async () => {
      await loadSingleAccount({
        equityPositions: [makeEquityPosition({ symbol: 'AAPL', quantity: 100 })],
        equityOrders: [
          makeOrder({ orderId: '1', type: 'stop_market', side: 'sell', symbol: 'AAPL', state: 'confirmed' }),
          makeOrder({ orderId: '2', type: 'limit', side: 'sell', symbol: 'AAPL', state: 'confirmed' }),
        ],
      });

      const protectedSymbols = store.stopLossProtectedSymbols();
      expect(protectedSymbols.size).toBe(1);
      expect(protectedSymbols.has('AAPL')).toBe(true);
    });

    it('does not mark symbol as protected when stop order is terminal (voided)', async () => {
      await loadSingleAccount({
        equityPositions: [makeEquityPosition({ symbol: 'AAPL', quantity: 100 })],
        equityOrders: [
          makeOrder({ orderId: '1', type: 'stop_market', side: 'sell', symbol: 'AAPL', state: 'voided' }),
        ],
      });

      const protectedSymbols = store.stopLossProtectedSymbols();
      expect(protectedSymbols.size).toBe(0);
    });

    it('does not mark symbol as protected when no matching position', async () => {
      await loadSingleAccount({
        equityPositions: [makeEquityPosition({ symbol: 'AAPL', quantity: 100 })],
        equityOrders: [
          makeOrder({ orderId: '1', type: 'stop_market', side: 'sell', symbol: 'MSFT', state: 'confirmed' }),
        ],
      });

      const protectedSymbols = store.stopLossProtectedSymbols();
      expect(protectedSymbols.size).toBe(0);
    });
  });
});
