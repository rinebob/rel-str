/**
 * Tests for portfolio-allocation shared contracts — bucket lifecycle shape,
 * attribution records, and the computed stats rollup
 * (Blueprint #581 / task #583).
 */

import {
  BucketStatus,
  type AllocationBucket,
  type AttributionEvent,
  type BucketStats,
  type PositionAttribution,
} from './portfolio-allocation-contracts';
import { buildAttributionId, buildBucketId } from './portfolio-allocation-ids';
import type { EquityCurvePoint } from './common';

const NOW = '2026-09-26T12:00:00Z';
const ACCT = '5AC12345';

/** Fixtures derive ids via the id builders so contract↔format stay coupled. */
function makeBucket(overrides: Partial<AllocationBucket> = {}): AllocationBucket {
  const name = 'CSP Wheel';
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

describe('BucketStatus', () => {
  it('has exactly ACTIVE and RETIRED', () => {
    expect(Object.values(BucketStatus)).toEqual(['ACTIVE', 'RETIRED']);
  });
});

describe('AllocationBucket', () => {
  it('id matches the buildBucketId format', () => {
    expect(makeBucket().id).toBe(`${ACCT}_csp-wheel`);
  });

  it('id is the creation-minted slug, not a live function of name', () => {
    // Rename semantics: the doc id is frozen at creation; renaming only
    // changes `name`. Asserted by constructing a "renamed" doc whose id is
    // still the original slug.
    const renamed = makeBucket({ name: 'Wheel 2' });
    expect(renamed.id).toBe(`${ACCT}_csp-wheel`);
    expect(renamed.id).not.toBe(buildBucketId(ACCT, renamed.name));
  });

  it('has no isCash field — the Cash bucket is computed, never stored', () => {
    expect('isCash' in makeBucket()).toBe(false);
  });
});

describe('PositionAttribution', () => {
  it('linkKey is optional and identifies the multi-leg group', () => {
    const without: PositionAttribution = {
      id: 'acct_SYM', accountNumber: 'acct', instrumentId: 'SYM',
      bucketId: 'acct_b', history: [{ fromBucketId: null, toBucketId: 'acct_b', at: 't' }],
      createdAt: 't', updatedAt: 't',
    };
    const withLink: PositionAttribution = { ...without, linkKey: 'order-123' };
    expect(without.linkKey).toBeUndefined();
    expect(withLink.linkKey).toBe('order-123');
  });

  it('id matches the buildAttributionId format', () => {
    const attr: PositionAttribution = {
      id: buildAttributionId(ACCT, 'inst-1'),
      accountNumber: ACCT,
      instrumentId: 'inst-1',
      bucketId: makeBucket().id,
      history: [{ fromBucketId: null, toBucketId: buildBucketId(ACCT, 'CSP Wheel'), at: NOW }],
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(attr.id).toBe(`${ACCT}_inst-1`);
    // history is non-empty once the doc exists — the first event is the
    // initial attribution (fromBucketId: null).
    expect(attr.history.length).toBeGreaterThan(0);
  });

  it('initial post-hoc assignment records fromBucketId: null', () => {
    const evt: AttributionEvent = {
      fromBucketId: null,
      toBucketId: makeBucket().id,
      at: NOW,
    };
    expect(evt.fromBucketId).toBeNull();
  });

  it('history tail is the current attribution (append-only invariant)', () => {
    const b1 = makeBucket().id;
    const b2 = buildBucketId(ACCT, 'LEAP Drops');
    const attr: PositionAttribution = {
      id: buildAttributionId(ACCT, 'inst-1'),
      accountNumber: ACCT,
      instrumentId: 'inst-1',
      bucketId: b2,
      history: [
        { fromBucketId: null, toBucketId: b1, at: '2026-09-25T10:00:00Z' },
        { fromBucketId: b1, toBucketId: b2, at: NOW },
      ],
      createdAt: '2026-09-25T10:00:00Z',
      updatedAt: NOW,
    };
    expect(attr.history[attr.history.length - 1].toBucketId).toBe(attr.bucketId);
  });
});

describe('BucketStats', () => {
  it('carries the v1 rollup fields incl. as-of label and shared curve type', () => {
    const curve: EquityCurvePoint[] = [{ date: '2026-09-26', cumulativePnl: 90 }];
    const s: BucketStats = {
      bucketId: makeBucket().id,
      exposure: 5000,
      netValue: 5000,
      targetDollars: 25000,
      drift: -20000,
      realizedPnl: 120,
      unrealizedPnl: -30,
      openCount: 2,
      closedCount: 1,
      asOf: NOW,
      equityCurve: curve,
    };
    // Required field SET on the type — sorted so declaration order doesn't
    // matter (compile fails if a field is dropped or renamed).
    expect(Object.keys(s).sort()).toEqual([
      'asOf', 'bucketId', 'closedCount', 'drift', 'equityCurve', 'exposure',
      'netValue', 'openCount', 'realizedPnl', 'targetDollars', 'unrealizedPnl',
    ]);
  });
});
