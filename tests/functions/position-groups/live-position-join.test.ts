/**
 * @topic #984 — ST Firestore Reorg (task #1004)
 *
 * Pure live-position join for st-position-groups: which RH positions belong
 * to a group. Equity holdings join through `tax_lots[].order_id` matching a
 * member ticket's `brokerOrderId`; option positions join through
 * `option_id`/`chain_id` matching a member ticket's leg identity.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  joinLivePositions,
  collectGroupMembership,
  type LiveJoinMembership,
} from '../../../functions/src/position-groups/live-position-join';

describe('joinLivePositions — equity via tax_lots.order_id', () => {
  const membership: LiveJoinMembership = {
    brokerOrderIds: ['ord-1', 'ord-2'],
    optionLegIds: [],
  };

  it('matches tax lots whose order_id is a member broker order', () => {
    const lots = [
      { order_id: 'ord-1', quantity: '10' },
      { order_id: 'ord-3', quantity: '5' },     // unrelated lot — other order
      { order_id: 'ord-2', quantity: '2' },
    ];
    const res = joinLivePositions(membership, lots, []);
    assert.deepEqual(res.taxLots, [lots[0], lots[2]]);
    assert.deepEqual(res.unmatchedBrokerOrderIds, []);
  });

  it('reports member orders with no matching lot (sold/expired or still open)', () => {
    const res = joinLivePositions(membership, [{ order_id: 'ord-1' }], []);
    assert.equal(res.taxLots.length, 1);
    assert.deepEqual(res.unmatchedBrokerOrderIds, ['ord-2']);
  });

  it('ignores lots missing order_id', () => {
    const res = joinLivePositions(membership, [{ quantity: '3' }], []);
    assert.equal(res.taxLots.length, 0);
    assert.deepEqual(res.unmatchedBrokerOrderIds, ['ord-1', 'ord-2']);
  });
});

describe('joinLivePositions — options via option_id / chain_id', () => {
  it('matches positions by option_id or chain_id against member leg ids', () => {
    const membership: LiveJoinMembership = {
      brokerOrderIds: [],
      optionLegIds: ['opt-uuid-1', 'chain-9'],
    };
    const positions = [
      { option_id: 'opt-uuid-1', chain_id: 'chain-9', quantity: '1' }, // hits both
      { option_id: 'opt-uuid-2', chain_id: 'chain-8' },                // miss
      { option_id: 'opt-x', chain_id: 'chain-9' },                     // chain hit
    ];
    const res = joinLivePositions(membership, [], positions);
    assert.deepEqual(res.optionPositions, [positions[0], positions[2]]);
  });

  it('keeps full payload types intact through the join', () => {
    const pos = { option_id: 'o1', symbol: 'QQQM $600 Call', nested: { a: 1 } };
    const res = joinLivePositions(
      { brokerOrderIds: [], optionLegIds: ['o1'] },
      [],
      [pos],
    );
    assert.equal(res.optionPositions[0], pos);
  });
});

describe('collectGroupMembership', () => {
  it('gathers brokerOrderIds + leg optionIds across member tickets', () => {
    const tickets: Parameters<typeof collectGroupMembership>[0] = [
      {
        brokerOrderId: 'ord-1',
        terms: { symbol: 'QQQM', side: 'buy', legs: [{ optionId: 'opt-1' }] },
      },
      { brokerOrderId: 'ord-2', terms: { symbol: 'QQQM', side: 'sell' } },
      { terms: { symbol: 'QQQM', side: 'buy', legs: [{ optionId: 'opt-2' }] } },
    ];
    assert.deepEqual(collectGroupMembership(tickets), {
      brokerOrderIds: ['ord-1', 'ord-2'],
      optionLegIds: ['opt-1', 'opt-2'],
    });
  });

  it('empty member set yields empty join inputs', () => {
    assert.deepEqual(collectGroupMembership([]), {
      brokerOrderIds: [],
      optionLegIds: [],
    });
  });
});
