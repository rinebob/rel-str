/**
 * AllocationBucketService — bucket CRUD on portfolio/buckets/items
 * (Blueprint #582 / task #586).
 *
 * Firestore and Auth are mocked at the @angular/fire boundary; doc()
 * returns an identifiable ref so write/transaction paths can be asserted.
 */

const mockTxn = {
  get: jest.fn(),
  set: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};
const mockSnap = { subject: undefined as unknown as import('rxjs').Subject<unknown> };

jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: jest.fn((_fs: unknown, path: string) => ({ path })),
  collectionSnapshots: jest.fn(() => mockSnap.subject.asObservable()),
  doc: jest.fn((_fs: unknown, col: string, id: string) => ({ path: `${col}/${id}` })),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
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
import { Firestore, getDocs, updateDoc, where } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { AllocationBucketService } from './allocation-bucket.service';
import { BucketStatus, type AllocationBucket } from '@portfolio-allocation/contracts';
import { PORTFOLIO_BUCKETS_COLLECTION } from '@portfolio-allocation/ids';

const ACCT = '5AC12345';

function bucketDoc(over: Partial<AllocationBucket> = {}): AllocationBucket {
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

describe('AllocationBucketService', () => {
  let service: AllocationBucketService;

  beforeEach(() => {
    mockSnap.subject = new Subject<unknown>();
    jest.clearAllMocks();
    mockTxn.get.mockResolvedValue({ exists: () => false, data: () => undefined });
    (getDocs as jest.Mock).mockResolvedValue({ docs: [] });
    TestBed.configureTestingModule({
      providers: [
        AllocationBucketService,
        { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: {} },
      ],
    });
    service = TestBed.inject(AllocationBucketService);
  });

  it('watchBuckets$ queries userId + accountNumber and maps doc data', async () => {
    const promise = firstValueFrom(service.watchBuckets$(ACCT));
    mockSnap.subject.next([{ id: bucketDoc().id, data: () => bucketDoc() }]);
    const buckets = await promise;
    expect(where).toHaveBeenCalledWith('userId', '==', 'user-1');
    expect(where).toHaveBeenCalledWith('accountNumber', '==', ACCT);
    expect(buckets).toEqual([bucketDoc()]);
  });

  it('listBuckets$ returns typed docs for the account', async () => {
    (getDocs as jest.Mock).mockResolvedValue({
      docs: [{ data: () => bucketDoc() }],
    });
    const buckets = await firstValueFrom(service.listBuckets$(ACCT));
    expect(buckets).toEqual([bucketDoc()]);
  });

  it('createBucket$ writes the composite-id doc when free', async () => {
    const created = await firstValueFrom(service.createBucket$(ACCT, 'CSP Wheel', 25));
    expect(created.id).toBe(`${ACCT}_csp-wheel`);
    expect(created.userId).toBe('user-1');
    expect(created.status).toBe(BucketStatus.ACTIVE);
    expect(mockTxn.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: `${PORTFOLIO_BUCKETS_COLLECTION}/${ACCT}_csp-wheel` }),
      expect.objectContaining({ name: 'CSP Wheel', targetPct: 25 }),
    );
  });

  it('createBucket$ throws a name-conflict when the slug id is occupied', async () => {
    mockTxn.get.mockResolvedValue({ exists: () => true });
    await expect(firstValueFrom(service.createBucket$(ACCT, 'CSP:Wheel', 25)))
      .rejects.toThrow('name conflict');
    expect(mockTxn.set).not.toHaveBeenCalled();
  });

  it('createBucket$ throws on an un-slugifiable name', async () => {
    await expect(firstValueFrom(service.createBucket$(ACCT, '!!!', 25)))
      .rejects.toThrow();
  });

  it('renameBucket$ updates name only — id stays the creation slug', async () => {
    // New name slugs to a free id → allowed. Current doc supplies
    // accountNumber for the conflict probe.
    mockTxn.get.mockImplementation((ref: { path: string }) =>
      Promise.resolve({
        exists: () => ref.path.endsWith('_csp-wheel'),
        data: () => bucketDoc(),
      }));
    await firstValueFrom(service.renameBucket$(bucketDoc(), 'Wheel v2'));
    expect(mockTxn.update).toHaveBeenCalledWith(
      expect.objectContaining({ path: `${PORTFOLIO_BUCKETS_COLLECTION}/${ACCT}_csp-wheel` }),
      expect.objectContaining({ name: 'Wheel v2' }),
    );
  });

  it('renameBucket$ rejects a name whose slug id is occupied by another doc', async () => {
    // Every get() reports existing → the candidate new id is occupied.
    mockTxn.get.mockResolvedValue({ exists: () => true, data: () => bucketDoc() });
    await expect(firstValueFrom(service.renameBucket$(bucketDoc(), 'LEAP Drops')))
      .rejects.toThrow('name conflict');
    expect(mockTxn.update).not.toHaveBeenCalled();
  });

  it('renameBucket$ throws when the bucket doc is missing', async () => {
    mockTxn.get.mockResolvedValue({ exists: () => false, data: () => undefined });
    await expect(firstValueFrom(service.renameBucket$(bucketDoc(), 'New Name')))
      .rejects.toThrow('does not exist');
  });

  it('retireBucket$ flips status to RETIRED and keeps the doc', async () => {
    await firstValueFrom(service.retireBucket$(`${ACCT}_csp-wheel`));
    expect(updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: `${PORTFOLIO_BUCKETS_COLLECTION}/${ACCT}_csp-wheel` }),
      expect.objectContaining({ status: BucketStatus.RETIRED }),
    );
  });

  it('updateTargetPct$ writes the new target', async () => {
    await firstValueFrom(service.updateTargetPct$(`${ACCT}_csp-wheel`, 40));
    expect(updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: `${PORTFOLIO_BUCKETS_COLLECTION}/${ACCT}_csp-wheel` }),
      expect.objectContaining({ targetPct: 40 }),
    );
  });

  it('deleteBucket$ deletes the bucket + every attribution doc in one txn', async () => {
    (getDocs as jest.Mock).mockResolvedValue({
      docs: [
        { id: 'a1', ref: { path: 'attr/a1' }, data: () => ({}) },
        { id: 'a2', ref: { path: 'attr/a2' }, data: () => ({}) },
      ],
    });
    await firstValueFrom(service.deleteBucket$(`${ACCT}_csp-wheel`));
    expect(mockTxn.delete).toHaveBeenCalledTimes(3);
    expect(mockTxn.delete).toHaveBeenCalledWith({ path: 'attr/a1' });
    expect(mockTxn.delete).toHaveBeenCalledWith({ path: 'attr/a2' });
    expect(mockTxn.delete).toHaveBeenCalledWith(
      expect.objectContaining({ path: `${PORTFOLIO_BUCKETS_COLLECTION}/${ACCT}_csp-wheel` }),
    );
    // The membership query scopes by owner + bucket.
    expect(where).toHaveBeenCalledWith('bucketId', '==', `${ACCT}_csp-wheel`);
  });

  it('deleteBucket$ with no contents deletes just the bucket doc', async () => {
    (getDocs as jest.Mock).mockResolvedValue({ docs: [] });
    await firstValueFrom(service.deleteBucket$(`${ACCT}_csp-wheel`));
    expect(mockTxn.delete).toHaveBeenCalledTimes(1);
  });
});
