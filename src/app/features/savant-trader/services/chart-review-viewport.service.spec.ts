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
      untriagedSymbols: signal([]),
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
    // #1016 — 'ALL' is the union of every list's members (was the
    // flagged-symbol queue before review-list removal).
    listCatalog.set([]);
    expect(service.activeViewportList()).toBe('ALL');
    expect(service.viewportSymbols()).toEqual([]);
  });

  it('ALL unions every list member deduped — the post-flag browse view (#1016)', () => {
    const triageStore = {
      viewportMode: signal<'signals' | 'browse'>('browse'),
      activeViewportList: signal('ALL'),
      reviewSymbols: signal<string[]>([]),
      setActiveViewportList: jest.fn(),
    };
    const symbolListStore = {
      byKey: computed(() => new Map()),
      symbolLists: computed(() => ({
        'my-picks': ['AAPL', 'MSFT'],
        'watchlist': ['MSFT', 'TSLA'],
      })),
      untriagedSymbols: signal([]),
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

    expect(service.viewportSymbols().sort()).toEqual(['AAPL', 'MSFT', 'TSLA']);
  });

  it('signals + ALL returns the flagged queue — retained semantics (#1016)', () => {
    const triageStore = {
      viewportMode: signal<'signals' | 'browse'>('signals'),
      activeViewportList: signal('ALL'),
      reviewSymbols: signal(['AAPL', 'MSFT']),
      setActiveViewportList: jest.fn(),
    };
    const symbolListStore = {
      byKey: computed(() => new Map()),
      symbolLists: computed(() => ({ 'my-picks': ['TSLA'] })),
      untriagedSymbols: signal([]),
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

    expect(service.viewportSymbols()).toEqual(['AAPL', 'MSFT']);
  });
});
