/**
 * PositionAttributionService — attribution writes on
 * portfolio/attributions/items (Blueprint #582 / task #586).
 *
 * Asserts the history-append contract, linkKey group atomicity,
 * retired-bucket rejection, and ticket seeding resolution rules.
 */

const mockTxn = {
  get: jest.fn(),
  set: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};
const mockSnap = { subject: undefined as unknown as import('rxjs').Subject<unknown> };
const mockDocs = { attributions: [] as { id: string; data: PositionAttribution }[] };

jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: jest.fn((_fs: unknown, path: string) => ({ path })),
  collectionSnapshots: jest.fn(() => mockSnap.subject.asObservable()),
  doc: jest.fn((_fs: unknown, col: string, id: string) => ({ path: `${col}/${id}` })),
  getDocs: jest.fn((q: { args?: unknown[] }) => {
    // Route by which collection the query targets: collection() is the
    // first query() arg — our mock embeds its path.
    const collPath = (q.args?.[0] as { path?: string })?.path ?? '';
    const source = collPath.endsWith('/attributions/items') || collPath.includes('attributions')
      ? mockDocs.attributions
      : [];
    return Promise.resolve({ docs: source.map((d) => ({ id: d.id, data: () => d.data })) });
  }),
  query: jest.fn((...args: unknown[]) => ({ args })),
  runTransaction: jest.fn((_fs: unknown, fn: (t: unknown) => Promise<unknown>) => fn(mockTxn)),
  setDoc: jest.fn(() => Promise.resolve()),
  updateDoc: jest.fn(() => Promise.resolve()),
  where: jest.fn((field: string, op: string, val: unknown) => ({ field, op, val })),
}));
jest.mock('@angular/fire/auth', () => ({
  Auth: class {},
  authState: jest.fn(() => of({ uid: 'user-1' })),
}));

import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, Subject } from 'rxjs';
import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { PositionAttributionService } from './position-attribution.service';
import { BucketStatus, type AllocationBucket, type PositionAttribution } from '@portfolio-allocation/contracts';

const ACCT = '5AC12345';

function bucket(over: Partial<AllocationBucket> = {}): AllocationBucket {
  return {
    id: `${ACCT}_csp-wheel`,
    userId: 'user-1',
    accountNumber: ACCT,
    name: 'CSP Wheel',
    targetPct: 25,
    status: BucketStatus.ACTIVE,
    createdAt: '2026-09-26T00:00:00Z',
    updatedAt: '2026-09-26T00:00:00Z',
    ...over,
  };
}

function attribution(over: Partial<PositionAttribution> = {}): PositionAttribution {
  return {
    id: `${ACCT}_AAPL`,
    userId: 'user-1',
    accountNumber: ACCT,
    instrumentId: 'AAPL',
    bucketId: `${ACCT}_csp-wheel`,
    history: [{ fromBucketId: null, toBucketId: `${ACCT}_csp-wheel`, at: '2026-09-25T00:00:00Z' }],
    createdAt: '2026-09-25T00:00:00Z',
    updatedAt: '2026-09-25T00:00:00Z',
    ...over,
  };
}

/** Wire txn.get by doc path suffix — buckets/attributions lookups share it. */
function txnSeeds(docsByPathSuffix: Record<string, unknown>) {
  mockTxn.get.mockImplementation((ref: { path: string }) => {
    for (const [suffix, data] of Object.entries(docsByPathSuffix)) {
      if (ref.path.endsWith(suffix)) {
        return Promise.resolve({ exists: () => data !== undefined, data: () => data });
      }
    }
    return Promise.resolve({ exists: () => false, data: () => undefined });
  });
}

