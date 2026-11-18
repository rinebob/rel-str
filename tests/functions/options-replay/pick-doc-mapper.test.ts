/**
 * Unit tests for `mapLegsToPositionRows` (Topic #1238, task #1499) — the
 * pure N-leg pick-doc join that replaces the v1 `mapPickDocToRows`.
 * TEST-BE seam: fixture docs + synthetic trading-day calendar, no
 * Firestore, no network.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  mapLegsToPositionRows,
} from '../../../functions/src/options-replay/pick-doc-mapper';
import type {
  MapperLegInput,
} from '../../../functions/src/options-replay/pick-doc-mapper';
import type {
  ContractListNoSelectionRow,
  ContractListPositionRow,
  PickDocDay,
  PickDocCoordinate,
  PickDocument,
} from '@options-replay/contracts';
import { OptionType } from '@options/common';
import { TradeSide } from '@common';

// ==========================
// Fixtures
// ==========================

const SHORT = TradeSide.SHORT;
const LONG = TradeSide.LONG;

const COORD_SHORT_PUT_20: PickDocCoordinate = {
  type: OptionType.PUT,
  targetDelta: -0.2,
  expiry: { mode: 'nearestDte', dte: 45 },
};
const COORD_LONG_PUT_5: PickDocCoordinate = {
  type: OptionType.PUT,
  targetDelta: -0.05,
  expiry: { mode: 'nearestDte', dte: 45 },
};

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

/** One option leg wired to a fixture doc. */
function optLeg(
  coordinate: PickDocCoordinate,
  d: PickDocument,
  side: TradeSide = SHORT,
): MapperLegInput {
  return { kind: 'option', side, coordinate, doc: d };
}

function stockLeg(side: TradeSide = LONG): MapperLegInput {
  return { kind: 'stock', side };
}

const DAYS = ['2026-01-05', '2026-01-06', '2026-01-07'];

// ==========================
// Single option leg (v1-parity behaviors)
// ==========================

describe('mapLegsToPositionRows — single option leg', () => {
  it('emits a position row per day with day fields + kind/side/coordinate on legs[0]', () => {
    const d = doc({ '2026-01-05': pick(), '2026-01-06': pick() });
    const rows = mapLegsToPositionRows([optLeg(COORD_SHORT_PUT_20, d)], DAYS.slice(0, 2));

    assert.equal(rows.length, 2);
    const row = rows[0] as ContractListPositionRow;
    assert.equal(row.kind, 'position');
    assert.equal(row.entryDate, '2026-01-05');
    assert.equal(row.legs.length, 1);
    const leg = row.legs[0];
    assert.equal(leg.kind, 'option');
    if (leg.kind === 'option') {
      assert.equal(leg.side, SHORT);
      assert.equal(leg.contractId, 'SPY260220P00580000');
      assert.equal(leg.strike, 580);
      assert.equal(leg.mark, 9.5);
      assert.deepEqual(leg.coordinate, COORD_SHORT_PUT_20);
    }
    assert.equal(row.repeatsPrevious, false);
  });

  it('maps miss entries to no-selection rows — no_match→miss, no_chain→gap', () => {
    const d = doc({
      '2026-01-05': pick(),
      '2026-01-06': { status: 'no_match' },
      '2026-01-07': { status: 'no_chain', underlyingClose: 578 },
    });
    const rows = mapLegsToPositionRows([optLeg(COORD_SHORT_PUT_20, d)], DAYS);

    const r1 = rows[1] as ContractListNoSelectionRow;
    assert.equal(r1.kind, 'no-selection');
    assert.equal(r1.reason, 'miss');
    assert.equal(r1.legMisses.length, 1);
    assert.equal(r1.legMisses[0].legIndex, 0);
    assert.deepEqual(r1.legMisses[0].coordinate, COORD_SHORT_PUT_20);
    assert.equal(r1.legMisses[0].reason, 'miss');
    const r2 = rows[2] as ContractListNoSelectionRow;
    assert.equal(r2.reason, 'gap');
    assert.equal(r2.legMisses[0].reason, 'gap');
  });

  it('absent in-range key → no-selection legMiss with no reason', () => {
    const d = doc({ '2026-01-05': pick() });
    const rows = mapLegsToPositionRows([optLeg(COORD_SHORT_PUT_20, d)], DAYS.slice(0, 2));
    const row = rows[1] as ContractListNoSelectionRow;
    assert.equal(row.kind, 'no-selection');
    assert.equal(row.reason, undefined);
    assert.equal(row.legMisses[0].reason, undefined);
  });

  it('marks days outside [firstDate, lastDate] as out-of-range', () => {
    const d = doc({ '2026-01-05': pick() });
    const rows = mapLegsToPositionRows(
      [optLeg(COORD_SHORT_PUT_20, d)],
      ['2026-01-02', '2026-01-05', '2026-01-12'],
    );
    assert.equal((rows[0] as ContractListNoSelectionRow).legMisses[0].reason, 'out-of-range');
    assert.equal((rows[2] as ContractListNoSelectionRow).legMisses[0].reason, 'out-of-range');
    assert.equal((rows[0] as ContractListNoSelectionRow).reason, 'out-of-range');
  });

  it('resets repeatsPrevious across a no-selection gap', () => {
    const d = doc({
      '2026-01-05': pick(),
      '2026-01-06': { status: 'no_match' },
      '2026-01-07': pick(),  // same contractId but prior row was a marker
    });
    const rows = mapLegsToPositionRows([optLeg(COORD_SHORT_PUT_20, d)], DAYS);
    assert.equal((rows[2] as ContractListPositionRow).repeatsPrevious, false);
  });

  it('returns [] for an empty trading-day calendar', () => {
    assert.deepEqual(mapLegsToPositionRows([optLeg(COORD_SHORT_PUT_20, doc({}))], []), []);
  });
});

