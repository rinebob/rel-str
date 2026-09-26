/**
 * @topic #553 — Paper Trading Infra
 *
 * Unit tests for the paper-trading ledger seam (task #561):
 * entry fills create the trade lifecycle doc + cash delta; exit fills close
 * the trade and realize P&L; cash is tracked but never enforced (negative
 * balances permitted).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TradeSide } from '../../../shared/common';
import { OptionQuoteSource, OptionType } from '../../../shared/options-common';
import {
  PaperTradeSource,
  PaperTradeStatus,
  PaperTradingKind,
  type PaperAccount,
  type PaperTrade,
  type PaperTradeLeg,
} from '../../../shared/paper-trading-contracts';
import {
  applyEntryFill,
  applyExitFill,
  applyPendingFill,
  createPendingTrade,
  type LedgerDeps,
  type LedgerWritePlan,
} from '../../../functions/src/paper-trading/ledger';

const NOW = '2026-09-24T19:00:00.000Z';
const FILL_DATE = '2026-09-24';

function cspLeg(): PaperTradeLeg {
  return {
    kind: 'option',
    contractID: 'QQQM251120P00570000',
    type: OptionType.PUT,
    strike: 570,
    expiration: '2026-11-20',
    side: TradeSide.SHORT,
    quantity: 1,
    multiplier: 100,
    entryMark: 2.1,
    lastMark: 2.1,
  };
}

function shareLeg(qty = 100, mark = 590): PaperTradeLeg {
  return {
    kind: 'share',
    side: TradeSide.LONG,
    quantity: qty,
    multiplier: 1,
    entryMark: mark,
    lastMark: mark,
  };
}

function existingAccount(overrides: Partial<PaperAccount> = {}): PaperAccount {
  return {
    kind: PaperTradingKind.ACCOUNT,
    id: 'acct-user1',
    userId: 'user1',
    cash: 0,
    equity: 0,
    realizedPnl: 0,
    openTradeCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function openTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: '260924-st-QQQM-CSP-020-30',
    status: PaperTradeStatus.OPEN,
    source: PaperTradeSource.STRATEGY,
    symbol: 'QQQM',
    expression: 'CSP',
    governingVariant: 'trailing-20',
    order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
    fills: [
      {
        fillId: 'f1',
        role: 'entry',
        date: FILL_DATE,
        price: 2.1,
        quantity: 1,
        quoteSource: OptionQuoteSource.RH_MCP,
      },
    ],
    legs: [cspLeg()],
    marks: {},
    variantRuns: [
      { variantKey: 'trailing-20', governing: true, state: 'ACTIVE', workingState: {} },
      { variantKey: 'time-30d', governing: false, state: 'ACTIVE', workingState: {} },
    ],
    variantKeys: ['trailing-20', 'time-30d'],
    realizedPnl: 0,
    unrealizedPnl: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

type LedgerTxn = Parameters<Parameters<LedgerDeps['transact']>[0]>[0];

/**
 * Fake deps: `transact` invokes the work with a txn whose reads/writes are
 * backed by plain maps — mirrors the real `runTransaction` contract (reads
 * before writes, single commit) closely enough for the ledger's logic.
 */
function makeDeps(
  overrides: {
    getAccount?: LedgerTxn['getAccount'];
    getTrade?: LedgerTxn['getTrade'];
  } = {},
) {
  const plans: LedgerWritePlan[] = [];
  const deps: LedgerDeps = {
    transact: async (work) =>
      work({
        getAccount: overrides.getAccount ?? (async () => null),
        getTrade: overrides.getTrade ?? (async () => null),
        write: (plan) => plans.push(plan),
      }),
  };
  return { deps, plans };
}

