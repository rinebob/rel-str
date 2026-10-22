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
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';

import { AnalysisComponent } from './analysis.component';
import { AnalysisStore } from '../../stores/analysis.store';
import { AnalysisHistogramComponent } from '../../components/analysis-views/analysis-histogram.component';
import { SliceMenuComponent } from '../../components/analysis-slices/slice-menu.component';
import { WorkbenchToolsComponent } from '../../components/analysis-workbench/workbench-tools.component';
import { PaperTradingKind } from '@paper-trading/contracts';
import type { AnalysisDatasetDoc, AnalysisSlice } from '@paper-trading/analysis';

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
    filteredRows: ReturnType<typeof signal<unknown[]>>;
    columns: ReturnType<typeof signal<string[]>>;
    sorts: ReturnType<typeof signal<unknown[]>>;
    filters: ReturnType<typeof signal<unknown[]>>;
    includeOpenRows: ReturnType<typeof signal<boolean>>;
    hiddenRowCount: ReturnType<typeof signal<number>>;
    isLoadingRows: ReturnType<typeof signal<boolean>>;
    isLoadingDatasets: ReturnType<typeof signal<boolean>>;
    isGenerating: ReturnType<typeof signal<boolean>>;
    isLoadingCompare: ReturnType<typeof signal<boolean>>;
    error: ReturnType<typeof signal<string | null>>;
    slices: ReturnType<typeof signal<AnalysisSlice[]>>;
    skippedSliceColumns: ReturnType<typeof signal<string[]>>;
    compareDataset: ReturnType<typeof signal<AnalysisDatasetDoc | null>>;
    filteredCompareRows: ReturnType<typeof signal<unknown[]>>;
    skippedCompareColumns: ReturnType<typeof signal<string[]>>;
    loadDatasets: jest.Mock;
    loadSlices: jest.Mock;
    saveSlice: jest.Mock;
    applySlice: jest.Mock;
    deleteSlice: jest.Mock;
    loadCompareDataset: jest.Mock;
    clearCompare: jest.Mock;
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
      filteredRows: signal<unknown[]>([]),
      columns: signal<string[]>([]),
      sorts: signal<unknown[]>([]),
      filters: signal<unknown[]>([]),
      includeOpenRows: signal(false),
      hiddenRowCount: signal(0),
      isLoadingRows: signal(false),
      isLoadingDatasets: signal(false),
      isGenerating: signal(false),
      isLoadingCompare: signal(false),
      error: signal<string | null>(null),
      slices: signal<AnalysisSlice[]>([]),
      skippedSliceColumns: signal<string[]>([]),
      compareDataset: signal<AnalysisDatasetDoc | null>(null),
      filteredCompareRows: signal<unknown[]>([]),
      skippedCompareColumns: signal<string[]>([]),
      loadDatasets: jest.fn(),
      loadSlices: jest.fn(),
      saveSlice: jest.fn(),
      applySlice: jest.fn(),
      deleteSlice: jest.fn(),
      loadCompareDataset: jest.fn(),
      clearCompare: jest.fn(),
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

  // ── #1085 — slices + compare ──────────────────────────────────────────

  function openWorkbench(): void {
    storeMock.activeDataset.set(READY);
    fixture.detectChanges();
  }

  function sliceFixture(name: string, filters: AnalysisSlice['filters']): AnalysisSlice {
    return {
      id: `s-${name}`,
      kind: PaperTradingKind.ANALYSIS_SLICE,
      name,
      filters,
      createdAt: '2026-10-21T00:00:00Z',
      updatedAt: '2026-10-21T00:00:00Z',
    };
  }

  function tools(): WorkbenchToolsComponent {
    return fixture.debugElement.query(By.directive(WorkbenchToolsComponent))
      .componentInstance;
  }

  function clickViewBtn(name: string): void {
    Array.from(els('.view-btn'))
      .find((b) => b.textContent?.trim() === name)!
      .click();
    fixture.detectChanges();
  }

  it('loads slices on init alongside datasets', () => {
    fixture.detectChanges();
    expect(storeMock.loadSlices).toHaveBeenCalledTimes(1);
  });

  it('the library carries a manage-only slice menu (no apply)', () => {
    fixture.detectChanges();
    const menu = fixture.debugElement.query(
      By.css('.header-actions app-slice-menu'),
    ).componentInstance as SliceMenuComponent;
    expect(menu.canApply()).toBe(false);
  });

  it('save slice serializes the filter chain under a name', () => {
    openWorkbench();
    storeMock.filters.set([
      { column: 'ind.zoneV2', op: 'range', value: { min: 4, max: 4 } },
    ]);
    fixture.detectChanges();
    const saveBtn = Array.from(els('.tool-btn')).find((b) =>
      b.textContent?.includes('Save slice'),
    ) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
    saveBtn.click();
    fixture.detectChanges();
    const nameInput = el('.save-slice-form .slice-name') as HTMLInputElement;
    nameInput.value = 'ZoneV2=4';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    Array.from(els('.save-slice-form .tool-btn'))
      .find((b) => b.textContent?.trim() === 'Save')!
      .click();
    expect(storeMock.saveSlice).toHaveBeenCalledWith('ZoneV2=4', undefined);
  });

  it('save slice is disabled with no active filters', () => {
    openWorkbench();
    const saveBtn = Array.from(els('.tool-btn')).find((b) =>
      b.textContent?.includes('Save slice'),
    ) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it('applying a slice forwards to store.applySlice', () => {
    openWorkbench();
    const slice = sliceFixture('Longs', [
      { column: 'direction', op: 'in', value: ['LONG'] },
    ]);
    storeMock.slices.set([slice]);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector(
      '.workbench-tools app-slice-menu .slice-btn',
    ) as HTMLButtonElement).click();
    fixture.detectChanges();
    (document.querySelector('.slice-item .slice-apply') as HTMLButtonElement).click();
    expect(storeMock.applySlice).toHaveBeenCalledWith(slice);
  });

  it('deleting a slice forwards its id to store.deleteSlice', () => {
    openWorkbench();
    storeMock.slices.set([sliceFixture('Longs', [])]);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector(
      '.workbench-tools app-slice-menu .slice-btn',
    ) as HTMLButtonElement).click();
    fixture.detectChanges();
    (document.querySelector('.slice-item .slice-delete') as HTMLButtonElement).click();
    expect(storeMock.deleteSlice).toHaveBeenCalledWith('s-Longs');
  });

  it('skipped slice columns render as a persistent notice', () => {
    openWorkbench();
    storeMock.skippedSliceColumns.set(['ind.zoneV2']);
    fixture.detectChanges();
    expect(el('.skip-note')?.textContent).toContain('ind.zoneV2');
  });

  it('compare picker lists ready datasets except the active one', () => {
    openWorkbench();
    // READY is active; GENERATING is not ready; LIVE_READY is the only option.
    expect(el('.compare-select')).not.toBeNull();
    expect(tools().compareOptions().map((d) => d.id)).toEqual([LIVE_READY.id]);
  });

  it('selecting a compare dataset forwards the doc to loadCompareDataset', () => {
    openWorkbench();
    tools().compareSelected.emit(LIVE_READY);
    expect(storeMock.loadCompareDataset).toHaveBeenCalledWith(LIVE_READY);
  });

  it('compare mode renders stats side-by-side and switches the histogram baseline', () => {
    openWorkbench();
    storeMock.compareDataset.set(LIVE_READY);
    fixture.detectChanges();
    // chip instead of the select
    expect(el('.compare-chip')?.textContent).toContain(LIVE_READY.id);
    expect(el('.compare-select')).toBeNull();
    // stats view → two blocks
    clickViewBtn('stats');
    expect(els('.compare-col').length).toBe(2);
    // histogram baseline resolves to filteredCompareRows labeled 'compare set'
    clickViewBtn('histogram');
    const hist = fixture.debugElement.query(
      By.directive(AnalysisHistogramComponent),
    ).componentInstance;
    expect(hist.baselineRows()).toBe(storeMock.filteredCompareRows());
    expect(hist.baselineLabel()).toBe('compare set');
    // clear → back to the single-set baseline
    storeMock.compareDataset.set(null);
    fixture.detectChanges();
    expect(hist.baselineRows()).toBe(storeMock.viewRows());
    expect(hist.baselineLabel()).toBe('full set');
  });

  it('the compare chip ✕ forwards to store.clearCompare', () => {
    openWorkbench();
    storeMock.compareDataset.set(LIVE_READY);
    fixture.detectChanges();
    (el('.compare-chip .chip-x') as HTMLButtonElement).click();
    expect(storeMock.clearCompare).toHaveBeenCalled();
  });

  it('skipped compare columns render their own notice', () => {
    openWorkbench();
    storeMock.compareDataset.set(LIVE_READY);
    storeMock.skippedCompareColumns.set(['ind.zoneV2']);
    fixture.detectChanges();
    const notes = els('.skip-note').map((n) => n.textContent);
    expect(notes.some((t) => t?.includes('compare skipped columns'))).toBe(true);
    expect(notes.some((t) => t?.includes('ind.zoneV2'))).toBe(true);
  });
});
