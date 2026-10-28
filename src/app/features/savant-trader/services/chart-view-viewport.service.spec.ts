/// <reference types="jest" />
import { TestBed } from '@angular/core/testing';
import { computed, provideZonelessChangeDetection, signal } from '@angular/core';

import { SymbolListStore } from '../stores/symbol-list.store';
import { LatestRunStore } from '../stores/latest-run.store';
import { ChartViewViewportService } from './chart-view-viewport.service';
import { NO_MEMBERSHIP, isScanSource, scanSourceRecipeId } from '../common/constants';
import type { SymbolListDef } from '../common/symbol-list-defs';
import type { ScanLatestRun } from '@st/scanner';
import { scanRun } from '../testing/scan-fixtures';

function listDef(key: string, symbols: string[]): SymbolListDef {
  return { key, label: key, order: 100, role: 'nonexclusive', hidden: false, symbols };
}

describe('isScanSource / scanSourceRecipeId', () => {
  it('scan:{recipeId} keys parse back to the recipe id', () => {
    expect(isScanSource('scan:quality-large')).toBe(true);
    expect(scanSourceRecipeId('scan:quality-large')).toBe('quality-large');
  });

  it('list keys, ALL, and NO_MEMBERSHIP are never scan sources', () => {
    expect(isScanSource('ALL')).toBe(false);
    expect(isScanSource(NO_MEMBERSHIP)).toBe(false);
    expect(isScanSource('my-picks')).toBe(false);
    expect(scanSourceRecipeId('my-picks')).toBeNull();
  });
});

