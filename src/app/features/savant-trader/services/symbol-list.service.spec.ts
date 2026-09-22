/// <reference types="jest" />
/**
 * SymbolListService â€” registry read path (Topic #465, Thread #492).
 *
 * watchLists$ streams SymbolListDef[] via collectionSnapshots; legacy
 * pre-registry docs (bare-name ids, no `key` field) are lazily rekeyed to
 * `{userId}_{key}` and stamped from SYSTEM_LIST_DEFS in one batch.
 * loadAllLists stays as the compat one-shot adapter for existing consumers.
 *
 * Firestore and Auth are mocked at the @angular/fire boundary; doc()
 * returns an identifiable ref so write paths can be asserted.
 */

const mockBatch = {
  set: jest.fn(),
  delete: jest.fn(),
  commit: jest.fn(() => Promise.resolve()),
};
/** Holder assigned in beforeEach — constructing a Subject at module scope
 *  reads the rxjs import before it initializes under jest.mock hoisting. */
const mockSnap = { subject: undefined as unknown as Subject<unknown> };

jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: jest.fn(() => ({ path: 'symbol-lists' })),
  doc: jest.fn((_fs: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
  setDoc: jest.fn(() => Promise.resolve()),
  deleteDoc: jest.fn(() => Promise.resolve()),
  getDoc: jest.fn(() => Promise.resolve({ exists: () => false, data: () => undefined })),
  getDocs: jest.fn(),
  collectionSnapshots: jest.fn(() => mockSnap.subject.asObservable()),
  query: jest.fn((...args: unknown[]) => ({ args })),
  where: jest.fn(),
  writeBatch: jest.fn(() => mockBatch),
  Timestamp: class {},
  serverTimestamp: jest.fn(() => 'ts'),
}));
jest.mock('@angular/fire/auth', () => ({
  Auth: class {},
  authState: jest.fn(() => of({ uid: 'user-1' })),
}));

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { firstValueFrom, of, Subject } from 'rxjs';
import { Firestore, setDoc, getDoc, writeBatch } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { SymbolListService } from './symbol-list.service';
import type { SymbolListDef } from '../common/symbol-list-defs';

/** Push a doc snapshot array through the subject and flush async migration. */
async function emit(docs: { id: string; data: Record<string, unknown> }[]): Promise<void> {
  mockSnap.subject.next(docs.map((d) => ({ id: d.id, data: () => d.data })));
  await new Promise<void>((r) => setTimeout(r, 0));
}

function registryDoc(key: string, over: Record<string, unknown> = {}) {
  return {
    id: `user-1_${key}`,
    data: { key, label: key, order: 0, role: 'exclusive', hidden: false, symbols: [], userId: 'user-1', ...over },
  };
}

function setupService(): SymbolListService {
  mockSnap.subject = new Subject<unknown>();
  jest.clearAllMocks();
  // clearAllMocks doesn't reset implementations — restore getDoc's default.
  (getDoc as jest.Mock).mockImplementation(() =>
    Promise.resolve({ exists: () => false, data: () => undefined }),
  );
  mockBatch.commit.mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: Firestore, useValue: {} },
      { provide: Auth, useValue: {} },
    ],
  });
  return TestBed.inject(SymbolListService);
}

