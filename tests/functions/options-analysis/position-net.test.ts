/**
 * Pure tests for `buildPositionNetSeries` (Topic #1238, Thread #1270,
 * task #1500) — the per-day signed cost-to-close series a position row
 * feeds the shared exit evaluators.
 *
 * Conventions under test:
 * - Sign space = cost-to-close: SHORT legs contribute +mark, LONG legs
 *   contribute -mark (a credit spread is a positive liability that
 *   decays to 0). Same formula on delta/iv — a 1-leg short pick
 *   reproduces the v1 entry fields verbatim.
 * - Inner join — a date missing from any living leg can't price the
 *   package and drops out.
 * - Settlement freezing — an expired leg contributes its frozen
 *   intrinsic on every date > its expiry while living legs continue.
 * - `expiry` on each bar = the nearest LIVING option expiry — a
 *   dte-time exit compares remaining days against the next leg to die.
 * - Absent-field → absent-value: one leg missing delta/iv (or a frozen
 *   leg — expired contracts carry no greeks) makes that day's net
 *   field absent. Stock legs contribute delta = ±1 and no iv.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPositionNetSeries,
  signFor,
  type PositionLegInput,
} from '../../../functions/src/options-analysis/position-net';
import type { ExitScanBar } from '../../../functions/src/options-analysis/exit-evaluators';
import { TradeSide } from '@common';

// ==========================
// Fixture builders
// ==========================

type Day = { mark: number; delta?: number; iv?: number };

const leg = (
  side: TradeSide,
  live: Record<string, Day>,
  opts: { expiry?: string; frozenMark?: number } = {},
): PositionLegInput => ({
  side,
  live: new Map(Object.entries(live)),
  ...opts,
});

/** The builder is total — `bars` is a readability alias for its output. */
const bars = (r: ExitScanBar[]): ExitScanBar[] => r;

// ==========================
// Sign + join semantics
// ==========================

describe('buildPositionNetSeries — sign + join', () => {
  it('single SHORT leg reproduces the contract series (v1 parity)', () => {
    const out = buildPositionNetSeries(
      [
        leg(TradeSide.SHORT, {
          '2026-01-05': { mark: 2.0, delta: -0.2, iv: 0.2 },
          '2026-01-06': { mark: 1.5, delta: -0.18, iv: 0.19 },
        }),
      ],
      '2026-02-20',
    );
    assert.deepEqual(bars(out), [
      { date: '2026-01-05', mark: 2.0, delta: -0.2, iv: 0.2 },
      { date: '2026-01-06', mark: 1.5, delta: -0.18, iv: 0.19 },
    ]);
  });

  it('credit spread: net = short mark − long mark per day', () => {
    const out = buildPositionNetSeries(
      [
        leg(TradeSide.SHORT, {
          '2026-01-05': { mark: 2.0 },
          '2026-01-06': { mark: 1.4 },
        }, { expiry: '2026-02-20' }),
        leg(TradeSide.LONG, {
          '2026-01-05': { mark: 0.5 },
          '2026-01-06': { mark: 0.4 },
        }, { expiry: '2026-02-20' }),
      ],
      '2026-02-20',
    );
    const out2 = bars(out);
    assert.deepEqual(out2.map((b) => b.date), ['2026-01-05', '2026-01-06']);
    assert.ok(Math.abs(out2[0].mark - 1.5) < 1e-9);
    assert.ok(Math.abs(out2[1].mark - 1.0) < 1e-9); // 1.4 − 0.4 — float sum
  });

  it('debit spread: net is negative (long − short space, same formula)', () => {
    const out = buildPositionNetSeries(
      [
        leg(TradeSide.LONG, {
          '2026-01-05': { mark: 3.0 },
        }, { expiry: '2026-02-20' }),
        leg(TradeSide.SHORT, {
          '2026-01-05': { mark: 1.0 },
        }, { expiry: '2026-02-20' }),
      ],
      '2026-02-20',
    );
    assert.deepEqual(bars(out).map((b) => b.mark), [-2.0]);
  });

  it('inner join — a date missing from any living leg drops out', () => {
    const out = buildPositionNetSeries(
      [
        leg(TradeSide.SHORT, {
          '2026-01-05': { mark: 2.0 },
          '2026-01-06': { mark: 1.4 },
          '2026-01-07': { mark: 1.3 },
        }, { expiry: '2026-02-20' }),
        leg(TradeSide.LONG, {
          '2026-01-05': { mark: 0.5 },
          // 2026-01-06 missing — corpus hole on the long leg
          '2026-01-07': { mark: 0.3 },
        }, { expiry: '2026-02-20' }),
      ],
      '2026-02-20',
    );
    assert.deepEqual(bars(out).map((b) => b.date), ['2026-01-05', '2026-01-07']);
  });

  it('dates past maxExpiry never appear (frozen tails are bounded)', () => {
    const out = buildPositionNetSeries(
      [
        leg(TradeSide.SHORT, {
          '2026-02-19': { mark: 0.1 },
          '2026-02-20': { mark: 0.0 },
        }, { expiry: '2026-02-20' }),
        leg(TradeSide.LONG, {}, { expiry: '2026-01-30', frozenMark: 0.0 }),
      ],
      '2026-02-20',
    );
    assert.ok(bars(out).every((b) => b.date <= '2026-02-20'));
  });
});

// ==========================
// Settlement freezing
// ==========================