describe('applyEntryFill', () => {
  it('creates the account and credits a short-option entry (CSP)', async () => {
    const { deps, plans } = makeDeps();

    const result = await applyEntryFill(
      {
        userId: 'user1',
        tradeId: '260924-st-QQQM-CSP-020-30',
        order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
        legs: [cspLeg()],
        fill: {
          fillId: 'f1',
          role: 'entry',
          date: FILL_DATE,
          price: 2.1,
          quantity: 1,
          quoteSource: OptionQuoteSource.RH_MCP,
        },
        dims: {
          source: PaperTradeSource.STRATEGY,
          symbol: 'QQQM',
          expression: 'CSP',
          governingVariant: 'trailing-20',
          variantKeys: ['trailing-20', 'time-30d'],
          strategyInstanceId: '260924-QQQM-CSP-020-30-D-1200',
        },
        underlyingClose: 600,
        now: NOW,
      },
      deps,
    );

    assert.equal(plans.length, 1);
    const plan = plans[0];

    assert.equal(plan.accountId, 'acct-user1');
    assert.equal(plan.cashDelta, 210); // +2.10 credit × 1 contract × 100
    assert.equal(plan.account.cash, 210);
    assert.equal(plan.account.equity, 0); // cash→asset swap: unchanged
    assert.equal(plan.account.openTradeCount, 1);

    const trade = plan.trade;
    assert.equal(trade.status, PaperTradeStatus.OPEN);
    assert.equal(trade.fills.length, 1);
    assert.equal(trade.fills[0].price, 2.1);
    const leg = trade.legs[0];
    assert(leg.kind === 'option');
    assert.equal(leg.contractID, 'QQQM251120P00570000');
    assert.deepEqual(trade.marks[FILL_DATE], { mark: 2.1, underlyingClose: 600 });
    assert.equal(trade.variantRuns.length, 2);
    assert.equal(trade.variantRuns[0].governing, true);
    assert.equal(trade.variantRuns[1].governing, false);
    assert.equal(trade.strategyInstanceId, '260924-QQQM-CSP-020-30-D-1200');
    assert.equal(result.cashDelta, 210);
  });

  it('debits a long equity entry and leaves equity flat at fill', async () => {
    const { deps, plans } = makeDeps({ getAccount: async () => existingAccount() });

    await applyEntryFill(
      {
        userId: 'user1',
        tradeId: '260924-sig-QQQ-EQ',
        order: { side: TradeSide.LONG, type: 'MARKET', quantity: 100 },
        legs: [shareLeg()],
        fill: {
          fillId: 'f1',
          role: 'entry',
          date: FILL_DATE,
          price: 590,
          quantity: 100,
          quoteSource: OptionQuoteSource.RH_MCP,
        },
        dims: {
          source: PaperTradeSource.SIGNAL,
          symbol: 'QQQ',
          expression: 'EQ',
          governingVariant: 'time-30d',
        },
        now: NOW,
      },
      deps,
    );

    const plan = plans[0];
    assert.equal(plan.cashDelta, -59_000);
    assert.equal(plan.account.cash, -59_000); // negative cash permitted
    assert.equal(plan.account.equity, 0); // cash −59000 + position value +59000
    assert.equal(plan.trade.expression, 'EQ');
    // no underlyingClose provided → no seeded mark
    assert.deepEqual(plan.trade.marks, {});
    // no variantKeys provided → seeds just the governing variant
    assert.deepEqual(
      plan.trade.variantRuns.map((r) => r.variantKey),
      ['time-30d'],
    );
    assert.deepEqual(plan.trade.variantKeys, ['time-30d']);
  });

  it('fails loudly when the trade id is already taken', async () => {
    const { deps, plans } = makeDeps({ getTrade: async () => openTrade() });
    await assert.rejects(
      applyEntryFill(
        {
          userId: 'user1',
          tradeId: '260924-st-QQQM-CSP-020-30',
          order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
          legs: [cspLeg()],
          fill: {
            fillId: 'f1',
            role: 'entry',
            date: FILL_DATE,
            price: 2.1,
            quantity: 1,
            quoteSource: OptionQuoteSource.RH_MCP,
          },
          dims: {
            source: PaperTradeSource.STRATEGY,
            symbol: 'QQQM',
            expression: 'CSP',
            governingVariant: 'trailing-20',
          },
          now: NOW,
        },
        deps,
      ),
      /already exists/i,
    );
    assert.equal(plans.length, 0); // nothing written
  });

  it('throws when variantKeys omit the governing variant (exactly-one-governing)', async () => {
    const { deps, plans } = makeDeps();
    await assert.rejects(
      applyEntryFill(
        {
          userId: 'user1',
          tradeId: '260924-st-QQQM-CSP-020-30',
          order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
          legs: [cspLeg()],
          fill: {
            fillId: 'f1',
            role: 'entry',
            date: FILL_DATE,
            price: 2.1,
            quantity: 1,
            quoteSource: OptionQuoteSource.RH_MCP,
          },
          dims: {
            source: PaperTradeSource.STRATEGY,
            symbol: 'QQQM',
            expression: 'CSP',
            governingVariant: 'trailing-20',
            variantKeys: ['time-30d', 'initial-stop-10'],
          },
          now: NOW,
        },
        deps,
      ),
      /must include governingVariant/i,
    );
    assert.equal(plans.length, 0);
  });

  it('dedupes duplicate variantKeys so every run is reachable', async () => {
    const { deps, plans } = makeDeps();
    await applyEntryFill(
      {
        userId: 'user1',
        tradeId: '260924-st-QQQM-CSP-020-30',
        order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
        legs: [cspLeg()],
        fill: {
          fillId: 'f1',
          role: 'entry',
          date: FILL_DATE,
          price: 2.1,
          quantity: 1,
          quoteSource: OptionQuoteSource.RH_MCP,
        },
        dims: {
          source: PaperTradeSource.STRATEGY,
          symbol: 'QQQM',
          expression: 'CSP',
          governingVariant: 'trailing-20',
          variantKeys: ['trailing-20', 'time-30d', 'trailing-20'],
        },
        now: NOW,
      },
      deps,
    );
    const runs = plans[0].trade.variantRuns;
    assert.equal(runs.length, 2);
    assert.equal(runs.filter((r) => r.governing).length, 1);
    assert.deepEqual(plans[0].trade.variantKeys, ['trailing-20', 'time-30d']);
  });
});

