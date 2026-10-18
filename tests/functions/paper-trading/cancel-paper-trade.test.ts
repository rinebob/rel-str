/**
 * @topic #553 — Paper Trading Infra (task #666)
 *
 * cancelPaperTrade callable: cancels a PENDING paper trade before the
 * expression-fill pass resolves it. Guard ladder: auth → arg shape →
 * not-found → ownership → pending status; the ledger txn re-checks status
 * so a cancel racing the fill pass fails safe.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TradeSide } from '../../../shared/common';
import {
  PaperTradeSource,
  PaperTradeStatus,
  PaperTradingKind,
  type PaperTrade,
} from '../../../shared/paper-trading-contracts';
import type { StOrderTicket } from '../../../shared/st-order-tickets';
import {
  handleCancelPaperTrade,
  type CancelPaperTradeDeps,
} from '../../../functions/src/paper-trading/callables';

const NOW = new Date('2026-09-28T19:00:00.000Z');

function pendingTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: '260928-sig-QQQM-CSP-030-45',
    status: PaperTradeStatus.PENDING,
    userId: 'user1',
    source: PaperTradeSource.SIGNAL,
    symbol: 'QQQM',
    expression: 'CSP',
    governingVariant: 'trailing-8',
    order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
    fills: [],
    legs: [],
    marks: {},
    variantRuns: [
      { variantKey: 'trailing-8', governing: true, state: 'ACTIVE', workingState: {} },
    ],
    variantKeys: ['trailing-8'],
    realizedPnl: 0,
    unrealizedPnl: 0,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<CancelPaperTradeDeps> = {}) {
  const cancels: { userId: string; tradeId: string }[] = [];
  const deps: CancelPaperTradeDeps = {
    getTrade: overrides.getTrade ?? (async () => pendingTrade()),
    cancelPendingTrade: async (input) => {
      cancels.push({ userId: input.userId, tradeId: input.tradeId });
      return pendingTrade({ status: PaperTradeStatus.CANCELLED });
    },
    now: () => NOW,
    ...overrides,
  };
  return { deps, cancels };
}

const authed = { auth: { uid: 'user1' }, data: { tradeId: '260928-sig-QQQM-CSP-030-45' } };

async function expectHttpsError(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (err: unknown) => {
    assert.equal((err as { code?: string }).code, code);
    return true;
  });
}

describe('handleCancelPaperTrade', () => {
  it('cancels a PENDING trade for its owner', async () => {
    const { deps, cancels } = makeDeps();
    const res = await handleCancelPaperTrade(authed, deps);
    assert.equal(res.tradeId, '260928-sig-QQQM-CSP-030-45');
    assert.equal(cancels.length, 1);
    assert.equal(cancels[0].userId, 'user1');
  });

  it('requires auth', async () => {
    const { deps, cancels } = makeDeps();
    await expectHttpsError(
      handleCancelPaperTrade({ data: { tradeId: 'x' } }, deps),
      'unauthenticated',
    );
    assert.equal(cancels.length, 0);
  });

  it('validates tradeId', async () => {
    const { deps, cancels } = makeDeps();
    await expectHttpsError(
      handleCancelPaperTrade({ auth: { uid: 'u' }, data: {} }, deps),
      'invalid-argument',
    );
    assert.equal(cancels.length, 0);
  });

  it('not-found when the trade is missing', async () => {
    const { deps } = makeDeps({ getTrade: async () => null });
    await expectHttpsError(handleCancelPaperTrade(authed, deps), 'not-found');
  });

  it('permission-denied when the trade belongs to another user', async () => {
    const { deps } = makeDeps({
      getTrade: async () => pendingTrade({ userId: 'someone-else' }),
    });
    await expectHttpsError(handleCancelPaperTrade(authed, deps), 'permission-denied');
  });

  it('permission-denied when the trade has no owner (fail closed)', async () => {
    const { deps, cancels } = makeDeps({
      getTrade: async () => pendingTrade({ userId: undefined }),
    });
    await expectHttpsError(handleCancelPaperTrade(authed, deps), 'permission-denied');
    assert.equal(cancels.length, 0);
  });

  it('failed-precondition on non-PENDING trades (also the cancel-vs-fill race)', async () => {
    for (const status of [
      PaperTradeStatus.OPEN,
      PaperTradeStatus.CLOSED,
      PaperTradeStatus.CANCELLED,
      PaperTradeStatus.EXPIRED,
      PaperTradeStatus.ASSIGNED,
    ]) {
      const { deps, cancels } = makeDeps({
        getTrade: async () => pendingTrade({ status }),
      });
      await expectHttpsError(handleCancelPaperTrade(authed, deps), 'failed-precondition');
      assert.equal(cancels.length, 0);
    }
  });

  it('maps a ledger "not pending" rejection to failed-precondition (race)', async () => {
    const { deps } = makeDeps({
      cancelPendingTrade: async () => {
        throw new Error('paper trade t is not pending (status OPEN)');
      },
    });
    await expectHttpsError(handleCancelPaperTrade(authed, deps), 'failed-precondition');
  });
});

function stagedTicket(overrides: Partial<StOrderTicket> = {}): StOrderTicket {
  return {
    id: 'pap_260928-sig-QQQM-CSP-030-45',
    origin: { type: 'signal', signalId: 'sig-1' },
    auto: false,
    mode: 'paper',
    terms: { symbol: 'QQQM', side: 'sell', instrument: 'option', quantity: 1 },
    state: 'staged',
    refId: 'ref-1',
    accountTarget: 'acct-user1',
    userId: 'user1',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function spyTicketStore(
  byId: Map<string, StOrderTicket> = new Map(),
  markResult?: { applied: boolean; ticketId: string; to: 'cancelled'; from?: StOrderTicket['state'] },
) {
  const cancels: string[] = [];
  const gets: string[] = [];
  return {
    cancels,
    gets,
    dep: {
      get: async (id: string) => {
        gets.push(id);
        return byId.get(id) ?? null;
      },
      markCancelled: async (id: string) => {
        cancels.push(id);
        return markResult ?? { applied: true, ticketId: id, to: 'cancelled' as const };
      },
    },
  };
}

describe('handleCancelPaperTrade — st-order-tickets (#1002)', () => {
  it('marks the staged pap_ ticket cancelled after the ledger cancel', async () => {
    const spy = spyTicketStore();
    const { deps } = makeDeps({ tickets: spy.dep });
    await handleCancelPaperTrade(authed, deps);
    assert.deepEqual(spy.cancels, ['pap_260928-sig-QQQM-CSP-030-45']);
    assert.deepEqual(spy.gets, ['pap_260928-sig-QQQM-CSP-030-45'], 'ownership check reads the ticket');
  });

  it('leaves a FOREIGN staged ticket alone after the ledger cancel (shared seed)', async () => {
    // pap_{tradeId} squats on the same seed but belongs to another accept
    // — an expression ticket with a different refId and signalId.
    const foreign = stagedTicket({
      terms: {
        symbol: 'QQQM', side: 'sell', instrument: 'option', quantity: 1,
        expression: 'CSP',
      },
      refId: 'ref-OTHER',
      signalContext: { signalId: 'sig-OTHER' },
    });
    const spy = spyTicketStore(new Map([['pap_260928-sig-QQQM-CSP-030-45', foreign]]));
    const { deps } = makeDeps({
      tickets: spy.dep,
      getTrade: async () => pendingTrade({ ticket: { signalId: 'sig-1', refId: 'ref-1', acceptedAt: NOW.toISOString() } }),
    });
    await handleCancelPaperTrade(authed, deps);
    assert.equal(spy.cancels.length, 0, 'foreign staged ticket must not be cancelled');
  });

  it('still cancels an OWNED pap_ ticket after the ledger cancel (signalId match)', async () => {
    const own = stagedTicket({ refId: 'ref-RETRY', signalContext: { signalId: 'sig-9' } });
    const spy = spyTicketStore(new Map([['pap_260928-sig-QQQM-CSP-030-45', own]]));
    const { deps } = makeDeps({
      tickets: spy.dep,
      getTrade: async () => pendingTrade({ ticket: { signalId: 'sig-9', refId: 'ref-1', acceptedAt: NOW.toISOString() } }),
    });
    await handleCancelPaperTrade(authed, deps);
    assert.deepEqual(spy.cancels, ['pap_260928-sig-QQQM-CSP-030-45']);
  });

  it('does not touch the ticket when the ledger cancel fails', async () => {
    const spy = spyTicketStore();
    const { deps } = makeDeps({
      cancelPendingTrade: async () => {
        throw new Error('paper trade t is not pending (status OPEN)');
      },
      tickets: spy.dep,
    });
    await expectHttpsError(handleCancelPaperTrade(authed, deps), 'failed-precondition');
    assert.equal(spy.cancels.length, 0);
  });
});

describe('handleCancelPaperTrade — staged-ticket cancel (#1005)', () => {
  const SEED = '260928-sig-QQQM-CSP-030-45';

  it('cancels the staged pap_ ticket when no trade exists (the ticket IS the pending expression)', async () => {
    const spy = spyTicketStore(
      new Map([[`pap_${SEED}`, stagedTicket()]]),
    );
    const { deps, cancels } = makeDeps({
      getTrade: async () => null,
      tickets: spy.dep,
    });
    const res = await handleCancelPaperTrade(authed, deps);
    assert.equal(res.tradeId, SEED);
    assert.deepEqual(spy.gets, [`pap_${SEED}`]);
    assert.deepEqual(spy.cancels, [`pap_${SEED}`]);
    assert.equal(cancels.length, 0, 'no ledger write — there is no trade');
  });

  it('not-found when neither trade nor ticket exists', async () => {
    const spy = spyTicketStore();
    const { deps } = makeDeps({ getTrade: async () => null, tickets: spy.dep });
    await expectHttpsError(handleCancelPaperTrade(authed, deps), 'not-found');
    assert.equal(spy.cancels.length, 0);
  });

  it('permission-denied on a ticket owned by another user', async () => {
    const spy = spyTicketStore(
      new Map([[`pap_${SEED}`, stagedTicket({ userId: 'someone-else' })]]),
    );
    const { deps } = makeDeps({ getTrade: async () => null, tickets: spy.dep });
    await expectHttpsError(handleCancelPaperTrade(authed, deps), 'permission-denied');
    assert.equal(spy.cancels.length, 0);
  });

  it('failed-precondition on non-staged tickets (filled/failed/cancelled)', async () => {
    for (const state of ['filled', 'cancelled', 'failed', 'expired'] as const) {
      const spy = spyTicketStore(
        new Map([[`pap_${SEED}`, stagedTicket({ state })]]),
      );
      const { deps } = makeDeps({ getTrade: async () => null, tickets: spy.dep });
      await expectHttpsError(handleCancelPaperTrade(authed, deps), 'failed-precondition');
      assert.equal(spy.cancels.length, 0);
    }
  });

  it('failed-precondition when the staged ticket already owns a minted trade', async () => {
    // Mint committed + group join failed → ticket stayed staged while the
    // OPEN trade is real. Cancelling would strand a live position with a
    // cancelled provenance ticket and no heal path.
    const minted = pendingTrade({
      id: 'QQQM-260928-sig-CSP-261106-580-01',
      status: PaperTradeStatus.OPEN,
    });
    const spy = spyTicketStore(new Map([[`pap_${SEED}`, stagedTicket()]]));
    const { deps } = makeDeps({
      getTrade: async () => null,
      tickets: spy.dep,
      listTradesByTicketId: async (id) => (id === `pap_${SEED}` ? [minted] : []),
    });
    await expectHttpsError(handleCancelPaperTrade(authed, deps), 'failed-precondition');
    assert.equal(spy.cancels.length, 0, 'must not strand a minted position');
  });

  it('cancels the ticket when its stamped trade already settled CANCELLED', async () => {
    // Dead member — the ticket cancel IS the correct heal, not a stranded
    // position. Only live stamped trades block.
    const dead = pendingTrade({
      id: 'QQQM-260928-sig-CSP-261106-580-01',
      status: PaperTradeStatus.CANCELLED,
    });
    const spy = spyTicketStore(new Map([[`pap_${SEED}`, stagedTicket()]]));
    const { deps } = makeDeps({
      getTrade: async () => null,
      tickets: spy.dep,
      listTradesByTicketId: async (id) => (id === `pap_${SEED}` ? [dead] : []),
    });
    const res = await handleCancelPaperTrade(authed, deps);
    assert.equal(res.tradeId, SEED);
    assert.deepEqual(spy.cancels, [`pap_${SEED}`]);
  });

  it('failed-precondition when the ticket raced to another state before the txn', async () => {
    const spy = spyTicketStore(
      new Map([[`pap_${SEED}`, stagedTicket()]]),
      { applied: false, ticketId: `pap_${SEED}`, to: 'cancelled', from: 'filled' },
    );
    const { deps } = makeDeps({ getTrade: async () => null, tickets: spy.dep });
    await expectHttpsError(handleCancelPaperTrade(authed, deps), 'failed-precondition');
  });
});
