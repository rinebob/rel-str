/// <reference types="jest" />
/**
 * SymbolListStore â€” catalog computeds + snapshot-truth mutations
 * (Topic #465, Thread #492, task #525).
 *
 * The store derives everything from the live `watchLists$` emission:
 * catalog/byKey/byRole/untriagedSymbols are computeds over `listCatalog`,
 * `symbolLists` is a derived compat record, and mutations delegate to the
 * service with no optimistic patchState â€” the next snapshot is the truth.
 *
 * Seam: SymbolListService / RelStrDbV2Service / SignalService are mocked;
 * the real store is injected.
 */

jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: jest.fn(),
  collectionData: jest.fn(),
  doc: jest.fn(),
  setDoc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
}));
jest.mock('@angular/fire/auth', () => ({
  Auth: class {},
  authState: jest.fn(() => of({ uid: 'user-123' })),
}));
jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(),
}));

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of, Observable, Subject, throwError } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';

import { SymbolListStore } from './symbol-list.store';
import { SymbolListService } from '../services/symbol-list.service';
import { RelStrDbV2Service } from '../../services/rel-str-db-v2.service';
import { SignalService } from '../services/signal.service';
import type { SymbolListDef } from '../common/symbol-list-defs';
import type { SymbolListFilter } from '../common/constants';

// =============================================================================
// Fixtures
// =============================================================================

let watchSubject: Subject<SymbolListDef[]>;

function def(key: string, over: Partial<SymbolListDef> = {}): SymbolListDef {
  return {
    key, label: key, order: 0, role: 'exclusive', hidden: false,
    symbols: [], userId: 'user-123', ...over,
  };
}

interface Setup {
  listStore: InstanceType<typeof SymbolListStore>;
  listService: {
    watchLists$: jest.Mock;
    moveToList: jest.Mock;
    addToList: jest.Mock;
    removeFromList: jest.Mock;
    createList: jest.Mock;
    renameList: jest.Mock;
    deleteList: jest.Mock;
    setListOrder: jest.Mock;
  };
  db: { getTrackedSymbols$: jest.Mock };
  snackBar: { open: jest.Mock };
}

function setup(tracked: string[] = []): Setup {
  watchSubject = new Subject<SymbolListDef[]>();
  const listService = {
    watchLists$: jest.fn(() => watchSubject.asObservable()),
    moveToList: jest.fn(() => of(undefined)),
    addToList: jest.fn(() => of(undefined)),
    removeFromList: jest.fn(() => of(undefined)),
    createList: jest.fn(() => of('my-picks')),
    renameList: jest.fn(() => of(undefined)),
    deleteList: jest.fn(() => of(undefined)),
    setListOrder: jest.fn(() => of(undefined)),
  };
  const db = {
    getTrackedSymbols$: jest.fn(() => of(tracked.map((s) => ({ symbol: s, company: `${s} Corp` })))),
  };
  const snackBar = { open: jest.fn() };

  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: SymbolListService, useValue: listService },
      { provide: RelStrDbV2Service, useValue: db },
      { provide: SignalService, useValue: { getAllSymbols: jest.fn(() => of([])) } },
      { provide: MatSnackBar, useValue: snackBar },
      SymbolListStore,
    ],
  });
  return { listStore: TestBed.inject(SymbolListStore), listService, db, snackBar };
}

async function emit(defs: SymbolListDef[]): Promise<void> {
  watchSubject.next(defs);
  await new Promise<void>((r) => setTimeout(r, 0));
}

// =============================================================================
// watchLists$ â†’ catalog computeds
// =============================================================================

