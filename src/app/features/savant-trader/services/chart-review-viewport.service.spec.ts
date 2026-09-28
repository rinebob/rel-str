/// <reference types="jest" />
import { TestBed } from '@angular/core/testing';
import { computed, provideZonelessChangeDetection, signal } from '@angular/core';

import { SymbolListStore } from '../stores/symbol-list.store';
import { TriageStore } from '../stores/triage.store';
import { ChartReviewViewportService } from './chart-review-viewport.service';
import type { SymbolListDef } from '../common/symbol-list-defs';

function listDef(key: string, symbols: string[]): SymbolListDef {
  return { key, label: key, order: 100, role: 'nonexclusive', hidden: false, symbols };
}

describe('ChartReviewViewportService', () => {
  it('falls back to ALL when the active catalog key is deleted', () => {
    const activeViewportList = signal('my-picks');
    const reviewSymbols = signal(['AAPL', 'MSFT']);
    const listCatalog = signal([listDef('my-picks', ['TSLA'])]);
    const triageStore = {
      viewportMode: signal<'signals' | 'browse'>('browse'),
      activeViewportList,
      reviewSymbols,
      setActiveViewportList: jest.fn(),
    };
    const symbolListStore = {
      byKey: computed(() => new Map(listCatalog().map((def) => [def.key, def]))),
      symbolLists: computed(() => Object.fromEntries(listCatalog().map((def) => [def.key, def.symbols]))),
      unlistedSymbols: signal([]),
      loadTrackedSymbols: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: TriageStore, useValue: triageStore },
        { provide: SymbolListStore, useValue: symbolListStore },
      ],
    });
    const service = TestBed.inject(ChartReviewViewportService);

    expect(service.activeViewportList()).toBe('my-picks');
    expect(service.viewportSymbols()).toEqual(['TSLA']);
    listCatalog.set([]);
    expect(service.activeViewportList()).toBe('ALL');
    expect(service.viewportSymbols()).toEqual(['AAPL', 'MSFT']);
  });
});