describe('applyExitFill', () => {
  it('closes a winning CSP: debits buy-to-close, realizes P&L', async () => {
    const { deps, plans } = makeDeps({
      getAccount: async () => existingAccount({ cash: 210, openTradeCount: 1 }),
      getTrade: async () => openTrade(),
    });

    const result = await applyExitFill(
      {
        userId: 'user1',
        tradeId: '260924-st-QQQM-CSP-020-30',
        fill: {
          fillId: 'f2',
          role: 'exit',
          date: '2026-10-01',
          price: 0.5,
          quantity: 1,
          quoteSource: OptionQuoteSource.RH_MCP,
        },
        now: '2026-10-01T20:00:00.000Z',
      },
      deps,
    );

    assert.equal(plans.length, 1);
    const plan = plans[0];

    assert.equal(plan.cashDelta, -50); // buy back at 0.50
    assert.equal(plan.account.cash, 160); // 210 − 50
    assert.equal(plan.account.openTradeCount, 0);
    assert.equal(plan.account.realizedPnl, 160);

    const trade = plan.trade;
    assert.equal(trade.status, PaperTradeStatus.CLOSED);
    assert.equal(trade.fills.length, 2);
    assert.equal(trade.fills[1].role, 'exit');
    assert.equal(trade.realizedPnl, 160); // (2.10 − 0.50) × 1 × 100
    assert.equal(trade.unrealizedPnl, 0);
    // legs marked out at the exit price
    assert.equal(trade.legs[0].lastMark, 0.5);
    assert.equal(result.cashDelta, -50);
  });

  it('realizes a loss on a long equity exit', async () => {
    const equityTrade = openTrade({
      id: '260924-sig-QQQ-EQ',
      source: PaperTradeSource.SIGNAL,
      symbol: 'QQQ',
      expression: 'EQ',
      order: { side: TradeSide.LONG, type: 'MARKET', quantity: 100 },
      legs: [shareLeg()],
      fills: [
        {
          fillId: 'f1',
          role: 'entry',
          date: FILL_DATE,
          price: 590,
          quantity: 100,
          quoteSource: OptionQuoteSource.RH_MCP,
        },
      ],
    });
    const { deps, plans } = makeDeps({
      getAccount: async () => existingAccount({ cash: -59_000, openTradeCount: 1 }),
      getTrade: async () => equityTrade,
    });

    await applyExitFill(
      {
        userId: 'user1',
        tradeId: '260924-sig-QQQ-EQ',
        fill: {
          fillId: 'f2',
          role: 'exit',
          date: '2026-10-01',
          price: 570,
          quantity: 100,
          quoteSource: OptionQuoteSource.RH_MCP,
        },
        now: '2026-10-01T20:00:00.000Z',
      },
      deps,
    );

    const plan = plans[0];
    assert.equal(plan.cashDelta, 57_000); // sell to close
    assert.equal(plan.account.cash, -2_000);
    assert.equal(plan.trade.realizedPnl, -2_000); // (570 − 590) × 100
    assert.equal(plan.trade.status, PaperTradeStatus.CLOSED);
  });

  it('throws when the trade does not exist', async () => {
    const { deps } = makeDeps();
    await assert.rejects(
      applyExitFill(
        {
          userId: 'user1',
          tradeId: 'missing',
          fill: {
            fillId: 'f2',
            role: 'exit',
            date: '2026-10-01',
            price: 1,
            quantity: 1,
            quoteSource: OptionQuoteSource.RH_MCP,
          },
          now: NOW,
        },
        deps,
      ),
      /not found/i,
    );
  });

  it('throws when the trade is already closed', async () => {
    const { deps } = makeDeps({
      getAccount: async () => existingAccount(),
      getTrade: async () => openTrade({ status: PaperTradeStatus.CLOSED }),
    });
    await assert.rejects(
      applyExitFill(
        {
          userId: 'user1',
          tradeId: 'x',
          fill: {
            fillId: 'f2',
            role: 'exit',
            date: '2026-10-01',
            price: 1,
            quantity: 1,
            quoteSource: OptionQuoteSource.RH_MCP,
          },
          now: NOW,
        },
        deps,
      ),
      /not open|already closed/i,
    );
  });

  it('rejects a fill whose role is not exit', async () => {
    const { deps } = makeDeps({
      getAccount: async () => existingAccount(),
      getTrade: async () => openTrade(),
    });
    await assert.rejects(
      applyExitFill(
        {
          userId: 'user1',
          tradeId: 'x',
          fill: {
            fillId: 'f2',
            role: 'entry',
            date: '2026-10-01',
            price: 1,
            quantity: 1,
            quoteSource: OptionQuoteSource.RH_MCP,
          },
          now: NOW,
        },
        deps,
      ),
      /role/i,
    );
  });

  it('rejects a partial-quantity exit', async () => {
    const { deps, plans } = makeDeps({
      getAccount: async () => existingAccount({ cash: 210, openTradeCount: 1 }),
      getTrade: async () => openTrade(),
    });
    await assert.rejects(
      applyExitFill(
        {
          userId: 'user1',
          tradeId: 'x',
          fill: {
            fillId: 'f2',
            role: 'exit',
            date: '2026-10-01',
            price: 0.5,
            quantity: 0.5, // order qty is 1
            quoteSource: OptionQuoteSource.RH_MCP,
          },
          now: NOW,
        },
        deps,
      ),
      /partial exits/i,
    );
    assert.equal(plans.length, 0);
  });
});