describe('ChartViewViewportService', () => {
  function setup(
    catalog: SymbolListDef[] = [],
    untriaged: string[] = [],
    tracked: string[] = [],
    latestRuns: Map<string, ScanLatestRun> = new Map(),
  ) {
    const listCatalog = signal(catalog);
    const symbolListStore = {
      byKey: computed(() => new Map(listCatalog().map((d) => [d.key, d]))),
      symbolLists: computed(() =>
        Object.fromEntries(listCatalog().map((d) => [d.key, d.symbols])),
      ),
      untriagedSymbols: signal(untriaged),
      trackedSymbols: signal(tracked),
      loadTrackedSymbols: jest.fn(),
    };
    // Signal-backed mock — same contract as the real store (latestRuns
    // signal + rowsFor reading it), not a closed-over snapshot.
    const runsSignal = signal(latestRuns);
    const latestRunStore = {
      latestRuns: runsSignal,
      rowsFor: jest.fn((recipeId: string) => runsSignal().get(recipeId)?.rows ?? []),
    };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: SymbolListStore, useValue: symbolListStore },
        { provide: LatestRunStore, useValue: latestRunStore },
      ],
    });
    return {
      service: TestBed.inject(ChartViewViewportService),
      listCatalog,
      symbolListStore,
      latestRunStore,
    };
  }

  it('defaults to ALL — the union of every list member, deduped', () => {
    const { service } = setup([
      listDef('primary', ['AAPL', 'MSFT']),
      listDef('secondary', ['MSFT', 'TSLA']),
    ]);
    expect(service.activeList()).toBe('ALL');
    expect(service.viewportSymbols()).toEqual(['AAPL', 'MSFT', 'TSLA']);
  });

  it('a list source returns that list’s members', () => {
    const { service } = setup([listDef('primary', ['AAPL'])]);
    service.setActiveSource('primary');
    expect(service.viewportSymbols()).toEqual(['AAPL']);
  });

  it('NO_MEMBERSHIP returns untriaged symbols and lazily loads the tracked universe', () => {
    const { service, symbolListStore } = setup([], ['NEW1', 'NEW2']);
    service.setActiveSource(NO_MEMBERSHIP);
    expect(service.viewportSymbols()).toEqual(['NEW1', 'NEW2']);
    expect(symbolListStore.loadTrackedSymbols).toHaveBeenCalled();
  });

  it('a deleted list key masks back to ALL', () => {
    const { service, listCatalog } = setup([listDef('gone', ['AAPL'])]);
    service.setActiveSource('gone');
    expect(service.activeList()).toBe('gone');
    listCatalog.set([]);
    expect(service.activeList()).toBe('ALL');
  });

  it('scan:{id} sources are live keys — never masked to ALL; a cold cache yields an empty pane (#1258)', () => {
    const { service } = setup([listDef('primary', ['AAPL'])]);
    service.setActiveSource('scan:quality-large');
    expect(service.activeList()).toBe('scan:quality-large');
    expect(service.viewportSymbols()).toEqual([]);
  });

  it('a scan source resolves the cache doc rows to tickers (#1258)', () => {
    const { service } = setup(
      [],
      [],
      [],
      new Map([['quality-large', scanRun('quality-large', ['NEW1', 'NEW2'])]]),
    );
    service.setActiveSource('scan:quality-large');
    expect(service.viewportSymbols()).toEqual(['NEW1', 'NEW2']);
  });

  it('New-only on a scan source lazily loads the tracked universe — the filter never runs against [] (#1258)', () => {
    const { service, symbolListStore } = setup(
      [],
      [],
      [],
      new Map([['gainers', scanRun('gainers', ['NEW1'])]]),
    );
    service.setActiveSource('scan:gainers');
    expect(symbolListStore.loadTrackedSymbols).toHaveBeenCalled();
    // Toggling back on while a scan is active re-ensures the load.
    symbolListStore.loadTrackedSymbols.mockClear();
    service.setNewOnly(false);
    expect(symbolListStore.loadTrackedSymbols).not.toHaveBeenCalled();
    service.setNewOnly(true);
    expect(symbolListStore.loadTrackedSymbols).toHaveBeenCalled();
  });

  it('a scan source dedupes repeated tickers like the ALL path (#1258)', () => {
    const { service } = setup(
      [],
      [],
      [],
      new Map([['gainers', scanRun('gainers', ['NEW1', 'NEW1', 'NEW2'])]]),
    );
    service.setActiveSource('scan:gainers');
    expect(service.viewportSymbols()).toEqual(['NEW1', 'NEW2']);
  });

  it('New only (default on) filters scan rows to symbols outside the tracked universe (#1258)', () => {
    const { service } = setup(
      [],
      [],
      ['TRACKED1'],
      new Map([['gainers', scanRun('gainers', ['NEW1', 'TRACKED1', 'NEW2'])]]),
    );
    service.setActiveSource('scan:gainers');
    // Tracked rows are filtered out by default…
    expect(service.newOnly()).toBe(true);
    expect(service.viewportSymbols()).toEqual(['NEW1', 'NEW2']);
    // …and reappear when the toggle goes off — all rows, original order.
    service.setNewOnly(false);
    expect(service.viewportSymbols()).toEqual(['NEW1', 'TRACKED1', 'NEW2']);
    service.setNewOnly(true);
    expect(service.viewportSymbols()).toEqual(['NEW1', 'NEW2']);
  });

  it('the New-only toggle never filters list sources (#1258)', () => {
    const { service } = setup([listDef('primary', ['AAPL', 'MSFT'])], [], ['AAPL', 'MSFT']);
    service.setActiveSource('primary');
    service.setNewOnly(true);
    expect(service.viewportSymbols()).toEqual(['AAPL', 'MSFT']);
    service.setNewOnly(false);
    expect(service.viewportSymbols()).toEqual(['AAPL', 'MSFT']);
  });

  it('selecting a list after a scan source leaves exactly one active source', () => {
    const { service } = setup([listDef('primary', ['AAPL'])]);
    service.setActiveSource('scan:quality-large');
    service.setActiveSource('primary');
    expect(service.activeList()).toBe('primary');
    expect(service.viewportSymbols()).toEqual(['AAPL']);
  });
});
