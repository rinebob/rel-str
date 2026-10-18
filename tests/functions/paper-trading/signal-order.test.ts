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
import {
  buildGroupDoc,
  type EmitPositionGroupInput,
} from '../../../functions/src/position-groups/st-position-group-writer';
import type { StPositionGroup } from '../../../shared/st-position-groups';

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
    // #652: exactly one governing trailing-8 run — no shadows.
    assert.deepEqual(entry.dims.variantKeys, ['trailing-8']);

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

// ── #1002 — canonical st-order-tickets emission ────────────────────────────

interface SignalTicketEmit {
  mode: string;
  idSeed: string;
  origin: Record<string, unknown>;
  auto: boolean;
  terms: Record<string, unknown>;
  refId?: string;
  accountTarget: string;
  userId: string;
  signalContext?: Record<string, unknown>;
}

function spyTickets(calls: string[]) {
  const emits: SignalTicketEmit[] = [];
  const fills: string[] = [];
  const fails: string[] = [];
  return {
    emits,
    fills,
    fails,
    dep: {
      emit: async (input: SignalTicketEmit) => {
        calls.push('emit');
        emits.push(input);
        return `pap_${input.idSeed}`;
      },
      markFilled: async (id: string) => {
        calls.push('markFilled');
        fills.push(id);
      },
      markFailed: async (id: string) => {
        calls.push('markFailed');
        fails.push(id);
      },
    },
  };
}

describe('handlePaperSignalOrder — st-order-tickets emission (#1002)', () => {
  it('emits a staged ticket per action: equity (filled) + one per expression template', async () => {
    const calls: string[] = [];
    const spy = spyTickets(calls);
    const { deps, pendingInputs } = makeDeps({ tickets: spy.dep });
    await handlePaperSignalOrder(request(), deps);

    const templates = SIGNAL_EXPRESSION_TEMPLATES[TradeSide.LONG];
    assert.equal(spy.emits.length, 1 + templates.length);
    const equity = spy.emits[0];
    assert.equal(equity.mode, 'paper');
    assert.equal(equity.auto, false, 'user-accepted — not an automated flow');
    assert.equal(equity.refId, 'ref-1', 'refId preserves order-ticket lineage');
    assert.equal(equity.accountTarget, 'acct-user1');
    assert.equal(equity.userId, 'user1');
    assert.equal(equity.terms.instrument, 'equity');
    assert.equal(equity.terms.quantity, 100);
    assert.equal(equity.terms.expression, 'EQ');

    for (const t of spy.emits.slice(1)) {
      assert.equal(t.terms.instrument, 'option');
      assert.equal(t.terms.quantity, 1);
      assert.ok(t.terms.expressionTemplate, 'staged ticket carries the contract recipe');
    }
    assert.deepEqual(
      spy.emits.slice(1).map((t) => t.idSeed).sort(),
      pendingInputs.map((p) => p.tradeId).sort(),
      'idSeed = the pending trade id each ticket expresses',
    );
    // equity ticket filled; expression tickets stay staged (no mark calls)
    assert.equal(spy.fills.length, 1);
    assert.equal(spy.fills[0], `pap_${equity.idSeed}`);
    assert.equal(spy.fails.length, 0);
  });

  it('origin is signal when the order ticket carries signalContext', async () => {
    const calls: string[] = [];
    const spy = spyTickets(calls);
    const { deps } = makeDeps({
      tickets: spy.dep,
      getTicket: async () => ({
        id: 't',
        refId: 'ref-1',
        symbol: 'QQQM',
        side: 'buy',
        signalContext: {
          signalType: 'D_ST_TREND_RIDER_V1_LONG',
          barDate: '2026-09-25',
          direction: 'LONG',
          decisionId: 'dec-1',
        },
      }),
    });
    await handlePaperSignalOrder(request(), deps);
    assert.deepEqual(spy.emits[0].origin, {
      type: 'signal',
      signalId: 'QQQM_2026-09-25_D_ST_TREND_RIDER_V1_LONG',
    });
    assert.equal(spy.emits[0].signalContext?.decisionId, 'dec-1');
  });

  it('origin is manual when the ticket has no signalContext', async () => {
    const calls: string[] = [];
    const spy = spyTickets(calls);
    const { deps } = makeDeps({ tickets: spy.dep });
    await handlePaperSignalOrder(request(), deps);
    assert.deepEqual(spy.emits[0].origin, { type: 'manual' });
  });

  it('marks the equity ticket failed when the entry fill throws', async () => {
    const calls: string[] = [];
    const spy = spyTickets(calls);
    const { deps } = makeDeps({
      tickets: spy.dep,
      applyEntryFill: async () => {
        throw new Error('ledger txn aborted');
      },
    });
    await assert.rejects(handlePaperSignalOrder(request(), deps), /ledger txn aborted/);
    assert.equal(spy.fails.length, 1);
    assert.equal(spy.fails[0], `pap_${spy.emits[0].idSeed}`);
  });

  it('emits no tickets on the idempotent retry path', async () => {
    const calls: string[] = [];
    const spy = spyTickets(calls);
    const { deps } = makeDeps({
      tickets: spy.dep,
      listTradesBySignal: async () => [
        signalTrade({ id: '260925-sig-QQQM-EQ', cohortId: 'cohort-260925-QQQM-01' }),
      ],
      getCohort: async () => ({
        kind: PaperTradingKind.COHORT,
        id: 'cohort-260925-QQQM-01',
        signalId: 'sig-1',
        symbol: 'QQQM',
        direction: TradeSide.LONG,
        acceptedAt: '2026-09-25T12:00:00Z',
        tradeIds: ['260925-sig-QQQM-EQ'],
        expressionTemplates: [],
        createdAt: '2026-09-25T12:00:00Z',
        updatedAt: '2026-09-25T12:00:00Z',
      }),
    });
    await handlePaperSignalOrder(request(), deps);
    assert.equal(spy.emits.length, 0, 'existing trades → early return before emission');
  });
});