describe('PositionAttributionService', () => {
  let service: PositionAttributionService;

  beforeEach(() => {
    mockSnap.subject = new Subject<unknown>();
    mockDocs.attributions = [];
    jest.clearAllMocks();
    txnSeeds({});
    TestBed.configureTestingModule({
      providers: [
        PositionAttributionService,
        { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: {} },
      ],
    });
    service = TestBed.inject(PositionAttributionService);
  });

  it('watchAttributions$ streams docs for the account', async () => {
    const promise = firstValueFrom(service.watchAttributions$(ACCT));
    mockSnap.subject.next([{ id: attribution().id, data: () => attribution() }]);
    expect(await promise).toEqual([attribution()]);
  });

  it('assign on an unattributed position writes fromBucketId: null', async () => {
    txnSeeds({ [`${ACCT}_csp-wheel`]: bucket() });
    await firstValueFrom(service.attribute$(ACCT, 'AAPL', `${ACCT}_csp-wheel`));
    const [, written] = mockTxn.set.mock.calls[0];
    expect(written).toMatchObject({
      id: `${ACCT}_AAPL`,
      bucketId: `${ACCT}_csp-wheel`,
      history: [{ fromBucketId: null, toBucketId: `${ACCT}_csp-wheel` }],
    });
  });

  it('move on an attributed position appends a from→to event', async () => {
    const existing = attribution();
    mockDocs.attributions = [{ id: existing.id, data: existing }];
    txnSeeds({
      [`${ACCT}_leaps`]: bucket({ id: `${ACCT}_leaps`, name: 'LEAP Drops' }),
      [`${ACCT}_AAPL`]: existing,
    });
    await firstValueFrom(service.attribute$(ACCT, 'AAPL', `${ACCT}_leaps`));
    const [, written] = mockTxn.set.mock.calls[0];
    expect(written.history).toHaveLength(2);
    expect(written.history[1]).toMatchObject({
      fromBucketId: `${ACCT}_csp-wheel`,
      toBucketId: `${ACCT}_leaps`,
    });
    expect(written.bucketId).toBe(`${ACCT}_leaps`);
  });

  it('rejects attribution to a RETIRED bucket', async () => {
    txnSeeds({ [`${ACCT}_csp-wheel`]: bucket({ status: BucketStatus.RETIRED }) });
    await expect(firstValueFrom(service.attribute$(ACCT, 'AAPL', `${ACCT}_csp-wheel`)))
      .rejects.toThrow('missing or retired');
    expect(mockTxn.set).not.toHaveBeenCalled();
  });

  it('moves every linkKey sibling atomically', async () => {
    const leg1 = attribution({ id: `${ACCT}_leg1`, instrumentId: 'leg1', linkKey: 'ord-9' });
    const leg2 = attribution({ id: `${ACCT}_leg2`, instrumentId: 'leg2', linkKey: 'ord-9' });
    const other = attribution({ id: `${ACCT}_AAPL`, instrumentId: 'AAPL' }); // unlinked
    mockDocs.attributions = [leg1, leg2, other].map((a) => ({ id: a.id, data: a }));
    txnSeeds({
      [`${ACCT}_leaps`]: bucket({ id: `${ACCT}_leaps`, name: 'LEAP Drops' }),
      [`${ACCT}_leg1`]: leg1,
      [`${ACCT}_leg2`]: leg2,
      [`${ACCT}_AAPL`]: other,
    });

    await firstValueFrom(service.attribute$(ACCT, 'leg1', `${ACCT}_leaps`));

    const writtenPaths = mockTxn.set.mock.calls.map((c) => (c[0] as { path: string }).path);
    expect(writtenPaths).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`${ACCT}_leg1`),
        expect.stringContaining(`${ACCT}_leg2`),
      ]),
    );
    expect(writtenPaths).toHaveLength(2); // the unlinked position is untouched
    for (const [, written] of mockTxn.set.mock.calls) {
      expect(written.bucketId).toBe(`${ACCT}_leaps`);
    }

    // Firestore txns require ALL reads before ALL writes — assert the
    // ordering the production SDK enforces (mock txn can't).
    const getOrder = mockTxn.get.mock.invocationCallOrder;
    const setOrder = mockTxn.set.mock.invocationCallOrder;
    expect(Math.max(...getOrder)).toBeLessThan(Math.min(...setOrder));
  });

  it('rejects a bucket belonging to a different account', async () => {
    txnSeeds({ '999XLEAPS_leaps': bucket({ id: '999XLEAPS_leaps', accountNumber: '999XLEAPS', name: 'L' }) });
    await expect(firstValueFrom(service.attribute$(ACCT, 'AAPL', '999XLEAPS_leaps')))
      .rejects.toThrow('different account');
    expect(mockTxn.set).not.toHaveBeenCalled();
  });

  it('rejects a nonexistent target bucket', async () => {
    txnSeeds({}); // nothing exists
    await expect(firstValueFrom(service.attribute$(ACCT, 'AAPL', `${ACCT}_ghost`)))
      .rejects.toThrow('missing or retired');
  });

  it('linkKey param joins an unlinked position to a group', async () => {
    const leg1 = attribution({ id: `${ACCT}_leg1`, instrumentId: 'leg1', linkKey: 'ord-9' });
    const leg2 = attribution({ id: `${ACCT}_leg2`, instrumentId: 'leg2', linkKey: 'ord-9' });
    mockDocs.attributions = [leg1, leg2].map((a) => ({ id: a.id, data: a }));
    txnSeeds({ [`${ACCT}_leaps`]: bucket({ id: `${ACCT}_leaps`, name: 'LEAP Drops' }) });

    // Assign MSFT (no existing doc) with linkKey → it joins ord-9's group.
    await firstValueFrom(service.attribute$(ACCT, 'MSFT', `${ACCT}_leaps`, 'ord-9'));

    const paths = mockTxn.set.mock.calls.map((c) => (c[0] as { path: string }).path);
    expect(paths).toHaveLength(3); // MSFT + leg1 + leg2 all move together
    expect(paths.some((p) => p.endsWith(`${ACCT}_MSFT`))).toBe(true);
    const msftWrite = mockTxn.set.mock.calls.find((c) =>
      (c[0] as { path: string }).path.endsWith(`${ACCT}_MSFT`));
    expect((msftWrite?.[1] as { linkKey?: string }).linkKey).toBe('ord-9');
  });

  it('unassign$ deletes the doc — and every linkKey sibling', async () => {
    const leg1 = attribution({ id: `${ACCT}_leg1`, instrumentId: 'leg1', linkKey: 'ord-9' });
    const leg2 = attribution({ id: `${ACCT}_leg2`, instrumentId: 'leg2', linkKey: 'ord-9' });
    const solo = attribution({ id: `${ACCT}_NVDA`, instrumentId: 'NVDA' });
    mockDocs.attributions = [leg1, leg2, solo].map((a) => ({ id: a.id, data: a }));

    await firstValueFrom(service.unassign$(ACCT, 'leg1'));

    const deleted = mockTxn.delete.mock.calls.map((c) => (c[0] as { path: string }).path);
    expect(deleted).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`${ACCT}_leg1`),
        expect.stringContaining(`${ACCT}_leg2`),
      ]),
    );
    expect(deleted).toHaveLength(2); // unlinked NVDA untouched
  });

  it('attributeMany$ writes all items + linkKey siblings in ONE txn', async () => {
    const other = `${ACCT}_other`;
    const leg1 = attribution({ id: `${ACCT}_leg1`, instrumentId: 'leg1', bucketId: other, linkKey: 'ord-9' });
    const leg2 = attribution({ id: `${ACCT}_leg2`, instrumentId: 'leg2', bucketId: other, linkKey: 'ord-9' });
    mockDocs.attributions = [leg1, leg2].map((a) => ({ id: a.id, data: a }));
    txnSeeds({
      [`${ACCT}_csp-wheel`]: bucket(),
      [`${ACCT}_leg1`]: leg1,
      [`${ACCT}_leg2`]: leg2,
    });
    const { runTransaction } = await import('@angular/fire/firestore');

    await firstValueFrom(service.attributeMany$(ACCT, [
      { instrumentId: 'leg1', linkKey: 'ord-9' },  // pulls leg2 via the group
      { instrumentId: 'MSFT' },
    ], `${ACCT}_csp-wheel`));

    expect(runTransaction).toHaveBeenCalledTimes(1);
    const writtenPaths = mockTxn.set.mock.calls.map((c) => (c[0] as { path: string }).path);
    expect(writtenPaths).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`${ACCT}_leg1`),
        expect.stringContaining(`${ACCT}_leg2`), // sibling moves with the group
        expect.stringContaining(`${ACCT}_MSFT`),
      ]),
    );
  });

  it('attributeMany$ rejects a retired bucket before any write', async () => {
    txnSeeds({ [`${ACCT}_csp-wheel`]: bucket({ status: BucketStatus.RETIRED }) });
    await expect(firstValueFrom(
      service.attributeMany$(ACCT, [{ instrumentId: 'MSFT' }], `${ACCT}_csp-wheel`),
    )).rejects.toThrow('missing or retired');
    expect(mockTxn.set).not.toHaveBeenCalled();
  });

  it('unassignMany$ deletes every checked id + group siblings in ONE txn', async () => {
    const leg1 = attribution({ id: `${ACCT}_leg1`, instrumentId: 'leg1', linkKey: 'ord-9' });
    const leg2 = attribution({ id: `${ACCT}_leg2`, instrumentId: 'leg2', linkKey: 'ord-9' });
    const aapl = attribution({ id: `${ACCT}_AAPL`, instrumentId: 'AAPL' });
    mockDocs.attributions = [leg1, leg2, aapl].map((a) => ({ id: a.id, data: a }));
    const { runTransaction } = await import('@angular/fire/firestore');

    await firstValueFrom(service.unassignMany$(ACCT, ['leg1', 'AAPL']));

    expect(runTransaction).toHaveBeenCalledTimes(1);
    const deleted = mockTxn.delete.mock.calls.map((c) => (c[0] as { path: string }).path);
    expect(deleted).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`${ACCT}_leg1`),
        expect.stringContaining(`${ACCT}_leg2`), // sibling rides along
        expect.stringContaining(`${ACCT}_AAPL`),
      ]),
    );
    expect(deleted).toHaveLength(3);
  });

  it('seedFromTicket$ writes the attribution for the ticket\'s bucketId, with linkKey', async () => {
    txnSeeds({ [`${ACCT}_csp-wheel`]: bucket() });

    const res = await firstValueFrom(service.seedFromTicket$(ACCT, 'AAPL', `${ACCT}_csp-wheel`, 'ord-7'));
    expect(res?.bucketId).toBe(`${ACCT}_csp-wheel`);
    const [, written] = mockTxn.set.mock.calls[0];
    expect(written).toMatchObject({ bucketId: `${ACCT}_csp-wheel`, linkKey: 'ord-7' });
  });

  it('stamps linkKey on a doc already at the target bucket (identity move records join)', async () => {
    const existing = attribution(); // AAPL in csp-wheel, no linkKey
    mockDocs.attributions = [{ id: existing.id, data: existing }];
    txnSeeds({ [`${ACCT}_csp-wheel`]: bucket(), [`${ACCT}_AAPL`]: existing });

    await firstValueFrom(service.attribute$(ACCT, 'AAPL', `${ACCT}_csp-wheel`, 'ord-9'));

    expect(mockTxn.set).toHaveBeenCalledTimes(1);
    const [, written] = mockTxn.set.mock.calls[0];
    expect(written.linkKey).toBe('ord-9');
    expect(written.history).toHaveLength(2); // identity event recorded
  });

  it('is a pure no-op when already at target AND already carrying the same linkKey', async () => {
    const existing = attribution({ linkKey: 'ord-9' });
    mockDocs.attributions = [{ id: existing.id, data: existing }];
    txnSeeds({ [`${ACCT}_csp-wheel`]: bucket(), [`${ACCT}_AAPL`]: existing });

    await firstValueFrom(service.attribute$(ACCT, 'AAPL', `${ACCT}_csp-wheel`, 'ord-9'));
    expect(mockTxn.set).not.toHaveBeenCalled();
  });

  it('seedFromTicket$ returns null when the attribution doc already exists', async () => {
    txnSeeds({
      [`${ACCT}_AAPL`]: attribution(),
      [`${ACCT}_csp-wheel`]: bucket(),
    });
    const res = await firstValueFrom(service.seedFromTicket$(ACCT, 'AAPL', `${ACCT}_csp-wheel`, 'ord-7'));
    expect(res).toBeNull();
    expect(mockTxn.set).not.toHaveBeenCalled();
  });

  it('seedFromTicket$ is a no-op when the bucket is missing, retired, or on another account', async () => {
    // Missing bucket doc.
    txnSeeds({});
    expect(await firstValueFrom(service.seedFromTicket$(ACCT, 'AAPL', `${ACCT}_csp-wheel`))).toBeNull();

    // Retired.
    txnSeeds({ [`${ACCT}_csp-wheel`]: bucket({ status: BucketStatus.RETIRED }) });
    expect(await firstValueFrom(service.seedFromTicket$(ACCT, 'AAPL', `${ACCT}_csp-wheel`))).toBeNull();

    // Bucket doc exists but belongs to a different account — a stale or
    // hand-built bucketId must never leak cross-account attribution.
    txnSeeds({ [`${ACCT}_csp-wheel`]: bucket({ accountNumber: 'OTHER-ACCT' }) });
    expect(await firstValueFrom(service.seedFromTicket$(ACCT, 'AAPL', `${ACCT}_csp-wheel`))).toBeNull();

    expect(mockTxn.set).not.toHaveBeenCalled();
  });

  it('seedFromTicket$ is a no-op when the ticket has no bucketId', async () => {
    expect(await firstValueFrom(service.seedFromTicket$(ACCT, 'AAPL', undefined))).toBeNull();
    expect(mockTxn.set).not.toHaveBeenCalled();
  });
});