describe('buildPositionNetSeries — settlement freezing', () => {
  it('expired leg contributes frozenMark on dates > its expiry', () => {
    const out = buildPositionNetSeries(
      [
        // Short leg expires 2026-01-30, settles ITM at 3.0 intrinsic.
        leg(TradeSide.SHORT, {
          '2026-01-28': { mark: 3.2 },
          '2026-01-30': { mark: 3.0 },
        }, { expiry: '2026-01-30', frozenMark: 3.0 }),
        // Long leg lives to 2026-02-06.
        leg(TradeSide.LONG, {
          '2026-01-28': { mark: 1.0 },
          '2026-01-30': { mark: 0.9 },
          '2026-02-04': { mark: 0.4 },
        }, { expiry: '2026-02-06' }),
      ],
      '2026-02-06',
    );
    assert.deepEqual(bars(out), [
      // Both living: 3.2 − 1.0 = 2.2
      { date: '2026-01-28', mark: 2.2, expiry: '2026-01-30' },
      // Short leg's expiry day — still living: 3.0 − 0.9 = 2.1
      { date: '2026-01-30', mark: 2.1, expiry: '2026-01-30' },
      // Short leg frozen at 3.0, long continues: 3.0 − 0.4 = 2.6
      { date: '2026-02-04', mark: 2.6, expiry: '2026-02-06' },
    ]);
  });

  it('frozen leg carries no greeks → net delta/iv absent on frozen days', () => {
    const out = buildPositionNetSeries(
      [
        leg(TradeSide.SHORT, {
          '2026-01-30': { mark: 3.0, delta: -0.9, iv: 0.3 },
        }, { expiry: '2026-01-30', frozenMark: 3.0 }),
        leg(TradeSide.LONG, {
          '2026-01-30': { mark: 0.9, delta: -0.1, iv: 0.25 },
          '2026-02-04': { mark: 0.4, delta: -0.05, iv: 0.2 },
        }, { expiry: '2026-02-06' }),
      ],
      '2026-02-06',
    );
    const [expiryDay, frozenDay] = bars(out);
    assert.ok(Math.abs((expiryDay.delta ?? NaN) - -0.8) < 1e-9); // (+1)(-0.9) + (-1)(-0.1)
    assert.ok(Math.abs((expiryDay.iv ?? NaN) - 0.05) < 1e-9); // 0.3 − 0.25
    assert.equal(frozenDay.delta, undefined);
    assert.equal(frozenDay.iv, undefined);
  });
});

// ==========================
// Stock legs
// ==========================

describe('buildPositionNetSeries — stock legs', () => {
  it('long stock contributes −close (cost-to-close space)', () => {
    const out = buildPositionNetSeries(
      [
        leg(TradeSide.SHORT, {
          '2026-01-05': { mark: 2.0 },
        }, { expiry: '2026-02-20' }),
        leg(TradeSide.LONG, {
          '2026-01-05': { mark: 100.0 }, // underlying close as the mark
        }),
      ],
      '2026-02-20',
    );
    assert.deepEqual(bars(out).map((b) => b.mark), [-98.0]);
  });

  it('stock leg delta = ±1 signed; stock carries no iv → net iv absent', () => {
    const out = buildPositionNetSeries(
      [
        leg(TradeSide.SHORT, {
          '2026-01-05': { mark: 2.0, delta: -0.3, iv: 0.2 },
        }, { expiry: '2026-02-20' }),
        {
          side: TradeSide.LONG,
          live: new Map([
            ['2026-01-05', { mark: 100.0, delta: 1 }],
          ]),
        },
      ],
      '2026-02-20',
    );
    const [bar] = bars(out);
    assert.ok(Math.abs((bar.delta ?? NaN) - -1.3) < 1e-9); // (+1)(-0.3) + (-1)(1)
    assert.equal(bar.iv, undefined); // stock carries no iv → net absent
  });
});

// ==========================
// Nearest living expiry
// ==========================

describe('buildPositionNetSeries — nearest living expiry', () => {
  it('expiry tracks the nearest still-living option leg', () => {
    const out = buildPositionNetSeries(
      [
        leg(TradeSide.SHORT, {
          '2026-01-28': { mark: 1.0 },
          '2026-01-30': { mark: 0.9 },
        }, { expiry: '2026-01-30', frozenMark: 0.8 }),
        leg(TradeSide.LONG, {
          '2026-01-28': { mark: 0.4 },
          '2026-01-30': { mark: 0.35 },
          '2026-02-04': { mark: 0.2 },
        }, { expiry: '2026-02-06' }),
      ],
      '2026-02-06',
    );
    assert.deepEqual(bars(out).map((b) => b.expiry), [
      '2026-01-30', // both legs alive — nearer wins
      '2026-01-30', // the short leg is still alive ON its expiry day
      '2026-02-06', // short leg dead — the long leg is the nearest living
    ]);
  });

  it('single option leg: every bar expiry = its own expiration', () => {
    const out = buildPositionNetSeries(
      [
        leg(TradeSide.SHORT, {
          '2026-01-05': { mark: 2.0 },
        }, { expiry: '2026-02-20' }),
      ],
      '2026-02-20',
    );
    assert.equal(bars(out)[0].expiry, '2026-02-20');
  });
});

// ==========================
// Edge cases
// ==========================

describe('buildPositionNetSeries — edges', () => {
  it('empty legs → empty series', () => {
    const out = buildPositionNetSeries([], '2026-02-20');
    assert.deepEqual(bars(out), []);
  });

  it('no qualifying dates → empty series', () => {
    const out = buildPositionNetSeries(
      [
        leg(TradeSide.SHORT, { '2026-01-05': { mark: 2.0 } }, { expiry: '2026-02-20' }),
        leg(TradeSide.LONG, { '2026-01-06': { mark: 0.5 } }, { expiry: '2026-02-20' }),
      ],
      '2026-02-20',
    );
    assert.deepEqual(bars(out), []);
  });

  it('signFor convention — SHORT +1 (liability), LONG −1', () => {
    assert.equal(signFor(TradeSide.SHORT), 1);
    assert.equal(signFor(TradeSide.LONG), -1);
  });
});
