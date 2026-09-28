/// <reference types="jest" />
/**
 * Tests for the symbol-nav slice of SwingAnalysisStore
 * (symbol-nav.feature.ts). Seam: the store's public interface —
 * RelStrDbV2Service, ChartService, SwingAnalysisService, and
 * SymbolListService are mocked; the real SymbolListStore is used so
 * navSequence reacts to real list state.
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
import { ApplicationRef } from '@angular/core';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';

import { SwingAnalysisStore, LARGE_CONFIG } from './swing-analysis.store';
import { ChartService } from '../services/chart.service';
import { SwingAnalysisService } from './swing-analysis.service';
import { RelStrDbV2Service } from '../../services/rel-str-db-v2.service';
import { SymbolListService } from '../services/symbol-list.service';
import { SignalService } from '../services/signal.service';
import { SymbolListStore } from '../stores/symbol-list.store';
import { NO_MEMBERSHIP } from '../common/constants';
import { SYSTEM_LIST_KEYS } from '../common/symbol-list-defs';
import { SYSTEM_LIST_DEFS, systemListDef, type SymbolListDef } from '../common/symbol-list-defs';
import type { Company } from '../../shared/types/rs.interfaces';
import { Subject } from 'rxjs';

// =============================================================================
// Fixtures
// =============================================================================

function makeCompany(symbol: string): Company {
  return { symbol, company: `${symbol} Corp` };
}

/** Convert the legacy {name,symbols} fixture shape into registry defs —
 *  system keys get their seed metadata, anything else is nonexclusive. */
function toDefs(lists: { name: string; symbols: string[] }[]): SymbolListDef[] {
  const provided = new Map(lists.map((list) => [list.name, list.symbols]));
  const systemDefs = SYSTEM_LIST_DEFS.map((def) => ({
    ...def,
    symbols: provided.get(def.key) ?? [],
    userId: 'user-123',
  }));
  const userDefs = lists
    .filter((list) => !systemListDef(list.name))
    .map((list, index) => ({
      key: list.name,
      label: list.name,
      order: 100 + index,
      role: 'nonexclusive' as const,
      hidden: false,
      symbols: list.symbols,
      userId: 'user-123',
    }));
  return [...systemDefs, ...userDefs];
}

interface NavSetup {
  store: InstanceType<typeof SwingAnalysisStore>;
  listStore: InstanceType<typeof SymbolListStore>;
  db: { getTrackedSymbols$: jest.Mock };
  chart: { loadBars$: jest.Mock };
  listService: {
    watchLists$: jest.Mock;
    moveToList: jest.Mock;
    addToList: jest.Mock;
    removeFromList: jest.Mock;
  };
  /** Push a fresh catalog emission — mirrors a Firestore snapshot. */
  emitLists(lists?: { name: string; symbols: string[] }[]): void;
}

function setupNav(
  companies: Company[] = [],
  lists: { name: string; symbols: string[] }[] = [],
): NavSetup {
  const watchSubject = new Subject<SymbolListDef[]>();
  const db = { getTrackedSymbols$: jest.fn(() => of(companies)) };
  const chart = {
    loadBars$: jest.fn(() =>
      of({
        daily: { bars: [] },
        weekly: { bars: [] },
        monthly: { bars: [] },
        version: 'test',
      }),
    ),
  };
  const listService = {
    watchLists$: jest.fn(() => watchSubject.asObservable()),
    moveToList: jest.fn(() => of(undefined)),
    addToList: jest.fn(() => of(undefined)),
    removeFromList: jest.fn(() => of(undefined)),
  };

  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: ChartService, useValue: chart },
      {
        provide: SwingAnalysisService,
        useValue: {
          loadSavedAnalyses: jest.fn(() => of([])),
        },
      },
      { provide: RelStrDbV2Service, useValue: db },
      { provide: SymbolListService, useValue: listService },
      { provide: SignalService, useValue: { getAllSymbols: jest.fn(() => of([])) } },
      { provide: MatSnackBar, useValue: { open: jest.fn() } },
      SwingAnalysisStore,
      SymbolListStore,
    ],
  });
  return {
    store: TestBed.inject(SwingAnalysisStore),
    listStore: TestBed.inject(SymbolListStore),
    db,
    chart,
    listService,
    emitLists: (l = lists) => watchSubject.next(toDefs(l)),
  };
}

// =============================================================================
// Tracked symbols load
// =============================================================================

describe('SwingAnalysisStore.loadTrackedSymbols', () => {
  it('starts empty with the ALL filter', () => {
    const { store } = setupNav();
    expect(store.trackedSymbols()).toEqual([]);
    expect(store.navFilter()).toBe('ALL');
    expect(store.navSequence()).toEqual([]);
    expect(store.navEnabled()).toBe(false);
    expect(store.navPosition()).toBe('— of 0');
  });

  it('populates trackedSymbols deduped, uppercased, and sorted A-Z', () => {
    const { store } = setupNav([
      makeCompany('bbb'),
      makeCompany('AAA'),
      makeCompany('CCC'),
      makeCompany('AAA'),
    ]);
    store.loadTrackedSymbols();
    expect(store.trackedSymbols()).toEqual(['AAA', 'BBB', 'CCC']);
  });

  it('is a no-op when tracked symbols are already loaded', () => {
    const { store, db } = setupNav([makeCompany('AAA')]);
    store.loadTrackedSymbols();
    store.loadTrackedSymbols();
    expect(db.getTrackedSymbols$).toHaveBeenCalledTimes(1);
    expect(store.trackedSymbols()).toEqual(['AAA']);
  });
});

