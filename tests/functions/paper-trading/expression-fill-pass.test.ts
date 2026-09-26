/**
 * @topic #553 — Paper Trading Infra (task #564)
 *
 * expression-fill-pass: for each PENDING expression trade — RH option
 * chains → instruments → batched quotes → delta/DTE contract selection →
 * applyPendingFill → OPEN. No broker mutation calls on this path.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TradeSide } from '../../../shared/common';
import { OptionQuoteSource, OptionType } from '../../../shared/options-common';
import {
  PaperTradeSource,
  PaperTradeStatus,
  PaperTradingKind,
  type PaperTrade,
  type SignalExpressionTemplate,
} from '../../../shared/paper-trading-contracts';
import {
  runExpressionFillPass,
  type ExpressionFillPassDeps,
} from '../../../functions/src/paper-trading/passes/expression-fill-pass';
import type { PendingFillInput } from '../../../functions/src/paper-trading/ledger';

const MARKET_DATE = '2026-09-25';
const NOW = new Date('2026-09-25T19:00:00.000Z');

const CSP_TEMPLATE: SignalExpressionTemplate = {
  key: 'csp-030-45',
  expression: 'CSP',
  optionType: OptionType.PUT,
  side: TradeSide.SHORT,
  targetDelta: 0.3,
  targetDte: 45,
  minDte: 30,
  maxDte: 60,
};

function pendingTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: '260925-sig-QQQM-CSP-030-45',
    status: PaperTradeStatus.PENDING,
    userId: 'user1',
    source: PaperTradeSource.SIGNAL,
    symbol: 'QQQM',
    expression: 'CSP',
    governingVariant: 'none',
    expressionTemplate: CSP_TEMPLATE,
    order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
    fills: [],
    legs: [],
    marks: {},
    variantRuns: [],
    variantKeys: [],
    realizedPnl: 0,
    unrealizedPnl: 0,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

// Expirations: 2026-11-06 (42d — in band), 2026-10-10 (15d — out), 2026-12-20 (86d — out)
const CHAIN = {
  data: {
    chains: [
      {
        id: 'chain-1',
        symbol: 'QQQM',
        expiration_dates: ['2026-10-10', '2026-11-06', '2026-12-20'],
      },
    ],
  },
};

const INSTRUMENTS = {
  data: {
    instruments: [
      { id: 'inst-570p', chain_symbol: 'QQQM', expiration_date: '2026-11-06', strike_price: '570', type: 'put' },
      { id: 'inst-580p', chain_symbol: 'QQQM', expiration_date: '2026-11-06', strike_price: '580', type: 'put' },
      { id: 'inst-560p', chain_symbol: 'QQQM', expiration_date: '2026-11-06', strike_price: '560', type: 'put' },
    ],
  },
};

const QUOTES = {
  data: {
    results: [
      { instrument_id: 'inst-570p', quote: { adjusted_mark_price: '4.10', delta: '-0.45' }, close: { price: '4.10' } },
      { instrument_id: 'inst-580p', quote: { adjusted_mark_price: '2.80', delta: '-0.31' }, close: { price: '2.80' } },
      { instrument_id: 'inst-560p', quote: { adjusted_mark_price: '1.50', delta: '-0.18' }, close: { price: '1.50' } },
    ],
  },
};

function makeDeps(overrides: Partial<ExpressionFillPassDeps> = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const fills: PendingFillInput[] = [];

  const deps: ExpressionFillPassDeps = {
    listPendingTrades: overrides.listPendingTrades ?? (async () => [pendingTrade()]),
    callTool:
      overrides.callTool ??
      (async (name, args) => {
        calls.push({ name, args });
        if (name.endsWith('get_option_chains')) return CHAIN;
        if (name.endsWith('get_option_instruments')) return INSTRUMENTS;
        if (name.endsWith('get_option_quotes')) return QUOTES;
        throw new Error(`unexpected tool ${name}`);
      }),
    applyPendingFill: async (input) => {
      fills.push(input);
      return { trade: pendingTrade({ status: PaperTradeStatus.OPEN }) };
    },
    now: () => NOW,
    ...overrides,
  };
  return { deps, calls, fills };
}

describe('runExpressionFillPass', () => {
  it('fills a pending expression: chains → instruments → quotes → select → applyPendingFill', async () => {
    const { deps, calls, fills } = makeDeps();
    const summary = await runExpressionFillPass(MARKET_DATE, deps);

    assert.equal(summary.filled, 1);
    assert.equal(summary.errors.length, 0);
    assert.equal(fills.length, 1);

    const fill = fills[0];
    assert.equal(fill.userId, 'user1');
    assert.equal(fill.tradeId, '260925-sig-QQQM-CSP-030-45');
    // selection: |delta| nearest 0.30 → inst-580p (-0.31)
    const leg = fill.legs[0];
    assert.equal(leg.kind, 'option');
    if (leg.kind === 'option') {
      assert.equal(leg.contractID, 'QQQM261106P00580000');
      assert.equal(leg.expiration, '2026-11-06');
      assert.equal(leg.strike, 580);
      assert.equal(leg.type, OptionType.PUT);
    }
    assert.equal(leg.side, TradeSide.SHORT);
    assert.equal(leg.multiplier, 100);
    assert.equal(leg.entryMark, 2.8);
    assert.equal(fill.fill.price, 2.8);
    assert.equal(fill.fill.role, 'entry');
    assert.equal(fill.fill.date, MARKET_DATE);
    assert.equal(fill.fill.quoteSource, OptionQuoteSource.RH_MCP);
    assert.equal(fill.fill.quantity, 1);
  });

  it('only queries instruments for expirations inside the template DTE band', async () => {
    const { deps, calls } = makeDeps();
    await runExpressionFillPass(MARKET_DATE, deps);

    const instrumentCalls = calls.filter((c) => c.name.endsWith('get_option_instruments'));
    assert.equal(instrumentCalls.length, 1);
    const args = instrumentCalls[0].args;
    assert.equal(args.chain_symbol, 'QQQM');
    assert.equal(args.expiration_dates, '2026-11-06');
    assert.equal(args.type, 'put');

    // quotes batched over the in-band instruments
    const quoteCalls = calls.filter((c) => c.name.endsWith('get_option_quotes'));
    assert.equal(quoteCalls.length, 1);
    assert.deepEqual(
      (quoteCalls[0].args.instrument_ids as string[]).sort(),
      ['inst-560p', 'inst-570p', 'inst-580p'],
    );

    // no mutation tools anywhere
    for (const c of calls) assert.ok(!/place_|review_/.test(c.name));
  });

  it('skips trades with no template and reports an error', async () => {
    const { deps, fills } = makeDeps({
      listPendingTrades: async () => [pendingTrade({ expressionTemplate: undefined })],
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.filled, 0);
    assert.equal(fills.length, 0);
    assert.equal(summary.errors.length, 1);
    assert.match(summary.errors[0].error, /template/i);
  });

  it('skips when no expiration falls inside the DTE band', async () => {
    const chainOut = {
      data: {
        chains: [{ id: 'c', symbol: 'QQQM', expiration_dates: ['2026-10-01', '2027-06-01'] }],
      },
    };
    const { deps, fills } = makeDeps({
      callTool: async (name) => {
        if (name.endsWith('get_option_chains')) return chainOut;
        throw new Error(`unexpected tool ${name}`);
      },
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.filled, 0);
    assert.equal(fills.length, 0);
    assert.equal(summary.skipped, 1);
  });

  it('skips when no candidate contract is selectable', async () => {
    const { deps, fills } = makeDeps({
      callTool: async (name) => {
        if (name.endsWith('get_option_chains')) return CHAIN;
        if (name.endsWith('get_option_instruments')) return { data: { instruments: [] } };
        throw new Error(`unexpected tool ${name}`);
      },
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.filled, 0);
    assert.equal(fills.length, 0);
    assert.equal(summary.skipped, 1);
  });

  it('is idempotent — filled trades are OPEN so re-run lists nothing', async () => {
    const { deps, fills } = makeDeps({ listPendingTrades: async () => [] });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.filled, 0);
    assert.equal(fills.length, 0);
  });

  it('reports a per-trade error without aborting the pass', async () => {
    const { deps, fills } = makeDeps({
      listPendingTrades: async () => [
        pendingTrade({ id: 'bad-trade', userId: undefined }),
        pendingTrade(),
      ],
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.filled, 1);
    assert.equal(summary.errors.length, 1);
    assert.equal(summary.errors[0].tradeId, 'bad-trade');
    assert.equal(fills.length, 1);
  });
});
