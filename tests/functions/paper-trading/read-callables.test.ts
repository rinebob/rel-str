/**
 * @topic #553 — Paper Trading Infra (task #565)
 *
 * Read-side callables: listPaperTrades (AND-combined filters),
 * getPaperStats (one scope or all docs), getPaperAccount (caller's acct),
 * listExitVariants (registry defaults). Auth required on all four.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TradeSide } from '../../../shared/common';
import {
  PaperTradingKind,
  PaperTradeSource,
  PaperTradeStatus,
} from '../../../shared/paper-trading-contracts';
import type {
  ListPaperTradesRequest,
  PaperAccount,
  PaperStats,
  PaperTrade,
} from '../../../shared/paper-trading-contracts';
import {
  handleGetPaperAccount,
  handleGetPaperStats,
  handleListExitVariants,
  handleListPaperTrades,
  type PaperReadDeps,
} from '../../../functions/src/paper-trading/read-callables';

const UID = 'uid-1';
const NOW = '2026-09-26T12:00:00Z';

function request<T>(data: T, auth = true) {
  return {
    data,
    auth: auth ? { uid: UID, token: {} } : undefined,
  } as Parameters<typeof handleListPaperTrades>[0];
}

function trade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: 't-1',
    status: PaperTradeStatus.OPEN,
    source: PaperTradeSource.STRATEGY,
    symbol: 'QQQM',
    expression: 'CSP',
    governingVariant: 'trailing-20',
    order: { side: TradeSide.SHORT, type: 'LIMIT', quantity: 1 },
    fills: [],
    legs: [],
    marks: {},
    variantRuns: [],
    variantKeys: [],
    realizedPnl: 0,
    unrealizedPnl: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function statsDoc(scope: string): PaperStats {
  return {
    kind: PaperTradingKind.STATS,
    id: `stats-${scope}`,
    scope,
    totalRealizedPnl: 100,
    totalUnrealizedPnl: -20,
    openTradeCount: 3,
    closedTradeCount: 5,
    maxDrawdown: 40,
    equityCurve: [{ date: '2026-09-25', cumulativePnl: 80 }],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const ACCOUNT: PaperAccount = {
  kind: PaperTradingKind.ACCOUNT,
  id: `acct-${UID}`,
  userId: UID,
  cash: 100_000,
  equity: 100_000,
  realizedPnl: 0,
  openTradeCount: 2,
  createdAt: NOW,
  updatedAt: NOW,
};

function makeDeps(overrides: Partial<PaperReadDeps> = {}): PaperReadDeps & {
  lastFilters: ListPaperTradesRequest | undefined;
} {
  const state = { lastFilters: undefined as ListPaperTradesRequest | undefined };
  return {
    get lastFilters() {
      return state.lastFilters;
    },
    listTrades: async (filters) => {
      state.lastFilters = filters;
      return [trade()];
    },
    getStats: async () => statsDoc('all'),
    listStats: async () => [statsDoc('all'), statsDoc('sym-QQQM')],
    getAccount: async () => ACCOUNT,
    ...overrides,
  };
}

describe('auth', () => {
  it('requires auth on all four handlers', async () => {
    const deps = makeDeps();
    for (const call of [
      handleListPaperTrades(request({} as ListPaperTradesRequest, false), deps),
      handleGetPaperStats(request({}, false), deps),
      handleGetPaperAccount(request({}, false), deps),
      handleListExitVariants(request({}, false)),
    ]) {
      await assert.rejects(call, /unauthenticated/i);
    }
  });
});

describe('handleListPaperTrades', () => {
  it('passes all filters through AND-combined', async () => {
    const deps = makeDeps();
    const filters: ListPaperTradesRequest = {
      status: PaperTradeStatus.OPEN,
      source: PaperTradeSource.SIGNAL,
      cohortId: 'cohort-1',
      symbol: 'qqqm',
      expression: 'CSP',
      variantKey: 'trailing-20',
    };
    const res = await handleListPaperTrades(request(filters), deps);
    assert.deepEqual(deps.lastFilters, {
      ...filters,
      symbol: 'QQQM', // normalized
    });
    assert.equal(res.trades.length, 1);
    assert.equal(res.trades[0].id, 't-1');
  });

  it('omitted filters return everything', async () => {
    const deps = makeDeps();
    await handleListPaperTrades(request({} as ListPaperTradesRequest), deps);
    assert.deepEqual(deps.lastFilters, {});
  });
});

describe('handleGetPaperStats', () => {
  it('returns the requested scope doc as a one-element array', async () => {
    const deps = makeDeps({ getStats: async () => statsDoc('sym-QQQM') });
    const res = await handleGetPaperStats(request({ scope: 'sym-QQQM' }), deps);
    assert.equal(res.stats.length, 1);
    assert.equal(res.stats[0].scope, 'sym-QQQM');
    assert.equal(res.stats[0].maxDrawdown, 40);
    assert.equal(res.stats[0].equityCurve.length, 1);
  });

  it('returns every stats doc when scope is omitted (dashboard enumeration)', async () => {
    let listed = false;
    const deps = makeDeps({
      listStats: async () => {
        listed = true;
        return [statsDoc('all'), statsDoc('sym-QQQM')];
      },
    });
    const res = await handleGetPaperStats(request({}), deps);
    assert.equal(listed, true);
    assert.equal(res.stats.length, 2);
  });

  it('returns [] when the scope doc does not exist', async () => {
    const deps = makeDeps({ getStats: async () => null });
    const res = await handleGetPaperStats(request({ scope: 'sym-NOPE' }), deps);
    assert.deepEqual(res.stats, []);
  });

  it('rejects malformed scope strings', async () => {
    const deps = makeDeps();
    await assert.rejects(
      handleGetPaperStats(request({ scope: 'x'.repeat(300) }), deps),
      (e: unknown) =>
        e instanceof Error && (e as { code?: string }).code === 'invalid-argument',
    );
  });
});

describe('handleGetPaperAccount', () => {
  it("returns the caller's account doc", async () => {
    let id = '';
    const deps = makeDeps({
      getAccount: async (accountId) => {
        id = accountId;
        return ACCOUNT;
      },
    });
    const res = await handleGetPaperAccount(request({}), deps);
    assert.equal(id, `acct-${UID}`);
    assert.equal(res.account?.cash, 100_000);
  });

  it('returns null when no account exists yet', async () => {
    const deps = makeDeps({ getAccount: async () => null });
    const res = await handleGetPaperAccount(request({}), deps);
    assert.equal(res.account, null);
  });
});

describe('handleListExitVariants', () => {
  it('returns the registry defaults incl. the stubbed limit-stddev', async () => {
    const res = await handleListExitVariants(request({}));
    const keys = res.variants.map((v) => v.key);
    assert.ok(keys.includes('initial-stop-10'));
    assert.ok(keys.includes('trailing-20'));
    assert.ok(keys.includes('time-9d'));
    assert.ok(keys.includes('limit-sd1'));
    for (const v of res.variants) {
      assert.ok(v.label.length > 0);
      assert.ok(v.params.type.length > 0);
    }
  });
});
