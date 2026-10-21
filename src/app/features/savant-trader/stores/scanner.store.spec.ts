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
import { ToolExecutionErrorCategory, type ScanResultRow } from '@robinhood-mcp/contracts';
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
    evaluateTracked: jest.Mock;
    saveProposal: jest.Mock;
    listProposals: jest.Mock;
    getProposal: jest.Mock;
  };
  let symbolLists: { loadTrackedSymbols: jest.Mock };

  beforeEach(() => {
    service = {
      runScan: jest.fn(),
      evaluateTracked: jest.fn(),
      saveProposal: jest.fn(() => Promise.resolve('prop-1')),
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
    expect(store.running()).toBe(false);
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
