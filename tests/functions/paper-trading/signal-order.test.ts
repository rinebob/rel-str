/**
 * @topic #553 — Paper Trading Infra (task #564)
 *
 * paperSignalOrder callable: accepts an ST signal as a paper cohort —
 * equity trade filled at the acceptance quote (applyEntryFill), a cohort
 * doc, and STAGED expression tickets per direction-mapped template (#1005 —
 * no PENDING trades; the pap_ ticket is the pending expression).
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
import type { EntryFillInput } from '../../../functions/src/paper-trading/ledger';
import type { ApplyFillResult } from '../../../functions/src/paper-trading/ledger';
import {
  buildGroupDoc,
  type EmitPositionGroupInput,
} from '../../../functions/src/position-groups/st-position-group-writer';
import type { StPositionGroup } from '../../../shared/st-position-groups';
import type { StOrderTicket } from '../../../shared/st-order-tickets';
import type {
  EmitStOrderTicketInput,
  StTicketTransitionResult,
} from '../../../functions/src/order-tickets/st-order-ticket-writer';

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
    setCohort: async (cohort) => {
      cohorts.push(cohort);
    },
    now: () => NOW,
    ...overrides,
  };
  return { deps, calls, entryInputs, cohorts };
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

  it('accepts a LONG signal: equity fill + cohort + staged expression tickets', async () => {
    const { deps, calls, entryInputs, cohorts } = makeDeps();
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

    // one staged-ticket seed per bullish template — no PENDING trades (#1005)
    const templates = SIGNAL_EXPRESSION_TEMPLATES[TradeSide.LONG];
    assert.equal(res.expressionTradeIds.length, templates.length);
    for (const seed of res.expressionTradeIds) {
      assert.match(seed, /^\d{6}-sig-QQQM-/);
    }

    // cohort lists the minted trade only; templates stay the soak anchor
    assert.equal(cohorts.length, 1);
    assert.equal(cohorts[0].signalId, 'sig-1');
    assert.equal(cohorts[0].direction, TradeSide.LONG);
    assert.deepEqual(cohorts[0].tradeIds, [entryInputs[0].tradeId]);
    assert.deepEqual(cohorts[0].expressionTemplates, templates.map((t) => t.key));

    assert.equal(res.cohortId, 'cohort-260925-QQQM-01');
  });

  it('accepts a SHORT signal: bearish template seeds only', async () => {
    const calls: string[] = [];
    const spy = spyTickets(calls);
    const { deps } = makeDeps({
      tickets: spy.dep,
      getTicket: async () => ({ id: 't', refId: 'ref-1', symbol: 'QQQM', side: 'sell' }),
    });
    const res = await handlePaperSignalOrder(request(TradeSide.SHORT), deps);
    const templates = SIGNAL_EXPRESSION_TEMPLATES[TradeSide.SHORT];
    assert.equal(res.expressionTradeIds.length, templates.length);
    assert.deepEqual(
      spy.emits.slice(1).map((t) => (t.terms.expressionTemplate as SignalExpressionTemplate).key).sort(),
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
    const { deps, entryInputs, calls } = makeDeps({
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
    // A legacy PENDING trade reports its real id; post-#1005 retries
    // report the recomputed ticket seeds.
    assert.deepEqual(res.expressionTradeIds, ['260925-sig-QQQM-CSP-030-45']);
    assert.equal(entryInputs.length, 0);  // no second equity fill
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
    // No expression trades to read keys from — rebuilt from the direction's
    // template set (#1005).
    assert.deepEqual(
      cohorts[0].expressionTemplates,
      SIGNAL_EXPRESSION_TEMPLATES[TradeSide.LONG].map((t) => t.key),
    );
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

type SignalTicketEmit = EmitStOrderTicketInput;

function spyTickets(calls: string[]) {
  const emits: SignalTicketEmit[] = [];
  const fills: string[] = [];
  const fails: string[] = [];
  // pap_{seed} → owner fields so resolveTicketSeed/get can model the
  // owned (same refId or same signalId) vs foreign check.
  const seeds = new Map<string, { refId: string; signalId?: string }>();
  return {
    emits,
    fills,
    fails,
    dep: {
      emit: async (input: SignalTicketEmit) => {
        calls.push('emit');
        emits.push(input);
        seeds.set(input.idSeed, {
          refId: input.refId ?? '',
          signalId: input.signalContext?.signalId as string | undefined,
        });
        return `pap_${input.idSeed}`;
      },
      markFilled: async (id: string): Promise<StTicketTransitionResult> => {
        calls.push('markFilled');
        fills.push(id);
        return { applied: true, ticketId: id, to: 'filled' };
      },
      markFailed: async (id: string): Promise<StTicketTransitionResult> => {
        calls.push('markFailed');
        fails.push(id);
        return { applied: true, ticketId: id, to: 'failed' };
      },
      // Minimal doc for the retry-path ownership checks — refId +
      // signalContext.signalId are all the handler reads.
      get: async (id: string) => {
        const seed = id.replace(/^pap_/, '');
        const owner = seeds.get(seed);
        return owner
          ? ({ id, refId: owner.refId, signalContext: { signalId: owner.signalId } } as StOrderTicket)
          : null;
      },
      resolveTicketSeed: async (base: string, refId: string, signalId?: string) => {
        for (let i = 0; i < 100; i++) {
          const seed = i === 0 ? base : `${base}-${i + 1}`;
          const owner = seeds.get(seed);
          if (owner === undefined || owner.refId === refId
            || (signalId !== undefined && owner.signalId === signalId)) {
            return seed;
          }
        }
        throw new Error(`ticket seed exhausted for ${base}`);
      },
    },
  };
}

describe('handlePaperSignalOrder — st-order-tickets emission (#1002)', () => {
  it('emits a staged ticket per action: equity (filled) + one per expression template', async () => {
    const calls: string[] = [];
    const spy = spyTickets(calls);
    const { deps } = makeDeps({ tickets: spy.dep });
    const res = await handlePaperSignalOrder(request(), deps);

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
      res.expressionTradeIds.slice().sort(),
      'idSeed = the staged-ticket seed each member carries (#1005)',
    );
    assert.ok(
      spy.emits.slice(1).every((t) => t.cohortId === 'cohort-260925-QQQM-01'),
      'staged tickets carry the cohort bridge for minted trades',
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
    // Caller-passed signal id rides the ticket so the #1005-minted trade
    // keeps listTradesBySignal(data.signalId) lineage on retry.
    assert.equal(spy.emits[0].signalContext?.signalId, 'sig-1');
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

  it('re-emits staged tickets on retry — heals a first accept that died before the emits (#1005)', async () => {
    const calls: string[] = [];
    const spy = spyTickets(calls);
    const { deps } = makeDeps({
      tickets: spy.dep,
      // Post-#1005 shape: only the equity trade exists; the staged
      // expression tickets are the pending expressions.
      listTradesBySignal: async () => [
        signalTrade({
          id: '260925-sig-QQQM-EQ',
          cohortId: 'cohort-260925-QQQM-01',
          fills: [{ fillId: 'f', role: 'entry', date: '2026-09-25', price: 5, quantity: 100, quoteSource: OptionQuoteSource.RH_MCP }],
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
    await handlePaperSignalOrder(request(), deps);

    const templates = SIGNAL_EXPRESSION_TEMPLATES[TradeSide.LONG];
    // equity lifecycle ticket + one staged ticket per template — emit is
    // create()-idempotent so re-emitting live tickets is a no-op in prod
    assert.equal(spy.emits.length, 1 + templates.length);
    assert.equal(spy.emits[0].idSeed, '260925-sig-QQQM-EQ');
    assert.ok(
      spy.emits.slice(1).every((t) => (t.terms as { instrument?: string }).instrument === 'option'),
      'every member emit is a staged expression ticket',
    );
    // the already-filled equity trade heals its lifecycle ticket
    assert.equal(spy.fills.length, 1);
    assert.equal(spy.fills[0], 'pap_260925-sig-QQQM-EQ');
  });

  it('adopts prior tickets on a retry carrying a different refId — no duplicate staged tickets', async () => {
    const calls: string[] = [];
    const spy = spyTickets(calls);
    let acceptCount = 0;
    const { deps } = makeDeps({
      tickets: spy.dep,
      // First call is the fresh accept (emits the seeds); the second hits
      // the retry branch with the equity trade present.
      listTradesBySignal: async () =>
        acceptCount++ === 0
          ? []
          : [
              signalTrade({
                id: '260925-sig-QQQM-EQ',
                cohortId: 'cohort-260925-QQQM-01',
                fills: [{ fillId: 'f', role: 'entry', date: '2026-09-25', price: 5, quantity: 100, quoteSource: OptionQuoteSource.RH_MCP }],
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

    // Fresh accept under ref-1, then a client retry under a NEW refId —
    // the signalId dedupe is what makes this the same logical accept.
    await handlePaperSignalOrder(request(), deps);
    const firstSeeds = spy.emits.slice(1).map((t) => t.idSeed);
    const retry = { auth: { uid: 'user1' }, data: { ...request().data, refId: 'ref-2' } };
    await handlePaperSignalOrder(retry, deps);

    const retrySeeds = spy.emits
      .slice(1 + SIGNAL_EXPRESSION_TEMPLATES[TradeSide.LONG].length)
      .slice(1)
      .map((t) => t.idSeed);
    assert.deepEqual(
      retrySeeds.sort(),
      firstSeeds.sort(),
      'same-signal tickets adopted by signalId — no -2 duplicate staged tickets',
    );
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
      create: async (input: EmitPositionGroupInput): Promise<string | null> => {
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
    // Post-#1005: only the equity trade is a member trade at mint —
    // expression members are staged tickets until the fill pass mints them.
    assert.equal(g.memberTradeIds!.length, 1);
    assert.deepEqual(g.rollups, { openCount: 1, closedCount: 0 });
    assert.equal(
      g.memberTicketIds!.length,
      1 + templates.length,
      'equity lifecycle ticket + one staged ticket per expression template',
    );
    assert.equal(g.brokerOrderIds, undefined, 'paper accept — no broker orders; writer defaults []');
    assert.equal(res.positionGroupId, 'QQQM-260925-grp-01');
  });

  it('stamps positionGroupId on emitted ticket origins and trade dims', async () => {
    const groups = spyGroups();
    const calls: string[] = [];
    const spy = spyTickets(calls);
    const { deps, entryInputs } = makeDeps({
      groups: groups.dep,
      tickets: spy.dep,
    });
    await handlePaperSignalOrder(request(), deps);

    for (const e of spy.emits) {
      assert.equal(e.origin.positionGroupId, 'QQQM-260925-grp-01');
    }
    assert.equal(entryInputs[0].dims.positionGroupId, 'QQQM-260925-grp-01');
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
    const calls: string[] = [];
    const spy = spyTickets(calls);
    const { deps } = makeDeps({
      groups: groups.dep,
      tickets: spy.dep,
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
    // memberTickets = lifecycle tickets for minted trades + staged
    // expression seeds (#1005) recomputed from the direction's templates.
    const templates = SIGNAL_EXPRESSION_TEMPLATES[TradeSide.LONG];
    assert.equal(rebuilt.memberTicketIds[0], 'pap_260925-sig-QQQM-EQ');
    assert.equal(rebuilt.memberTicketIds.length, 1 + templates.length);
    assert.deepEqual(rebuilt.rollups, { openCount: 1, closedCount: 0 });
    assert.equal(rebuilt.status, 'open');
    assert.equal(rebuilt.createdAt, '2026-09-25T12:00:00Z', 'original accept time preserved');
  });

  it('a cross-day retry re-keys member seeds on the ORIGINAL accept date', async () => {
    // Seeds embed the market date — a Monday retry of a Friday accept must
    // adopt the original 260925 pap_ tickets, not stage a second 260928 set
    // (a fresh-date re-key would double-mint both sets at the fill pass).
    const calls: string[] = [];
    const spy = spyTickets(calls);
    const { deps } = makeDeps({
      tickets: spy.dep,
      now: () => new Date('2026-09-28T19:00:00.000Z'), // Monday → market date 260928
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
    const res = await handlePaperSignalOrder(request(), deps);

    const templates = SIGNAL_EXPRESSION_TEMPLATES[TradeSide.LONG];
    assert.equal(res.expressionTradeIds.length, templates.length);
    assert.ok(
      res.expressionTradeIds.every((id) => id.startsWith('260925-')),
      'member seeds carry the original accept date, not the retry date',
    );
    assert.ok(
      spy.emits.every((t) => t.idSeed.startsWith('260925-')),
      're-emitted tickets adopt the original seeds — no 260928 duplicates',
    );
    assert.ok(
      !spy.emits.some((t) => t.idSeed.includes('-2')),
      'no -2 duplicate staged members',
    );
  });

  it('a covered member whose trade id diverged from the seed is NOT re-staged', async () => {
    // Same-day id collision at accept → resolveTradeId suffixed this
    // member's trade id (-HHMM). Coverage by id-equality alone would see
    // the recomputed base seed as "uncovered" and stage a second position
    // for a template that already has a live member.
    const calls: string[] = [];
    const spy = spyTickets(calls);
    const templates = SIGNAL_EXPRESSION_TEMPLATES[TradeSide.LONG];
    const covered = signalTrade({
      id: '260925-sig-QQQM-CSP-030-45-1430',
      status: PaperTradeStatus.PENDING,
      cohortId: 'cohort-260925-QQQM-01',
      expression: templates[0].expression,
      expressionTemplate: templates[0],
    });
    const { deps } = makeDeps({
      tickets: spy.dep,
      listTradesBySignal: async () => [
        signalTrade({ id: '260925-sig-QQQM-EQ', cohortId: 'cohort-260925-QQQM-01' }),
        covered,
      ],
      getCohort: async () => ({
        kind: PaperTradingKind.COHORT,
        id: 'cohort-260925-QQQM-01',
        signalId: 'sig-1',
        symbol: 'QQQM',
        direction: TradeSide.LONG,
        acceptedAt: '2026-09-25T12:00:00Z',
        tradeIds: ['260925-sig-QQQM-EQ', covered.id],
        expressionTemplates: [templates[0].key],
        createdAt: '2026-09-25T12:00:00Z',
        updatedAt: '2026-09-25T12:00:00Z',
      }),
    });
    const res = await handlePaperSignalOrder(request(), deps);

    // emits = equity lifecycle + pending-member lifecycle + (N-1) staged
    // — the covered template's base seed must NOT be re-staged.
    const seeds = spy.emits.map((t) => t.idSeed);
    assert.ok(
      !seeds.includes('260925-sig-QQQM-CSP-030-45'),
      'template with a suffixed member must not re-stage its base seed',
    );
    assert.ok(
      seeds.includes(covered.id),
      'the pending member still gets its lifecycle ticket',
    );
    assert.equal(seeds.length, 1 + 1 + (templates.length - 1));
    // Response reports the real member id plus the still-staged seeds.
    assert.ok(res.expressionTradeIds.includes(covered.id));
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