// =============================================================================
// navSequence / position computeds
// =============================================================================

describe('SwingAnalysisStore nav sequence', () => {
  const companies = [makeCompany('AAA'), makeCompany('BBB'), makeCompany('MSFT'), makeCompany('NVDA')];

  it('ALL filter returns the alphabetical tracked order', () => {
    const { store } = setupNav(companies);
    store.loadTrackedSymbols();
    expect(store.navSequence()).toEqual(['AAA', 'BBB', 'MSFT', 'NVDA']);
  });

  it('list filter returns stored list order intersected with tracked', () => {
    const { store, listStore, emitLists } = setupNav(companies, [
      { name: SYSTEM_LIST_KEYS.PRIMARY, symbols: ['NVDA', 'MSFT', 'GHOST'] },
    ]);
    listStore.loadSymbolLists();
    emitLists();
    store.loadTrackedSymbols();
    store.setNavFilter(SYSTEM_LIST_KEYS.PRIMARY);
    // GHOST is in the list but not tracked — dropped.
    expect(store.navSequence()).toEqual(['NVDA', 'MSFT']);
    expect(store.navFilter()).toBe(SYSTEM_LIST_KEYS.PRIMARY);
  });

  it('NO_MEMBERSHIP returns tracked symbols in zero exclusive lists', () => {
    const { store, listStore, emitLists } = setupNav(companies, [
      { name: SYSTEM_LIST_KEYS.PRIMARY, symbols: ['NVDA'] },
      { name: SYSTEM_LIST_KEYS.AVOID, symbols: ['MSFT'] },
    ]);
    listStore.loadSymbolLists();
    emitLists();
    store.loadTrackedSymbols();
    store.setNavFilter(NO_MEMBERSHIP);
    expect(store.navSequence()).toEqual(['AAA', 'BBB']);
  });

  it('setNavFilter jumps to the new sequence\'s first symbol', () => {
    const { store, listStore, emitLists } = setupNav(companies, [
      { name: SYSTEM_LIST_KEYS.PRIMARY, symbols: ['MSFT', 'NVDA'] },
    ]);
    listStore.loadSymbolLists();
    emitLists();
    store.loadTrackedSymbols();
    store.setSymbol('AAA');
    store.setNavFilter(SYSTEM_LIST_KEYS.PRIMARY);
    expect(store.symbol()).toBe('MSFT');
    expect(store.navPosition()).toBe('1 of 2');
  });

  it('setNavFilter keeps the current symbol when an existing list is empty', () => {
    const { store, listStore, emitLists } = setupNav(companies, [
      { name: 'PRIMARY', symbols: [] },
    ]);
    listStore.loadSymbolLists();
    emitLists();
    store.loadTrackedSymbols();
    store.setSymbol('AAA');
    store.setNavFilter('PRIMARY');
    expect(store.symbol()).toBe('AAA');
    expect(store.navPosition()).toBe('— of 0');
  });

  it('falls back to ALL when the active user-list filter disappears from the live catalog', async () => {
    const { store, listStore, emitLists } = setupNav(companies, [
      { name: 'my-picks', symbols: ['MSFT'] },
    ]);
    listStore.loadSymbolLists();
    emitLists();
    store.loadTrackedSymbols();
    store.setNavFilter('my-picks');
    expect(store.navSequence()).toEqual(['MSFT']);

    emitLists([{ name: 'PRIMARY', symbols: ['AAA'] }]);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(store.navFilter()).toBe('ALL');
    expect(store.navSequence()).toEqual(['AAA', 'BBB', 'MSFT', 'NVDA']);
  });

  it('navIndex and navPosition reflect the current symbol position', () => {
    const { store } = setupNav(companies);
    store.loadTrackedSymbols();
    store.setSymbol('BBB');
    expect(store.navIndex()).toBe(1);
    expect(store.navPosition()).toBe('2 of 4');
  });

  it('reports — of M when the current symbol is outside the sequence', () => {
    const { store } = setupNav(companies);
    store.loadTrackedSymbols();
    store.setSymbol('TSLA');
    expect(store.navIndex()).toBe(-1);
    expect(store.navPosition()).toBe('— of 4');
  });
});

// =============================================================================
// nextSymbol / prevSymbol
// =============================================================================

