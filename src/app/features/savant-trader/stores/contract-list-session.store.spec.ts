/**
 * contract-list-session store specs (#1361).
 *
 * Store-seam specs over a stubbed ContractListService — load/default
 * selection, every selection op, chunk partition/cursor/info, emit
 * payloads, and rs-optlist persistence (restore re-reads the doc; stale
 * docId → failed status).
 */
import { TestBed } from '@angular/core/testing';
import { from, of, throwError } from 'rxjs';

import { TradeSide } from '@common';
import { OptionType } from '@options/common';
import type { ContractListPickRow, ContractListRow } from '@options-replay/contracts';
import type { OptionsContractListUi } from '../backtest/common/options-replay.types';
import { ContractListService } from '../services/contract-list.service';
import { ContractListSessionStore } from './contract-list-session.store';
import {
  LIST_SESSION_PREFIX,
  LIST_SESSION_VERSION,
  clearListSession,
  saveListSession,
} from '../utils/contract-list-session-settings';

const pick = (entryDate: string, contractId = 'QQQ260619C00500000'): ContractListPickRow => ({
  kind: 'pick',
  entryDate,
  contractId,
  side: TradeSide.LONG,
  repeatsPrevious: false,
  underlyingClose: 500,
  expiration: '2026-06-19',
  dte: 9,
  strike: 500,
  delta: 0.5,
  iv: 0.2,
  mark: 5,
  bid: 4.9,
  ask: 5.1,
  volume: 100,
  openInterest: 1000,
});

const miss = (entryDate: string): ContractListRow => ({
  kind: 'no-selection',
  entryDate,
  reason: 'miss',
});

const listDoc = (rows: ContractListRow[], over: Partial<OptionsContractListUi> = {}): OptionsContractListUi => ({
  listId: 'run-1_QQQ',
  runId: 'run-1',
  symbol: 'QQQ',
  templateId: 'csp-45-20',
  status: 'success',
  rows,
  pickDocMeta: {
    coordinate: { type: OptionType.PUT, targetDelta: -0.2, expiry: { mode: 'nearestDte', dte: 45 } },
    gridVersion: 1,
    pickCount: rows.filter((r) => r.kind === 'pick').length,
    missCount: rows.filter((r) => r.kind === 'no-selection').length,
    firstDate: rows[0]?.entryDate ?? '',
    lastDate: rows[rows.length - 1]?.entryDate ?? '',
  },
  generatedAtIso: '2026-06-30T15:00:00Z',
  ...over,
});

/** 15 pick days d01..d15 plus misses on distinct dates (d16..d18);
 *  contract ids cycle so unique-count differs from row-count. */
const fifteenRows = (): ContractListRow[] => {
  const ids = ['AAA', 'AAA', 'AAA', 'BBB', 'BBB', 'CCC', 'DDD', 'DDD', 'EEE', 'FFF', 'FFF', 'GGG', 'HHH', 'III', 'JJJ'];
  const rows: ContractListRow[] = [];
  for (let i = 1; i <= 15; i++) {
    const d = `2026-06-${String(i).padStart(2, '0')}`;
    rows.push(pick(d, `${ids[i - 1]}260619C00500000`));
    if (i % 5 === 0) rows.push(miss(`2026-06-${String(15 + i / 5).padStart(2, '0')}`));
  }
  return rows;
};