// ── #1004 — canonical st-position-groups ────────────────────────────────────

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

function spyGroups(existing: Map<string, StPositionGroup> = new Map()) {
  const creates: EmitPositionGroupInput[] = [];
  const ensures: StPositionGroup[] = [];
  let seq = 0;
  return {
    creates,
    ensures,
    dep: {
      create: async (input: EmitPositionGroupInput) => {
        creates.push(input);
        seq++;
        const id = `QQQM-260925-grp-0${seq}`;
        existing.set(id, buildGroupDoc(id, input));
        return id;
      },
      ensure: async (group: StPositionGroup) => {
        ensures.push(group);
        existing.set(group.id, group);
        return group.id;
      },
      get: async (id: string) => existing.get(id) ?? null,
    },
  };
}

describe('handlePaperSignalOrder — st-position-groups (#1004)', () => {
  it('creates one group covering every member ticket/trade and returns its id', async () => {
    const groups = spyGroups();
    const calls: string[] = [];
    const spy = spyTickets(calls);
    const { deps } = makeDeps({ groups: groups.dep, tickets: spy.dep });
    const res = await handlePaperSignalOrder(request(), deps);

    assert.equal(groups.creates.length, 1);
    const g = groups.creates[0];
    assert.equal(g.symbol, 'QQQM');
    assert.equal(g.mode, 'paper');
    assert.equal(g.userId, 'user1');
    assert.deepEqual(g.origin, { type: 'manual' });
    const templates = SIGNAL_EXPRESSION_TEMPLATES[TradeSide.LONG];
    assert.equal(g.memberTradeIds!.length, 1 + templates.length);
    assert.equal(
      g.memberTicketIds!.length,
      1 + templates.length,
      'pap_{tradeId} lifecycle tickets are members',
    );
    assert.equal(g.brokerOrderIds, undefined, 'paper accept — no broker orders; writer defaults []');
    assert.equal(res.positionGroupId, 'QQQM-260925-grp-01');
  });

  it('stamps positionGroupId on emitted ticket origins and trade dims', async () => {
    const groups = spyGroups();
    const calls: string[] = [];
    const spy = spyTickets(calls);
    const { deps, entryInputs, pendingInputs } = makeDeps({
      groups: groups.dep,
      tickets: spy.dep,
    });
    await handlePaperSignalOrder(request(), deps);

    for (const e of spy.emits) {
      assert.equal(
        (e.origin as Record<string, unknown>).positionGroupId,
        'QQQM-260925-grp-01',
      );
    }
    assert.equal(entryInputs[0].dims.positionGroupId, 'QQQM-260925-grp-01');
    for (const p of pendingInputs) {
      assert.equal(p.dims.positionGroupId, 'QQQM-260925-grp-01');
    }
  });

  it('works unchanged when the groups dep is absent (pre-wired callers)', async () => {
    const { deps, entryInputs } = makeDeps();
    const res = await handlePaperSignalOrder(request(), deps);
    assert.equal(res.cohortId, 'cohort-260925-QQQM-01');
    assert.equal(res.positionGroupId, undefined);
    assert.equal(entryInputs[0].dims.positionGroupId, undefined);
  });

  it('retry path returns the stored positionGroupId and ensures the group doc', async () => {
    const groups = spyGroups(); // empty — group doc missing → ensure() rebuild
    const { deps } = makeDeps({
      groups: groups.dep,
      listTradesBySignal: async () => [
        signalTrade({
          id: '260925-sig-QQQM-EQ',
          cohortId: 'cohort-260925-QQQM-01',
          positionGroupId: 'QQQM-260925-grp-01',
        }),
      ],
      getCohort: async () => ({
        kind: PaperTradingKind.COHORT,
        id: 'cohort-260925-QQQM-01',
        signalId: 'sig-1',
        symbol: 'QQQM',
        direction: TradeSide.LONG,
        acceptedAt: '2026-09-25T12:00:00Z',
        tradeIds: ['260925-sig-QQQM-EQ'],
        expressionTemplates: [],
        createdAt: '2026-09-25T12:00:00Z',
        updatedAt: '2026-09-25T12:00:00Z',
      }),
    });
    const res = await handlePaperSignalOrder(request(), deps);
    assert.equal(res.positionGroupId, 'QQQM-260925-grp-01');
    assert.equal(groups.ensures.length, 1, 'missing group rebuilt on retry');
    assert.equal(groups.creates.length, 0);
    const rebuilt = groups.ensures[0];
    assert.equal(rebuilt.id, 'QQQM-260925-grp-01');
    assert.deepEqual(rebuilt.memberTradeIds, ['260925-sig-QQQM-EQ']);
    assert.deepEqual(rebuilt.memberTicketIds, ['pap_260925-sig-QQQM-EQ']);
    assert.deepEqual(rebuilt.rollups, { openCount: 1, closedCount: 0 });
    assert.equal(rebuilt.status, 'open');
    assert.equal(rebuilt.createdAt, '2026-09-25T12:00:00Z', 'original accept time preserved');
  });

  it('rebuild membership excludes same-signal trades outside the cohort', async () => {
    const groups = spyGroups();
    const { deps } = makeDeps({
      groups: groups.dep,
      listTradesBySignal: async () => [
        signalTrade({
          id: '260925-sig-QQQM-EQ',
          cohortId: 'cohort-260925-QQQM-01',
          positionGroupId: 'QQQM-260925-grp-01',
        }),
        // Auto-paper ingest writes source:SIGNAL trades with no cohort —
        // same signalId, but not a member of this group.
        signalTrade({ id: '260925-sig-QQQM-auto', expression: 'CSP' }),
      ],
      getCohort: async () => ({
        kind: PaperTradingKind.COHORT,
        id: 'cohort-260925-QQQM-01',
        signalId: 'sig-1',
        symbol: 'QQQM',
        direction: TradeSide.LONG,
        acceptedAt: '2026-09-25T12:00:00Z',
        tradeIds: ['260925-sig-QQQM-EQ'],
        expressionTemplates: [],
        createdAt: '2026-09-25T12:00:00Z',
        updatedAt: '2026-09-25T12:00:00Z',
      }),
    });
    await handlePaperSignalOrder(request(), deps);
    assert.equal(groups.ensures.length, 1);
    assert.deepEqual(
      groups.ensures[0].memberTradeIds,
      ['260925-sig-QQQM-EQ'],
      'non-cohort same-signal trade excluded from rebuild',
    );
  });

  it('fail-soft: group create returning null completes the accept unstamped', async () => {
    const groups = spyGroups();
    groups.dep.create = async (input: EmitPositionGroupInput) => {
      groups.creates.push(input);
      return null; // writer fail-soft — canonical write failed
    };
    const { deps, entryInputs, cohorts } = makeDeps({ groups: groups.dep });
    const res = await handlePaperSignalOrder(request(), deps);
    assert.ok(res.cohortId, 'legacy cohort still written');
    assert.equal(cohorts.length, 1);
    assert.equal(res.positionGroupId, undefined);
    assert.equal(entryInputs[0].dims.positionGroupId, undefined);
  });
});
