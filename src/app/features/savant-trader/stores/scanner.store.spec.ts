/// <reference types="jest" />
/**
 * ScannerStore specs (#1098/#1139) — ScannerService and SymbolListStore
 * are the injected seams; the compare engine is the real #1138 util.
 */

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { ScannerStore } from './scanner.store';
import { ScannerService } from '../services/scanner.service';
import { SymbolListStore } from './symbol-list.store';
import { RobinhoodMcpError } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';
import {
  ToolExecutionErrorCategory,
  type PreviewScanResult,
  type ScanResultRow,
} from '@robinhood-mcp/contracts';
import { SCANNER_RECIPES } from '../scanner/scanner-recipes';

const wireRow = (ticker: string, values: Record<string, string> = {}): ScanResultRow => ({
  ticker,
  instrument_id: `i-${ticker}`,
  instrument_type: 'EQUITY',
  columns: values,
});

describe('ScannerStore (#1139)', () => {
  let store: InstanceType<typeof ScannerStore>;
  let service: {
    runScan: jest.Mock;
    previewScanRaw: jest.Mock;
    evaluateTracked: jest.Mock;
    saveProposal: jest.Mock;
    saveLatestRun: jest.Mock;
    listProposals: jest.Mock;
    getProposal: jest.Mock;
  };
  let symbolLists: { loadTrackedSymbols: jest.Mock };

  beforeEach(() => {
    service = {
      runScan: jest.fn(),
      previewScanRaw: jest.fn(),
      evaluateTracked: jest.fn(),
      saveProposal: jest.fn(() => Promise.resolve('prop-1')),
      saveLatestRun: jest.fn(() => Promise.resolve()),
      listProposals: jest.fn(() => Promise.resolve([])),
      getProposal: jest.fn(() => Promise.resolve(null)),
    };
    symbolLists = { loadTrackedSymbols: jest.fn(() => Promise.resolve(['KEEP', 'DROP', 'DEAD'])) };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ScannerStore,
        { provide: ScannerService, useValue: service },
        { provide: SymbolListStore, useValue: symbolLists },
      ],
    });
    store = TestBed.inject(ScannerStore);
  });

  it('defaults to the first catalog recipe; selectRecipe changes the active recipe', () => {
    expect(store.activeRecipe()?.id).toBe(SCANNER_RECIPES[0].id);
    store.selectRecipe('gainers');
    expect(store.activeRecipe()?.id).toBe('gainers');
    store.selectRecipe('nope');
    expect(store.activeRecipe()?.id).toBe('gainers');
  });

  it('runScan → discovery compare → auto-persist proposal', async () => {
    service.runScan.mockResolvedValue({
      totalItems: 2,
      rows: [wireRow('KEEP', { ROE: '0.2' }), wireRow('NEWCO', { ROE: '0.3' })],
      filtersApplied: [],
    });
    await store.runScan();
    const compare = store.compare()!;
    expect(compare.buckets.addCandidates).toEqual(['NEWCO']);
    expect(store.rows().find((r) => r.symbol === 'KEEP')?.tracked).toBe(true);
    expect(service.saveProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        recipeId: store.activeRecipe()!.id,
        universeSize: 3,
        matchedCount: 2,
        addCandidates: ['NEWCO'],
      }),
    );
    expect(store.proposals()[0].id).toBe('prop-1');
    // Wire totalItems — the status line's truth under truncation (#1140).
    expect(store.matchedCount()).toBe(2);
    expect(store.runKind()).toBe('scan');
    expect(store.running()).toBe(false);
  });

  it('runScan success caches the latest run via the preview adapter (#1257)', async () => {
    const result = {
      totalItems: 2,
      rows: [wireRow('KEEP', { ROE: '0.2' }), wireRow('NEWCO', { ROE: '0.3' })],
      filtersApplied: [],
    };
    service.runScan.mockResolvedValue(result);
    await store.runScan();
    // Same adapter shape the store already builds for parseScanRows —
    // saveLatestRun takes wire-shaped PreviewScanResult.
    expect(service.saveLatestRun).toHaveBeenCalledWith(
      store.activeRecipe()!.id,
      { results: result.rows, total_items: result.totalItems },
    );
    expect(service.saveLatestRun).toHaveBeenCalledTimes(1);
  });

  it('refreshRecipe success caches the wire result on the discovery path (#1257)', async () => {
    const recipe = SCANNER_RECIPES[0];
    const wire: PreviewScanResult = {
      results: [wireRow('NEWCO', { ROE: '0.3' })],
      total_items: 1,
    };
    service.previewScanRaw.mockResolvedValue(wire);
    store.refreshRecipe(recipe.id);
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(service.saveLatestRun).toHaveBeenCalledWith(recipe.id, wire);
    expect(service.saveLatestRun).toHaveBeenCalledTimes(1);
  });

  it('evaluateTracked never writes the latest-run cache (#1257)', async () => {
    store.selectRecipe('quality-mid');
    service.evaluateTracked.mockResolvedValue({
      coverage: { rows: [wireRow('KEEP')], unevaluated: [], filtersApplied: [] },
      matched: { rows: [wireRow('KEEP', { ROE: '0.2' })], unevaluated: [], filtersApplied: [] },
    });
    await store.evaluateTracked();
    expect(service.saveLatestRun).not.toHaveBeenCalled();
  });

  it('runScan merges the response echo over the static columnLookup', async () => {
    // quality-mega static: ROE → 'Return on equity'. An applied-filter
    // echo matching the ROE column's expression binds it to whatever the
    // backend actually canonicalized — the echo wins on conflict.
    service.runScan.mockResolvedValue({
      totalItems: 1,
      rows: [wireRow('KEEP', { 'ROE canonical': '0.2' })],
      filtersApplied: [
        {
          filter_type: 'ROE canonical',
          filter_type_enum: 'FILTER_TYPE_CUSTOM',
          predicate: '=',
          values: ['True'],
          expression: 'fundamental.returnOnEquity',
        },
      ],
    });
    await store.runScan();
    expect(store.columnLookup()?.get('ROE')).toBe('ROE canonical');
    // NPM has no echo → the static map still resolves it.
    expect(store.columnLookup()?.get('NPM')).toBe('Net profit margin');
  });

  it('a display-title echo cannot clobber the verified static mapping', async () => {
    // dep-prev-scan-04: an expression filter's echo can carry its
    // display_title in filter_type — never a row key. The presence
    // check must keep 'Return on equity' (the key rows actually carry).
    service.runScan.mockResolvedValue({
      totalItems: 1,
      rows: [wireRow('KEEP', { 'Return on equity': '0.2' })],
      filtersApplied: [
        {
          filter_type: 'ROE ≥ 15%',
          filter_type_enum: 'FILTER_TYPE_CUSTOM',
          predicate: '=',
          values: ['True'],
          expression: 'fundamental.returnOnEquity',
        },
      ],
    });
    await store.runScan();
    expect(store.columnLookup()?.get('ROE')).toBe('Return on equity');
  });

  it('selectRecipe resets matchedCount with the rest of the stale result', async () => {
    service.runScan.mockResolvedValue({
      totalItems: 5,
      rows: [wireRow('KEEP', { ROE: '0.2' })],
      filtersApplied: [],
    });
    await store.runScan();
    expect(store.matchedCount()).toBe(5);
    store.selectRecipe('gainers');
    expect(store.matchedCount()).toBeNull();
  });

  it('evaluateTracked → two-eval prune compare → persist with dropDetail', async () => {
    store.selectRecipe('quality-mid');
    service.evaluateTracked.mockResolvedValue({
      coverage: {
        rows: [
          wireRow('KEEP', { ROE: '0.2', NPM: '0.3' }),
          wireRow('DROP', { ROE: '-0.4', NPM: '-0.1' }),
        ],
        unevaluated: [],
        filtersApplied: [],
      },
      matched: {
        rows: [wireRow('KEEP', { ROE: '0.2', NPM: '0.3' })],
        unevaluated: [],
        filtersApplied: [],
      },
    });
    await store.evaluateTracked();
    const compare = store.compare()!;
    expect(compare.buckets.dropCandidates).toEqual(['DROP']);
    expect(compare.buckets.deadSymbols).toEqual(['DEAD']);
    expect(compare.dropDetail['DROP']).toMatchObject({ ROE: '-0.4' });
    expect(service.saveProposal).toHaveBeenCalledWith(
      expect.objectContaining({ dropCandidates: ['DROP'], deadSymbols: ['DEAD'] }),
    );
    expect(store.runKind()).toBe('eval');
    expect(store.evaluating()).toBeNull();
  });

  it('evaluateTracked unions both evals\' unevaluated — unioned symbols are not dead', async () => {
    store.selectRecipe('quality-mid');
    symbolLists.loadTrackedSymbols.mockResolvedValue(['KEEP', 'LOST']);
    service.evaluateTracked.mockResolvedValue({
      coverage: { rows: [wireRow('KEEP', { ROE: '0.2', NPM: '0.3' })], unevaluated: ['LOST'], filtersApplied: [] },
      matched: { rows: [wireRow('KEEP', { ROE: '0.2', NPM: '0.3' })], unevaluated: [], filtersApplied: [] },
    });
    await store.evaluateTracked();
    expect(store.compare()!.buckets.deadSymbols).toEqual([]);
    expect(store.compare()!.unevaluated).toEqual(['LOST']);
  });

  it('canEvaluateTracked gates on supportsPrune recipes only', () => {
    store.selectRecipe('gainers');
    expect(store.canEvaluateTracked()).toBe(false);
    store.selectRecipe('quality-mid');
    expect(store.canEvaluateTracked()).toBe(true);
  });

  it('a superseded runScan result is dropped when a newer run lands first', async () => {
    // Start a slow run, then bump the run token with a fast prune —
    // the slow run's late result must not clobber the newer state.
    let resolveSlow!: (v: unknown) => void;
    service.runScan.mockImplementation(
      () => new Promise((res) => (resolveSlow = res)),
    );
    store.selectRecipe('quality-mid');
    const slow = store.runScan();
    service.evaluateTracked.mockResolvedValue({
      coverage: { rows: [wireRow('KEEP', { ROE: '0.2', NPM: '0.3' })], unevaluated: [], filtersApplied: [] },
      matched: { rows: [wireRow('KEEP', { ROE: '0.2', NPM: '0.3' })], unevaluated: [], filtersApplied: [] },
    });
    await store.evaluateTracked();
    const newer = store.compare()!;
    resolveSlow({ totalItems: 9, rows: [wireRow('STALE')], filtersApplied: [] });
    await slow;
    expect(store.compare()).toBe(newer); // stale result dropped
    expect(store.rows().some((r) => r.symbol === 'STALE')).toBe(false);
    // Stale scan can't write the latest-run cache — it drops at the
    // token guard before the write fires (#1257).
    expect(service.saveLatestRun).not.toHaveBeenCalled();
  });

  it('evaluateTracked errors on an empty tracked universe', async () => {
    store.selectRecipe('quality-mid');
    symbolLists.loadTrackedSymbols.mockResolvedValue([]);
    await store.evaluateTracked();
    expect(store.error()?.message).toContain('empty');
    expect(service.evaluateTracked).not.toHaveBeenCalled();
    expect(store.evaluating()).toBeNull();
  });

  it('runScan surfaces AUTH-category errors for reauth prompt', async () => {
    service.runScan.mockRejectedValue(
      new RobinhoodMcpError('session expired', 'preview_scan', ToolExecutionErrorCategory.AUTH),
    );
    await store.runScan();
    expect(store.error()?.category).toBe(ToolExecutionErrorCategory.AUTH);
    expect(store.requiresReauth()).toBe(true);
    expect(store.running()).toBe(false);
    // A failed run must not cache a nonexistent result (#1257).
    expect(service.saveLatestRun).not.toHaveBeenCalled();
  });

  it('openProposal prefers the cached list entry, else fetches by id', async () => {
    const entry = {
      id: 'p1',
      proposal: {
        recipeId: 'quality-mid',
        ranAt: '2026-10-21T00:00:00Z',
        universeSize: 1,
        matchedCount: 0,
        truncated: false,
        addCandidates: [],
        dropCandidates: [],
        deadSymbols: [],
        noDataSymbols: [],
      },
    };
    service.listProposals.mockResolvedValue([entry]);
    await store.loadProposals();
    await store.openProposal('p1');
    expect(service.getProposal).not.toHaveBeenCalled();
    expect(store.proposalOpen()?.id).toBe('p1');

    service.getProposal.mockResolvedValue(entry);
    await store.openProposal('uncached');
    expect(service.getProposal).toHaveBeenCalledWith('uncached');
    store.closeProposal();
    expect(store.proposalOpen()).toBeNull();
  });

  it('listProposals refreshes history; proposalsLoading toggles', async () => {
    service.listProposals.mockResolvedValue([
      { id: 'p2', proposal: { recipeId: 'gainers', ranAt: '2026-10-21T01:00:00Z', universeSize: 0, matchedCount: 0, truncated: false, addCandidates: [], dropCandidates: [], deadSymbols: [], noDataSymbols: [] } },
    ]);
    await store.loadProposals();
    expect(store.proposals().map((p) => p.id)).toEqual(['p2']);
    expect(store.proposalsLoading()).toBe(false);
  });

  it('loadProposals merge keeps a proposal prepended by an in-flight persist', async () => {
    // A run's persist() prepends locally after addDoc — a listProposals
    // snapshot taken before the commit lacks it; a bare replace would
    // silently drop the fresh entry until the next load.
    service.runScan.mockResolvedValue({
      totalItems: 1,
      rows: [wireRow('X', { ROE: '0.2' })],
      filtersApplied: [],
    });
    service.saveProposal.mockResolvedValue('prop-new');
    const run = store.runScan();
    // listProposals resolves with a stale snapshot mid-run.
    service.listProposals.mockResolvedValue([]);
    const load = store.loadProposals();
    await Promise.all([run, load]);
    expect(store.proposals().map((p) => p.id)).toEqual(['prop-new']);
  });

  it('evaluateTracked patches progress from the service callback', async () => {
    store.selectRecipe('quality-mid');
    let seen: unknown = null;
    service.evaluateTracked.mockImplementation(
      (_r: unknown, _s: string[], cb?: (d: number, t: number) => void) => {
        cb?.(3, 6);
        seen = store.evaluating();
        return Promise.resolve({
          coverage: { rows: [], unevaluated: [], filtersApplied: [] },
          matched: { rows: [], unevaluated: [], filtersApplied: [] },
        });
      },
    );
    await store.evaluateTracked();
    expect(seen).toEqual({ done: 3, total: 6 });
    expect(store.evaluating()).toBeNull(); // cleared on completion
  });

  it('a run superseded mid-save writes the doc but does not prepend it', async () => {
    let resolveSave!: (v: string) => void;
    service.saveProposal.mockImplementation(
      () => new Promise((r) => (resolveSave = r)),
    );
    service.runScan.mockResolvedValue({
      totalItems: 1,
      rows: [wireRow('KEEP', { ROE: '0.2' })],
      filtersApplied: [],
    });
    const run = store.runScan();
    await new Promise((r) => setTimeout(r, 0)); // let the run reach the save await
    store.selectRecipe('gainers'); // supersedes — bumps runSeq
    resolveSave('prop-stale');
    await run;
    expect(service.saveProposal).toHaveBeenCalledTimes(1); // doc written
    expect(store.proposals().some((p) => p.id === 'prop-stale')).toBe(false);
  });

  it('a superseded run error is swallowed — newer state wins', async () => {
    let rejectSlow!: (e: unknown) => void;
    service.runScan.mockImplementation(
      () => new Promise((_, rej) => (rejectSlow = rej)),
    );
    store.selectRecipe('quality-mid');
    const slow = store.runScan();
    service.evaluateTracked.mockResolvedValue({
      coverage: { rows: [], unevaluated: [], filtersApplied: [] },
      matched: { rows: [], unevaluated: [], filtersApplied: [] },
    });
    await store.evaluateTracked();
    rejectSlow(new Error('stale failure'));
    await slow;
    expect(store.error()).toBeNull();
  });

  it('a proposal save failure surfaces separately — compare stays, error names the save', async () => {
    service.runScan.mockResolvedValue({
      totalItems: 1,
      rows: [wireRow('KEEP', { ROE: '0.2' })],
      filtersApplied: [],
    });
    service.saveProposal.mockRejectedValue(new Error('permission-denied'));
    await store.runScan();
    expect(store.compare()).not.toBeNull();
    expect(store.error()?.message).toContain('proposal save failed');
    expect(store.error()?.category).toBeNull(); // Firestore-side, not an RH reauth
    expect(store.running()).toBe(false);
  });

  it('runScan errors on an empty tracked universe instead of persisting a phantom proposal', async () => {
    // loadTrackedSymbols resolves [] on upstream failure — an empty
    // universe would mark every row an addCandidate and persist
    // universeSize:0, so the run refuses instead.
    symbolLists.loadTrackedSymbols.mockResolvedValue([]);
    service.runScan.mockResolvedValue({
      totalItems: 1,
      rows: [wireRow('X')],
      filtersApplied: [],
    });
    await store.runScan();
    expect(store.error()?.message).toContain('empty');
    expect(service.saveProposal).not.toHaveBeenCalled();
    // The write sits after the empty-universe throw — a refused run
    // can't cache a phantom result either (#1257).
    expect(service.saveLatestRun).not.toHaveBeenCalled();
    expect(store.compare()).toBeNull();
  });

  it('runScan persists matchedCount from wire totalItems, not parsed rows', async () => {
    // Truncated page: 200-row page of a 393-total result — the wire
    // count is the truthful matched count for the proposal.
    service.runScan.mockResolvedValue({
      totalItems: 393,
      rows: [wireRow('NEW')],
      filtersApplied: [],
    });
    await store.runScan();
    expect(service.saveProposal).toHaveBeenCalledWith(
      expect.objectContaining({ matchedCount: 393, truncated: true }),
    );
  });

  it('openProposal surfaces an error for an absent/drifted doc', async () => {
    await store.openProposal('gone');
    expect(store.proposalOpen()).toBeNull();
    expect(store.error()?.message).toContain('not found');
  });

  it('overlapping openProposal fetches resolve last-write-wins by call order', async () => {
    const entry = (id: string) => ({
      id,
      proposal: { recipeId: 'r', ranAt: 't', universeSize: 0, matchedCount: 0, truncated: false, addCandidates: [], dropCandidates: [], deadSymbols: [], noDataSymbols: [] },
    });
    let resolveA!: (v: unknown) => void;
    let resolveB!: (v: unknown) => void;
    service.getProposal
      .mockImplementationOnce(() => new Promise((r) => (resolveA = r)))
      .mockImplementationOnce(() => new Promise((r) => (resolveB = r)));
    const a = store.openProposal('a');
    const b = store.openProposal('b');
    resolveA(entry('a')); // older call resolves LAST
    resolveB(entry('b'));
    await Promise.all([a, b]);
    expect(store.proposalOpen()?.id).toBe('b');
  });

  it('closeProposal invalidates a pending openProposal fetch', async () => {
    let resolveFetch!: (v: unknown) => void;
    service.getProposal.mockImplementation(
      () => new Promise((r) => (resolveFetch = r)),
    );
    const open = store.openProposal('uncached');
    store.closeProposal();
    resolveFetch({
      id: 'uncached',
      proposal: { recipeId: 'r', ranAt: 't', universeSize: 0, matchedCount: 0, truncated: false, addCandidates: [], dropCandidates: [], deadSymbols: [], noDataSymbols: [] },
    });
    await open;
    expect(store.proposalOpen()).toBeNull();
  });

  it('a save rejection after supersession does not leak a stale error', async () => {
    let rejectSave!: (e: unknown) => void;
    service.saveProposal.mockImplementation(
      () => new Promise((_, rej) => (rejectSave = rej)),
    );
    service.runScan.mockResolvedValue({
      totalItems: 1,
      rows: [wireRow('KEEP', { ROE: '0.2' })],
      filtersApplied: [],
    });
    const run = store.runScan();
    await new Promise((r) => setTimeout(r, 0)); // reach the save await
    store.selectRecipe('gainers'); // supersedes
    rejectSave(new Error('stale save failure'));
    await run;
    expect(store.error()).toBeNull();
  });
});