describe('SymbolListService.watchLists$', () => {
  let service: SymbolListService;

  beforeEach(() => {
    service = setupService();
  });

  it('emits defs unchanged for already-registry docs â€” no writes', async () => {
    const emissions: SymbolListDef[][] = [];
    const sub = service.watchLists$().subscribe((defs) => emissions.push(defs));

    await emit([registryDoc('PRIMARY', { symbols: ['AAPL'] })]);

    expect(emissions).toHaveLength(1);
    const def = emissions[0][0];
    expect(def).toEqual(expect.objectContaining({
      key: 'PRIMARY', label: 'PRIMARY', role: 'exclusive', symbols: ['AAPL'],
    }));
    expect(writeBatch).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('rekeys a legacy bare-name doc to {userId}_{key} and stamps metadata in one batch', async () => {
    const emissions: SymbolListDef[][] = [];
    const sub = service.watchLists$().subscribe((defs) => emissions.push(defs));

    await emit([
      { id: 'PRIMARY', data: { name: 'PRIMARY', symbols: ['MSFT'], userId: 'user-1' } },
    ]);

    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'savant-trader/data/symbol-lists/user-1_PRIMARY' }),
      expect.objectContaining({
        key: 'PRIMARY', label: 'Primary', order: 0, role: 'exclusive',
        hidden: false, symbols: ['MSFT'], userId: 'user-1',
      }),
      { merge: true },
    );
    expect(mockBatch.delete).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'savant-trader/data/symbol-lists/PRIMARY' }),
    );
    expect(mockBatch.commit).toHaveBeenCalled();

    const def = emissions[0].find((d) => d.key === 'PRIMARY');
    expect(def).toEqual(expect.objectContaining({ symbols: ['MSFT'], role: 'exclusive' }));
    sub.unsubscribe();
  });

  it('maps legacy PAST_SIGNALS to the MONITOR key', async () => {
    const emissions: SymbolListDef[][] = [];
    const sub = service.watchLists$().subscribe((defs) => emissions.push(defs));

    await emit([
      { id: 'PAST_SIGNALS', data: { name: 'PAST_SIGNALS', symbols: ['AAPL'], userId: 'user-1' } },
    ]);

    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'savant-trader/data/symbol-lists/user-1_MONITOR' }),
      expect.objectContaining({ key: 'MONITOR', role: 'nonexclusive', symbols: ['AAPL'] }),
      { merge: true },
    );
    expect(mockBatch.delete).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'savant-trader/data/symbol-lists/PAST_SIGNALS' }),
    );
    expect(emissions[0].map((d) => d.key)).toEqual(['MONITOR']);
    sub.unsubscribe();
  });

  it('merges a legacy doc into an existing registry doc with the same key', async () => {
    const emissions: SymbolListDef[][] = [];
    const sub = service.watchLists$().subscribe((defs) => emissions.push(defs));

    await emit([
      { id: 'PRIMARY', data: { name: 'PRIMARY', symbols: ['AAPL'], userId: 'user-1' } },
      registryDoc('PRIMARY', { symbols: ['MSFT'], label: 'Primary', order: 0, role: 'exclusive', hidden: false }),
    ]);

    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'savant-trader/data/symbol-lists/user-1_PRIMARY' }),
      expect.objectContaining({ symbols: ['MSFT', 'AAPL'] }),
      { merge: true },
    );
    const def = emissions[0].find((d) => d.key === 'PRIMARY');
    expect(def?.symbols).toEqual(['MSFT', 'AAPL']);
    sub.unsubscribe();
  });

  it('emits a best-effort def view when the migration batch fails', async () => {
    const emissions: SymbolListDef[][] = [];
    const sub = service.watchLists$().subscribe((defs) => emissions.push(defs));
    mockBatch.commit.mockRejectedValue(new Error('permission denied'));

    await emit([
      { id: 'PRIMARY', data: { name: 'PRIMARY', symbols: ['AAPL'], userId: 'user-1' } },
    ]);

    const def = emissions[0].find((d) => d.key === 'PRIMARY');
    expect(def?.symbols).toEqual(['AAPL']);
    expect(def?.role).toBe('exclusive');
    sub.unsubscribe();
  });

  it('unions symbols when two legacy docs resolve to the same key (PAST_SIGNALS + MONITOR)', async () => {
    const emissions: SymbolListDef[][] = [];
    const sub = service.watchLists$().subscribe((defs) => emissions.push(defs));

    await emit([
      { id: 'PAST_SIGNALS', data: { name: 'PAST_SIGNALS', symbols: ['AAPL'], userId: 'user-1' } },
      { id: 'MONITOR', data: { name: 'MONITOR', symbols: ['MSFT'], userId: 'user-1' } },
    ]);

    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'savant-trader/data/symbol-lists/user-1_MONITOR' }),
      expect.objectContaining({ symbols: ['MSFT', 'AAPL'] }),
      { merge: true },
    );
    const def = emissions[0].find((d) => d.key === 'MONITOR');
    expect(def?.symbols).toEqual(['MSFT', 'AAPL']);
    sub.unsubscribe();
  });

  it('does not delete a composite-id doc that lacks the key field — stamps it in place', async () => {
    const emissions: SymbolListDef[][] = [];
    const sub = service.watchLists$().subscribe((defs) => emissions.push(defs));

    await emit([
      { id: 'user-1_PRIMARY', data: { name: 'PRIMARY', symbols: ['X'], userId: 'user-1' } },
    ]);

    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'savant-trader/data/symbol-lists/user-1_PRIMARY' }),
      expect.objectContaining({ key: 'PRIMARY', symbols: ['X'] }),
      { merge: true },
    );
    expect(mockBatch.delete).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: 'savant-trader/data/symbol-lists/user-1_PRIMARY' }),
    );
    sub.unsubscribe();
  });

  it('migrates a bare-name doc that has no userId field (found via legacy-id probe)', async () => {
    (getDoc as jest.Mock).mockImplementation((ref: { path: string }) =>
      Promise.resolve(
        ref.path === 'savant-trader/data/symbol-lists/PRIMARY'
          ? { exists: () => true, data: () => ({ name: 'PRIMARY', symbols: ['T'] }) }
          : { exists: () => false, data: () => undefined },
      ),
    );
    const emissions: SymbolListDef[][] = [];
    const sub = service.watchLists$().subscribe((defs) => emissions.push(defs));

    // The filtered snapshot sees nothing — the probe finds the bare doc.
    await emit([registryDoc('MONITOR', { role: 'nonexclusive' })]);

    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'savant-trader/data/symbol-lists/user-1_PRIMARY' }),
      expect.objectContaining({ key: 'PRIMARY', symbols: ['T'] }),
      { merge: true },
    );
    expect(mockBatch.delete).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'savant-trader/data/symbol-lists/PRIMARY' }),
    );
    const def = emissions[0].find((d) => d.key === 'PRIMARY');
    expect(def?.symbols).toEqual(['T']);
    sub.unsubscribe();
  });

  it('emits defs sorted by order, not snapshot order', async () => {
    const emissions: SymbolListDef[][] = [];
    const sub = service.watchLists$().subscribe((defs) => emissions.push(defs));

    await emit([
      registryDoc('AVOID', { order: 3 }),
      registryDoc('PRIMARY', { order: 0 }),
    ]);

    expect(emissions[0].map((d) => d.key)).toEqual(['PRIMARY', 'AVOID']);
    sub.unsubscribe();
  });

  it('re-emits on every snapshot (live sync)', async () => {
    const emissions: SymbolListDef[][] = [];
    const sub = service.watchLists$().subscribe((defs) => emissions.push(defs));

    await emit([registryDoc('PRIMARY', { symbols: ['AAPL'] })]);
    await emit([registryDoc('PRIMARY', { symbols: ['AAPL', 'MSFT'] })]);

    expect(emissions).toHaveLength(2);
    expect(emissions[1][0].symbols).toEqual(['AAPL', 'MSFT']);
    sub.unsubscribe();
  });
});

