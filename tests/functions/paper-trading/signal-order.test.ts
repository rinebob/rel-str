/**
 * @topic #553 — Paper Trading Infra (task #564)
 *
 * paperSignalOrder callable: accepts an ST signal as a paper cohort —
 * equity trade filled at the acceptance quote (applyEntryFill), a cohort
 * doc, and PENDING expression trades per direction-mapped template.
 * No broker mutation calls (place_\* / review_\*) may appear on this path.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TradeSide } from '../../../shared/common';
import { OptionQuoteSource } from '../../../shared/options-common';
import {
  PaperTradingKind,
  PaperTradeSource,
  PaperTradeStatus,
  SIGNAL_EXPRESSION_TEMPLATES,
  SIGNAL_GOVERNING_VARIANT,
  type PaperCohort,
  type PaperTrade,
  type SignalExpressionTemplate,
} from '../../../shared/paper-trading-contracts';
import {
  extractEquityPrice,
  handlePaperSignalOrder,
  type PaperSignalOrderDeps,
} from '../../../functions/src/paper-trading/callables';
import type { EntryFillInput, PendingTradeInput } from '../../../functions/src/paper-trading/ledger';
import type { ApplyFillResult } from '../../../functions/src/paper-trading/ledger';

const NOW = new Date('2026-09-25T19:00:00.000Z'); // Friday → PT market date 2026-09-25

const EQUITY_QUOTE = {
  data: {
    results: [
      {
        quote: { symbol: 'QQQM', last_trade_price: '590.10' },
        close: { price: '590.00' },
      },
    ],
  },
};

function makeDeps(overrides: Partial<PaperSignalOrderDeps> = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const entryInputs: EntryFillInput[] = [];
  const pendingInputs: PendingTradeInput[] = [];
  const cohorts: PaperCohort[] = [];

  const deps: PaperSignalOrderDeps = {
    getTicket: overrides.getTicket ?? (async () => ({
      id: 'ticket-1',
      refId: 'ref-1',
      symbol: 'QQQM',
      side: 'buy',
      quantity: '100',
    })),
    listTradesBySignal: overrides.listTradesBySignal ?? (async () => []),
    getCohort: overrides.getCohort ?? (async () => null),
    callTool:
      overrides.callTool ??
      (async (name, args) => {
        calls.push({ name, args });
        return EQUITY_QUOTE;
      }),
    resolveTradeId: overrides.resolveTradeId ?? (async (base) => base),
    resolveCohortId: overrides.resolveCohortId ?? (async () => 'cohort-260925-QQQM-01'),
    applyEntryFill: async (input) => {
      entryInputs.push(input);
      return {} as ApplyFillResult;
    },
    createPendingTrade: async (input) => {
      pendingInputs.push(input);
      return { id: input.tradeId } as PaperTrade;
    },
    setCohort: async (cohort) => {
      cohorts.push(cohort);
    },
    now: () => NOW,
    ...overrides,
  };
  return { deps, calls, entryInputs, pendingInputs, cohorts };
}

function request(direction: TradeSide = TradeSide.LONG) {
  return {
    auth: { uid: 'user1' },
    data: {
      signalId: 'sig-1',
      symbol: 'QQQM',
      direction,
      quantity: 100,
      refId: 'ref-1',
    },
  };
}

describe('extractEquityPrice', () => {
  it('extracts last_trade_price for the requested symbol', () => {
    assert.equal(extractEquityPrice(EQUITY_QUOTE, 'QQQM'), 590.1);
  });

  it('falls back to close.price when last_trade_price is absent', () => {
    const raw = {
      data: { results: [{ quote: { symbol: 'QQQM' }, close: { price: '589.50' } }] },
    };
    assert.equal(extractEquityPrice(raw, 'QQQM'), 589.5);
  });

  it('returns undefined for a missing symbol or malformed payload', () => {
    assert.equal(extractEquityPrice(EQUITY_QUOTE, 'MSFT'), undefined);
    assert.equal(extractEquityPrice({}, 'QQQM'), undefined);
    assert.equal(extractEquityPrice(null, 'QQQM'), undefined);
  });
});

describe('handlePaperSignalOrder', () => {
  it('rejects unauthenticated calls', async () => {
    const { deps } = makeDeps();
    await assert.rejects(
      handlePaperSignalOrder({ data: request().data }, deps),
      /signed in/i,
    );
  });

  it('rejects a request missing required fields', async () => {
    const { deps } = makeDeps();
    await assert.rejects(
      handlePaperSignalOrder(
        { auth: { uid: 'u' }, data: { signalId: 'sig-1', symbol: 'QQQM' } },
        deps,
      ),
      /signalId|quantity|refId/i,
    );
  });

  it('rejects when the order ticket cannot be found', async () => {
    const { deps } = makeDeps({ getTicket: async () => null });
    await assert.rejects(
      handlePaperSignalOrder(request(), deps),
      /not-found|ticket/i,
    );
  });

  it('rejects when the ticket symbol does not match the request', async () => {
    const { deps } = makeDeps({
      getTicket: async () => ({ id: 't', refId: 'ref-1', symbol: 'MSFT', side: 'buy' }),
    });
    await assert.rejects(
      handlePaperSignalOrder(request(), deps),
      /does not match/i,
    );
  });

  it('accepts a LONG signal: equity fill + cohort + PENDING expression trades', async () => {
    const { deps, calls, entryInputs, pendingInputs, cohorts } = makeDeps();
    const res = await handlePaperSignalOrder(request(), deps);

    // equity fill applied once at the quote
    assert.equal(entryInputs.length, 1);
    const entry = entryInputs[0];
    assert.equal(entry.userId, 'user1');
    assert.equal(entry.fill.price, 590.1);
    assert.equal(entry.fill.role, 'entry');
    assert.equal(entry.fill.quantity, 100);
    assert.equal(entry.fill.quoteSource, OptionQuoteSource.RH_MCP);
    assert.equal(entry.order.side, TradeSide.LONG);
    assert.equal(entry.legs.length, 1);
    assert.equal(entry.legs[0].kind, 'share');
    assert.equal(entry.legs[0].quantity, 100);
    assert.equal(entry.legs[0].multiplier, 1);
    assert.match(entry.tradeId, /^\d{6}-sig-QQQM-EQ/);
    assert.equal(entry.dims.source, PaperTradeSource.SIGNAL);
    assert.equal(entry.dims.expression, 'EQ');
    assert.equal(entry.dims.signalId, 'sig-1');
    assert.equal(entry.dims.cohortId, 'cohort-260925-QQQM-01');
    assert.equal(entry.dims.ticket?.refId, 'ref-1');
    assert.equal(entry.dims.governingVariant, SIGNAL_GOVERNING_VARIANT);
    assert.ok(entry.dims.variantKeys?.includes('initial-stop-10'));

    // one PENDING trade per bullish template
    const templates = SIGNAL_EXPRESSION_TEMPLATES[TradeSide.LONG];
    assert.equal(pendingInputs.length, templates.length);
    assert.deepEqual(
      pendingInputs.map((p) => p.expressionTemplate?.key).sort(),
      templates.map((t) => t.key).sort(),
    );
    for (const p of pendingInputs) {
      assert.match(p.tradeId, /^\d{6}-sig-QQQM-/);
      assert.equal(p.dims.cohortId, 'cohort-260925-QQQM-01');
      assert.equal(p.dims.signalId, 'sig-1');
      assert.equal(p.order.quantity, 1); // expression legs are 1 contract
    }

    // cohort groups all member trades
    assert.equal(cohorts.length, 1);
    assert.equal(cohorts[0].signalId, 'sig-1');
    assert.equal(cohorts[0].direction, TradeSide.LONG);
    assert.equal(cohorts[0].tradeIds.length, 1 + templates.length);
    assert.deepEqual(cohorts[0].expressionTemplates, templates.map((t) => t.key));

    assert.equal(res.cohortId, 'cohort-260925-QQQM-01');
    assert.equal(res.expressionTradeIds.length, templates.length);
  });

  it('accepts a SHORT signal: bearish templates only', async () => {
    const { deps, pendingInputs } = makeDeps({
      getTicket: async () => ({ id: 't', refId: 'ref-1', symbol: 'QQQM', side: 'sell' }),
    });
    await handlePaperSignalOrder(request(TradeSide.SHORT), deps);
    const templates = SIGNAL_EXPRESSION_TEMPLATES[TradeSide.SHORT];
    assert.equal(pendingInputs.length, templates.length);
    assert.deepEqual(
      pendingInputs.map((p) => p.expressionTemplate?.key).sort(),
      templates.map((t) => t.key).sort(),
    );
  });

  it('rejects when ticket side disagrees with request direction', async () => {
    const { deps } = makeDeps();
    await assert.rejects(
      handlePaperSignalOrder(request(TradeSide.SHORT), deps), // ticket is 'buy'
      /side .* does not match/i,
    );
  });

  it('inherits the order ticket quantity over the request quantity', async () => {
    const { deps, entryInputs } = makeDeps();
    const req = request();
    req.data.quantity = 25; // ticket says 100
    await handlePaperSignalOrder(req, deps);
    assert.equal(entryInputs[0].order.quantity, 100);
    assert.equal(entryInputs[0].fill.quantity, 100);
    assert.equal(entryInputs[0].legs[0].quantity, 100);
  });

  function signalTrade(overrides: Partial<PaperTrade>): PaperTrade {
    return {
      kind: PaperTradingKind.TRADE,
      id: 'x',
      status: PaperTradeStatus.OPEN,
      source: PaperTradeSource.SIGNAL,
      symbol: 'QQQM',
      expression: 'EQ',
      governingVariant: 'none',
      order: { side: TradeSide.LONG, type: 'MARKET', quantity: 100 },
      fills: [],
      legs: [],
      marks: {},
      variantRuns: [],
      variantKeys: [],
      realizedPnl: 0,
      unrealizedPnl: 0,
      createdAt: '2026-09-25T12:00:00Z',
      updatedAt: '2026-09-25T12:00:00Z',
      ...overrides,
    };
  }

  it('is idempotent: a retry for the same signal returns the existing cohort', async () => {
    const existingTrade = signalTrade({
      id: '260925-sig-QQQM-EQ',
      cohortId: 'cohort-260925-QQQM-01',
    });
    const existingPending = signalTrade({
      id: '260925-sig-QQQM-CSP-030-45',
      expression: 'CSP',
      cohortId: 'cohort-260925-QQQM-01',
      status: PaperTradeStatus.PENDING,
      expressionTemplate: { key: 'csp-030-45' } as SignalExpressionTemplate,
    });
    const { deps, entryInputs, pendingInputs, calls } = makeDeps({
      listTradesBySignal: async () => [existingTrade, existingPending],
      getCohort: async () => ({
        kind: PaperTradingKind.COHORT,
        id: 'cohort-260925-QQQM-01',
        signalId: 'sig-123',
        symbol: 'QQQM',
        direction: TradeSide.LONG,
        acceptedAt: '2026-09-25T12:00:00Z',
        tradeIds: [existingTrade.id, existingPending.id],
        expressionTemplates: ['csp-030-45'],
        createdAt: '2026-09-25T12:00:00Z',
        updatedAt: '2026-09-25T12:00:00Z',
      }),
    });
    const res = await handlePaperSignalOrder(request(), deps);

    assert.equal(res.cohortId, 'cohort-260925-QQQM-01');
    assert.equal(res.equityTradeId, '260925-sig-QQQM-EQ');
    assert.deepEqual(res.expressionTradeIds, ['260925-sig-QQQM-CSP-030-45']);
    assert.equal(entryInputs.length, 0);  // no second equity fill
    assert.equal(pendingInputs.length, 0); // no second pending fan-out
    assert.equal(calls.length, 0);         // no quote fetch on a retry
  });

  it('rebuilds a missing cohort doc on retry instead of failing', async () => {
    const existingTrade = signalTrade({
      id: '260925-sig-QQQM-EQ',
      cohortId: 'cohort-260925-QQQM-01',
    });
    const { deps, cohorts } = makeDeps({
      listTradesBySignal: async () => [existingTrade],
      getCohort: async () => null, // cohort doc was never written
    });
    const res = await handlePaperSignalOrder(request(), deps);
    assert.equal(res.cohortId, 'cohort-260925-QQQM-01');
    assert.equal(cohorts.length, 1);
    assert.deepEqual(cohorts[0].tradeIds, ['260925-sig-QQQM-EQ']);
    // provenance preserved: acceptedAt from the original trade, not retry time
    assert.equal(cohorts[0].acceptedAt, '2026-09-25T12:00:00Z');
  });

  it('never invokes broker mutation tools (place_*/review_*)', async () => {
    const { deps, calls } = makeDeps();
    await handlePaperSignalOrder(request(), deps);
    assert.ok(calls.length > 0);
    for (const c of calls) {
      assert.ok(!/place_|review_/.test(c.name), `unexpected tool call: ${c.name}`);
    }
    assert.deepEqual(calls.map((c) => c.name), [
      'mcp__robinhood-trading__get_equity_quotes',
    ]);
  });
});
