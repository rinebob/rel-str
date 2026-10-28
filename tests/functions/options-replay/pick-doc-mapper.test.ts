/**
 * Unit tests for `mapPickDocToRows` (Topic #1238, task #1280) — the pure
 * pick-doc → contract-list row mapper. TEST-BE seam 2: fixture doc +
 * synthetic trading-day calendar, no Firestore, no network.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mapPickDocToRows } from '../../../functions/src/options-replay/pick-doc-mapper';
import type {
  PickDocDay,
  PickDocument,
  ContractListPickRow,
  ContractListNoSelectionRow,
} from '@options-replay/contracts';
import { OptionType } from '@options/common';
import { TradeSide } from '@common';

// ==========================
// Fixtures
// ==========================

function pick(overrides: Partial<PickDocDay> = {}): PickDocDay {
  return {
    underlyingClose: 580,
    contractId: 'SPY260220P00580000',
    expiration: '2026-02-20',
    dte: 45,
    strike: 580,
    delta: -0.2,
    iv: 0.22,
    mark: 9.5,
    bid: 9.4,
    ask: 9.6,
    volume: 100,
    openInterest: 5000,
    ...overrides,
  };
}

function doc(days: PickDocument['days'], overrides: Partial<PickDocument> = {}): PickDocument {
  return {
    type: OptionType.PUT,
    targetDelta: -0.2,
    expiry: { mode: 'nearestDte', dte: 45 },
    symbol: 'SPY',
    gridVersion: 1,
    firstDate: '2026-01-05',
    lastDate: '2026-01-09',
    pickCount: 3,
    missCount: 1,
    days,
    ...overrides,
  };
}

const SHORT = TradeSide.SHORT;

describe('mapPickDocToRows', () => {
  it('emits a pick row per trading day with all day fields + side + entryDate', () => {
    const d = doc({ '2026-01-05': pick(), '2026-01-06': pick() });
    const rows = mapPickDocToRows(d, ['2026-01-05', '2026-01-06'], SHORT);

    assert.equal(rows.length, 2);
    const row = rows[0] as ContractListPickRow;
    assert.equal(row.kind, 'pick');
    assert.equal(row.entryDate, '2026-01-05');
    assert.equal(row.side, SHORT);
    assert.equal(row.contractId, 'SPY260220P00580000');
    assert.equal(row.strike, 580);
    assert.equal(row.mark, 9.5);
    assert.equal(row.repeatsPrevious, false);
  });

  it('maps miss entries to no-selection rows — no_match→miss, no_chain→gap', () => {
    const d = doc({
      '2026-01-05': pick(),
      '2026-01-06': { status: 'no_match' },
      '2026-01-07': { status: 'no_chain', underlyingClose: 578 },
    });
    const rows = mapPickDocToRows(d, ['2026-01-05', '2026-01-06', '2026-01-07'], SHORT);

    assert.deepEqual(rows[1], { kind: 'no-selection', entryDate: '2026-01-06', reason: 'miss' });
    assert.deepEqual(rows[2], { kind: 'no-selection', entryDate: '2026-01-07', reason: 'gap' });
  });

  it('emits a no-selection row for a trading day absent from doc.days', () => {
    const d = doc({ '2026-01-05': pick() });
    const rows = mapPickDocToRows(d, ['2026-01-05', '2026-01-06'], SHORT);
    const row = rows[1] as ContractListNoSelectionRow;
    assert.equal(row.kind, 'no-selection');
    assert.equal(row.entryDate, '2026-01-06');
    assert.equal(row.reason, undefined);
  });

  it('marks days outside [firstDate, lastDate] as out-of-range', () => {
    const d = doc({ '2026-01-05': pick() });
    const rows = mapPickDocToRows(d, ['2026-01-02', '2026-01-05', '2026-01-12'], SHORT);
    assert.equal((rows[0] as ContractListNoSelectionRow).reason, 'out-of-range');
    assert.equal((rows[2] as ContractListNoSelectionRow).reason, 'out-of-range');
  });

  it('sets repeatsPrevious on consecutive same-contractId picks', () => {
    const d = doc({
      '2026-01-05': pick(),
      '2026-01-06': pick(),                          // same contractId
      '2026-01-07': pick({ contractId: 'OTHER' }),   // different
      '2026-01-08': pick({ contractId: 'OTHER' }),   // same as previous
    });
    const rows = mapPickDocToRows(
      d,
      ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'],
      SHORT,
    ) as ContractListPickRow[];
    assert.deepEqual(rows.map((r) => r.repeatsPrevious), [false, true, false, true]);
  });

  it('resets repeatsPrevious across a no-selection gap', () => {
    const d = doc({
      '2026-01-05': pick(),
      '2026-01-06': { status: 'no_match' },
      '2026-01-07': pick(),  // same contractId but prior row was a marker
    });
    const rows = mapPickDocToRows(d, ['2026-01-05', '2026-01-06', '2026-01-07'], SHORT);
    assert.equal((rows[2] as ContractListPickRow).repeatsPrevious, false);
  });

  it('handles a window starting before doc.firstDate — markers, not crashes', () => {
    const d = doc({ '2026-01-05': pick() });
    const rows = mapPickDocToRows(d, ['2026-01-01', '2026-01-02', '2026-01-05'], SHORT);
    assert.equal(rows[0].kind, 'no-selection');
    assert.equal(rows[1].kind, 'no-selection');
    assert.equal(rows[2].kind, 'pick');
  });

  it('returns [] for an empty trading-day calendar', () => {
    assert.deepEqual(mapPickDocToRows(doc({}), [], SHORT), []);
  });
});