describe('SymbolListService.loadAllLists compat adapter', () => {
  let service: SymbolListService;

  beforeEach(() => {
    service = setupService();
  });

  it('emits SymbolList[] with name = registry key, taking the first snapshot', async () => {
    const pending = firstValueFrom(service.loadAllLists());
    await emit([registryDoc('MONITOR', { role: 'nonexclusive', symbols: ['AAPL'] })]);

    const lists = await pending;
    expect(lists).toEqual([
      expect.objectContaining({ name: 'MONITOR', symbols: ['AAPL'] }),
    ]);
  });
});

describe('SymbolListService writes use composite doc ids', () => {
  let service: SymbolListService;

  beforeEach(() => {
    service = setupService();
  });

  it('addToList targets {userId}_{key}', async () => {
    await firstValueFrom(service.addToList('aapl', 'PRIMARY'));
    expect(setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'savant-trader/data/symbol-lists/user-1_PRIMARY' }),
      expect.objectContaining({ key: 'PRIMARY', symbols: ['AAPL'] }),
      { merge: true },
    );
  });

  it('removeFromList targets {userId}_{key}', async () => {
    await firstValueFrom(service.removeFromList('AAPL', 'MONITOR'));
    // Doc doesn't exist in the mock â€” early return, no write.
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('moveToList merges — registry metadata on the target doc survives the move', async () => {
    (getDoc as jest.Mock).mockImplementation((ref: { path: string }) =>
      Promise.resolve(
        ref.path.endsWith('user-1_PRIMARY') || ref.path.endsWith('user-1_SECONDARY')
          ? {
              exists: () => true,
              data: () => ({
                key: ref.path.split('_').pop(),
                label: 'Primary', order: 0, role: 'exclusive', hidden: false,
                symbols: ref.path.endsWith('user-1_PRIMARY') ? [] : ['AAPL'],
                userId: 'user-1',
              }),
            }
          : { exists: () => false, data: () => undefined },
      ),
    );

    await firstValueFrom(service.moveToList('AAPL', 'PRIMARY', ['PRIMARY', 'SECONDARY']));

    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'savant-trader/data/symbol-lists/user-1_PRIMARY' }),
      expect.objectContaining({ symbols: ['AAPL'] }),
      { merge: true },
    );
    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'savant-trader/data/symbol-lists/user-1_SECONDARY' }),
      expect.objectContaining({ symbols: [] }),
      { merge: true },
    );
    expect(mockBatch.commit).toHaveBeenCalled();
  });
});




