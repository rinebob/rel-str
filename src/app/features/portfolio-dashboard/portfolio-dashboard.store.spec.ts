import { TestBed } from '@angular/core/testing';

import { PortfolioDashboardStore } from './portfolio-dashboard.store';
import {
  MockClient,
  MockPeakService,
  MockToolSpec,
  batchAnswers,
  createMockClient,
  createMockPeakService,
  fulfilled,
  makeAccount,
  makeEquityPosition,
  makeOptionPosition,
  makeOrder,
  makeOptionOrder,
  makePortfolio,
  rejected,
  resolve,
  reject,
  setupStore,
} from './portfolio-dashboard.spec-fixtures';

describe('PortfolioDashboardStore', () => {
  let store: InstanceType<typeof PortfolioDashboardStore>;
  let client: MockClient;
  let peaks: MockPeakService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    client = createMockClient();
    peaks = createMockPeakService();
    store = setupStore(client, peaks);
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

    it('rethrows on error', async () => {
      client.getAccounts.and.returnValue(reject('Network error'));
      let threw = false;
      try { await store.loadAccounts(); } catch { threw = true; }
      expect(threw).toBe(true);
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
      // core batch + orders batch for the single account
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

  // ── reconcileOrders ────────────────────────────────────────────────────────

  describe('reconcileOrders', () => {
    beforeEach(async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount({ accountNumber: '111' })]));
      await store.loadAccounts();
      // Seed loaded order data — makes a stray loading flag observable.
      batchAnswers(client, {
        get_equity_orders: fulfilled([makeOrder({ state: 'queued' })]),
        get_option_orders: fulfilled([makeOptionOrder({ state: 'queued' })]),
      });
      await store.retrySection(0, 'orders');
      client.executeBatch.calls.reset();
    });

    it('refetches both order sections without setting loading flags or globalLoading', async () => {
      batchAnswers(client, {
        get_equity_orders: fulfilled([makeOrder({ state: 'filled' })]),
        get_option_orders: fulfilled([makeOptionOrder({ state: 'cancelled' })]),
      });

      const p = store.reconcileOrders(0);
      // Mid-flight: the slow RH call is outstanding yet nothing shows loading.
      expect(store.globalLoading()).toBe(false);
      expect(store.accounts()[0].equityOrders.loading).toBe(false);
      expect(store.accounts()[0].optionOrders.loading).toBe(false);

      await p;
      expect(store.accounts()[0].equityOrders.data?.[0].state).toBe('filled');
      expect(store.accounts()[0].optionOrders.data?.[0].state).toBe('cancelled');
      expect(store.accounts()[0].equityOrders.loading).toBe(false);
      expect(store.accounts()[0].optionOrders.loading).toBe(false);
      expect(store.globalLoading()).toBe(false);
    });

    it('collapses overlapping calls into the in-flight run plus one trailing refetch', async () => {
      const resolves: Array<(v: unknown) => void> = [];
      client.executeBatch.and.callFake(() => new Promise((r) => resolves.push(r)));
      const empty = [
        { status: 'fulfilled', value: [] },
        { status: 'fulfilled', value: [] },
      ];

      const p1 = store.reconcileOrders(0);
      store.reconcileOrders(0);
      store.reconcileOrders(0);
      expect(client.executeBatch).toHaveBeenCalledTimes(1);

      resolves[0](empty);
      await new Promise<void>((r) => setTimeout(r, 0));
      // Both overlapping calls collapsed into ONE trailing rerun.
      expect(client.executeBatch).toHaveBeenCalledTimes(2);

      resolves[1](empty);
      await p1;
      expect(client.executeBatch).toHaveBeenCalledTimes(2);
    });

    it('does nothing for invalid account index', async () => {
      await store.reconcileOrders(99);
      expect(client.executeBatch).not.toHaveBeenCalled();
    });
  });

  // ── initialLoad + prefetch waterfall (#1408) ──────────────────────────────

  describe('initialLoad + prefetch waterfall', () => {
    const twoAccounts = () => [
      makeAccount({ accountNumber: '111' }),
      makeAccount({ accountNumber: '222', agenticAllowed: false }),
    ];

    const fullTable = {
      get_portfolio: fulfilled(makePortfolio()),
      get_equity_positions: fulfilled([makeEquityPosition()]),
      get_option_positions: fulfilled([]),
      get_equity_orders: fulfilled([makeOrder()]),
      get_option_orders: fulfilled([]),
    };

    function stubAll(): void {
      batchAnswers(client, fullTable);
      client.getEquityQuotes.and.returnValue(resolve(new Map()));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));
    }

    const flush = () => new Promise<void>((r) => setTimeout(r, 0));

    const accountNumbersCalled = () =>
      client.executeBatch.calls
        .allArgs()
        .flatMap(([specs]) => (specs as MockToolSpec[]).map((s) => s.args?.['account_number']));

    it("issues only the selected account's requests before globalLoading clears", async () => {
      client.getAccounts.and.returnValue(resolve(twoAccounts()));
      const gates: Array<() => void> = [];
      client.executeBatch.and.callFake((specs: MockToolSpec[]) =>
        new Promise((r) => gates.push(() => r(specs.map(() => fulfilled([]))))));
      client.getEquityQuotes.and.returnValue(resolve(new Map()));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));

      const p = store.initialLoad();
      await flush();

      // First wave is the selected account's core batch — nothing else.
      expect(client.executeBatch).toHaveBeenCalledTimes(1);
      const firstSpecs = client.executeBatch.calls.mostRecent().args[0] as MockToolSpec[];
      expect(firstSpecs.every((s) => s.args?.['account_number'] === '111')).toBe(true);

      gates[0]();
      await flush();

      // Visible data landed → global gate released; account 222 still untouched.
      expect(store.globalLoading()).toBe(false);
      expect(accountNumbersCalled()).not.toContain('222');

      // Let the waterfall run to completion.
      while (gates.length) gates.shift()!();
      stubAll();
      await p;
      expect(accountNumbersCalled()).toContain('222');
    });

    it("prefetches every account's sections after first paint", async () => {
      client.getAccounts.and.returnValue(resolve(twoAccounts()));
      stubAll();

      await store.initialLoad();

      const [a1, a2] = store.accounts();
      expect(a1.portfolio.data).not.toBeNull();
      expect(a1.equityPositions.data?.length).toBe(1);
      expect(a1.equityOrders.data?.length).toBe(1);
      expect(a2.portfolio.data).not.toBeNull();
      expect(a2.equityPositions.data?.length).toBe(1);
      expect(a2.equityOrders.data?.length).toBe(1);
      // 2 accounts × (core batch + orders batch)
      expect(client.executeBatch).toHaveBeenCalledTimes(4);
      expect(store.globalLoading()).toBe(false);
    });

    // ── positionPeaks derivation kick (#1413) ────────────────────────────

    it('derives positionPeaks per account once equity positions land', async () => {
      const peak = { symbol: 'QQQ', entryDate: '2026-01-01T10:00:00Z', lastFillDate: '2026-01-01T10:00:00Z', lifetime: { price: 120, date: '2026-02-01T00:00:00Z' }, sinceLastFill: { price: 120, date: '2026-02-01T00:00:00Z' } };
      peaks.derivePeaks.and.returnValue(resolve({ QQQ: peak }));
      client.getAccounts.and.returnValue(resolve([makeAccount({ accountNumber: '111' })]));
      stubAll();

      await store.initialLoad();
      await flush();

      const acct = store.accounts()[0];
      expect(peaks.derivePeaks).toHaveBeenCalledWith('111', acct.equityPositions.data);
      expect(acct.positionPeaks.data).toEqual({ QQQ: peak });
      expect(acct.positionPeaks.error).toBeNull();
    });

    it('a derivePeaks failure lands on the peaks section only', async () => {
      peaks.derivePeaks.and.returnValue(reject('historicals down'));
      client.getAccounts.and.returnValue(resolve([makeAccount({ accountNumber: '111' })]));
      stubAll();

      await store.initialLoad();
      await flush();

      const acct = store.accounts()[0];
      expect(acct.positionPeaks.error).toBe('historicals down');
      expect(acct.equityPositions.data?.length).toBe(1); // core unaffected
    });

    it('a refresh during an in-flight derive queues a rerun — peaks still populate', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount({ accountNumber: '111' })]));
      stubAll();

      // Hang the first derivation; resolve on demand.
      let releaseFirst!: () => void;
      const gate = new Promise<Record<string, never>>((r) => (releaseFirst = () => r({})));
      let calls = 0;
      peaks.derivePeaks.and.callFake(() => (++calls === 1 ? gate : resolve({ QQQ: null as never })));

      await store.initialLoad();
      await flush();
      expect(peaks.derivePeaks).toHaveBeenCalledTimes(1);

      // Refresh while the derive is still running — the new fetchCore's
      // kick must not be swallowed by the stale in-flight promise.
      const refresh = store.refresh();
      await flush();
      releaseFirst();
      await refresh;
      await flush();

      expect(peaks.derivePeaks).toHaveBeenCalledTimes(2);
      expect(store.accounts()[0].positionPeaks.data).toEqual({ QQQ: null });
    });

    it('skips peaks derivation when equity positions failed', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount({ accountNumber: '111' })]));
      batchAnswers(client, {
        get_portfolio: fulfilled(makePortfolio()),
        get_equity_positions: rejected('positions down'),
        get_option_positions: fulfilled([]),
        get_equity_orders: fulfilled([]),
        get_option_orders: fulfilled([]),
      });
      client.getEquityQuotes.and.returnValue(resolve(new Map()));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));

      await store.initialLoad();
      await flush();

      expect(peaks.derivePeaks).not.toHaveBeenCalled();
    });

    it("selectAccount fetches an unloaded account's sections on demand, once", async () => {
      client.getAccounts.and.returnValue(resolve(twoAccounts()));
      await store.loadAccounts();
      stubAll();

      await store.selectAccount(1);

      expect(store.selectedAccountIndex()).toBe(1);
      const acct2 = store.accounts()[1];
      expect(acct2.portfolio.data).not.toBeNull();
      expect(acct2.equityOrders.data?.length).toBe(1);

      // A second select of the now-loaded account issues nothing.
      client.executeBatch.calls.reset();
      client.getEquityQuotes.calls.reset();
      await store.selectAccount(1);
      expect(client.executeBatch).not.toHaveBeenCalled();
      expect(client.getEquityQuotes).not.toHaveBeenCalled();
    });

    it('selectAccount joins an in-flight prefetch instead of double-fetching', async () => {
      client.getAccounts.and.returnValue(resolve(twoAccounts()));
      const gates: Array<() => void> = [];
      client.executeBatch.and.callFake((specs: MockToolSpec[]) =>
        new Promise((r) => gates.push(() => r(specs.map(() => fulfilled([]))))));
      client.getEquityQuotes.and.returnValue(resolve(new Map()));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));

      const p = store.initialLoad();
      await flush();
      gates[0](); // resolve selected core → waterfall begins
      await flush();

      // 111's orders prefetch is in flight; selecting 222 starts its fetch
      // immediately — it must not wait for the waterfall to reach it.
      const sel = store.selectAccount(1);
      await flush();

      while (gates.length) gates.shift()!();
      stubAll();
      await Promise.all([p, sel]);

      const portfolioCallsFor222 = client.executeBatch.calls
        .allArgs()
        .flatMap(([specs]) => specs as MockToolSpec[])
        .filter((s) => s.tool === 'get_portfolio' && s.args?.['account_number'] === '222');
      expect(portfolioCallsFor222).toHaveLength(1);
      expect(store.accounts()[1].portfolio.loading).toBe(false);
    });

    it('a reconcile during an in-flight orders prefetch queues one trailing rerun', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount({ accountNumber: '111' })]));
      const gates: Array<() => void> = [];
      client.executeBatch.and.callFake((specs: MockToolSpec[]) =>
        new Promise((r) => gates.push(() => r(specs.map(() => fulfilled([]))))));
      client.getEquityQuotes.and.returnValue(resolve(new Map()));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));

      const p = store.initialLoad();
      await flush();
      gates[0](); // core resolves → orders prefetch fires and parks in gates
      await flush();

      // Post-mutation reconcile while the orders prefetch is in flight —
      // must not double-fetch, must still get a post-mutation snapshot.
      void store.reconcileOrders(0);
      await flush();

      while (gates.length) gates.shift()!();
      stubAll();
      await p;

      const orderBatches = client.executeBatch.calls
        .allArgs()
        .flatMap(([specs]) => specs as MockToolSpec[])
        .filter((s) => s.tool === 'get_equity_orders');
      // prefetch run + exactly one trailing rerun — never a concurrent double.
      expect(orderBatches).toHaveLength(2);
    });

    it('selecting an account whose orders are prefetching joins — no second fetch', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount({ accountNumber: '111' })]));
      const gates: Array<() => void> = [];
      client.executeBatch.and.callFake((specs: MockToolSpec[]) =>
        new Promise((r) => gates.push(() => r(specs.map(() => fulfilled([]))))));
      client.getEquityQuotes.and.returnValue(resolve(new Map()));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));

      const p = store.initialLoad();
      await flush();
      gates[0](); // core resolves → orders prefetch parks in gates
      await flush();
      expect(client.executeBatch).toHaveBeenCalledTimes(2);

      // No mutation happened — the in-flight fetch already returns fresh
      // data, so selectAccount must join it, not queue a trailing rerun.
      const sel = store.selectAccount(0);
      while (gates.length) gates.shift()!();
      stubAll();
      await Promise.all([p, sel]);

      const orderBatches = client.executeBatch.calls
        .allArgs()
        .flatMap(([specs]) => specs as MockToolSpec[])
        .filter((s) => s.tool === 'get_equity_orders');
      expect(orderBatches).toHaveLength(1);
    });

    it('runs the waterfall selected-account-first when selected is not index 0', async () => {
      client.getAccounts.and.returnValue(resolve([
        makeAccount({ accountNumber: '111', agenticAllowed: false }),
        makeAccount({ accountNumber: '222' }),
      ]));
      stubAll();

      await store.initialLoad();

      expect(store.selectedAccountIndex()).toBe(1);
      const batchAcctOrder = client.executeBatch.calls
        .allArgs()
        .map(([specs]) => (specs as MockToolSpec[])[0].args?.['account_number']);
      // selected 222's remaining group (orders) precedes sibling 111 entirely.
      expect(batchAcctOrder).toEqual(['222', '222', '111', '111']);
    });

    it('an in-flight fetch across refresh does not mark the group loaded', async () => {
      client.getAccounts.and.returnValue(resolve(twoAccounts()));
      await store.loadAccounts();
      const gates: Array<() => void> = [];
      client.executeBatch.and.callFake((specs: MockToolSpec[]) =>
        new Promise((r) => gates.push(() => r(specs.map(() => fulfilled([]))))));
      client.getEquityQuotes.and.returnValue(resolve(new Map()));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));

      // 222's core parks in-flight while refresh clears loadedGroups and
      // bumps the epoch — its stale completion must not mark the group.
      const sel = store.selectAccount(1);
      await flush();
      const p = store.refresh();
      await flush();
      gates[0]();
      await flush();
      while (gates.length) gates.shift()!();
      stubAll();
      await Promise.all([p, sel]);

      // The stale fetch didn't mark 222 loaded — the waterfall's ensure
      // refetched core rather than trusting the pre-refresh snapshot.
      const coreFor222 = client.executeBatch.calls
        .allArgs()
        .flatMap(([specs]) => specs as MockToolSpec[])
        .filter((s) => s.tool === 'get_portfolio' && s.args?.['account_number'] === '222');
      expect(coreFor222).toHaveLength(2);
    });
  });

  // ── per-section error mapping (ported from the pre-waterfall phases) ──────

  describe('per-section error mapping', () => {
    it('a failed batch item lands on its own section — others still load', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount({ accountNumber: '111' })]));
      batchAnswers(client, {
        get_portfolio: rejected('Portfolio failed'),
        get_equity_positions: fulfilled([makeEquityPosition()]),
        get_option_positions: fulfilled([makeOptionPosition()]),
        get_equity_orders: fulfilled([]),
        get_option_orders: fulfilled([]),
      });
      client.getEquityQuotes.and.returnValue(resolve(new Map()));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));

      await store.initialLoad();

      const acct = store.accounts()[0];
      expect(acct.portfolio.error).toBe('Portfolio failed');
      expect(acct.portfolio.data).toBeNull();
      expect(acct.equityPositions.data).toEqual([makeEquityPosition()]);
      expect(acct.equityPositions.error).toBeNull();
      expect(acct.optionPositions.data).toEqual([makeOptionPosition()]);
      expect(acct.optionPositions.error).toBeNull();
    });

    it('a batch transport failure errors every core section and stays retryable', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount({ accountNumber: '111' })]));
      client.executeBatch.and.callFake(() => reject('HTTP 401'));
      client.getEquityQuotes.and.returnValue(resolve(new Map()));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));

      await store.initialLoad();

      const acct = store.accounts()[0];
      expect(acct.portfolio.error).toBe('HTTP 401');
      expect(acct.equityPositions.error).toBe('HTTP 401');
      expect(acct.optionPositions.error).toBe('HTTP 401');
      expect(acct.portfolio.loading).toBe(false);
      expect(store.globalLoading()).toBe(false);

      // Transport failure left the group unmarked — the next ensure retries.
      batchAnswers(client, {
        get_portfolio: fulfilled(makePortfolio()),
        get_equity_positions: fulfilled([]),
        get_option_positions: fulfilled([]),
        get_equity_orders: fulfilled([]),
        get_option_orders: fulfilled([]),
      });
      await store.selectAccount(0);
      expect(store.accounts()[0].portfolio.data).toEqual(makePortfolio());
    });

    it('a failed orders item lands on its own section', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount({ accountNumber: '111' })]));
      batchAnswers(client, {
        get_portfolio: fulfilled(makePortfolio()),
        get_equity_positions: fulfilled([]),
        get_option_positions: fulfilled([]),
        get_equity_orders: rejected('Orders failed'),
        get_option_orders: fulfilled([makeOptionOrder({ state: 'filled' })]),
      });
      client.getEquityQuotes.and.returnValue(resolve(new Map()));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));

      await store.initialLoad();

      expect(store.accounts()[0].equityOrders.error).toBe('Orders failed');
      expect(store.accounts()[0].equityOrders.data).toBeNull();
      expect(store.accounts()[0].optionOrders.data?.length).toBe(1);
      expect(store.accounts()[0].optionOrders.error).toBeNull();
    });

    it('a quote fetch failure lands on its own section without stuck loading', async () => {
      client.getAccounts.and.returnValue(resolve([makeAccount({ accountNumber: '111' })]));
      batchAnswers(client, {
        get_portfolio: fulfilled(makePortfolio()),
        get_equity_positions: fulfilled([makeEquityPosition({ symbol: 'AAPL' })]),
        get_option_positions: fulfilled([]),
        get_equity_orders: fulfilled([]),
        get_option_orders: fulfilled([]),
      });
      client.getEquityQuotes.and.returnValue(reject('Quotes failed'));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));

      await store.initialLoad();

      const acct = store.accounts()[0];
      expect(acct.equityQuotes.error).toBe('Quotes failed');
      expect(acct.equityQuotes.loading).toBe(false);
      expect(acct.equityQuotes.data).toBeNull();
      expect(acct.optionQuotes.data).toEqual(new Map());
      expect(acct.optionQuotes.error).toBeNull();
    });

    it('fetches equity quotes scoped to each account’s own symbols', async () => {
      client.getAccounts.and.returnValue(resolve([
        makeAccount({ accountNumber: '111' }),
        makeAccount({ accountNumber: '222', agenticAllowed: false }),
      ]));
      batchAnswers(client, {
        get_portfolio: fulfilled(makePortfolio()),
        get_equity_positions: (spec) =>
          spec.args?.['account_number'] === '111'
            ? fulfilled([makeEquityPosition({ symbol: 'AAPL' }), makeEquityPosition({ symbol: 'NVDA' })])
            : fulfilled([makeEquityPosition({ symbol: 'MSFT' })]),
        get_option_positions: fulfilled([]),
        get_equity_orders: fulfilled([]),
        get_option_orders: fulfilled([]),
      });
      client.getEquityQuotes.and.returnValue(resolve(new Map()));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));

      await store.initialLoad();

      expect(client.getEquityQuotes).toHaveBeenCalledTimes(2);
      const quoteArgs = client.getEquityQuotes.calls.allArgs() as [string[]][];
      expect(quoteArgs).toContainEqual([['AAPL', 'NVDA']]);
      expect(quoteArgs).toContainEqual([['MSFT']]);
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
      batchAnswers(client, {
        get_portfolio: fulfilled(makePortfolio()),
        get_equity_positions: fulfilled([]),
        get_option_positions: fulfilled([]),
        get_equity_orders: fulfilled([]),
        get_option_orders: fulfilled([]),
      });
      client.getEquityQuotes.and.returnValue(resolve(new Map()));
      client.getOptionQuotes.and.returnValue(resolve(new Map()));
      await store.selectAccount(1);
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
