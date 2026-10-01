/**
 * AllocationStore — NgRx SignalStore for the Allocation Manager page
 * (Blueprint #582 / task #587).
 *
 * Account-scoped selectors: bucketRows (config + stats + computed Cash +
 * Unassigned pseudo-row), positionsRows (bucket name join), accountHeader
 * completeness check, bucketDetail(id). Attribution writes invalidate
 * dependent selectors via the attribution watch stream.
 */
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of, Subject } from 'rxjs';

import { AllocationStore } from './allocation.store';
import { AllocationDataService } from './allocation-data.service';
import { AllocationBucketService } from './allocation-bucket.service';
import { PositionAttributionService } from './position-attribution.service';
import {
  AllocationBucket,
  BucketStatus,
  PositionAttribution,
} from '@portfolio-allocation/contracts';
import type {
  AccountInfo,
  PortfolioSnapshot,
} from '../../core/robinhood-mcp/types/robinhood-mcp.types';
import type {
  AllocationFillInput,
  AllocationPositionInput,
} from '@portfolio-allocation/utils';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACCT_A = '5AC11111';
const ACCT_B = '9BB22222';
const NOW = '2026-09-26T12:00:00Z';

function account(num: string, agentic = true): AccountInfo {
  return { accountNumber: num, accountName: `Acct ${num}`, accountType: 'margin', agenticAllowed: agentic };
}

function snapshot(value: number, cash: number): PortfolioSnapshot {
  return { totalValue: value, equityValue: value - cash, cash, buyingPower: cash, marginExposure: null };
}

function bucket(acct: string, name: string, targetPct = 25, status = BucketStatus.ACTIVE): AllocationBucket {
  return {
    id: `${acct}_${name.toLowerCase().replace(/\s+/g, '-')}`,
    userId: 'uid-1',
    accountNumber: acct,
    name,
    targetPct,
    status,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function attribution(acct: string, instrumentId: string, bucketId: string, linkKey?: string): PositionAttribution {
  return {
    id: `${acct}_${instrumentId}`,
    userId: 'uid-1',
    accountNumber: acct,
    instrumentId,
    bucketId,
    ...(linkKey ? { linkKey } : {}),
    history: [{ fromBucketId: null, toBucketId: bucketId, at: NOW }],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function pos(instrumentId: string, marketValue: number, costBasis: number, quantity = 10): AllocationPositionInput {
  return { instrumentId, quantity, marketValue, costBasis };
}

function fill(instrumentId: string, side: 'buy' | 'sell', quantity: number, price: number, at = '2026-09-01T15:00:00Z'): AllocationFillInput {
  return { instrumentId, side, quantity, price, multiplier: 1, filledAt: at };
}

// ---------------------------------------------------------------------------
// Harness — per-account subjects so tests can push stream updates
// ---------------------------------------------------------------------------

interface Mocks {
  data: {
    listAccounts: jest.Mock<Promise<AccountInfo[]>, []>;
    getSnapshot: jest.Mock<Promise<PortfolioSnapshot>, [string]>;
    getPositions: jest.Mock<Promise<AllocationPositionInput[]>, [string]>;
    getFills: jest.Mock<Promise<AllocationFillInput[]>, [string]>;
  };
  buckets: jest.Mocked<Partial<AllocationBucketService>>;
  attrs: jest.Mocked<Partial<PositionAttributionService>>;
  bucketStreams: Map<string, Subject<AllocationBucket[]>>;
  attrStreams: Map<string, Subject<PositionAttribution[]>>;
}

function buildMocks(): Mocks {
  const bucketStreams = new Map<string, Subject<AllocationBucket[]>>();
  const attrStreams = new Map<string, Subject<PositionAttribution[]>>();
  const data = {
    listAccounts: jest.fn(async (): Promise<AccountInfo[]> => [account(ACCT_A), account(ACCT_B, false)]),
    getSnapshot: jest.fn(async (acct: string): Promise<PortfolioSnapshot> => snapshot(acct === ACCT_A ? 10000 : 5000, acct === ACCT_A ? 4000 : 1000)),
    getPositions: jest.fn(async (acct: string): Promise<AllocationPositionInput[]> => acct === ACCT_A
      ? [pos('AAPL', 1000, 800), pos('MSFT', 2000, 1900), pos('NVDA', 500, 400)]
      : [pos('TSLA', 300, 250)]),
    getFills: jest.fn(async (acct: string): Promise<AllocationFillInput[]> => acct === ACCT_A
      ? [fill('AAPL', 'buy', 10, 80), fill('AAPL', 'sell', 10, 95), fill('MSFT', 'buy', 10, 190)]
      : [fill('TSLA', 'buy', 2, 125)]),
  };
  const buckets = {
    watchBuckets$: jest.fn((acct: string) => {
      const s = new Subject<AllocationBucket[]>();
      bucketStreams.set(acct, s);
      return s.asObservable();
    }),
  };
  const attrs = {
    watchAttributions$: jest.fn((acct: string) => {
      const s = new Subject<PositionAttribution[]>();
      attrStreams.set(acct, s);
      return s.asObservable();
    }),
    attribute$: jest.fn(() => of(void 0)),
    unassign$: jest.fn(() => of(void 0)),
    attributeMany$: jest.fn(() => of(void 0)),
    unassignMany$: jest.fn(() => of(void 0)),
  };
  return { data, buckets, attrs, bucketStreams, attrStreams };
}

async function setup(mocks: Mocks) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: AllocationDataService, useValue: mocks.data },
      { provide: AllocationBucketService, useValue: mocks.buckets },
      { provide: PositionAttributionService, useValue: mocks.attrs },
      AllocationStore,
    ],
  });
  const store = TestBed.inject(AllocationStore);
  await store.loadAccounts();
  return { store, mocks };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** Push a bucket set + attribution set for account A (the default selected). */
