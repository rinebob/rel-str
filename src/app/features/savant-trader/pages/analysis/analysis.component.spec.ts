/**
 * AnalysisComponent spec (Thread #1059, task #1082) — the dataset
 * library page.
 *
 * AC1: provenance at a glance (origin badge, params, scope, rowCount,
 * timestamp, status chip) + search by symbol/name/tag.
 * AC2: 'generating' entries render pending and the library polls until
 * status flips.
 * Also: tags/notes inline edit → updateTagsNotes; delete → two-step
 * confirm → deleteDataset; Open only for ready; run-config submit →
 * store.generateDataset.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';

import { AnalysisComponent } from './analysis.component';
import { AnalysisStore } from '../../stores/analysis.store';
import { PaperTradingKind } from '@paper-trading/contracts';
import type { AnalysisDatasetDoc } from '@paper-trading/analysis';

function doc(over: Partial<AnalysisDatasetDoc> = {}): AnalysisDatasetDoc {
  return {
    kind: PaperTradingKind.ANALYSIS_DATASET,
    id: 'ds-1',
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-10-20T00:00:00Z',
    origin: 'replay',
    status: 'ready',
    rowCount: 99,
    symbolScope: ['AMAT'],
    signalTypes: [],
    exitRule: 'trailing-8',
    barRange: { from: '2023-01-01', to: '2026-10-16' },
    entryConvention: 'signal-bar-close',
    generatedAt: '2026-10-20T12:00:00Z',
    gcsPath: 'analysis-datasets/ds-1.csv',
    tags: ['oct'],
    ...over,
  };
}

const READY = doc();
const GENERATING = doc({
  id: 'ds-gen',
  origin: 'live',
  status: 'generating',
  rowCount: undefined,
  symbolScope: [],
  gcsPath: 'analysis-datasets/ds-gen.csv',
  tags: [],
});
const LIVE_READY = doc({ id: 'ds-live', origin: 'live', symbolScope: [], notes: 'snapshot' });

describe('AnalysisComponent', () => {
  let fixture: ComponentFixture<AnalysisComponent>;
  let component: AnalysisComponent;
  let storeMock: {
    datasets: ReturnType<typeof signal<AnalysisDatasetDoc[]>>;
    activeDataset: ReturnType<typeof signal<AnalysisDatasetDoc | null>>;
    rows: ReturnType<typeof signal<unknown[]>>;
    sortedRows: ReturnType<typeof signal<unknown[]>>;
    viewRows: ReturnType<typeof signal<unknown[]>>;
    columns: ReturnType<typeof signal<string[]>>;
    sorts: ReturnType<typeof signal<unknown[]>>;
    filters: ReturnType<typeof signal<unknown[]>>;
    includeOpenRows: ReturnType<typeof signal<boolean>>;
    hiddenRowCount: ReturnType<typeof signal<number>>;
    isLoadingRows: ReturnType<typeof signal<boolean>>;
    isLoadingDatasets: ReturnType<typeof signal<boolean>>;
    isGenerating: ReturnType<typeof signal<boolean>>;
    error: ReturnType<typeof signal<string | null>>;
    loadDatasets: jest.Mock;
    openDataset: jest.Mock;
    closeDataset: jest.Mock;
    deleteDataset: jest.Mock;
    updateTagsNotes: jest.Mock;
    generateDataset: jest.Mock;
    toggleSort: jest.Mock;
    setFilters: jest.Mock;
    setIncludeOpenRows: jest.Mock;
  };

  function el(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }

  function els(selector: string): HTMLElement[] {
    return [...fixture.nativeElement.querySelectorAll(selector)];
  }

  beforeEach(async () => {
    storeMock = {
      datasets: signal<AnalysisDatasetDoc[]>([READY, GENERATING, LIVE_READY]),
      activeDataset: signal<AnalysisDatasetDoc | null>(null),
      rows: signal<unknown[]>([]),
      sortedRows: signal<unknown[]>([]),
      viewRows: signal<unknown[]>([]),
      columns: signal<string[]>([]),
      sorts: signal<unknown[]>([]),
      filters: signal<unknown[]>([]),
      includeOpenRows: signal(false),
      hiddenRowCount: signal(0),
      isLoadingRows: signal(false),
      isLoadingDatasets: signal(false),
      isGenerating: signal(false),
      error: signal<string | null>(null),
      loadDatasets: jest.fn(),
      openDataset: jest.fn(),
      closeDataset: jest.fn(),
      deleteDataset: jest.fn(),
      updateTagsNotes: jest.fn(),
      generateDataset: jest.fn(),
      toggleSort: jest.fn(),
      setFilters: jest.fn(),
      setIncludeOpenRows: jest.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [AnalysisComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: AnalysisStore, useValue: storeMock },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AnalysisComponent);
    component = fixture.componentInstance;
  });

  // ── library render + provenance (AC1) ────────────────────────────────

  it('loads the library on init and renders one card per dataset', () => {
    fixture.detectChanges();
    expect(storeMock.loadDatasets).toHaveBeenCalledTimes(1);
    expect(els('mat-card')).toHaveLength(3);
  });

  it('provenance is visible at a glance — origin badge, status chip, params, scope, rowCount, timestamp', () => {
    fixture.detectChanges();
    const cards = els('mat-card');
    const ready = cards[0];
    expect(ready.querySelector('.origin-badge')?.textContent).toContain('replay');
    expect(ready.querySelector('.status-chip')?.textContent).toContain('ready');
    expect(ready.textContent).toContain('trailing-8');
    const title = ready.querySelector('.card-title');
    expect(title?.textContent).toContain('AMAT');
    expect(title?.textContent).toContain('trailing-8');
    expect(ready.textContent).toContain('signal-bar-close');
    expect(ready.textContent).toContain('2023-01-01 → 2026-10-16');
    expect(ready.textContent).toContain('AMAT');
    expect(ready.textContent).toContain('99 rows');
    expect(ready.textContent).toContain('Oct 20, 2026');
  });

  it('empty scope renders as all-symbols / all-types', () => {
    fixture.detectChanges();
    const liveCard = els('mat-card')[2];
    expect(liveCard.textContent).toContain('all symbols');
    expect(liveCard.textContent).toContain('all signal types');
  });

  // ── search (AC1) ─────────────────────────────────────────────────────

  it('search narrows the list by symbol, name, or tag', () => {
    fixture.detectChanges();
    const input = el('input') as HTMLInputElement;
    input.value = 'amat';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(els('mat-card')).toHaveLength(1);
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(els('mat-card')).toHaveLength(0);
    expect(el('.empty-state')?.textContent).toContain('zzz');
  });

  // ── generating pending + refresh (AC2) ───────────────────────────────

  it('a generating entry renders the pending chip and disables Open', () => {
    fixture.detectChanges();
    const genCard = els('mat-card')[1];
    expect(genCard.querySelector('.status-chip')?.textContent).toContain('generating');
    expect(genCard.querySelector('mat-spinner')).toBeTruthy();
    const openBtn = genCard.querySelector('mat-card-actions button') as HTMLButtonElement;
    expect(openBtn.disabled).toBe(true);
  });

  it('polls while a generating entry exists', () => {
    jest.useFakeTimers();
    try {
      fixture.detectChanges(); // ngOnInit → initial load
      storeMock.loadDatasets.mockClear();
      jest.advanceTimersByTime(AnalysisComponent.REFRESH_INTERVAL_MS);
      expect(storeMock.loadDatasets).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not poll when nothing is generating', () => {
    storeMock.datasets.set([READY, LIVE_READY]);
    jest.useFakeTimers();
    try {
      fixture.detectChanges();
      storeMock.loadDatasets.mockClear();
      jest.advanceTimersByTime(AnalysisComponent.REFRESH_INTERVAL_MS * 3);
      expect(storeMock.loadDatasets).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a failed entry renders its error detail', () => {
    storeMock.datasets.set([doc({ status: 'failed', error: 'task exploded' })]);
    fixture.detectChanges();
    expect(el('.error-line')?.textContent).toContain('task exploded');
  });

  // ── open ─────────────────────────────────────────────────────────────

  it('Open loads a ready dataset into the workbench', () => {
    fixture.detectChanges();
    const openBtn = els('mat-card')[0].querySelector(
      'mat-card-actions button',
    ) as HTMLButtonElement;
    expect(openBtn.disabled).toBe(false);
    openBtn.click();
    expect(storeMock.openDataset).toHaveBeenCalledWith(READY);
  });

  it('the opened card is marked and mounts the workbench table (#1083)', () => {
    fixture.detectChanges();
    expect(el('app-analysis-table')).toBeNull();
    storeMock.activeDataset.set(READY);
    fixture.detectChanges();
    const banner = els('mat-card')[0].querySelector('.open-banner');
    expect(banner?.textContent).toContain('Open in workbench');
    expect(el('app-analysis-table')).not.toBeNull();
  });

  it('the workbench close button clears the active dataset', () => {
    storeMock.activeDataset.set(READY);
    fixture.detectChanges();
    (el('.close-workbench') as HTMLButtonElement).click();
    expect(storeMock.closeDataset).toHaveBeenCalled();
  });

  it('the page explains what a dataset is — subtitle with the replay/live distinction', () => {
    fixture.detectChanges();
    expect(el('.page-subtitle')?.textContent).toContain('replay');
    expect(el('.page-subtitle')?.textContent).toContain('live');
  });

  // ── tags/notes inline edit ───────────────────────────────────────────

  it('edit → save writes parsed tags + notes via updateTagsNotes', () => {
    fixture.detectChanges();
    const card = els('mat-card')[0];
    (card.querySelectorAll('button')[1] as HTMLButtonElement).click(); // Tags / notes
    fixture.detectChanges();
    const tagsInput = card.querySelector('.edit-tags input') as HTMLInputElement;
    tagsInput.value = 'a, b';
    tagsInput.dispatchEvent(new Event('input'));
    const notesInput = card.querySelector('.edit-notes textarea') as HTMLTextAreaElement;
    notesInput.value = 'new note';
    notesInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (card.querySelector('.edit-actions button') as HTMLButtonElement).click();
    expect(storeMock.updateTagsNotes).toHaveBeenCalledWith('ds-1', ['a', 'b'], 'new note');
  });

  it('saving empty notes passes null — explicit clear', () => {
    fixture.detectChanges();
    const card = els('mat-card')[0];
    (card.querySelectorAll('button')[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    (card.querySelector('.edit-actions button') as HTMLButtonElement).click();
    expect(storeMock.updateTagsNotes).toHaveBeenCalledWith('ds-1', ['oct'], null);
  });

  // ── delete with confirm ──────────────────────────────────────────────

  it('delete requires confirmation — first click asks, confirm deletes', () => {
    fixture.detectChanges();
    const card = els('mat-card')[0];
    const del = card.querySelector(
      'mat-card-actions button[color="warn"], mat-card-actions button:last-child',
    ) as HTMLButtonElement;
    del.click();
    fixture.detectChanges();
    expect(storeMock.deleteDataset).not.toHaveBeenCalled();
    const confirm = Array.from(card.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Confirm delete'),
    ) as HTMLButtonElement;
    expect(confirm).toBeTruthy();
    confirm.click();
    expect(storeMock.deleteDataset).toHaveBeenCalledWith(READY);
  });

  it('Keep cancels the pending delete', () => {
    fixture.detectChanges();
    const card = els('mat-card')[0];
    Array.from(card.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Delete'))!
      .click();
    fixture.detectChanges();
    Array.from(card.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Keep'))!
      .click();
    fixture.detectChanges();
    expect(storeMock.deleteDataset).not.toHaveBeenCalled();
    expect(
      Array.from(card.querySelectorAll('button')).some((b) =>
        b.textContent?.includes('Confirm delete'),
      ),
    ).toBe(false);
  });

  // ── run-config integration ───────────────────────────────────────────

  it('run-config submission forwards to store.generateDataset and closes the panel', () => {
    fixture.detectChanges();
    component.onGenerate({
      params: {
        origin: 'replay',
        symbolScope: ['AMAT'],
        signalTypes: [],
        exitRule: 'trailing-8',
        barRange: { from: '2023-01-01', to: '2026-10-20' },
        entryConvention: 'signal-bar-close',
      },
      meta: { tags: ['t'], notes: 'n' },
    });
    expect(storeMock.generateDataset).toHaveBeenCalledWith(
      expect.objectContaining({ exitRule: 'trailing-8' }),
      { tags: ['t'], notes: 'n' },
    );
    fixture.detectChanges();
    expect(el('app-analysis-run-config')).toBeNull();
  });
});
