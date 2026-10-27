/// <reference types="jest" />
import { TestBed } from '@angular/core/testing';
import { computed, provideZonelessChangeDetection, signal } from '@angular/core';

import { SymbolListStore } from '../stores/symbol-list.store';
import { ChartViewViewportService } from './chart-view-viewport.service';
import { NO_MEMBERSHIP, isScanSource, scanSourceRecipeId } from '../common/constants';
import type { SymbolListDef } from '../common/symbol-list-defs';

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
  function setup(catalog: SymbolListDef[] = [], untriaged: string[] = []) {
    const listCatalog = signal(catalog);
    const symbolListStore = {
      byKey: computed(() => new Map(listCatalog().map((d) => [d.key, d]))),
      symbolLists: computed(() =>
        Object.fromEntries(listCatalog().map((d) => [d.key, d.symbols])),
      ),
      untriagedSymbols: signal(untriaged),
      loadTrackedSymbols: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: SymbolListStore, useValue: symbolListStore },
      ],
    });
    return {
      service: TestBed.inject(ChartViewViewportService),
      listCatalog,
      symbolListStore,
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

  it('scan:{id} sources are live keys — never masked to ALL, empty until the cache lands (#1258)', () => {
    const { service } = setup([listDef('primary', ['AAPL'])]);
    service.setActiveSource('scan:quality-large');
    expect(service.activeList()).toBe('scan:quality-large');
    expect(service.viewportSymbols()).toEqual([]);
  });

  it('selecting a list after a scan source leaves exactly one active source', () => {
    const { service } = setup([listDef('primary', ['AAPL'])]);
    service.setActiveSource('scan:quality-large');
    service.setActiveSource('primary');
    expect(service.activeList()).toBe('primary');
    expect(service.viewportSymbols()).toEqual(['AAPL']);
  });
});
