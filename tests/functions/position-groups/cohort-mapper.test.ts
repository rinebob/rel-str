/**
 * @topic #984 — ST Firestore Reorg (task #1004)
 *
 * cohortToGroup — pure mapper from the legacy `paper-trading/cohorts/items`
 * doc to the canonical `st-position-groups` doc. The cohort's own fields
 * only carry part of the group — userId, lifecycle rollups, canonical
 * signal lineage, and member ticket ids come from the joined member trades
 * and st-order-tickets (extras the caller supplies).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cohortToGroup,
  parseCohortId,
} from '../../../functions/src/position-groups/legacy-cohorts';
import { TradeSide } from '../../../shared/common';
import {
  PaperTradingKind,
  PaperTradeSource,
  PaperTradeStatus,
  type PaperCohort,
  type PaperTrade,
} from '../../../shared/paper-trading-contracts';

const COHORT: PaperCohort = {
  kind: PaperTradingKind.COHORT,
  id: 'cohort-260927-ADPT-01',
  signalId: '2026-09-15_tue_140444_nightly-ADPT-D-D_ST_TREND_RIDER_V2_LONG',
  symbol: 'ADPT',
  direction: TradeSide.LONG,
  acceptedAt: '2026-09-28T06:00:45.594Z',
  tradeIds: ['260927-sig-ADPT-EQ', '260927-sig-ADPT-CSP-030-45'],
  expressionTemplates: ['csp-030-45'],
  createdAt: '2026-09-28T06:00:45.594Z',
  updatedAt: '2026-09-28T06:00:45.594Z',
};

function trade(overrides: Partial<PaperTrade>): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: 'x',
    status: PaperTradeStatus.OPEN,
    source: PaperTradeSource.SIGNAL,
    symbol: 'ADPT',
    expression: 'EQ',
    governingVariant: 'none',
    order: { side: TradeSide.LONG, type: 'MARKET', quantity: 1 },
    fills: [],
    legs: [],
    marks: {},
    variantRuns: [],
    variantKeys: [],
    realizedPnl: 0,
    unrealizedPnl: 0,
    userId: 'u-owner',
    createdAt: 'x',
    updatedAt: 'x',
    ...overrides,
  };
}

describe('parseCohortId', () => {
  it('parses cohort-YYMMDD-SYM-NN', () => {
    assert.deepEqual(parseCohortId('cohort-260927-ADPT-01'), {
      date: '260927',
      symbol: 'ADPT',
      seq: 1,
    });
  });

  it('returns null on malformed ids', () => {
    assert.equal(parseCohortId('not-a-cohort'), null);
    assert.equal(parseCohortId('cohort-ADPT-01'), null);
  });
});

describe('cohortToGroup', () => {
  it('maps the cohort to {SYM}-{YYMMDD}-grp-{NN} with memberTradeIds carried', () => {
    const g = cohortToGroup(COHORT, {
      userId: 'u-owner',
      originSignalId: 'ADPT_2026-09-15_D_ST_TREND_RIDER_V2_LONG',
      memberTicketIds: ['pap_intent-1'],
      memberTrades: [trade({ status: PaperTradeStatus.OPEN }), trade({ status: PaperTradeStatus.PENDING })],
      now: '2026-10-20T00:00:00.000Z',
    });
    assert.ok(g);
    assert.equal(g!.id, 'ADPT-260927-grp-01');
    assert.equal(g!.mode, 'paper');
    assert.equal(g!.userId, 'u-owner');
    assert.deepEqual(g!.origin, {
      type: 'signal',
      signalId: 'ADPT_2026-09-15_D_ST_TREND_RIDER_V2_LONG',
    });
    assert.deepEqual(g!.memberTradeIds, COHORT.tradeIds);
    assert.deepEqual(g!.memberTicketIds, ['pap_intent-1']);
    assert.deepEqual(g!.brokerOrderIds, []);
    assert.equal(g!.createdAt, COHORT.acceptedAt);
    assert.equal(g!.updatedAt, '2026-10-20T00:00:00.000Z');
  });

  it('derives status/rollups from member trade lifecycle', () => {
    const g = cohortToGroup(COHORT, {
      userId: 'u',
      memberTicketIds: [],
      memberTrades: [
        trade({ status: PaperTradeStatus.OPEN }),
        trade({ status: PaperTradeStatus.PENDING }),
        trade({ status: PaperTradeStatus.CLOSED }),
      ],
      now: 'x',
    });
    assert.equal(g!.status, 'open');
    assert.deepEqual(g!.rollups, { openCount: 2, closedCount: 1 });
  });

  it('marks the group closed when every member trade is terminal', () => {
    const g = cohortToGroup(COHORT, {
      userId: 'u',
      memberTicketIds: [],
      memberTrades: [
        trade({ status: PaperTradeStatus.CLOSED }),
        trade({ status: PaperTradeStatus.CANCELLED }),
      ],
      now: 'x',
    });
    assert.equal(g!.status, 'closed');
    assert.deepEqual(g!.rollups, { openCount: 0, closedCount: 2 });
  });

  it('omits origin.signalId when no canonical occurrence id is resolvable', () => {
    const g = cohortToGroup(COHORT, {
      userId: 'u',
      memberTicketIds: [],
      memberTrades: [trade({})],
      now: 'x',
    });
    assert.deepEqual(g!.origin, { type: 'signal' });
  });

  it('returns null when no userId is resolvable from member trades', () => {
    const g = cohortToGroup(COHORT, {
      userId: undefined,
      memberTicketIds: [],
      memberTrades: [trade({ userId: undefined })],
      now: 'x',
    });
    assert.equal(g, null);
  });
});
