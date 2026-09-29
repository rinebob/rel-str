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