describe('SymbolListStore catalog', () => {
  it('loadSymbolLists opens one watchLists$ subscription and derives the catalog', async () => {
    const { listStore, listService } = setup();
    listStore.loadSymbolLists();
    listStore.loadSymbolLists(); // guarded â€” no second subscription

    await emit([
      def('PRIMARY', { order: 0, role: 'exclusive', symbols: ['AAPL'] }),
      def('MONITOR', { order: 5, role: 'nonexclusive', symbols: ['AAPL', 'MSFT'] }),
    ]);

    expect(listService.watchLists$).toHaveBeenCalledTimes(1);
    expect(listStore.catalog().map((d) => d.key)).toEqual(['PRIMARY', 'MONITOR']);
    expect(listStore.byKey().get('MONITOR')?.role).toBe('nonexclusive');
    expect(listStore.byRole().nonexclusive.map((d) => d.key)).toEqual(['MONITOR']);
    expect(listStore.symbolLists()).toEqual({ PRIMARY: ['AAPL'], MONITOR: ['AAPL', 'MSFT'] });
    expect(listStore.symbolListsLoading()).toBe(false);
  });

  it('later emissions re-derive all computeds (live sync)', async () => {
    const { listStore } = setup();
    listStore.loadSymbolLists();

    await emit([def('PRIMARY', { symbols: ['AAPL'] })]);
    expect(listStore.symbolLists()['PRIMARY']).toEqual(['AAPL']);

    await emit([def('PRIMARY', { symbols: ['AAPL', 'MSFT'] })]);
    expect(listStore.symbolLists()['PRIMARY']).toEqual(['AAPL', 'MSFT']);
  });

  it('untriagedSymbols counts exclusive memberships only â€” MONITOR membership leaves a symbol untriaged', async () => {
    const { listStore } = setup(['AAA', 'BBB', 'CCC']);
    listStore.loadSymbolLists();
    await listStore.loadTrackedSymbols();

    await emit([
      def('PRIMARY', { order: 0, role: 'exclusive', symbols: ['AAA'] }),
      def('MONITOR', { order: 5, role: 'nonexclusive', symbols: ['BBB'] }),
    ]);

    expect(listStore.untriagedSymbols()).toEqual(['BBB', 'CCC']);
    expect(listStore.unlistedSymbols()).toEqual(['BBB', 'CCC']); // compat alias
  });
});

// =============================================================================
// Snapshot-truth mutations â€” no optimistic updates, no rollback
// =============================================================================