describe('ContractListSessionStore', () => {
  let store: InstanceType<typeof ContractListSessionStore>;
  let getList$: jest.Mock;

  const setup = () => {
    getList$ = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        ContractListSessionStore,
        { provide: ContractListService, useValue: { getList$ } },
      ],
    });
    store = TestBed.inject(ContractListSessionStore);
  };

  afterEach(() => {
    clearListSession('QQQ');
    clearListSession('SPY');
    TestBed.resetTestingModule();
  });

  describe('loadList', () => {
    beforeEach(setup);

    it('loads the doc, default-selects the first 10 pick rows, cursor 0', async () => {
      getList$.mockReturnValue(of(listDoc(fifteenRows())));
      store.setSymbol('QQQ');
      await store.loadList('run-1_QQQ');

      expect(store.status()).toBe('ready');
      expect(store.activeList()?.listId).toBe('run-1_QQQ');
      expect(store.pickRows()).toHaveLength(15);
      expect(store.selection().size).toBe(10);
      expect(store.chunkCursor()).toBe(0);
      // First 10 pick days selected.
      expect(store.selectedRows().map((r) => r.entryDate)).toEqual(
        Array.from({ length: 10 }, (_, i) => `2026-06-${String(i + 1).padStart(2, '0')}`),
      );
    });

    it('names the error for a missing doc and leaves the chart untouched (no list)', async () => {
      getList$.mockReturnValue(of(null));
      store.setSymbol('QQQ');
      await store.loadList('gone');

      expect(store.status()).toBe('error');
      expect(store.error()).toContain('gone');
      expect(store.activeList()).toBeNull();
    });

    it('names the error for a non-success doc', async () => {
      getList$.mockReturnValue(of(listDoc([], { status: 'failed', error: 'worker blew up' })));
      store.setSymbol('QQQ');
      await store.loadList('run-1_QQQ');

      expect(store.status()).toBe('error');
      expect(store.error()).toContain('failed');
      expect(store.activeList()).toBeNull();
    });

    it('names the error for a doc belonging to another symbol', async () => {
      getList$.mockReturnValue(of(listDoc(fifteenRows(), { symbol: 'SPY', listId: 'run-1_SPY' })));
      store.setSymbol('QQQ');
      await store.loadList('run-1_SPY');

      expect(store.status()).toBe('error');
      expect(store.error()).toContain('SPY');
      expect(store.activeList()).toBeNull();
    });

    it('names the error for a doc with no pick metadata', async () => {
      getList$.mockReturnValue(of(listDoc(fifteenRows(), { pickDocMeta: undefined })));
      store.setSymbol('QQQ');
      await store.loadList('run-1_QQQ');

      expect(store.status()).toBe('error');
      expect(store.error()).toContain('no pick metadata');
      expect(store.activeList()).toBeNull();
    });

    it('names the error for an empty-rows doc', async () => {
      getList$.mockReturnValue(of(listDoc([])));
      store.setSymbol('QQQ');
      await store.loadList('run-1_QQQ');

      expect(store.status()).toBe('error');
      expect(store.error()).toContain('no pick rows');
      expect(store.activeList()).toBeNull();
    });

    it('names the error for an all-miss doc (rows exist, none pickable)', async () => {
      getList$.mockReturnValue(of(listDoc([miss('2026-06-10'), miss('2026-06-11')])));
      store.setSymbol('QQQ');
      await store.loadList('run-1_QQQ');

      // A success doc carrying only no-selection rows must not land on
      // a dead "ready" session with nothing sendable.
      expect(store.status()).toBe('error');
      expect(store.error()).toContain('no pick rows');
      expect(store.activeList()).toBeNull();
    });

    it('discards a stale in-flight load when a newer load supersedes it', async () => {
      let resolveFirst!: (d: OptionsContractListUi | null) => void;
      const deferred = new Promise<OptionsContractListUi | null>((r) => (resolveFirst = r));
      getList$
        .mockReturnValueOnce(from(deferred))
        .mockReturnValue(of(listDoc(fifteenRows())));
      store.setSymbol('QQQ');

      const p1 = store.loadList('first');
      const p2 = store.loadList('run-1_QQQ');
      resolveFirst(listDoc(fifteenRows(), { listId: 'first' }));
      await p1;
      await p2;

      expect(getList$).toHaveBeenCalledTimes(2);
      expect(store.activeList()?.listId).toBe('run-1_QQQ');
      expect(store.status()).toBe('ready');
    });

    it('loadListDoc applies an already-read doc without a second fetch', () => {
      store.setSymbol('QQQ');
      store.loadListDoc(listDoc(fifteenRows()));

      expect(getList$).not.toHaveBeenCalled();
      expect(store.status()).toBe('ready');
      expect(store.activeList()?.listId).toBe('run-1_QQQ');
      expect(store.selection().size).toBe(10);
    });

    it('loadListDoc names the error for a wrong-symbol doc', () => {
      store.setSymbol('QQQ');
      store.loadListDoc(listDoc(fifteenRows(), { symbol: 'SPY', listId: 'run-1_SPY' }));

      expect(store.status()).toBe('error');
      expect(store.error()).toContain('SPY');
      expect(store.activeList()).toBeNull();
    });
  });

  describe('selection ops', () => {
    beforeEach(async () => {
      setup();
      getList$.mockReturnValue(of(listDoc(fifteenRows())));
      store.setSymbol('QQQ');
      await store.loadList('run-1_QQQ');
    });

    it('selectAll checks every pick row; selectNone clears; invert flips', () => {
      store.selectAll();
      expect(store.selection().size).toBe(15);
      store.selectNone();
      expect(store.selection().size).toBe(0);
      store.toggleRow('2026-06-01', true);
      store.invertSelection();
      expect(store.selection().size).toBe(14);
      expect(store.selection().has('2026-06-01')).toBe(false);
    });

    it('no-selection rows are unselectable', () => {
      store.selectNone();
      store.toggleRow('2026-06-16', true);
      expect(store.selection().has('2026-06-16')).toBe(false);
      expect(store.selection().size).toBe(0);
    });

    it('stride k keeps every k-th pick day', () => {
      store.selectStride(5);
      expect(store.selectedRows().map((r) => r.entryDate)).toEqual([
        '2026-06-01',
        '2026-06-06',
        '2026-06-11',
      ]);
    });

    it('randomPick selects bounded unique rows deterministically with an injected rng', () => {
      const rng = () => 0;
      store.randomPick(3, rng);
      expect(store.selection().size).toBe(3);
      store.randomPick(50, rng);
      expect(store.selection().size).toBe(15);
      store.randomPick(0, rng);
      expect(store.selection().size).toBe(0);
    });

    it('dateRange keeps picks inside the bounds inclusive', () => {
      store.selectDateRange('2026-06-03', '2026-06-07');
      expect(store.selectedRows().map((r) => r.entryDate)).toEqual([
        '2026-06-03',
        '2026-06-04',
        '2026-06-05',
        '2026-06-06',
        '2026-06-07',
      ]);
    });

    it('contains filters by contract-id substring case-insensitively', () => {
      store.selectContains('bbb');
      expect(store.selectedRows().map((r) => r.entryDate)).toEqual([
        '2026-06-04',
        '2026-06-05',
      ]);
    });

    it('non-finite toolbar input is ignored rather than wiping the selection', () => {
      store.selectAll();
      store.selectStride(NaN);
      expect(store.selection().size).toBe(15);
      store.randomPick(NaN);
      expect(store.selection().size).toBe(15);
    });
  });

  describe('chunks', () => {
    beforeEach(async () => {
      setup();
      getList$.mockReturnValue(of(listDoc(fifteenRows())));
      store.setSymbol('QQQ');
      await store.loadList('run-1_QQQ');
    });

    it('partitions pick rows into chunkSize groups with i/n · days · unique info', () => {
      expect(store.chunks()).toHaveLength(2);
      const info = store.chunkInfo();
      expect(info).toEqual({ index: 0, total: 2, days: 10, unique: 6 });
      store.setChunk(1);
      expect(store.chunkInfo()).toEqual({ index: 1, total: 2, days: 5, unique: 5 });
    });

    it('step clamps at both ends (no wrap)', () => {
      expect(store.chunkCursor()).toBe(0);
      store.step(-1);
      expect(store.chunkCursor()).toBe(0);
      store.step(1);
      store.step(1);
      expect(store.chunkCursor()).toBe(1);
    });

    it('chunk size larger than the list yields a single 1/1 chunk', () => {
      store.setChunkSize(50);
      expect(store.chunks()).toHaveLength(1);
      expect(store.chunkInfo().index).toBe(0);
      expect(store.chunkInfo().total).toBe(1);
    });

    it('setChunkSize repartitions and clamps the cursor', () => {
      store.setChunkSize(3);
      store.setChunk(4);
      expect(store.chunkCursor()).toBe(4);
      store.setChunkSize(10);
      expect(store.chunkCursor()).toBe(1);
    });

    it('non-finite chunk input is ignored rather than corrupting the cursor', () => {
      store.setChunk(1);
      store.step(NaN);
      store.setChunk(NaN);
      store.setChunkSize(NaN);
      expect(store.chunkCursor()).toBe(1);
      expect(store.chunkInfo().index).toBe(1);
    });

    it('addChunkToSelection unions the current chunk into the selection', () => {
      store.selectNone();
      store.setChunk(1);
      store.addChunkToSelection();
      expect(store.selectedRows().map((r) => r.entryDate)).toEqual([
        '2026-06-11',
        '2026-06-12',
        '2026-06-13',
        '2026-06-14',
        '2026-06-15',
      ]);
    });
  });

  describe('emit', () => {
    beforeEach(async () => {
      setup();
      getList$.mockReturnValue(of(listDoc(fifteenRows())));
      store.setSymbol('QQQ');
      await store.loadList('run-1_QQQ');
    });

    it('sendSelected emits entryDate,id lines in order, duplicates preserved', () => {
      const lines = store.sendSelected();
      expect(lines).toHaveLength(10);
      expect(lines[0]).toBe('2026-06-01,AAA260619C00500000');
      expect(lines[2]).toBe('2026-06-03,AAA260619C00500000');
      expect(store.lastEmitted()).toEqual(lines);
    });

    it('sendChunk emits only the current chunk', () => {
      store.setChunk(1);
      const lines = store.sendChunk();
      expect(lines).toHaveLength(5);
      expect(lines[0]).toBe('2026-06-11,FFF260619C00500000');
    });

    it('emittedLines previews the selection payload', () => {
      store.selectNone();
      expect(store.emittedLines()).toEqual([]);
      store.toggleRow('2026-06-01', true);
      expect(store.emittedLines()).toEqual(['2026-06-01,AAA260619C00500000']);
    });

    it('a fresh list apply clears lastEmitted — no stale emit leaks across docs', async () => {
      store.sendSelected();
      expect(store.lastEmitted().length).toBeGreaterThan(0);
      getList$.mockReturnValue(of(listDoc(fifteenRows())));
      await store.loadList('run-1_QQQ');
      expect(store.lastEmitted()).toEqual([]);
    });
  });

  describe('persistence', () => {
    beforeEach(setup);

    it('saves the session blob and restores it via setSymbol (re-reads doc)', async () => {
      getList$.mockReturnValue(of(listDoc(fifteenRows())));
      store.setSymbol('QQQ');
      await store.loadList('run-1_QQQ');
      store.selectNone();
      store.toggleRow('2026-06-02', true);
      store.toggleRow('2026-06-09', true);
      store.setChunkSize(5);
      store.setChunk(1);

      const blob = JSON.parse(localStorage.getItem(`${LIST_SESSION_PREFIX}QQQ`)!);
      expect(blob.version).toBe(LIST_SESSION_VERSION);
      expect(blob.docId).toBe('run-1_QQQ');
      expect(blob.chunkSize).toBe(5);
      expect(blob.cursor).toBe(1);
      expect(blob.selectionKeys.sort()).toEqual(['2026-06-02', '2026-06-09']);

      // Fresh store instance: setSymbol restores by re-reading the doc.
      TestBed.resetTestingModule();
      setup();
      getList$.mockReturnValue(of(listDoc(fifteenRows())));
      store.setSymbol('QQQ');
      await new Promise<void>((r) => setTimeout(r, 0));
      expect(getList$).toHaveBeenCalledWith('run-1_QQQ');
      expect(store.status()).toBe('ready');
      expect(store.chunkSize()).toBe(5);
      expect(store.chunkCursor()).toBe(1);
      expect([...store.selection()].sort()).toEqual(['2026-06-02', '2026-06-09']);
    });

    it('stale persisted docId → failed status, never silent empty', async () => {
      saveListSession('QQQ', {
        version: LIST_SESSION_VERSION,
        docId: 'stale-doc',
        chunkSize: 10,
        cursor: 0,
        selectionKeys: ['2026-06-01'],
      });
      getList$.mockReturnValue(of(null));

      store.setSymbol('QQQ');
      await new Promise<void>((r) => setTimeout(r, 0));

      expect(store.status()).toBe('error');
      expect(store.error()).toContain('stale-doc');
    });

    it('a restore-initiated failure wipes the stale docId from the blob', async () => {
      saveListSession('QQQ', {
        version: LIST_SESSION_VERSION,
        docId: 'bad-doc',
        chunkSize: 10,
        cursor: 0,
        selectionKeys: [],
      });
      getList$.mockReturnValue(of(listDoc([], { status: 'failed', listId: 'bad-doc' })));

      store.setSymbol('QQQ');
      await new Promise<void>((r) => setTimeout(r, 0));

      expect(store.status()).toBe('error');
      // The blob that led to the failure is cleared — no retry loop.
      const blob = JSON.parse(localStorage.getItem(`${LIST_SESSION_PREFIX}QQQ`)!);
      expect(blob.docId).toBeNull();
    });

    it('an explicit load failure leaves the persisted session alone', async () => {
      getList$.mockReturnValue(of(listDoc(fifteenRows())));
      store.setSymbol('QQQ');
      await store.loadList('run-1_QQQ'); // persists docId run-1_QQQ

      // A bad explicit load must not erase the prior session's blob.
      store.loadListDoc(listDoc([], { status: 'failed', listId: 'bad-doc' }));
      expect(store.status()).toBe('error');

      const blob = JSON.parse(localStorage.getItem(`${LIST_SESSION_PREFIX}QQQ`)!);
      expect(blob.docId).toBe('run-1_QQQ');
    });

    it('symbol swap keeps each symbol\'s own session', async () => {
      getList$.mockReturnValue(of(listDoc(fifteenRows())));
      store.setSymbol('QQQ');
      await store.loadList('run-1_QQQ');
      store.toggleRow('2026-06-01', false); // QQQ: drop one from default-10

      store.setSymbol('SPY'); // SPY: no blob → empty session
      await new Promise<void>((r) => setTimeout(r, 0));
      expect(store.activeList()).toBeNull();
      expect(store.selection().size).toBe(0);

      getList$.mockReturnValue(of(listDoc(fifteenRows())));
      store.setSymbol('QQQ'); // back → restored
      await new Promise<void>((r) => setTimeout(r, 0));
      expect(store.selection().size).toBe(9);
      expect(store.selection().has('2026-06-01')).toBe(false);
    });
  });

  describe('load errors', () => {
    beforeEach(setup);

    it('service failure → named error status', async () => {
      getList$.mockReturnValue(throwError(() => new Error('firestore down')));
      store.setSymbol('QQQ');
      await store.loadList('run-1_QQQ');
      expect(store.status()).toBe('error');
      expect(store.error()).toContain('firestore down');
    });
  });
});
