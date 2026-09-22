/// <reference types="jest" />
/**
 * SymbolListService — legacy PAST_SIGNALS → MONITOR migration inside
 * loadAllLists. Firestore and Auth are mocked at the @angular/fire
 * boundary; doc() returns an identifiable ref so write paths can be
 * asserted.
 */

const mockBatch = {
  set: jest.fn(),
  delete: jest.fn(),
  commit: jest.fn(() => Promise.resolve()),
};

jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: jest.fn(() => ({ path: 'symbol-lists' })),
  doc: jest.fn((_fs: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
  setDoc: jest.fn(() => Promise.resolve()),
  deleteDoc: jest.fn(() => Promise.resolve()),
  getDoc: jest.fn(() => Promise.resolve({ exists: () => false, data: () => undefined })),
  getDocs: jest.fn(),
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
import { firstValueFrom, of } from 'rxjs';
import { Firestore, getDocs, setDoc, deleteDoc, writeBatch } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { SymbolListService } from './symbol-list.service';

function snapOf(docs: { id: string; data: Record<string, unknown> }[]) {
  return { docs: docs.map((d) => ({ id: d.id, data: () => d.data })) };
}

describe('SymbolListService.loadAllLists legacy migration', () => {
  let service: SymbolListService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBatch.commit.mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: {} },
      ],
    });
    service = TestBed.inject(SymbolListService);
  });

  it('renames a legacy PAST_SIGNALS doc to MONITOR and deletes the old doc in one batch', async () => {
    (getDocs as jest.Mock).mockReturnValue(Promise.resolve(snapOf([
      { id: 'PAST_SIGNALS', data: { name: 'PAST_SIGNALS', symbols: ['AAPL'], userId: 'user-1' } },
      { id: 'PRIMARY', data: { name: 'PRIMARY', symbols: ['MSFT'], userId: 'user-1' } },
    ])));

    const lists = await firstValueFrom(service.loadAllLists());

    expect(lists.map((l) => l.name).sort()).toEqual(['MONITOR', 'PRIMARY']);
    expect(lists.find((l) => l.name === 'MONITOR')?.symbols).toEqual(['AAPL']);
    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'savant-trader/data/symbol-lists/MONITOR' }),
      expect.objectContaining({ name: 'MONITOR', symbols: ['AAPL'], userId: 'user-1' }),
    );
    expect(mockBatch.delete).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'savant-trader/data/symbol-lists/PAST_SIGNALS' }),
    );
    expect(mockBatch.commit).toHaveBeenCalled();
  });

  it('merges into an existing MONITOR doc instead of overwriting it', async () => {
    (getDocs as jest.Mock).mockReturnValue(Promise.resolve(snapOf([
      { id: 'PAST_SIGNALS', data: { name: 'PAST_SIGNALS', symbols: ['AAPL'], userId: 'user-1' } },
      { id: 'MONITOR', data: { name: 'MONITOR', symbols: ['MSFT'], userId: 'user-1' } },
    ])));

    const lists = await firstValueFrom(service.loadAllLists());

    const monitor = lists.find((l) => l.name === 'MONITOR');
    expect(monitor?.symbols).toEqual(['MSFT', 'AAPL']);
    expect(lists.find((l) => l.name === 'PAST_SIGNALS')).toBeUndefined();
    expect(mockBatch.delete).toHaveBeenCalled();
  });

  it('returns the unmigrated lists when the batch write fails', async () => {
    (getDocs as jest.Mock).mockReturnValue(Promise.resolve(snapOf([
      { id: 'PAST_SIGNALS', data: { name: 'PAST_SIGNALS', symbols: ['AAPL'], userId: 'user-1' } },
    ])));
    mockBatch.commit.mockRejectedValue(new Error('permission denied'));

    const lists = await firstValueFrom(service.loadAllLists());

    expect(lists.map((l) => l.name)).toEqual(['PAST_SIGNALS']);
    expect(writeBatch).toHaveBeenCalled();
  });

  it('is a no-op when no legacy doc exists', async () => {
    (getDocs as jest.Mock).mockReturnValue(Promise.resolve(snapOf([
      { id: 'MONITOR', data: { name: 'MONITOR', symbols: ['MSFT'], userId: 'user-1' } },
    ])));

    const lists = await firstValueFrom(service.loadAllLists());

    expect(lists.map((l) => l.name)).toEqual(['MONITOR']);
    expect(writeBatch).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
    expect(deleteDoc).not.toHaveBeenCalled();
  });
});
