/**
 * Tests for portfolio-allocation rollup utils (Blueprint #581 / task #584).
 *
 * Seam under test: `shared/portfolio-allocation-utils.ts` — pure functions
 * over normalized domain inputs (the service layer maps MCP shapes →
 * AllocationPositionInput / AllocationFillInput). Covers target/drift math,
 * the warn-not-block predicate, position→bucket join, FIFO realized P&L
 * matching, the computeBucketStats rollup seam, and the derived Cash row.
 */

import type { EquityCurvePoint } from './common';
import {
  attributePositions,
  cashCheck,
  cashExposure,
  computeBucketStats,
  drift,
  matchRealizedPnl,
  targetDollars,
  wouldExceedTarget,
  type AllocationFillInput,
  type AllocationPositionInput,
} from './portfolio-allocation-utils';
import { BucketStatus, type AllocationBucket, type PositionAttribution } from './portfolio-allocation-contracts';
import { buildBucketId } from './portfolio-allocation-ids';

const ACCT = '5AC12345';
const NOW = '2026-09-26T12:00:00Z';

function bucket(name = 'CSP Wheel', overrides: Partial<AllocationBucket> = {}): AllocationBucket {
  return {
    id: buildBucketId(ACCT, name),
    accountNumber: ACCT,
    name,
    targetPct: 25,
    status: BucketStatus.ACTIVE,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function attribution(instrumentId: string, bucketId: string, accountNumber = ACCT): PositionAttribution {
  return {
    id: `${accountNumber}_${instrumentId}`,
    accountNumber,
    instrumentId,
    bucketId,
    history: [{ fromBucketId: null, toBucketId: bucketId, at: NOW }],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function pos(instrumentId: string, overrides: Partial<AllocationPositionInput> = {}): AllocationPositionInput {
  return { instrumentId, quantity: 1, marketValue: 1000, costBasis: 900, ...overrides };
}

function fill(instrumentId: string, side: 'buy' | 'sell', overrides: Partial<AllocationFillInput> = {}): AllocationFillInput {
  return { instrumentId, side, quantity: 1, price: 10, multiplier: 1, filledAt: NOW, ...overrides };
}

describe('targetDollars / drift', () => {
  it('converts pct of account value to dollars', () => {
    expect(targetDollars(100_000, 25)).toBe(25_000);
    expect(targetDollars(33_333.33, 7.5)).toBeCloseTo(2500, 0);
  });

  it('zero and negative account values stay computable', () => {
    expect(targetDollars(0, 50)).toBe(0);
    expect(targetDollars(-50_000, 25)).toBe(-12_500);
  });

  it('drift is exposure minus target', () => {
    expect(drift(30_000, 25_000)).toBe(5000);
    expect(drift(20_000, 25_000)).toBe(-5000);
  });
});

describe('wouldExceedTarget', () => {
  it('does not warn when projected exposure is at or under target', () => {
    expect(wouldExceedTarget(24_000, 1000, 25_000)).toBe(false);
  });

  it('warns when projected exposure exceeds target by any amount', () => {
    expect(wouldExceedTarget(24_000, 1000.01, 25_000)).toBe(true);
  });

  it('zero target warns on any buy exposure', () => {
    expect(wouldExceedTarget(0, 1, 0)).toBe(true);
    expect(wouldExceedTarget(0, 0, 0)).toBe(false);
  });

  it('fails closed — non-finite inputs warn rather than silently pass', () => {
    expect(wouldExceedTarget(Number.NaN, 0, 25_000)).toBe(true);
    expect(wouldExceedTarget(0, Number.NaN, 25_000)).toBe(true);
    expect(wouldExceedTarget(0, 0, Number.NaN)).toBe(true);
    expect(wouldExceedTarget(0, 0, Number.POSITIVE_INFINITY)).toBe(true);
  });
});

describe('attributePositions', () => {
  it('joins positions to their bucket via attribution docs', () => {
    const b = bucket();
    const results = attributePositions(
      [pos('SPY-PUT-1'), pos('AAPL')],
      [attribution('SPY-PUT-1', b.id)],
      ACCT,
    );
    expect(results[0].bucketId).toBe(b.id);
    expect(results[1].bucketId).toBeNull();
  });

  it('does not leak attributions from another account', () => {
    const b = bucket();
    const foreign = attribution('SPY-PUT-1', b.id, 'OTHER-ACCT');
    const results = attributePositions([pos('SPY-PUT-1')], [foreign], ACCT);
    expect(results[0].bucketId).toBeNull();
  });

  it('still reports a retired bucket as the owner (history preserved)', () => {
    const retired = bucket('Old CSP', { status: BucketStatus.RETIRED });
    const results = attributePositions([pos('XYZ')], [attribution('XYZ', retired.id)], ACCT);
    expect(results[0].bucketId).toBe(retired.id);
  });
});

describe('matchRealizedPnl', () => {
  it('round trip: buy then sell the same instrument → realized gain', () => {
    const m = matchRealizedPnl([
      fill('AAPL', 'buy', { price: 100, quantity: 10, filledAt: '2026-09-01T10:00:00Z' }),
      fill('AAPL', 'sell', { price: 110, quantity: 10, filledAt: '2026-09-05T10:00:00Z' }),
    ]);
    expect(m.get('AAPL')?.realizedPnl).toBeCloseTo(100, 5);
  });

  it('partial close leaves the remainder open and realizes only the matched qty', () => {
    const m = matchRealizedPnl([
      fill('AAPL', 'buy', { price: 100, quantity: 10, filledAt: '2026-09-01T10:00:00Z' }),
      fill('AAPL', 'sell', { price: 110, quantity: 4, filledAt: '2026-09-05T10:00:00Z' }),
    ]);
    expect(m.get('AAPL')?.realizedPnl).toBeCloseTo(40, 5);
    expect(m.get('AAPL')?.matches).toHaveLength(1);
  });

  it('matches FIFO across multiple lots', () => {
    const m = matchRealizedPnl([
      fill('AAPL', 'buy', { price: 100, quantity: 5, filledAt: '2026-09-01T10:00:00Z' }),
      fill('AAPL', 'buy', { price: 110, quantity: 5, filledAt: '2026-09-02T10:00:00Z' }),
      fill('AAPL', 'sell', { price: 120, quantity: 7, filledAt: '2026-09-05T10:00:00Z' }),
    ]);
    // FIFO: 5 × (120-100) + 2 × (120-110) = 100 + 20 = 120
    expect(m.get('AAPL')?.realizedPnl).toBeCloseTo(120, 5);
    expect(m.get('AAPL')?.matches).toHaveLength(2);
  });

  it('short sell then buy-to-cover realizes the short gain', () => {
    const m = matchRealizedPnl([
      fill('AAPL', 'sell', { price: 150, quantity: 10, filledAt: '2026-09-01T10:00:00Z' }),
      fill('AAPL', 'buy', { price: 140, quantity: 10, filledAt: '2026-09-05T10:00:00Z' }),
    ]);
    expect(m.get('AAPL')?.realizedPnl).toBeCloseTo(100, 5);
  });

  it('option multiplier applies (premium × qty × 100)', () => {
    const m = matchRealizedPnl([
      fill('SPY-PUT-1', 'sell', { price: 2.0, quantity: 1, multiplier: 100, filledAt: '2026-09-01T10:00:00Z' }),
      fill('SPY-PUT-1', 'buy', { price: 1.0, quantity: 1, multiplier: 100, filledAt: '2026-09-05T10:00:00Z' }),
    ]);
    expect(m.get('SPY-PUT-1')?.realizedPnl).toBeCloseTo(100, 5);
  });

  it('keeps instruments independent when interleaved', () => {
    const m = matchRealizedPnl([
      fill('AAPL', 'buy', { price: 100, filledAt: '2026-09-01T10:00:00Z' }),
      fill('MSFT', 'buy', { price: 200, filledAt: '2026-09-01T10:05:00Z' }),
      fill('AAPL', 'sell', { price: 110, filledAt: '2026-09-02T10:00:00Z' }),
      fill('MSFT', 'sell', { price: 190, filledAt: '2026-09-02T10:05:00Z' }),
    ]);
    expect(m.get('AAPL')?.realizedPnl).toBeCloseTo(10, 5);
    expect(m.get('MSFT')?.realizedPnl).toBeCloseTo(-10, 5);
  });

  it('fills with no opposing fill contribute nothing (unrealized, excluded)', () => {
    const m = matchRealizedPnl([
      fill('AAPL', 'buy', { price: 100, quantity: 10, filledAt: '2026-09-01T10:00:00Z' }),
    ]);
    expect(m.get('AAPL')?.realizedPnl ?? 0).toBe(0);
    expect(m.get('AAPL')?.matches ?? []).toHaveLength(0);
  });

  it('close fill outside the history window drops its remainder — no phantom lot', () => {
    const m = matchRealizedPnl([
      // Opening buy is older than RH's history window — absent.
      fill('SPY-PUT-1', 'buy', { positionEffect: 'close', price: 1.0, quantity: 2, multiplier: 100, filledAt: '2026-09-05T10:00:00Z' }),
      // A later open must not match against a phantom short lot.
      fill('SPY-PUT-1', 'sell', { positionEffect: 'open', price: 2.0, quantity: 1, multiplier: 100, filledAt: '2026-09-10T10:00:00Z' }),
    ]);
    expect(m.get('SPY-PUT-1')?.realizedPnl ?? 0).toBe(0);
    expect(m.get('SPY-PUT-1')?.matches ?? []).toHaveLength(0);
  });

  it('partial close beyond available lots realizes only what can be matched', () => {
    const m = matchRealizedPnl([
      fill('AAPL', 'buy', { positionEffect: 'open', price: 100, quantity: 5, filledAt: '2026-09-01T10:00:00Z' }),
      // Closing 8 but only 5 exist — the extra 3 vanish (truncated history).
      fill('AAPL', 'sell', { positionEffect: 'close', price: 110, quantity: 8, filledAt: '2026-09-05T10:00:00Z' }),
    ]);
    expect(m.get('AAPL')?.realizedPnl).toBeCloseTo(50, 5);
  });

  it('out-of-order input is sorted before matching', () => {
    const m = matchRealizedPnl([
      fill('AAPL', 'sell', { price: 110, quantity: 10, filledAt: '2026-09-05T10:00:00Z' }),
      fill('AAPL', 'buy', { price: 100, quantity: 10, filledAt: '2026-09-01T10:00:00Z' }),
    ]);
    expect(m.get('AAPL')?.realizedPnl).toBeCloseTo(100, 5);
  });

  it('unflagged sell into an empty book opens a short lot (documented fallback)', () => {
    // No positionEffect — side alone can't distinguish sell-to-close from
    // sell-to-open, so the matcher assumes open-capable. The service layer
    // is responsible for supplying `close` when it can infer it.
    const m = matchRealizedPnl([
      fill('AAPL', 'sell', { price: 150, quantity: 10, filledAt: '2026-09-01T10:00:00Z' }),
      fill('AAPL', 'buy', { price: 140, quantity: 10, filledAt: '2026-09-05T10:00:00Z' }),
    ]);
    expect(m.get('AAPL')?.realizedPnl).toBeCloseTo(100, 5);
  });

  it('unparseable timestamps are skipped; parseable-but-non-ISO still match', () => {
    const m = matchRealizedPnl([
      fill('AAPL', 'buy', { price: 100, quantity: 10, filledAt: '09/01/2026' }),
      fill('AAPL', 'sell', { price: 110, quantity: 10, filledAt: 'not a date' }),
    ]);
    expect(m.get('AAPL')?.realizedPnl ?? 0).toBe(0);
  });

  it('skips malformed fills rather than crashing', () => {
    const m = matchRealizedPnl([
      fill('AAPL', 'buy', { price: 100, quantity: 10 }),
      fill('AAPL', 'sell', { price: Number.NaN, quantity: 10 }),
      fill('AAPL', 'sell', { price: 110, quantity: 0 }),
      fill('AAPL', 'sell', { price: 110, quantity: 10, filledAt: '' }),
      fill('AAPL', 'sell', { price: 120, quantity: 10, filledAt: '2026-09-05T10:00:00Z' }),
    ]);
    // Only the last sell is well-formed: 10 × (120-100) = 200
    expect(m.get('AAPL')?.realizedPnl).toBeCloseTo(200, 5);
  });
});

describe('computeBucketStats', () => {
  const b = bucket();

  it('rolls up exposure, target, drift, counts, and P&L for the bucket', () => {
    const s = computeBucketStats(b, 100_000,
      [pos('SPY-PUT-1', { marketValue: 4000, costBasis: 3600, quantity: 2 })],
      [fill('SPY-PUT-1', 'sell', { price: 2.0, multiplier: 100 }), fill('SPY-PUT-1', 'buy', { price: 1.5, multiplier: 100 })],
      [attribution('SPY-PUT-1', b.id)],
      NOW);
    expect(s.bucketId).toBe(b.id);
    expect(s.exposure).toBe(4000);
    expect(s.netValue).toBe(4000);
    expect(s.targetDollars).toBe(25_000);
    expect(s.drift).toBe(-21_000);
    expect(s.realizedPnl).toBeCloseTo(50, 5);
    expect(s.unrealizedPnl).toBeCloseTo(400, 5);
    expect(s.openCount).toBe(1);
    expect(s.closedCount).toBe(0);
    expect(s.asOf).toBe(NOW);
  });

  it('counts an attributed-but-flat instrument as closed', () => {
    const s = computeBucketStats(b, 100_000,
      [],
      [fill('OLD-1', 'buy', { price: 10 }), fill('OLD-1', 'sell', { price: 12 })],
      [attribution('OLD-1', b.id)],
      NOW);
    expect(s.openCount).toBe(0);
    expect(s.closedCount).toBe(1);
    expect(s.realizedPnl).toBeCloseTo(2, 5);
  });

  it('uses gross exposure — short positions count toward the target, not against it', () => {
    const s = computeBucketStats(b, 100_000,
      [pos('SPY-PUT-1', { marketValue: -4000, costBasis: -3600 })],
      [],
      [attribution('SPY-PUT-1', b.id)],
      NOW);
    expect(s.exposure).toBe(4000);
    expect(s.netValue).toBe(-4000);
    expect(s.unrealizedPnl).toBeCloseTo(-400, 5);
  });

  it('malformed positions are skipped rather than NaN-ing the rollup', () => {
    const s = computeBucketStats(b, 100_000,
      [pos('SPY-PUT-1', { marketValue: Number.NaN }), pos('SPY-PUT-2', { marketValue: 1000 })],
      [],
      [attribution('SPY-PUT-1', b.id), attribution('SPY-PUT-2', b.id)],
      NOW);
    expect(s.exposure).toBe(1000);
    expect(s.openCount).toBe(1);
    expect(s.unrealizedPnl).toBeCloseTo(100, 5);
  });

  it('attributed but never-traded instruments are neither open nor closed', () => {
    const s = computeBucketStats(b, 100_000, [], [], [attribution('NEVER-TRADED', b.id)], NOW);
    expect(s.openCount).toBe(0);
    expect(s.closedCount).toBe(0);
    expect(s.equityCurve).toEqual([]);
  });

  it('equity curve accumulates realized matches, endpoint adds unrealized', () => {
    const s = computeBucketStats(b, 100_000,
      [pos('AAPL', { marketValue: 1100, costBasis: 1000 })],
      [
        fill('AAPL', 'buy', { price: 100, quantity: 10, filledAt: '2026-09-01T10:00:00Z' }),
        fill('AAPL', 'sell', { price: 110, quantity: 10, filledAt: '2026-09-05T10:00:00Z' }),
        fill('AAPL', 'buy', { price: 105, quantity: 10, filledAt: '2026-09-10T10:00:00Z' }),
        fill('AAPL', 'sell', { price: 115, quantity: 10, filledAt: '2026-09-12T10:00:00Z' }),
      ],
      [attribution('AAPL', b.id)],
      NOW);
    const curve = s.equityCurve;
    expect(curve[0]).toEqual<EquityCurvePoint>({ date: '2026-09-05', cumulativePnl: 100 });
    expect(curve[1]).toEqual<EquityCurvePoint>({ date: '2026-09-12', cumulativePnl: 200 });
    const last = curve[curve.length - 1];
    expect(last.date).toBe('2026-09-26');
    expect(last.cumulativePnl).toBeCloseTo(300, 5); // 200 realized + 100 unrealized
  });

  it('empty inputs produce a zeroed rollup', () => {
    const s = computeBucketStats(b, 100_000, [], [], [], NOW);
    expect(s.exposure).toBe(0);
    expect(s.targetDollars).toBe(25_000);
    expect(s.drift).toBe(-25_000);
    expect(s.realizedPnl).toBe(0);
    expect(s.unrealizedPnl).toBe(0);
    expect(s.openCount).toBe(0);
    expect(s.closedCount).toBe(0);
    expect(s.equityCurve).toEqual([]);
  });

  it('target % sums over 100 compute without throwing (warn-only state)', () => {
    const over = bucket('Over', { targetPct: 130 });
    const s = computeBucketStats(over, 100_000, [], [], [], NOW);
    expect(s.targetDollars).toBe(130_000);
    expect(s.drift).toBe(-130_000);
  });
});

describe('cashExposure', () => {
  it('is the signed residual over ALL positions — buckets + Unassigned + Cash = account value', () => {
    // Long 30k + short −20k → positions net to 10k → cash residual 90k.
    // (Gross would have given 50k — wrong; account value already nets shorts.)
    expect(cashExposure(100_000, [pos('A', { marketValue: 30_000 }), pos('B', { marketValue: -20_000 })]))
      .toBe(90_000);
  });

  it('no positions → the whole account is cash', () => {
    expect(cashExposure(100_000, [])).toBe(100_000);
  });

  it('skips malformed positions', () => {
    expect(cashExposure(100_000, [pos('A', { marketValue: Number.NaN }), pos('B', { marketValue: 10_000 })]))
      .toBe(90_000);
  });
});

describe('cashCheck', () => {
  it('reports actual vs derived and the discrepancy', () => {
    // account 100k, positions net 10k → derived residual 90k; RH reports 91k
    const c = cashCheck(91_000, 100_000, [pos('A', { marketValue: 10_000 })]);
    expect(c.actual).toBe(91_000);
    expect(c.derived).toBe(90_000);
    expect(c.discrepancy).toBe(1000);
    expect(c.diverged).toBe(true); // default tolerance $1
  });

  it('does not diverge within tolerance', () => {
    const c = cashCheck(90_000.5, 100_000, [pos('A', { marketValue: 10_000 })]);
    expect(c.diverged).toBe(false);
    const d = cashCheck(90_500, 100_000, [pos('A', { marketValue: 10_000 })], 1000);
    expect(d.diverged).toBe(false);
  });
});