// -- Pending trades (task #564 � signal expression cohorts) -----------------

function pendingTemplate() {
  return {
    key: 'csp-030-45',
    expression: 'CSP',
    optionType: OptionType.PUT,
    side: TradeSide.SHORT,
    targetDelta: 0.3,
    targetDte: 45,
    minDte: 30,
    maxDte: 60,
  };
}

function pendingTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: '260924-sig-QQQM-CSP-030-45',
    status: PaperTradeStatus.PENDING,
    source: PaperTradeSource.SIGNAL,
    symbol: 'QQQM',
    expression: 'CSP',
    governingVariant: 'none',
    cohortId: 'cohort-260924-QQQM-01',
    signalId: 'sig-1',
    expressionTemplate: pendingTemplate(),
    order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
    fills: [],
    legs: [],
    marks: {},
    variantRuns: [
      { variantKey: 'none', governing: true, state: 'ACTIVE', workingState: {} },
      { variantKey: 'initial-stop-10', governing: false, state: 'ACTIVE', workingState: {} },
    ],
    variantKeys: ['none', 'initial-stop-10'],
    realizedPnl: 0,
    unrealizedPnl: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('createPendingTrade', () => {
  it('writes a PENDING trade with seeded runs, template, and dims � no fills/legs', async () => {
    const { deps, plans } = makeDeps();
    const trade = await createPendingTrade(
      {
        userId: 'user1',
        tradeId: '260924-sig-QQQM-CSP-030-45',
        order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
        dims: {
          source: PaperTradeSource.SIGNAL,
          symbol: 'QQQM',
          expression: 'CSP',
          governingVariant: 'none',
          variantKeys: ['none', 'initial-stop-10', 'trailing-20', 'time-30d'],
          cohortId: 'cohort-260924-QQQM-01',
          signalId: 'sig-1',
          ticket: { signalId: 'sig-1', refId: 'ref-1', acceptedAt: NOW },
        },
        expressionTemplate: pendingTemplate(),
        now: NOW,
      },
      deps,
    );

    assert.equal(plans.length, 1);
    const t = plans[0].trade;
    assert.equal(t.status, PaperTradeStatus.PENDING);
    assert.deepEqual(t.fills, []);
    assert.deepEqual(t.legs, []);
    assert.deepEqual(t.marks, {});
    assert.equal(t.variantRuns.length, 4);
    assert.equal(t.variantRuns.filter((r) => r.governing).length, 1);
    assert.equal(t.cohortId, 'cohort-260924-QQQM-01');
    assert.equal(t.signalId, 'sig-1');
    assert.equal(t.ticket?.refId, 'ref-1');
    assert.equal(t.expressionTemplate?.key, 'csp-030-45');
    // account unchanged � pending is not open
    assert.equal(plans[0].cashDelta, 0);
    assert.equal(plans[0].account.openTradeCount, 0);
    assert.equal(trade.id, t.id);
  });

  it('throws when the trade id is already taken', async () => {
    const { deps, plans } = makeDeps({ getTrade: async () => pendingTrade() });
    await assert.rejects(
      createPendingTrade(
        {
          userId: 'user1',
          tradeId: '260924-sig-QQQM-CSP-030-45',
          order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
          dims: {
            source: PaperTradeSource.SIGNAL,
            symbol: 'QQQM',
            expression: 'CSP',
            governingVariant: 'none',
          },
          now: NOW,
        },
        deps,
      ),
      /already exists/i,
    );
    assert.equal(plans.length, 0);
  });

  it('throws when governingVariant is not in variantKeys', async () => {
    const { deps } = makeDeps();
    await assert.rejects(
      createPendingTrade(
        {
          userId: 'user1',
          tradeId: 't1',
          order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
          dims: {
            source: PaperTradeSource.SIGNAL,
            symbol: 'QQQM',
            expression: 'CSP',
            governingVariant: 'none',
            variantKeys: ['time-30d'],
          },
          now: NOW,
        },
        deps,
      ),
      /must include governingVariant/i,
    );
  });
});

