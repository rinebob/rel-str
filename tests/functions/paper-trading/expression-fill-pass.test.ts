/**
 * @topic #553 — Paper Trading Infra (task #564)
 * @topic #984 — ST Firestore Reorg (task #1005)
 *
 * expression-fill-pass: for each pending expression — RH option
 * chains → instruments → batched quotes → delta/DTE contract selection →
 * fill → OPEN. Sources (#1005):
 *  - staged pap_* tickets (terms.expressionTemplate) → MINT a canonical
 *    {SYM}-{YYMMDD}-{origin}-{expr}-{exp}-{strike}-{NN} trade via
 *    applyEntryFill, then mark the ticket filled;
 *  - legacy PENDING trades → applyPendingFill in place (drain path);
 *  - a staged ticket whose seed still has a PENDING trade → filled in
 *    place, not re-minted.
 * No broker mutation calls on this path.
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
import type { StOrderTicket } from '../../../shared/st-order-tickets';
import {
  runExpressionFillPass,
  type ExpressionFillPassDeps,
} from '../../../functions/src/paper-trading/passes/expression-fill-pass';
import type { EntryFillInput, PendingFillInput } from '../../../functions/src/paper-trading/ledger';

const MARKET_DATE = '2026-09-25';
const NOW = new Date('2026-09-25T19:00:00.000Z');
const SEED = '260925-sig-QQQM-CSP-030-45';
const TICKET_ID = `pap_${SEED}`;

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

function stagedTicket(overrides: Partial<StOrderTicket> = {}): StOrderTicket {
  return {
    id: TICKET_ID,
    origin: {
      type: 'signal',
      signalId: 'QQQM_2026-09-25_D_SIG',
      positionGroupId: 'QQQM-260925-grp-01',
    },
    auto: false,
    mode: 'paper',
    terms: {
      symbol: 'QQQM',
      side: 'sell',
      instrument: 'option',
      quantity: 1,
      expression: 'CSP',
      expressionTemplate: CSP_TEMPLATE,
    },
    state: 'staged',
    refId: 'ref-1',
    accountTarget: 'acct-user1',
    userId: 'user1',
    cohortId: 'cohort-260925-QQQM-01',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function pendingTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: SEED,
    status: PaperTradeStatus.PENDING,
    userId: 'user1',
    source: PaperTradeSource.SIGNAL,
    symbol: 'QQQM',
    expression: 'CSP',
    governingVariant: 'none',
    expressionTemplate: CSP_TEMPLATE,
    order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
    // Pre-#1005 pendings carry the caller refId — the fill pass pairs a
    // staged ticket with its seed trade on refId equality.
    ticket: { signalId: 'QQQM_2026-09-25_D_SIG', refId: 'ref-1', acceptedAt: NOW.toISOString() },
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
  const pendingFills: PendingFillInput[] = [];
  const entryFills: EntryFillInput[] = [];
  const ticketFills: string[] = [];
  const ticketCancels: string[] = [];
  const ticketErrors: { ticketId: string; category: string }[] = [];
  const memberAdds: { groupId: string; tradeIds?: string[] }[] = [];

  const deps: ExpressionFillPassDeps = {
    listStagedExpressionTickets:
      overrides.listStagedExpressionTickets ?? (async () => [stagedTicket()]),
    listPendingTrades: overrides.listPendingTrades ?? (async () => []),
    getTrade: overrides.getTrade ?? (async () => null),
    listTradesByTicketId: overrides.listTradesByTicketId ?? (async () => []),
    listTradeDocIdsByPrefix: overrides.listTradeDocIdsByPrefix ?? (async () => []),
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
      pendingFills.push(input);
      return { trade: pendingTrade({ status: PaperTradeStatus.OPEN }) };
    },
    applyEntryFill: async (input) => {
      entryFills.push(input);
      return {};
    },
    getTicket: overrides.getTicket ?? (async (ticketId) => ({
      ...stagedTicket(),
      id: ticketId,
    })),
    recordTicketError: async (ticketId, error) => {
      ticketErrors.push({ ticketId, category: error.category });
    },
    markTicketFilled: async (ticketId) => {
      ticketFills.push(ticketId);
    },
    markTicketCancelled: async (ticketId) => {
      ticketCancels.push(ticketId);
    },
    groups: {
      addMembers: async (groupId, members) => {
        memberAdds.push({ groupId, tradeIds: members.tradeIds });
        return true;
      },
    },
    now: () => NOW,
    ...overrides,
  };
  return { deps, calls, pendingFills, entryFills, ticketFills, ticketCancels, ticketErrors, memberAdds };
}

describe('runExpressionFillPass — staged tickets (#1005)', () => {
  it('mints a canonical contract-bearing trade, joins the group, fills the ticket', async () => {
    const { deps, entryFills, ticketFills, memberAdds } = makeDeps();
    const summary = await runExpressionFillPass(MARKET_DATE, deps);

    assert.equal(summary.filled, 1);
    assert.equal(summary.errors.length, 0);
    assert.equal(entryFills.length, 1);

    const entry = entryFills[0];
    // QQQM-260925-sig-CSP-261106-580-01 — contract stamped into the id
    assert.equal(entry.tradeId, 'QQQM-260925-sig-CSP-261106-580-01');
    assert.equal(entry.userId, 'user1');
    assert.equal(entry.order.side, TradeSide.SHORT);
    const leg = entry.legs[0];
    if (leg.kind === 'option') {
      assert.equal(leg.contractID, 'QQQM261106P00580000');
      assert.equal(leg.strike, 580);
      assert.equal(leg.expiration, '2026-11-06');
    }
    assert.equal(entry.fill.price, 2.8);
    // lineage dims from the ticket
    assert.equal(entry.dims.source, PaperTradeSource.SIGNAL);
    assert.equal(entry.dims.expression, 'CSP');
    assert.equal(entry.dims.cohortId, 'cohort-260925-QQQM-01');
    assert.equal(entry.dims.positionGroupId, 'QQQM-260925-grp-01');
    assert.equal(entry.dims.signalId, 'QQQM_2026-09-25_D_SIG');
    assert.equal(entry.dims.ticket?.ticketId, TICKET_ID);
    assert.equal(entry.dims.ticket?.refId, 'ref-1');
    // resolved contract denormalized onto the trade
    assert.equal(entry.tradeOverrides?.strike, 580);
    assert.equal(entry.tradeOverrides?.expiration, '2026-11-06');
    assert.equal(entry.tradeOverrides?.optionType, OptionType.PUT);

    // group join + ticket closeout
    assert.deepEqual(memberAdds, [
      { groupId: 'QQQM-260925-grp-01', tradeIds: [entry.tradeId] },
    ]);
    assert.deepEqual(ticketFills, [TICKET_ID]);
  });

  it('allocates the next seq from existing doc ids under the prefix', async () => {
    const { deps, entryFills } = makeDeps({
      listTradeDocIdsByPrefix: async (prefix) => {
        assert.equal(prefix, 'QQQM-260925-sig-CSP-261106-580-');
        return [
          'QQQM-260925-sig-CSP-261106-580-01',
          'QQQM-260925-sig-CSP-261106-580-07',
        ];
      },
    });
    await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(entryFills[0].tradeId, 'QQQM-260925-sig-CSP-261106-580-08');
  });

  it('re-scans the seq once when applyEntryFill reports a lost race', async () => {
    let scan = 0;
    const { deps, entryFills } = makeDeps({
      listTradeDocIdsByPrefix: async () => (scan++ === 0 ? [] : ['QQQM-260925-sig-CSP-261106-580-01']),
      applyEntryFill: async (input) => {
        if (scan === 1) throw new Error('paper trade QQQM-...-01 already exists');
        entryFills.push(input);
        return {};
      },
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.filled, 1);
    assert.equal(entryFills.length, 1);
    assert.equal(entryFills[0].tradeId, 'QQQM-260925-sig-CSP-261106-580-02');
  });

  it('a lost mint race to OUR OWN ticketId heals — never mints a second trade', async () => {
    // Concurrent passes: both saw the staged ticket, the other won the
    // seq. The loser's applyEntryFill throws, the winner's doc carries our
    // ticketId — heal the ticket, don't mint -02 as a duplicate position.
    const winner = pendingTrade({
      id: 'QQQM-260925-sig-CSP-261106-580-01',
      status: PaperTradeStatus.OPEN,
      fills: [{ fillId: 'f', role: 'entry', date: MARKET_DATE, price: 2.8, quantity: 1 }],
    });
    let stampedLookups = 0;
    const { deps, entryFills, ticketFills } = makeDeps({
      listTradesByTicketId: async () => (stampedLookups++ === 0 ? [] : [winner]),
      applyEntryFill: async () => {
        throw new Error('paper trade QQQM-260925-sig-CSP-261106-580-01 already exists');
      },
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.filled, 1);
    assert.equal(entryFills.length, 0, 'no second trade minted');
    assert.deepEqual(ticketFills, [TICKET_ID]);
  });

  it('a lost mint race to a FOREIGN ticket re-scans and mints the next seq', async () => {
    let scan = 0;
    const { deps, entryFills } = makeDeps({
      // First scan missed the concurrently-committed -01; the rescan sees it.
      listTradeDocIdsByPrefix: async () =>
        scan++ === 0 ? [] : ['QQQM-260925-sig-CSP-261106-580-01'],
      applyEntryFill: async (input) => {
        if (input.tradeId.endsWith('-01')) {
          throw new Error(`paper trade ${input.tradeId} already exists`);
        }
        entryFills.push(input);
        return {};
      },
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.filled, 1);
    assert.equal(entryFills[0].tradeId, 'QQQM-260925-sig-CSP-261106-580-02');
  });

  it('a winner committing between the dedupe and the seq scan is healed by the in-loop recheck', async () => {
    // Concurrent passes: both listed the ticket, the winner minted while we
    // were in contract selection. The first ticketId query missed it; the
    // in-loop recheck (after the slow MCP calls) must catch it — otherwise
    // the seq scan would mint a sibling.
    const winner = pendingTrade({
      id: 'QQQM-260925-sig-CSP-261106-580-01',
      status: PaperTradeStatus.OPEN,
      fills: [{ fillId: 'f', role: 'entry', date: MARKET_DATE, price: 2.8, quantity: 1 }],
    });
    let stampedLookups = 0;
    const { deps, entryFills, ticketFills, memberAdds } = makeDeps({
      listTradesByTicketId: async () => (stampedLookups++ === 0 ? [] : [winner]),
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.filled, 1);
    assert.equal(stampedLookups, 2, 'dedupe re-ran inside the mint loop');
    assert.equal(entryFills.length, 0, 'no second trade minted');
    assert.deepEqual(ticketFills, [TICKET_ID]);
    assert.deepEqual(memberAdds, [
      { groupId: 'QQQM-260925-grp-01', tradeIds: [winner.id] },
    ]);
  });

  it('a post-mint stamped sibling is detected — ticket still heals to filled', async () => {
    // The narrow residual window: a winner commits between our in-loop
    // recheck and our write at a DIFFERENT seq, so no ALREADY_EXISTS. Our
    // mint succeeds; the post-mint check must see the stamped sibling
    // rather than silently leaving two OPEN trades for one ticket.
    const mintedId = 'QQQM-260925-sig-CSP-261106-580-01';
    const sibling = pendingTrade({
      id: 'QQQM-260925-sig-CSP-261106-580-02',
      status: PaperTradeStatus.OPEN,
    });
    let stampedLookups = 0;
    const { deps, entryFills, ticketFills } = makeDeps({
      listTradesByTicketId: async () => {
        stampedLookups += 1;
        // Pre-mint queries (dedupe + in-loop recheck) see nothing; the
        // post-mint check sees both stamped docs.
        return stampedLookups <= 2 ? [] : [
          pendingTrade({ id: mintedId, status: PaperTradeStatus.OPEN }),
          sibling,
        ];
      },
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(entryFills.length, 1);
    assert.equal(entryFills[0].tradeId, mintedId);
    assert.equal(summary.filled, 1);
    assert.deepEqual(ticketFills, [TICKET_ID]);
  });

  it('heals a ticket whose trade was already minted (markFilled failed last pass)', async () => {
    const minted = pendingTrade({
      id: 'QQQM-260925-sig-CSP-261106-580-01',
      status: PaperTradeStatus.OPEN,
      fills: [
        { fillId: 'f', role: 'entry', date: MARKET_DATE, price: 2.8, quantity: 1 },
      ],
    });
    const { deps, entryFills, ticketFills, calls } = makeDeps({
      listTradesByTicketId: async () => [minted],
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.filled, 1);
    assert.equal(entryFills.length, 0, 'no second mint');
    assert.deepEqual(ticketFills, [TICKET_ID]);
    assert.equal(calls.length, 0, 'heal needs no market data');
  });

  it('fills a legacy PENDING trade in place when the seed doc still exists', async () => {
    const legacy = pendingTrade();
    const { deps, pendingFills, entryFills, ticketFills } = makeDeps({
      getTrade: async (id) => (id === SEED ? legacy : null),
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.filled, 1);
    assert.equal(entryFills.length, 0, 'in-place fill — no mint');
    assert.equal(pendingFills.length, 1);
    assert.equal(pendingFills[0].tradeId, SEED);
    assert.equal(pendingFills[0].tradeOverrides?.strike, 580);
    assert.deepEqual(ticketFills, [TICKET_ID]);
  });

  it('heals the ticket when the seed trade is already past PENDING', async () => {
    const { deps, pendingFills, entryFills, ticketFills, calls } = makeDeps({
      getTrade: async (id) =>
        id === SEED
          ? pendingTrade({
              status: PaperTradeStatus.OPEN,
              fills: [{ fillId: 'f', role: 'entry', date: MARKET_DATE, price: 2.8, quantity: 1 }],
            })
          : null,
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.filled, 1);
    assert.equal(pendingFills.length + entryFills.length, 0);
    assert.deepEqual(ticketFills, [TICKET_ID]);
    assert.equal(calls.length, 0);
  });

  it('cancels the ticket when its owned seed trade settled CANCELLED', async () => {
    const { deps, pendingFills, entryFills, ticketFills, ticketCancels, calls } = makeDeps({
      getTrade: async (id) =>
        id === SEED ? pendingTrade({ status: PaperTradeStatus.CANCELLED }) : null,
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.skipped, 1, 'ticket consumed — not reprocessed, but not a fill');
    assert.equal(pendingFills.length + entryFills.length, 0);
    assert.deepEqual(ticketFills, [], 'a cancelled member must not heal to filled');
    assert.deepEqual(ticketCancels, [TICKET_ID]);
    assert.equal(calls.length, 0, 'no market data needed');
  });

  it('mints — does not adopt — when the seed trade belongs to a foreign refId', async () => {
    const foreign = pendingTrade({
      ticket: { signalId: 's', refId: 'ref-OTHER', acceptedAt: NOW.toISOString() },
    });
    const { deps, pendingFills, entryFills, ticketFills } = makeDeps({
      getTrade: async (id) => (id === SEED ? foreign : null),
      // the foreign pending also drains through the pending list — both
      // members are consumed independently, neither steals the other
      listPendingTrades: async () => [foreign],
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.filled, 2);
    assert.equal(pendingFills.length, 1, 'foreign pending drains in place');
    assert.equal(pendingFills[0].tradeId, SEED);
    assert.equal(entryFills.length, 1, 'staged ticket mints its own trade');
    assert.deepEqual(ticketFills, [TICKET_ID]);
  });

  it('a same-signal ticket owns the pending seed even with a different refId (cross-refId retry)', async () => {
    // Client retry under a fresh refId emitted the lifecycle ticket; the
    // pre-#1005 pending carries the original refId — signalId equality is
    // the same logical accept, so the ticket fills it in place.
    const legacy = pendingTrade({ signalId: 'sig-1' });
    const { deps, pendingFills, entryFills, ticketFills } = makeDeps({
      listStagedExpressionTickets: async () => [
        stagedTicket({ refId: 'ref-2', signalContext: { signalId: 'sig-1' } }),
      ],
      getTrade: async (id) => (id === SEED ? legacy : null),
      listPendingTrades: async () => [legacy],
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.filled, 1, 'one item — no double fill');
    assert.equal(entryFills.length, 0, 'no minted duplicate');
    assert.equal(pendingFills.length, 1, 'pending filled in place');
    assert.equal(pendingFills[0].tradeId, SEED);
    assert.deepEqual(ticketFills, [TICKET_ID]);
  });

  it('stamps dims.signalId from signalContext.signalId over the canonical occurrence id', async () => {
    const { deps, entryFills } = makeDeps({
      listStagedExpressionTickets: async () => [
        stagedTicket({ signalContext: { signalId: 'legacy-sig-99' } }),
      ],
    });
    await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(entryFills[0].dims.signalId, 'legacy-sig-99');
    assert.equal(entryFills[0].dims.ticket?.signalId, 'legacy-sig-99');
  });

  it('skips a staged ticket with no selectable contract (ticket stays staged)', async () => {
    const { deps, entryFills, ticketFills, ticketErrors } = makeDeps({
      callTool: async (name) => {
        if (name.endsWith('get_option_chains')) return CHAIN;
        if (name.endsWith('get_option_instruments')) return { data: { instruments: [] } };
        throw new Error(`unexpected tool ${name}`);
      },
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.skipped, 1);
    assert.equal(entryFills.length, 0);
    assert.equal(ticketFills.length, 0);
    // TEST-BE: the skip is recorded on the ticket — it stays staged for
    // the next pass but carries why.
    assert.deepEqual(ticketErrors, [{ ticketId: TICKET_ID, category: 'no_contract' }]);
  });

  it('honors a cancel that landed after the staged list — no mint, no fill stamp', async () => {
    // The staged list is a snapshot; the state is re-read before the
    // ledger write so a mid-pass cancel wins (no zombie OPEN trade).
    const { deps, entryFills, pendingFills, ticketFills } = makeDeps({
      getTicket: async () => stagedTicket({ state: 'cancelled' }),
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.skipped, 1);
    assert.equal(entryFills.length, 0, 'no trade minted for a cancelled ticket');
    assert.equal(pendingFills.length, 0);
    assert.equal(ticketFills.length, 0, 'markFilled must not flip cancelled → filled');
  });

  it('leaves the ticket staged when the group join fails after mint', async () => {
    const joins: string[] = [];
    const { deps, entryFills, ticketFills } = makeDeps({
      groups: {
        addMembers: async (groupId) => {
          joins.push(groupId);
          return false;
        },
      },
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.skipped, 1);
    assert.equal(entryFills.length, 1, 'trade minted');
    assert.deepEqual(joins, ['QQQM-260925-grp-01'], 'join attempted');
    assert.equal(ticketFills.length, 0, 'ticket stays staged so the next pass replays the join');
  });

  it('heal replays a failed group join — skipped when it fails again', async () => {
    // A minted trade already stamped with the ticket id whose group join
    // failed last pass: heal retries the join and defers the fill stamp.
    const minted = pendingTrade({
      status: PaperTradeStatus.OPEN,
      positionGroupId: 'QQQM-260925-grp-01',
      ticket: {
        signalId: 'QQQM_2026-09-25_D_SIG',
        refId: 'ref-1',
        acceptedAt: NOW.toISOString(),
        ticketId: TICKET_ID,
      },
      fills: [{ fillId: 'e1', role: 'entry', date: MARKET_DATE, price: 2.8, quantity: 1, quoteSource: OptionQuoteSource.RH_MCP }],
    });
    const joins: string[] = [];
    const { deps, entryFills, ticketFills } = makeDeps({
      listTradesByTicketId: async (id) => (id === TICKET_ID ? [minted] : []),
      groups: {
        addMembers: async (groupId) => {
          joins.push(groupId);
          return false;
        },
      },
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.skipped, 1);
    assert.equal(entryFills.length, 0, 'no second mint');
    assert.deepEqual(joins, ['QQQM-260925-grp-01'], 'join replayed');
    assert.equal(ticketFills.length, 0, 'ticket stays staged for the next retry');
  });
});

describe('runExpressionFillPass — legacy PENDING drain', () => {
  it('fills a ticket-less pending trade: chains → instruments → quotes → select → applyPendingFill', async () => {
    const { deps, calls, pendingFills } = makeDeps({
      listStagedExpressionTickets: async () => [],
      listPendingTrades: async () => [pendingTrade()],
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);

    assert.equal(summary.filled, 1);
    assert.equal(summary.errors.length, 0);
    assert.equal(pendingFills.length, 1);

    const fill = pendingFills[0];
    assert.equal(fill.userId, 'user1');
    assert.equal(fill.tradeId, SEED);
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
    assert.equal(fill.tradeOverrides?.strike, 580);
    // no mutation tools
    for (const c of calls) assert.ok(!/place_|review_/.test(c.name));
  });

  it('a pending trade whose pap_ ticket is staged is owned by the ticket path', async () => {
    const { deps, pendingFills, entryFills } = makeDeps({
      // staged ticket AND a PENDING trade at the seed — ticket path wins
      getTrade: async (id) => (id === SEED ? pendingTrade() : null),
      listPendingTrades: async () => [pendingTrade()],
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.filled, 1, 'one item total — not double-counted');
    assert.equal(pendingFills.length, 1, 'in-place fill via the ticket path');
    assert.equal(entryFills.length, 0);
  });

  it('only queries instruments for expirations inside the template DTE band', async () => {
    const { deps, calls } = makeDeps({
      listStagedExpressionTickets: async () => [],
      listPendingTrades: async () => [pendingTrade()],
    });
    await runExpressionFillPass(MARKET_DATE, deps);

    const instrumentCalls = calls.filter((c) => c.name.endsWith('get_option_instruments'));
    assert.equal(instrumentCalls.length, 1);
    const args = instrumentCalls[0].args;
    assert.equal(args.chain_symbol, 'QQQM');
    assert.equal(args.expiration_dates, '2026-11-06');
    assert.equal(args.type, 'put');

    const quoteCalls = calls.filter((c) => c.name.endsWith('get_option_quotes'));
    assert.equal(quoteCalls.length, 1);
    assert.deepEqual(
      (quoteCalls[0].args.instrument_ids as string[]).sort(),
      ['inst-560p', 'inst-570p', 'inst-580p'],
    );
  });

  it('errors a pending trade with no template', async () => {
    const { deps, pendingFills } = makeDeps({
      listStagedExpressionTickets: async () => [],
      listPendingTrades: async () => [pendingTrade({ expressionTemplate: undefined })],
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.filled, 0);
    assert.equal(pendingFills.length, 0);
    assert.equal(summary.errors.length, 1);
    assert.match(summary.errors[0].error, /template/i);
  });

  it('skips when no expiration falls inside the DTE band', async () => {
    const chainOut = {
      data: {
        chains: [{ id: 'c', symbol: 'QQQM', expiration_dates: ['2026-10-01', '2027-06-01'] }],
      },
    };
    const { deps, pendingFills } = makeDeps({
      listStagedExpressionTickets: async () => [],
      listPendingTrades: async () => [pendingTrade()],
      callTool: async (name) => {
        if (name.endsWith('get_option_chains')) return chainOut;
        throw new Error(`unexpected tool ${name}`);
      },
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.filled, 0);
    assert.equal(pendingFills.length, 0);
    assert.equal(summary.skipped, 1);
  });

  it('is idempotent — nothing staged, nothing pending', async () => {
    const { deps, pendingFills, entryFills } = makeDeps({
      listStagedExpressionTickets: async () => [],
      listPendingTrades: async () => [],
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.filled, 0);
    assert.equal(pendingFills.length + entryFills.length, 0);
  });

  it('classifies a cancel-during-fill rejection as skipped, not an error (#666)', async () => {
    const { deps } = makeDeps({
      listStagedExpressionTickets: async () => [],
      listPendingTrades: async () => [pendingTrade()],
      applyPendingFill: async () => {
        throw new Error(`paper trade ${SEED} is not pending (status CANCELLED)`);
      },
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.filled, 0);
    assert.equal(summary.skipped, 1);
    assert.equal(summary.errors.length, 0, 'a legitimate cancel is not a pass failure');
  });

  it('reports a per-item error without aborting the pass', async () => {
    const { deps, pendingFills } = makeDeps({
      listStagedExpressionTickets: async () => [],
      listPendingTrades: async () => [
        pendingTrade({ id: 'bad-trade', userId: undefined }),
        pendingTrade(),
      ],
    });
    const summary = await runExpressionFillPass(MARKET_DATE, deps);
    assert.equal(summary.filled, 1);
    assert.equal(summary.errors.length, 1);
    assert.equal(summary.errors[0].id, 'bad-trade');
    assert.equal(pendingFills.length, 1);
  });
});