// ==========================
// Multi option legs — the atomic join
// ==========================

describe('mapLegsToPositionRows — multi-leg join', () => {
  function twoLegDays(
    leg0Days: PickDocument['days'],
    leg1Days: PickDocument['days'],
  ): MapperLegInput[] {
    return [
      optLeg(COORD_SHORT_PUT_20, doc(leg0Days)),
      optLeg(COORD_LONG_PUT_5, doc(leg1Days, { targetDelta: -0.05 }), LONG),
    ];
  }

  it('all legs pick → position row carrying every leg in declared order', () => {
    const legs = twoLegDays(
      { '2026-01-05': pick() },
      { '2026-01-05': pick({ contractId: 'SPY260220P00560000', strike: 560, delta: -0.05, mark: 1.2 }) },
    );
    const rows = mapLegsToPositionRows(legs, ['2026-01-05']);

    const row = rows[0] as ContractListPositionRow;
    assert.equal(row.kind, 'position');
    assert.equal(row.legs.length, 2);
    const [l0, l1] = row.legs;
    assert.equal(l0.kind, 'option');
    assert.equal(l1.kind, 'option');
    if (l0.kind === 'option' && l1.kind === 'option') {
      assert.equal(l0.side, SHORT);
      assert.equal(l1.side, LONG);
      assert.equal(l0.contractId, 'SPY260220P00580000');
      assert.equal(l1.contractId, 'SPY260220P00560000');
      assert.deepEqual(l0.coordinate, COORD_SHORT_PUT_20);
      assert.deepEqual(l1.coordinate, COORD_LONG_PUT_5);
    }
  });

  it('any leg miss → no-selection; legMisses names only the failing leg', () => {
    const legs = twoLegDays(
      { '2026-01-05': pick() },
      { '2026-01-05': { status: 'no_match' } },
    );
    const rows = mapLegsToPositionRows(legs, ['2026-01-05']);

    const row = rows[0] as ContractListNoSelectionRow;
    assert.equal(row.kind, 'no-selection');
    assert.equal(row.reason, 'miss');
    assert.equal(row.legMisses.length, 1);
    assert.equal(row.legMisses[0].legIndex, 1);
    assert.deepEqual(row.legMisses[0].coordinate, COORD_LONG_PUT_5);
  });

  it('both legs missing → legMisses carries both, roll-up reason is the worst', () => {
    const legs = twoLegDays(
      { '2026-01-05': { status: 'no_chain' } },
      { '2026-01-05': { status: 'no_match' } },
    );
    const rows = mapLegsToPositionRows(legs, ['2026-01-05']);

    const row = rows[0] as ContractListNoSelectionRow;
    assert.equal(row.legMisses.length, 2);
    assert.equal(row.legMisses[0].legIndex, 0);
    assert.equal(row.legMisses[0].reason, 'gap');
    assert.equal(row.legMisses[1].legIndex, 1);
    assert.equal(row.legMisses[1].reason, 'miss');
    // miss (chain existed, nothing matched) outranks gap (data hole).
    assert.equal(row.reason, 'miss');
  });

  it('repeatsPrevious requires EVERY option leg to repeat', () => {
    const legs = twoLegDays(
      {
        '2026-01-05': pick(),
        '2026-01-06': pick(),
        '2026-01-07': pick({ contractId: 'ROLL-A' }),
      },
      {
        '2026-01-05': pick({ contractId: 'B' }),
        '2026-01-06': pick({ contractId: 'B' }),
        '2026-01-07': pick({ contractId: 'B' }),  // leg1 repeats but leg0 changed
      },
    );
    const rows = mapLegsToPositionRows(legs, DAYS) as ContractListPositionRow[];
    assert.deepEqual(rows.map((r) => r.repeatsPrevious), [false, true, false]);
  });
});

// ==========================
// Stock legs
// ==========================

describe('mapLegsToPositionRows — stock legs', () => {
  it('stock leg always resolves — underlyingClose from the option pick', () => {
    const legs: MapperLegInput[] = [
      stockLeg(LONG),
      optLeg(COORD_SHORT_PUT_20, doc({ '2026-01-05': pick({ underlyingClose: 581.25 }) }), SHORT),
    ];
    const rows = mapLegsToPositionRows(legs, ['2026-01-05']);

    const row = rows[0] as ContractListPositionRow;
    assert.equal(row.legs.length, 2);
    const stock = row.legs[0];
    assert.equal(stock.kind, 'stock');
    if (stock.kind === 'stock') {
      assert.equal(stock.side, LONG);
      assert.equal(stock.underlyingClose, 581.25);
    }
    assert.equal(row.legs[1].kind, 'option');
  });

  it('stock legs never appear in legMisses — a missing option behind them keeps absolute index', () => {
    const legs: MapperLegInput[] = [
      stockLeg(LONG),
      optLeg(COORD_SHORT_PUT_20, doc({ '2026-01-05': { status: 'no_match' } }), SHORT),
    ];
    const rows = mapLegsToPositionRows(legs, ['2026-01-05']);

    const row = rows[0] as ContractListNoSelectionRow;
    assert.equal(row.legMisses.length, 1);
    // Absolute index into the declared legs array — the stock leg is 0.
    assert.equal(row.legMisses[0].legIndex, 1);
  });

  it('throws with no option legs — stock underlyingClose is unresolvable', () => {
    assert.throws(
      () => mapLegsToPositionRows([stockLeg(LONG), stockLeg(SHORT)], DAYS),
      /at least one option leg/i,
    );
  });
});