describe('applyPendingFill', () => {
  it('flips PENDING to OPEN: legs, entry fill, marks, cash credit, open count', async () => {
    const { deps, plans } = makeDeps({
      getTrade: async () => pendingTrade(),
      getAccount: async () => existingAccount({ cash: 500 }),
    });
    const result = await applyPendingFill(
      {
        userId: 'user1',
        tradeId: '260924-sig-QQQM-CSP-030-45',
        legs: [cspLeg()],
        fill: {
          fillId: 'entry-1',
          role: 'entry',
          date: FILL_DATE,
          price: 2.1,
          quantity: 1,
          quoteSource: OptionQuoteSource.RH_MCP,
        },
        underlyingClose: 590,
        tradeOverrides: { capitalRequired: 57_000 },
        now: NOW,
      },
      deps,
    );

    const t = plans[0].trade;
    assert.equal(t.status, PaperTradeStatus.OPEN);
    assert.equal(t.fills.length, 1);
    assert.equal(t.fills[0].price, 2.1);
    assert.equal(t.legs.length, 1);
    assert.equal(t.legs[0].lastMark, 2.1);
    assert.deepEqual(t.marks[FILL_DATE], { mark: 2.1, underlyingClose: 590 });
    assert.equal(t.capitalRequired, 57_000);
    assert.equal(result.cashDelta, 210); // +2.10 credit � 100
    assert.equal(plans[0].account.cash, 710);
    assert.equal(plans[0].account.equity, 0); // cash?asset swap (500 -500+... check: 500+210-210=500? equity = equity + cashDelta + posValue = 0+210-210=0) 
    assert.equal(plans[0].account.openTradeCount, 1);
  });

  it('throws when the trade is not PENDING', async () => {
    const { deps, plans } = makeDeps({ getTrade: async () => pendingTrade({ status: PaperTradeStatus.OPEN }) });
    await assert.rejects(
      applyPendingFill(
        {
          userId: 'user1',
          tradeId: '260924-sig-QQQM-CSP-030-45',
          legs: [cspLeg()],
          fill: {
            fillId: 'entry-1',
            role: 'entry',
            date: FILL_DATE,
            price: 2.1,
            quantity: 1,
            quoteSource: OptionQuoteSource.RH_MCP,
          },
          now: NOW,
        },
        deps,
      ),
      /not pending/i,
    );
    assert.equal(plans.length, 0);
  });

  it('debits cash for a LONG-side expression fill', async () => {
    const { deps, plans } = makeDeps({
      getTrade: async () => pendingTrade({ order: { side: TradeSide.LONG, type: 'MARKET', quantity: 1 } }),
      getAccount: async () => existingAccount({ cash: 1000 }),
    });
    const longLeg: PaperTradeLeg = {
      kind: 'option',
      contractID: 'QQQM251030C00600000',
      type: OptionType.CALL,
      strike: 600,
      expiration: '2026-10-30',
      side: TradeSide.LONG,
      quantity: 1,
      multiplier: 100,
      entryMark: 5.0,
      lastMark: 5.0,
    };
    await applyPendingFill(
      {
        userId: 'user1',
        tradeId: '260924-sig-QQQM-CSP-030-45',
        legs: [longLeg],
        fill: {
          fillId: 'entry-1',
          role: 'entry',
          date: FILL_DATE,
          price: 5.0,
          quantity: 1,
          quoteSource: OptionQuoteSource.RH_MCP,
        },
        now: NOW,
      },
      deps,
    );
    assert.equal(plans[0].account.cash, 500); // -5.00 � 100
    assert.equal(plans[0].account.equity, 0); // -500 cash +500 position
  });
});