describe('SymbolListStore snapshot-truth mutations', () => {
  it('exclusive toggle calls moveToList over exclusive keys â€” no local state change until the emission', async () => {
    const { listStore, listService } = setup();
    listStore.loadSymbolLists();
    await emit([
      def('PRIMARY', { order: 0, role: 'exclusive' }),
      def('SECONDARY', { order: 1, role: 'exclusive' }),
      def('MONITOR', { order: 5, role: 'nonexclusive', symbols: ['AAPL'] }),
    ]);

    listStore.toggleSymbolInList('AAPL', 'PRIMARY');
    await new Promise<void>((r) => setTimeout(r, 0)); // queued write

    // Delegated with the exclusive-key set â€” MONITOR untouched (re-filing
    // preserves nonexclusive memberships).
    expect(listService.moveToList).toHaveBeenCalledWith('AAPL', 'PRIMARY', [
      'NEW', 'PRIMARY', 'SECONDARY', 'NEUTRAL', 'AVOID', 'HIDE',
    ]);
    // No optimistic patch â€” state still reflects the last emission.
    expect(listStore.symbolLists()['PRIMARY']).toEqual([]);

    await emit([
      def('PRIMARY', { order: 0, role: 'exclusive', symbols: ['AAPL'] }),
      def('SECONDARY', { order: 1, role: 'exclusive' }),
      def('MONITOR', { order: 5, role: 'nonexclusive', symbols: ['AAPL'] }),
    ]);
    expect(listStore.symbolLists()['PRIMARY']).toEqual(['AAPL']);
    expect(listStore.symbolLists()['MONITOR']).toEqual(['AAPL']);
  });

  it('exclusive toggle-off targets null (un-assign)', async () => {
    const { listStore, listService } = setup();
    listStore.loadSymbolLists();
    await emit([def('PRIMARY', { role: 'exclusive', symbols: ['AAPL'] })]);

    listStore.toggleSymbolInList('AAPL', 'PRIMARY');
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(listService.moveToList).toHaveBeenCalledWith('AAPL', null, [
      'NEW', 'PRIMARY', 'SECONDARY', 'NEUTRAL', 'AVOID', 'HIDE',
    ]);
  });

  it('nonexclusive toggle routes to add/remove â€” never moveToList, no MONITOR name-check', async () => {
    const { listStore, listService } = setup();
    listStore.loadSymbolLists();
    await emit([def('MONITOR', { role: 'nonexclusive', symbols: [] })]);

    listStore.toggleSymbolInList('AAPL', 'MONITOR');
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(listService.moveToList).not.toHaveBeenCalled();
    expect(listService.addToList).toHaveBeenCalledWith('AAPL', 'MONITOR');
    expect(listStore.symbolLists()['MONITOR']).toEqual([]); // no optimistic patch

    await emit([def('MONITOR', { role: 'nonexclusive', symbols: ['AAPL'] })]);
    listStore.toggleSymbolInList('AAPL', 'MONITOR');
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(listService.removeFromList).toHaveBeenCalledWith('AAPL', 'MONITOR');
  });

  it('a failed write surfaces a snackbar and leaves state on the last emission (no rollback needed)', async () => {
    const { listStore, listService, snackBar } = setup();
    listStore.loadSymbolLists();
    await emit([def('PRIMARY', { role: 'exclusive', symbols: ['MSFT'] })]);
    listService.moveToList.mockReturnValue(throwError(() => new Error('denied')));

    listStore.toggleSymbolInList('AAPL', 'PRIMARY');
    await new Promise<void>((r) => setTimeout(r, 0)); // writes are queued

    expect(snackBar.open).toHaveBeenCalled();
    // State is still the last emission â€” no optimistic write to roll back.
    expect(listStore.symbolLists()['PRIMARY']).toEqual(['MSFT']);
  });

  it('refuses an unknown list key instead of routing it to the exclusive move', async () => {
    const { listStore, listService, snackBar } = setup();
    listStore.loadSymbolLists();
    await emit([def('PRIMARY')]);

    listStore.toggleSymbolInList('AAPL', 'WISHLIST-42'); // not in catalog, not a seed
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(listService.moveToList).not.toHaveBeenCalled();
    expect(listService.addToList).not.toHaveBeenCalled();
    expect(listService.removeFromList).not.toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalled();
  });

  it('serializes writes — a second toggle queues behind the first', async () => {
    const { listStore, listService } = setup();
    listStore.loadSymbolLists();
    await emit([
      def('PRIMARY', { order: 0, role: 'exclusive' }),
      def('SECONDARY', { order: 1, role: 'exclusive' }),
    ]);

    let releaseFirst!: () => void;
    listService.moveToList
      .mockImplementationOnce(
        () => new Observable<void>((s) => {
          releaseFirst = () => { s.next(undefined); s.complete(); };
        }),
      )
      .mockImplementation(() => of(undefined));

    listStore.toggleSymbolInList('AAPL', 'PRIMARY');
    listStore.toggleSymbolInList('AAPL', 'SECONDARY'); // queued behind the first

    await Promise.resolve(); // first write dequeued, second still queued
    expect(listService.moveToList).toHaveBeenCalledTimes(1);
    releaseFirst();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(listService.moveToList).toHaveBeenCalledTimes(2);
  });

  it('watchLists$ error → snackbar + guard resets so a retry resubscribes', async () => {
    const { listStore, listService, snackBar } = setup();
    listStore.loadSymbolLists();
    watchSubject.error(new Error('boom'));
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(snackBar.open).toHaveBeenCalled();
    expect(listStore.symbolListsLoading()).toBe(false);

    listStore.loadSymbolLists(); // retry — the mock reads the current subject
    expect(listService.watchLists$).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================
// User-list CRUD pass-throughs (#526)
// =============================================================================

describe('SymbolListStore user-list CRUD', () => {
  it('createList delegates and resolves the generated key', async () => {
    const { listStore, listService } = setup();
    const key = await listStore.createList('My Picks');
    expect(listService.createList).toHaveBeenCalledWith('My Picks');
    expect(key).toBe('my-picks');
  });

  it('renameList / deleteList / setListOrder delegate through the queue', async () => {
    const { listStore, listService } = setup();
    await listStore.renameList('my-picks', 'Watchlist B');
    await listStore.deleteList('my-picks');
    await listStore.setListOrder(['b-list', 'a-list']);
    expect(listService.renameList).toHaveBeenCalledWith('my-picks', 'Watchlist B');
    expect(listService.deleteList).toHaveBeenCalledWith('my-picks');
    expect(listService.setListOrder).toHaveBeenCalledWith(['b-list', 'a-list']);
  });

  it('a failed CRUD write snackbars and resolves undefined', async () => {
    const { listStore, listService, snackBar } = setup();
    listService.createList.mockReturnValue(throwError(() => new Error('denied')));
    const key = await listStore.createList('My Picks');
    expect(key).toBeUndefined();
    expect(snackBar.open).toHaveBeenCalled();
  });

  it('deleteList resets activeListFilter to ALL when it matches the deleted key', async () => {
    const { listStore } = setup();
    // Cast: user-list keys aren't in the enum-era union until #528.
    listStore.setActiveListFilter('my-picks' as SymbolListFilter);
    await listStore.deleteList('my-picks');
    expect(listStore.activeListFilter()).toBe('ALL');
  });

  it('deleteList leaves activeListFilter alone for other keys — and on failure', async () => {
    const { listStore, listService } = setup();
    listStore.setActiveListFilter('my-picks' as SymbolListFilter);
    await listStore.deleteList('other-list');
    expect(listStore.activeListFilter()).toBe('my-picks');

    listService.deleteList.mockReturnValue(throwError(() => new Error('denied')));
    await listStore.deleteList('my-picks');
    expect(listStore.activeListFilter()).toBe('my-picks');
  });
});