function emitA(mocks: Mocks, buckets: AllocationBucket[], attrs: PositionAttribution[]) {
  mocks.bucketStreams.get(ACCT_A)?.next(buckets);
  mocks.attrStreams.get(ACCT_A)?.next(attrs);
}

// ===========================================================================

describe('AllocationStore', () => {
  it('loadAccounts surfaces ALL accounts — non-agentic included, unfiltered', async () => {
    const { store } = await setup(buildMocks());
    expect(store.accounts().map((a) => a.accountNumber)).toEqual([ACCT_A, ACCT_B]);
    expect(store.accounts()[1].agenticAllowed).toBe(false);
    expect(store.selectedAccount()?.accountNumber).toBe(ACCT_A);
  });

  it('loads snapshot + positions + fills for the selected account and stamps asOf', async () => {
    const { store } = await setup(buildMocks());
    await flush();
    const alloc = store.selectedAllocation();
    expect(alloc.snapshot?.cash).toBe(4000);
    expect(alloc.positions).toHaveLength(3);
    expect(alloc.asOf).not.toBeNull();
  });

  it('zero cross-account leakage — selectors only see the selected account', async () => {
    const { store, mocks } = await setup(buildMocks());
    await flush();
    emitA(mocks, [bucket(ACCT_A, 'Wheel')], [attribution(ACCT_A, 'AAPL', `${ACCT_A}_wheel`)]);

    // Simulate a leaked doc — an attribution for ACCT_B present in the stream
    mocks.attrStreams.get(ACCT_A)?.next([
      attribution(ACCT_A, 'AAPL', `${ACCT_A}_wheel`),
      attribution(ACCT_B, 'TSLA', `${ACCT_B}_other`), // foreign account doc
    ]);

    const rows = store.positionsRows();
    expect(rows).toHaveLength(3); // ACCT_A positions only
    expect(rows.map((r) => r.bucketName)).toEqual(['Wheel', 'Unassigned', 'Unassigned']);
    // TSLA (ACCT_B's position) never appears
    expect(rows.every((r) => r.position.instrumentId !== 'TSLA')).toBe(true);
  });

  it('bucketRows merges config + stats; Cash row pinned last; Unassigned between', async () => {
    const { store, mocks } = await setup(buildMocks());
    await flush();
    emitA(mocks,
      [bucket(ACCT_A, 'Wheel', 25), bucket(ACCT_A, 'LEAP Drops', 10)],
      [attribution(ACCT_A, 'AAPL', `${ACCT_A}_wheel`), attribution(ACCT_A, 'MSFT', `${ACCT_A}_leap-drops`)]);

    const rows = store.bucketRows();
    expect(rows.map((r) => r.kind)).toEqual(['bucket', 'bucket', 'unassigned', 'cash']);

    const wheel = rows[0];
    expect(wheel.bucket?.name).toBe('Wheel');
    // AAPL exposure 1000; target = 25% of cash 4000 = 1000 → drift 0
    expect(wheel.stats?.exposure).toBe(1000);
    expect(wheel.stats?.targetDollars).toBe(1000);
    expect(wheel.stats?.drift).toBe(0);
    // AAPL realized: buy 10 @80, sell 10 @95 → +150
    expect(wheel.stats?.realizedPnl).toBeCloseTo(150);

    const unassigned = rows.find((r) => r.kind === 'unassigned');
    // NVDA 500 unassigned
    expect(unassigned?.stats?.exposure).toBe(500);
    expect(unassigned?.stats?.openCount).toBe(1);

    const cash = rows.find((r) => r.kind === 'cash');
    expect(cash?.cash?.actual).toBe(4000);
    // derived = totalValue − Σ marketValue = 10000 − 3500 = 6500; diverged
    expect(cash?.cash?.derived).toBe(6500);
    expect(cash?.cash?.diverged).toBe(true);
  });

  it('accountHeader reports value / allocated / cash remainder for the account', async () => {
    const { store, mocks } = await setup(buildMocks());
    await flush();
    emitA(mocks,
      [bucket(ACCT_A, 'Wheel')],
      [attribution(ACCT_A, 'AAPL', `${ACCT_A}_wheel`), attribution(ACCT_A, 'MSFT', `${ACCT_A}_wheel`)]);

    const h = store.accountHeader();
    expect(h?.accountValue).toBe(10000);
    // allocated gross = AAPL 1000 + MSFT 2000 + NVDA 500 (unassigned counts as deployed)
    expect(h?.allocated).toBe(3500);
    expect(h?.unassignedExposure).toBe(500);
    expect(h?.cash).toBe(4000);
    expect(h?.cashDiverged).toBe(true);
  });

  it('positionsRows resolves bucket names; null-attribution rows are Unassigned', async () => {
    const { store, mocks } = await setup(buildMocks());
    await flush();
    emitA(mocks,
      [bucket(ACCT_A, 'Wheel')],
      [attribution(ACCT_A, 'AAPL', `${ACCT_A}_wheel`), attribution(ACCT_A, 'NVDA', `${ACCT_A}_wheel`, 'ord-1')]);

    const rows = store.positionsRows();
    const nvda = rows.find((r) => r.position.instrumentId === 'NVDA');
    expect(nvda?.bucketName).toBe('Wheel');
    expect(nvda?.linkKey).toBe('ord-1');
    const msft = rows.find((r) => r.position.instrumentId === 'MSFT');
    expect(msft?.bucketName).toBe('Unassigned');
    expect(msft?.bucketId).toBeNull();
  });

  it('positionsRows drops qty-0 placeholder rows (resting-order stubs, not positions)', async () => {
    // RH's positions endpoint returns type:'empty' qty-0 rows for symbols
    // with resting orders — they must never render or be assignable.
    const mocks = buildMocks();
    mocks.data.getPositions.mockImplementation(async (acct: string) => acct === ACCT_A
      ? [
        pos('AAPL', 1000, 800),
        pos('MU', 0, 0, 0),          // qty=0 resting-order stub
        pos('PLTR', NaN, NaN, 0),    // unpriced + qty 0
      ]
      : []);
    const { store } = await setup(mocks);
    await flush();
    const rows = store.positionsRows();
    expect(rows.map((r) => r.position.instrumentId)).toEqual(['AAPL']);
  });

  it('bucketDetail(id) returns the bucket, its stats, and its positions', async () => {
    const { store, mocks } = await setup(buildMocks());
    await flush();
    emitA(mocks,
      [bucket(ACCT_A, 'Wheel')],
      [attribution(ACCT_A, 'AAPL', `${ACCT_A}_wheel`)]);

    const detail = store.bucketDetail(ACCT_A, `${ACCT_A}_wheel`);
    expect(detail?.bucket?.name).toBe('Wheel');
    expect(detail?.stats?.openCount).toBe(1);
    expect(detail?.positions.map((p) => p.position.instrumentId)).toEqual(['AAPL']);
    // Fills follow attribution ownership — flat-but-attributed instruments
    // contribute; non-owned instruments never do.
    expect(detail?.fills.map((f) => f.instrumentId)).toEqual(['AAPL', 'AAPL']);
    expect(store.bucketDetail(ACCT_B, `${ACCT_B}_nonexistent`)).toBeNull();
    expect(store.bucketDetail(ACCT_A, `${ACCT_A}_nonexistent`)).toBeNull();
  });

  it('ensureAccount loads a non-selected account without changing selection', async () => {
    const { store, mocks } = await setup(buildMocks());
    await flush();
    expect(store.selectedAccount()?.accountNumber).toBe(ACCT_A);
    expect(store.byAccount()[ACCT_B]?.asOf ?? null).toBeNull(); // not yet loaded

    await store.ensureAccount(ACCT_B);

    // Selection untouched; ACCT_B slice populated + streams attached.
    expect(store.selectedAccount()?.accountNumber).toBe(ACCT_A);
    expect(store.byAccount()[ACCT_B]?.snapshot?.cash).toBe(1000);
    expect(store.byAccount()[ACCT_B]?.positions).toHaveLength(1);
    expect(mocks.bucketStreams.has(ACCT_B)).toBe(true);
    expect(mocks.attrStreams.has(ACCT_B)).toBe(true);
  });

  it('post-write selector refresh — attribution stream updates re-derive rows', async () => {
    const { store, mocks } = await setup(buildMocks());
    await flush();
    emitA(mocks, [bucket(ACCT_A, 'Wheel')], []);
    expect(store.positionsRows()[0].bucketName).toBe('Unassigned');

    // After assign, the watch stream emits the new doc — selectors update
    mocks.attrStreams.get(ACCT_A)?.next([attribution(ACCT_A, 'MSFT', `${ACCT_A}_wheel`)]);
    const msft = store.positionsRows().find((r) => r.position.instrumentId === 'MSFT');
    expect(msft?.bucketName).toBe('Wheel');
    const wheel = store.bucketRows().find((r) => r.bucket?.name === 'Wheel');
    expect(wheel?.stats?.exposure).toBe(2000); // MSFT only now
    expect(store.bucketDetail(ACCT_A, `${ACCT_A}_wheel`)?.positions).toHaveLength(1);
  });

  it('switching accounts attaches that account\'s streams and loads its data', async () => {
    const { store, mocks } = await setup(buildMocks());
    await flush();
    store.selectAccount(1);
    await flush();
    expect(mocks.buckets.watchBuckets$).toHaveBeenCalledWith(ACCT_B);
    expect(mocks.data.getPositions).toHaveBeenCalledWith(ACCT_B);
    expect(store.positionsRows().map((r) => r.position.instrumentId)).toEqual(['TSLA']);
    expect(store.selectedAllocation().snapshot?.cash).toBe(1000);
  });

  it('assign/move/unassign delegate to the attribution service', async () => {
    const { store, mocks } = await setup(buildMocks());
    await flush();
    await store.assignPosition(ACCT_A, 'MSFT', `${ACCT_A}_wheel`);
    expect(mocks.attrs.attribute$).toHaveBeenCalledWith(ACCT_A, 'MSFT', `${ACCT_A}_wheel`, undefined);
    await store.unassignPosition(ACCT_A, 'MSFT');
    expect(mocks.attrs.unassign$).toHaveBeenCalledWith(ACCT_A, 'MSFT');
  });

  it('bucket mutations delegate to the bucket service', async () => {
    const create$ = jest.fn(() => of(bucket(ACCT_A, 'New')));
    const mocks = buildMocks();
    (mocks.buckets as Record<string, unknown>).createBucket$ = create$;
    const { store } = await setup(mocks);
    await store.createBucket(ACCT_A, 'New', 30);
    expect(create$).toHaveBeenCalledWith(ACCT_A, 'New', 30);
  });

  it('per-account error surfaces in the account slice, not globally', async () => {
    const mocks = buildMocks();
    mocks.data.getPositions.mockRejectedValueOnce(new Error('mcp down'));
    const { store } = await setup(mocks);
    await flush();
    expect(store.selectedAllocation().error).toBe('mcp down');
    expect(store.loadError()).toBeNull();
  });

  it('refresh() reloads the account even after a successful load', async () => {
    const { store, mocks } = await setup(buildMocks());
    await flush();
    const before = mocks.data.getPositions.mock.calls.length;
    await store.refresh();
    expect(mocks.data.getPositions.mock.calls.length).toBeGreaterThan(before);
    expect(store.selectedAllocation().asOf).not.toBeNull();
  });

  it('loadAccounts failure surfaces as loadError with no accounts', async () => {
    const mocks = buildMocks();
    mocks.data.listAccounts.mockRejectedValueOnce(new Error('accounts down'));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: AllocationDataService, useValue: mocks.data },
        { provide: AllocationBucketService, useValue: mocks.buckets },
        { provide: PositionAttributionService, useValue: mocks.attrs },
        AllocationStore,
      ],
    });
    const store = TestBed.inject(AllocationStore);
    await store.loadAccounts();
    expect(store.loadError()).toBe('accounts down');
    expect(store.accounts()).toEqual([]);
    expect(store.selectedAccount()).toBeNull();
    expect(store.bucketRows()).toEqual([]);
  });

  it('loadAccounts preserves the selected account across reloads — resolved by accountNumber, not index', async () => {
    const mocks = buildMocks();
    const { store } = await setup(mocks);
    await flush();
    await store.selectAccount(1); // select ACCT_B
    // Account list reorders AND drops ACCT_A on the next load.
    mocks.data.listAccounts.mockResolvedValueOnce([account(ACCT_B, false), account('NEW33333')]);
    await store.loadAccounts();
    expect(store.selectedAccount()?.accountNumber).toBe(ACCT_B);
    // Select the NEW account, then remove it from the next list — the
    // selection falls back to index 0 rather than a stale pointer.
    await store.selectAccount(1); // NEW33333
    mocks.data.listAccounts.mockResolvedValueOnce([account(ACCT_A), account(ACCT_B, false)]);
    await store.loadAccounts();
    expect(store.selectedAccount()?.accountNumber).toBe(ACCT_A);
  });

  it('an errored stream re-attaches on next selectAccount', async () => {
    const { store, mocks } = await setup(buildMocks());
    await flush();
    mocks.attrStreams.get(ACCT_A)?.error(new Error('stream died'));
    expect(store.selectedAllocation().error).toBe('stream died');
    // Switch to B and back — the dead attribution sub is cleared and
    // watchAttributions$ is called again for ACCT_A.
    await store.selectAccount(1);
    await store.selectAccount(0);
    // Called for ACCT_A twice — initial attach + re-attach after error.
    const acctACalls = (mocks.attrs.watchAttributions$ as jest.Mock).mock.calls.filter((c) => c[0] === ACCT_A);
    expect(acctACalls).toHaveLength(2);
    expect(mocks.attrs.watchAttributions$).toHaveBeenLastCalledWith(ACCT_A);
  });

  it('dangling bucketId (attribution to a missing bucket) folds into Unassigned', async () => {
    const { store, mocks } = await setup(buildMocks());
    await flush();
    // AAPL attributed to a bucket that does not exist in the stream.
    emitA(mocks, [bucket(ACCT_A, 'Wheel')],
      [attribution(ACCT_A, 'AAPL', `${ACCT_A}_deleted-bucket`)]);
    const aapl = store.positionsRows().find((r) => r.position.instrumentId === 'AAPL');
    expect(aapl?.bucketName).toBe('Unknown bucket');
    // ...but the numbers must not vanish — Unassigned counts it.
    const unassigned = store.bucketRows().find((r) => r.kind === 'unassigned');
    // AAPL(1000) + MSFT(2000) + NVDA(500) all unassigned
    expect(unassigned?.stats?.exposure).toBe(3500);
    expect(store.accountHeader()?.unassignedExposure).toBe(3500);
  });

  it('Unassigned counts flat-but-traded instruments: realized P&L + closedCount', async () => {
    const mocks = buildMocks();
    // ACCT_A adds a sold-flat unassigned instrument: buy+sell FOO, no position.
    mocks.data.getFills.mockImplementation(async (acct: string): Promise<AllocationFillInput[]> => acct === ACCT_A
      ? [fill('AAPL', 'buy', 10, 80), fill('AAPL', 'sell', 10, 95),
         fill('FOO', 'buy', 5, 10, '2026-08-01T15:00:00Z'),
         fill('FOO', 'sell', 5, 14, '2026-08-05T15:00:00Z')]
      : []);
    const { store } = await setup(mocks);
    await flush();
    emitA(mocks, [bucket(ACCT_A, 'Wheel')], [attribution(ACCT_A, 'AAPL', `${ACCT_A}_wheel`)]);
    const unassigned = store.bucketRows().find((r) => r.kind === 'unassigned');
    // FOO realized: buy 5 @10, sell 5 @14 → +20, counted as closed
    expect(unassigned?.stats?.realizedPnl).toBeCloseTo(20);
    expect(unassigned?.stats?.closedCount).toBe(1);
    expect(unassigned?.stats?.openCount).toBe(2); // MSFT + NVDA
  });

  it('renameBucket delegates when the bucket is loaded; throws when it is not', async () => {
    const rename$ = jest.fn(() => of(void 0));
    const mocks = buildMocks();
    (mocks.buckets as Record<string, unknown>).renameBucket$ = rename$;
    const { store } = await setup(mocks);
    await flush();
    emitA(mocks, [bucket(ACCT_A, 'Wheel')], []);

    await store.renameBucket(ACCT_A, `${ACCT_A}_wheel`, 'Wheel v2');
    expect(rename$).toHaveBeenCalledWith(expect.objectContaining({ id: `${ACCT_A}_wheel` }), 'Wheel v2');
    await expect(store.renameBucket(ACCT_A, `${ACCT_A}_missing`, 'x'))
      .rejects.toThrow('not loaded');
  });
});