describe('ScannerStore run-all machinery (#1198)', () => {
  let store: InstanceType<typeof ScannerStore>;
  let service: {
    runScan: jest.Mock;
    previewScanRaw: jest.Mock;
    evaluateTracked: jest.Mock;
    saveProposal: jest.Mock;
    saveLatestRun: jest.Mock;
    listProposals: jest.Mock;
    getProposal: jest.Mock;
  };
  let symbolLists: { loadTrackedSymbols: jest.Mock };

  const preview = (
    rows: ScanResultRow[],
    over: Partial<PreviewScanResult> = {},
  ): PreviewScanResult => ({
    total_items: rows.length,
    results: rows,
    filters_applied: [],
    sorted_by: 'Last desc',
    ...over,
  });

  beforeEach(() => {
    jest.useFakeTimers();
    service = {
      runScan: jest.fn(),
      previewScanRaw: jest.fn(),
      evaluateTracked: jest.fn(),
      saveProposal: jest.fn(() => Promise.resolve('prop-1')),
      saveLatestRun: jest.fn(() => Promise.resolve()),
      listProposals: jest.fn(() => Promise.resolve([])),
      getProposal: jest.fn(() => Promise.resolve(null)),
    };
    symbolLists = { loadTrackedSymbols: jest.fn(() => Promise.resolve(['KEEP'])) };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ScannerStore,
        { provide: ScannerService, useValue: service },
        { provide: SymbolListStore, useValue: symbolLists },
      ],
    });
    store = TestBed.inject(ScannerStore);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const recipeIds = () => SCANNER_RECIPES.map((r) => r.id);

  it('initializes every catalog recipe at idle', () => {
    expect(Object.keys(store.runs())).toEqual(recipeIds());
    for (const entry of Object.values(store.runs())) {
      expect(entry).toEqual({
        status: 'idle',
        result: null,
        ranAt: null,
        errorKind: null,
      });
    }
    expect(store.authFailed()).toBe(false);
  });

  it('runAllRecipes launches every recipe ~1s apart, each landing independently', async () => {
    service.previewScanRaw.mockImplementation((recipe: { id: string }) =>
      Promise.resolve(preview([wireRow(recipe.id.toUpperCase())])),
    );
    store.runAllRecipes();
    expect(service.previewScanRaw).toHaveBeenCalledTimes(0); // timers only
    // One launch per 1s slot — step a second at a time to prove the
    // stagger rather than jumping to the end.
    for (let i = 0; i < SCANNER_RECIPES.length; i++) {
      await jest.advanceTimersByTimeAsync(i === 0 ? 0 : 1000);
      expect(service.previewScanRaw).toHaveBeenCalledTimes(i + 1);
    }
    // Every recipe was called with its own recipe object.
    expect(service.previewScanRaw.mock.calls.map((c) => c[0].id)).toEqual(recipeIds());
    for (const id of recipeIds()) {
      expect(store.runs()[id].status).toBe('success');
      expect(store.runs()[id].result?.results[0].ticker).toBe(id.toUpperCase());
      expect(store.runs()[id].ranAt).toBeTruthy();
      expect(store.runs()[id].errorKind).toBeNull();
    }
  });

  it('a second runAllRecipes cancels the first wave\'s un-launched slots', async () => {
    // Page remount mid-stagger calls ngOnInit → runAllRecipes again —
    // wave-1's pending timers must not still fire on top of wave-2.
    service.previewScanRaw.mockResolvedValue(preview([wireRow('A')]));
    store.runAllRecipes();
    await jest.advanceTimersByTimeAsync(3000); // 4 recipes launched (0..3s)
    store.runAllRecipes();
    await jest.advanceTimersByTimeAsync(SCANNER_RECIPES.length * 1000);
    // 4 wave-1 launches + a full wave-2 — without cancellation wave-1's
    // remaining armed slots would still fire on top of wave-2's.
    expect(service.previewScanRaw).toHaveBeenCalledTimes(4 + SCANNER_RECIPES.length);
  });

  it('a pending stagger keeps later recipes queued (idle) until their slot', async () => {
    service.previewScanRaw.mockResolvedValue(preview([wireRow('AAPL')]));
    store.runAllRecipes();
    await jest.advanceTimersByTimeAsync(0); // first launch settles
    const last = SCANNER_RECIPES[SCANNER_RECIPES.length - 1].id;
    expect(store.runs()[last].status).toBe('idle');
    expect(store.runs()[SCANNER_RECIPES[0].id].status).toBe('success');
  });

  it('a per-recipe failure is isolated — status error, errorKind other, others unaffected', async () => {
    const failing = SCANNER_RECIPES[2].id;
    service.previewScanRaw.mockImplementation((recipe: { id: string }) =>
      recipe.id === failing
        ? Promise.reject(new Error('rate limited'))
        : Promise.resolve(preview([wireRow(recipe.id)])),
    );
    store.runAllRecipes();
    await jest.advanceTimersByTimeAsync(SCANNER_RECIPES.length * 1000);
    expect(store.runs()[failing].status).toBe('error');
    expect(store.runs()[failing].errorKind).toBe('other');
    expect(store.authFailed()).toBe(false);
    const others = Object.entries(store.runs()).filter(([id]) => id !== failing);
    expect(others.every(([, r]) => r.status === 'success')).toBe(true);
    // The single-run error channel is untouched — run-all failures are
    // per-recipe, not page errors.
    expect(store.error()).toBeNull();
    // The failed recipe doesn't cache — every other recipe writes once (#1257).
    expect(service.saveLatestRun).toHaveBeenCalledTimes(SCANNER_RECIPES.length - 1);
  });

  it('an auth-shaped failure sets errorKind auth and flips authFailed', async () => {
    service.previewScanRaw.mockRejectedValue(
      new RobinhoodMcpError('session expired', 'preview_scan', ToolExecutionErrorCategory.AUTH),
    );
    store.runAllRecipes();
    await jest.advanceTimersByTimeAsync(SCANNER_RECIPES.length * 1000);
    for (const id of recipeIds()) {
      expect(store.runs()[id].errorKind).toBe('auth');
    }
    expect(store.authFailed()).toBe(true);
    // A non-RH error does NOT count as auth — the Firebase/auth-category
    // distinction must hold in the run map too.
    service.previewScanRaw.mockRejectedValue(new Error('firestore denied'));
    store.refreshRecipe(recipeIds()[0]);
    await jest.advanceTimersByTimeAsync(0);
    expect(store.runs()[recipeIds()[0]].errorKind).toBe('other');
    expect(store.authFailed()).toBe(true); // other entries still auth
    // No success landed anywhere — nothing may reach the cache (#1257).
    expect(service.saveLatestRun).not.toHaveBeenCalled();
  });

  it('a non-AUTH RobinhoodMcpError is not auth — the category, not the type, decides', async () => {
    // e.g. parseScanResult's own malformed-response throw is MCP-category;
    // an `instanceof RobinhoodMcpError` check would wrongly raise reauth.
    service.previewScanRaw.mockRejectedValue(
      new RobinhoodMcpError('bad shape', 'preview_scan', ToolExecutionErrorCategory.MCP),
    );
    store.refreshRecipe(recipeIds()[0]);
    await jest.advanceTimersByTimeAsync(0);
    expect(store.runs()[recipeIds()[0]].errorKind).toBe('other');
    expect(store.authFailed()).toBe(false);
  });

  it('a successful refresh clears a prior auth failure for that recipe', async () => {
    service.previewScanRaw.mockRejectedValueOnce(
      new RobinhoodMcpError('expired', 'preview_scan', ToolExecutionErrorCategory.AUTH),
    );
    store.refreshRecipe(recipeIds()[0]);
    await jest.advanceTimersByTimeAsync(0);
    expect(store.authFailed()).toBe(true);
    service.previewScanRaw.mockResolvedValue(preview([wireRow('OK')]));
    store.refreshRecipe(recipeIds()[0]);
    await jest.advanceTimersByTimeAsync(0);
    expect(store.runs()[recipeIds()[0]].status).toBe('success');
    expect(store.authFailed()).toBe(false);
  });

  it('runAllRecipes clears errorKind at arm — authFailed drops before the first launch lands', async () => {
    // ~1s-per-recipe stagger: clearing at launch would leave the reauth
    // banner up ~11s after a successful reauth. Arming clears it.
    service.previewScanRaw.mockRejectedValueOnce(
      new RobinhoodMcpError('expired', 'preview_scan', ToolExecutionErrorCategory.AUTH),
    );
    store.refreshRecipe(recipeIds()[0]);
    await jest.advanceTimersByTimeAsync(0);
    expect(store.authFailed()).toBe(true);

    service.previewScanRaw.mockResolvedValue(preview([wireRow('OK')]));
    store.runAllRecipes();
    expect(store.authFailed()).toBe(false); // armed — zero timers elapsed
    // The failed entry keeps status 'error' (and its retained result)
    // until its relaunch — only the auth flag clears early.
    expect(store.runs()[recipeIds()[0]].status).toBe('error');
  });

  it('refreshRecipe re-runs one recipe immediately — no stagger, others untouched', async () => {
    const target = SCANNER_RECIPES[3];
    const other = SCANNER_RECIPES[0];
    service.previewScanRaw.mockResolvedValue(preview([wireRow('ONE')]));
    // Give a sibling entry a result first — "untouched" must mean its
    // data survives the refresh, not just that it was never launched.
    store.refreshRecipe(other.id);
    await jest.advanceTimersByTimeAsync(0);
    const otherEntry = store.runs()[other.id];
    store.refreshRecipe(target.id);
    expect(service.previewScanRaw).toHaveBeenCalledTimes(2);
    expect(service.previewScanRaw).toHaveBeenLastCalledWith(target);
    await jest.advanceTimersByTimeAsync(0);
    expect(store.runs()[target.id].status).toBe('success');
    expect(store.runs()[other.id]).toBe(otherEntry); // identity preserved
    for (const id of recipeIds().filter((i) => i !== target.id && i !== other.id)) {
      expect(store.runs()[id].status).toBe('idle');
    }
    store.refreshRecipe('not-a-recipe');
    expect(service.previewScanRaw).toHaveBeenCalledTimes(2);
  });

  it('a refresh during the stagger consumes the recipe\'s armed slot — no double-fire', async () => {
    const target = SCANNER_RECIPES[SCANNER_RECIPES.length - 1]; // last slot
    service.previewScanRaw.mockResolvedValue(preview([wireRow('A')]));
    store.runAllRecipes();
    store.refreshRecipe(target.id); // user refreshes the queued table
    await jest.advanceTimersByTimeAsync(SCANNER_RECIPES.length * 1000);
    const callsFor = service.previewScanRaw.mock.calls.filter(
      (c) => c[0].id === target.id,
    );
    expect(callsFor.length).toBe(1); // armed slot was consumed
    expect(store.runs()[target.id].status).toBe('success');
  });

  it('an error entry keeps the prior result and ranAt — refresh can show where it left off', async () => {
    const id = recipeIds()[0];
    service.previewScanRaw.mockResolvedValueOnce(preview([wireRow('OLD')]));
    store.refreshRecipe(id);
    await jest.advanceTimersByTimeAsync(0);
    const okRanAt = store.runs()[id].ranAt;
    service.previewScanRaw.mockRejectedValueOnce(new Error('down'));
    store.refreshRecipe(id);
    await jest.advanceTimersByTimeAsync(0);
    expect(store.runs()[id].status).toBe('error');
    expect(store.runs()[id].errorKind).toBe('other');
    expect(store.runs()[id].result?.results[0].ticker).toBe('OLD');
    expect(store.runs()[id].ranAt).toBe(okRanAt);
  });

  it('a runAll re-entry supersedes wave-1 launches still in flight', async () => {
    // TEST edge: the 15-min interval ticking while the previous cycle's
    // calls are in flight — newer wave wins per recipe.
    const id = recipeIds()[0];
    let resolveStale!: (v: PreviewScanResult) => void;
    service.previewScanRaw
      .mockImplementationOnce(() => new Promise((r) => (resolveStale = r)))
      .mockResolvedValue(preview([wireRow('FRESH')]));
    store.runAllRecipes();
    await jest.advanceTimersByTimeAsync(0); // recipe 0 in flight (hangs)
    store.runAllRecipes();
    await jest.advanceTimersByTimeAsync(0); // wave-2 recipe 0 launches
    expect(store.runs()[id].result?.results[0].ticker).toBe('FRESH');
    resolveStale(preview([wireRow('STALE')]));
    await jest.advanceTimersByTimeAsync(0);
    expect(store.runs()[id].result?.results[0].ticker).toBe('FRESH');
  });

  it('a refresh keeps the prior result while reloading — no collapse to blank', async () => {
    const id = recipeIds()[0];
    service.previewScanRaw.mockResolvedValueOnce(preview([wireRow('OLD')]));
    store.refreshRecipe(id);
    await jest.advanceTimersByTimeAsync(0);
    expect(store.runs()[id].result?.results[0].ticker).toBe('OLD');

    let resolveNew!: (v: PreviewScanResult) => void;
    service.previewScanRaw.mockImplementation(
      () => new Promise((r) => (resolveNew = r)),
    );
    store.refreshRecipe(id);
    expect(store.runs()[id].status).toBe('loading');
    expect(store.runs()[id].result?.results[0].ticker).toBe('OLD'); // stale rows retained
    resolveNew(preview([wireRow('NEW')]));
    await jest.advanceTimersByTimeAsync(0);
    expect(store.runs()[id].result?.results[0].ticker).toBe('NEW');
    expect(store.runs()[id].status).toBe('success');
  });

  it('an overlapping relaunch wins per recipe — a stale completion cannot clobber it', async () => {
    const id = recipeIds()[0];
    // First launch hangs; second (refresh) resolves first; the stale
    // promise landing later must not overwrite the newer result.
    let resolveStale!: (v: PreviewScanResult) => void;
    service.previewScanRaw
      .mockImplementationOnce(() => new Promise((r) => (resolveStale = r)))
      .mockResolvedValueOnce(preview([wireRow('FRESH')]));
    store.runAllRecipes(); // launch #1 in flight for this recipe
    await jest.advanceTimersByTimeAsync(0);
    store.refreshRecipe(id); // launch #2 supersedes for THIS recipe only
    await jest.advanceTimersByTimeAsync(0);
    expect(store.runs()[id].result?.results[0].ticker).toBe('FRESH');
    resolveStale(preview([wireRow('STALE')]));
    await jest.advanceTimersByTimeAsync(0);
    expect(store.runs()[id].result?.results[0].ticker).toBe('FRESH');
    expect(store.runs()[id].status).toBe('success');
    // Stale completion can't write the cache either — only the
    // superseding launch's result reached saveLatestRun (#1257).
    expect(service.saveLatestRun).toHaveBeenCalledTimes(1);
    expect(service.saveLatestRun).toHaveBeenCalledWith(
      id,
      expect.objectContaining({
        results: [expect.objectContaining({ ticker: 'FRESH' })],
      }),
    );
  });

  it('run state persists in the root store — entries survive across page lifetimes', async () => {
    service.previewScanRaw.mockResolvedValue(preview([wireRow('AAPL')]));
    store.refreshRecipe(recipeIds()[0]);
    await jest.advanceTimersByTimeAsync(0);
    // A second store injection returns the same root instance — the map
    // carries last results without re-firing anything.
    const again = TestBed.inject(ScannerStore);
    expect(again.runs()[recipeIds()[0]].status).toBe('success');
    expect(service.previewScanRaw).toHaveBeenCalledTimes(1);
  });

  it('runsLoading covers armed-but-unfired slots — the gate cannot flicker mid-wave', async () => {
    service.previewScanRaw.mockResolvedValue(preview([wireRow('X')]));
    expect(store.runsLoading()).toBe(false);
    store.runAllRecipes();
    expect(store.runsLoading()).toBe(true); // all slots armed, none launched yet
    await jest.advanceTimersByTimeAsync(0); // recipe 0 settles fast…
    // …but recipes 1+ are still armed — the gate must stay closed.
    expect(store.runsLoading()).toBe(true);
    await jest.advanceTimersByTimeAsync(SCANNER_RECIPES.length * 1000);
    expect(store.runsLoading()).toBe(false);

    let resolveOne!: (v: PreviewScanResult) => void;
    service.previewScanRaw.mockImplementation(
      () => new Promise((r) => (resolveOne = r)),
    );
    store.refreshRecipe(recipeIds()[0]);
    expect(store.runsLoading()).toBe(true);
    resolveOne(preview([wireRow('X')]));
    await jest.advanceTimersByTimeAsync(0);
    expect(store.runsLoading()).toBe(false);
  });
});