describe('SwingAnalysisStore next/prev navigation', () => {
  const companies = [makeCompany('AAA'), makeCompany('BBB'), makeCompany('CCC')];

  it('next steps forward and prev steps back through the sequence', () => {
    const { store } = setupNav(companies);
    store.loadTrackedSymbols();
    store.setSymbol('AAA');

    store.nextSymbol();
    expect(store.symbol()).toBe('BBB');
    expect(store.navPosition()).toBe('2 of 3');

    store.prevSymbol();
    expect(store.symbol()).toBe('AAA');
    expect(store.navPosition()).toBe('1 of 3');
  });

  it('wraps around at both ends', () => {
    const { store } = setupNav(companies);
    store.loadTrackedSymbols();
    store.setSymbol('CCC');

    store.nextSymbol();
    expect(store.symbol()).toBe('AAA');

    store.prevSymbol();
    expect(store.symbol()).toBe('CCC');
  });

  it('enters the sequence when the current symbol is outside it', () => {
    const { store } = setupNav(companies);
    store.loadTrackedSymbols();
    store.setSymbol('TSLA');

    store.nextSymbol();
    expect(store.symbol()).toBe('AAA');

    store.setSymbol('TSLA');
    store.prevSymbol();
    expect(store.symbol()).toBe('CCC');
  });

  it('is a no-op when the sequence is empty', () => {
    const { store, chart } = setupNav([]);
    store.loadTrackedSymbols();
    store.nextSymbol();
    store.prevSymbol();
    expect(store.symbol()).toBe('');
    expect(chart.loadBars$).not.toHaveBeenCalled();
  });

  it('preserves the current configs across navigation', () => {
    const { store } = setupNav(companies);
    store.loadTrackedSymbols();
    store.setSymbol('AAA');
    store.nextSymbol();
    expect(store.configs()[0]).toEqual(LARGE_CONFIG);
    expect(store.symbol()).toBe('BBB');
  });

  it('cycles only the filtered list when a watchlist filter is active', () => {
    const { store, listStore, emitLists } = setupNav(companies, [
      { name: SYSTEM_LIST_KEYS.PRIMARY, symbols: ['CCC', 'AAA'] },
    ]);
    listStore.loadSymbolLists();
    emitLists();
    store.loadTrackedSymbols();
    store.setNavFilter(SYSTEM_LIST_KEYS.PRIMARY);
    store.setSymbol('AAA');

    store.nextSymbol();
    expect(store.symbol()).toBe('CCC');
    expect(store.navPosition()).toBe('1 of 2');

    store.nextSymbol();
    expect(store.symbol()).toBe('AAA');
  });
});

// =============================================================================
// MONITOR coexistence — non-exclusive list survives triage re-filing
// =============================================================================

describe('SymbolListStore MONITOR coexistence', () => {
  it('filing into a triage list preserves MONITOR membership', async () => {
    const { listStore, listService, emitLists } = setupNav([], [
      { name: SYSTEM_LIST_KEYS.MONITOR, symbols: ['AAPL'] },
    ]);
    listStore.loadSymbolLists();
    emitLists();

    listStore.toggleSymbolInList('AAPL', SYSTEM_LIST_KEYS.PRIMARY);
    await new Promise<void>((r) => setTimeout(r, 0)); // queued write

    // Persisted batch targets exclusive lists only — MONITOR is never written.
    expect(listService.moveToList).toHaveBeenCalledWith('AAPL', SYSTEM_LIST_KEYS.PRIMARY, [
      'NEW', 'PRIMARY', 'SECONDARY', 'NEUTRAL', 'AVOID', 'HIDE',
    ]);
    // State follows the snapshot, not the call — emit the post-write truth.
    emitLists([
      { name: SYSTEM_LIST_KEYS.MONITOR, symbols: ['AAPL'] },
      { name: SYSTEM_LIST_KEYS.PRIMARY, symbols: ['AAPL'] },
    ]);
    expect(listStore.symbolLists()[SYSTEM_LIST_KEYS.MONITOR]).toEqual(['AAPL']);
    expect(listStore.symbolLists()[SYSTEM_LIST_KEYS.PRIMARY]).toEqual(['AAPL']);
  });

  it('toggleSymbolInList(MONITOR) routes through the non-exclusive toggle', async () => {
    const { listStore, listService, emitLists } = setupNav([], [
      { name: SYSTEM_LIST_KEYS.PRIMARY, symbols: ['AAPL'] },
    ]);
    listStore.loadSymbolLists();
    emitLists();

    listStore.toggleSymbolInList('AAPL', SYSTEM_LIST_KEYS.MONITOR);
    await new Promise<void>((r) => setTimeout(r, 0)); // queued write

    // Membership-driven add — never an exclusive move.
    expect(listService.moveToList).not.toHaveBeenCalled();
    expect(listService.addToList).toHaveBeenCalledWith('AAPL', SYSTEM_LIST_KEYS.MONITOR);

    emitLists([
      { name: SYSTEM_LIST_KEYS.PRIMARY, symbols: ['AAPL'] },
      { name: SYSTEM_LIST_KEYS.MONITOR, symbols: ['AAPL'] },
    ]);
    expect(listStore.symbolLists()[SYSTEM_LIST_KEYS.MONITOR]).toEqual(['AAPL']);
    expect(listStore.symbolLists()[SYSTEM_LIST_KEYS.PRIMARY]).toEqual(['AAPL']);
  });
});
