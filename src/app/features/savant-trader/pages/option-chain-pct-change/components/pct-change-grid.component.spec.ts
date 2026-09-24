// Mock @angular/fire modules — the store's config service transitively imports them.
jest.mock('@angular/fire/auth', () => ({
  Auth: class {},
  authState: jest.fn(),
}));
jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(),
}));
jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: jest.fn(),
  doc: jest.fn(),
  setDoc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  deleteDoc: jest.fn(),
}));

import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';

import { PctChangeGridComponent } from './pct-change-grid.component';
import { OptionChainPctChangeStore } from '../option-chain-pct-change.store';
import { OptionsContractService } from '../../../services/options-contract.service';
import { PctChangeConfigService } from '../services/pct-change-config.service';
import { SwingAnalysisService } from '../../../swing-analysis/swing-analysis.service';
import { SymbolHistoryStore } from '../../../stores/symbol-history.store';
import { LocalBarReadService } from '../../../../../core/services/local-bar-read.service';
import type { PctChangeGrid, PctChangeCell } from '../utils/pct-change.utils';
import { cellKey } from '../utils/pct-change.utils';

// =============================================================================
// Test fixtures
// =============================================================================

function makeCell(overrides: Partial<PctChangeCell> = {}): PctChangeCell {
  return {
    contractID: 'TEST',
    strike: 100,
    expiration: '2024-03-15',
    delta: 0.5,
    targetDelta: 0.6,
    startPrice: 10,
    targetPrice: 15,
    pctChange: 50,
    ...overrides,
  };
}

function makeGrid(overrides: Partial<PctChangeGrid> = {}): PctChangeGrid {
  const cells = new Map<string, PctChangeCell>();
  const cell = makeCell();
  cells.set(cellKey(cell.strike, cell.expiration), cell);
  return {
    targetDate: '2024-02-15',
    startDate: '2024-01-15',
    durationDays: 31,
    atmStrike: 100,
    startUnderlyingPrice: 100,
    targetUnderlyingPrice: 105,
    strikes: [100],
    expirations: ['2024-03-15'],
    cells,
    p5: -10,
    p95: 50,
    ...overrides,
  };
}

function setupComponent(grid: PctChangeGrid = makeGrid()): {
  fixture: import('@angular/core/testing').ComponentFixture<PctChangeGridComponent>;
  component: PctChangeGridComponent;
} {
  const fixture = TestBed.createComponent(PctChangeGridComponent);
  fixture.componentRef.setInput('grid', grid);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance };
}

// =============================================================================
// Tests
// =============================================================================

describe('PctChangeGridComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PctChangeGridComponent],
      providers: [
        // The grid injects the store for selection events; these leaf
        // services are never invoked by the popup wiring under test.
        { provide: OptionsContractService, useValue: {} },
        { provide: LocalBarReadService, useValue: {} },
        { provide: PctChangeConfigService, useValue: {} },
        { provide: SwingAnalysisService, useValue: { loadSavedAnalyses: () => of([]) } },
        { provide: SymbolHistoryStore, useValue: { signalHistoryCache: signal({}), loadSignalHistory: () => {} } },
      ],
    }).compileComponents();
  });

  it('renders the grid header with target date and duration', () => {
    const { fixture } = setupComponent(makeGrid({ targetDate: '2024-02-15', durationDays: 31 }));
    const headerEl = fixture.nativeElement.querySelector('.grid-header');
    expect(headerEl.textContent).toContain('2024-02-15');
    expect(headerEl.textContent).toContain('31d');
  });

  it('shows a "live fetch" chip only when source is live', () => {
    const { fixture } = setupComponent(makeGrid({ targetDate: '2024-02-15' }));
    expect(fixture.nativeElement.querySelector('[data-testid="src-live"]')).toBeNull();

    fixture.componentRef.setInput('source', 'gcs');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="src-live"]')).toBeNull();

    fixture.componentRef.setInput('source', 'live');
    fixture.detectChanges();
    const chip = fixture.nativeElement.querySelector('[data-testid="src-live"]');
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain('live fetch');
  });

  it('renders "No contracts" message when grid has no cells', () => {
    const { fixture } = setupComponent(makeGrid({ strikes: [], expirations: [], cells: new Map() }));
    const noDataEl = fixture.nativeElement.querySelector('.no-data');
    expect(noDataEl).not.toBeNull();
    expect(noDataEl.textContent).toContain('No contracts');
  });

  it('renders "No contracts" message when cells is empty but strikes exist', () => {
    const grid = makeGrid({ strikes: [100], expirations: ['2024-03-15'], cells: new Map() });
    const { fixture } = setupComponent(grid);
    const noDataEl = fixture.nativeElement.querySelector('.no-data');
    expect(noDataEl).not.toBeNull();
  });

  it('renders expiration column headers', () => {
    const grid = makeGrid({ expirations: ['2024-03-15', '2024-04-19'] });
    const { fixture } = setupComponent(grid);
    const headers = fixture.nativeElement.querySelectorAll('.header-cell');
    // First header is the corner, then one per expiration.
    expect(headers.length).toBe(3);
    expect(headers[1].textContent).toContain('2024-03-15');
    expect(headers[2].textContent).toContain('2024-04-19');
  });

  it('shows the day of week after the date in expiration headers', () => {
    const grid = makeGrid({ expirations: ['2024-03-15', '2024-04-19'] });
    const { fixture } = setupComponent(grid);
    const expDates = fixture.nativeElement.querySelectorAll('.exp-date');
    // 2024-03-15 is a Friday; 2024-04-19 is also a Friday.
    expect(expDates[0].textContent).toContain('2024-03-15');
    expect(expDates[0].textContent).toContain('Fri');
    expect(expDates[1].textContent).toContain('2024-04-19');
    expect(expDates[1].textContent).toContain('Fri');
  });

  it('renders strike row headers', () => {
    const grid = makeGrid({ strikes: [100, 110] });
    const { fixture } = setupComponent(grid);
    const rowHeaders = fixture.nativeElement.querySelectorAll('.row-header');
    expect(rowHeaders.length).toBe(2);
    expect(rowHeaders[0].textContent).toContain('100');
    expect(rowHeaders[1].textContent).toContain('110');
  });

  it('renders data cells with percentage change and prices', () => {
    const { fixture } = setupComponent();
    const dataCells = fixture.nativeElement.querySelectorAll('.data-cell');
    expect(dataCells.length).toBe(1);
    expect(dataCells[0].textContent).toContain('+50.0%');
    expect(dataCells[0].textContent).toContain('$10.00');
    expect(dataCells[0].textContent).toContain('$15.00');
  });

  it('applies the deep-ramp background color in adaptive/halo modes', () => {
    const { fixture } = setupComponent();
    fixture.componentRef.setInput('contrastMode', 'adaptive');
    fixture.detectChanges();
    const dataCell = fixture.nativeElement.querySelector('.data-cell') as HTMLElement;
    // pctChange=50, p5=-10, p95=50 → intensity=1 → full GREEN (0, 140, 60)
    expect(dataCell.style.backgroundColor).toBe('rgb(0, 140, 60)');
  });

  it('adaptive mode: dark cells get white text', () => {
    const { fixture } = setupComponent();
    fixture.componentRef.setInput('contrastMode', 'adaptive');
    fixture.detectChanges();
    const dataCell = fixture.nativeElement.querySelector('.data-cell') as HTMLElement;
    // intensity=1 → deep green background → white text.
    expect(dataCell.style.color).toBe('rgb(255, 255, 255)');
  });

  it('bright mode (default): brighter background, default dark text', () => {
    const { fixture } = setupComponent();
    const dataCell = fixture.nativeElement.querySelector('.data-cell') as HTMLElement;
    expect(dataCell.style.backgroundColor).toBe('rgb(0, 200, 80)');
    expect(dataCell.style.color).toBe('inherit');
  });

  it('halo mode: deep background, dark text with a light halo', () => {
    const { fixture } = setupComponent();
    fixture.componentRef.setInput('contrastMode', 'halo');
    fixture.detectChanges();
    const dataCell = fixture.nativeElement.querySelector('.data-cell') as HTMLElement;
    expect(dataCell.style.backgroundColor).toBe('rgb(0, 140, 60)');
    expect(dataCell.style.textShadow).toContain('rgba(255,255,255');
  });

  it('marks the top 5 gainers in each column', () => {
    // 8 strikes × 2 expirations = 16 cells. pctChange increases per strike,
    // so in each column the 5 highest strikes should be marked.
    const strikes = [90, 95, 100, 105, 110, 115, 120, 125];
    const expirations = ['2024-03-15', '2024-04-19'];
    const cells = new Map<string, PctChangeCell>();
    strikes.forEach((s, i) => {
      for (const e of expirations) {
        const cell = makeCell({ strike: s, expiration: e, pctChange: i + 1 });
        cells.set(cellKey(s, e), cell);
      }
    });
    const grid = makeGrid({ strikes, expirations, cells, p5: 0, p95: 8 });
    const { fixture } = setupComponent(grid);
    const marked = fixture.nativeElement.querySelectorAll('.data-cell.top-gainer');
    // 5 per column × 2 columns.
    expect(marked.length).toBe(10);
    // Lowest-gainer cells (pct 1) must not be marked in either column.
    for (const e of expirations) {
      const lowest = fixture.nativeElement.querySelector(
        `[data-cell-key="${cellKey(90, e)}"]`,
      ) as HTMLElement;
      expect(lowest.classList.contains('top-gainer')).toBe(false);
      const highest = fixture.nativeElement.querySelector(
        `[data-cell-key="${cellKey(125, e)}"]`,
      ) as HTMLElement;
      expect(highest.classList.contains('top-gainer')).toBe(true);
    }
  });

  it('excludes penny-priced cells (< $0.02) from top-5 marking', () => {
    // 6 cells, one with a $0.01 start price and the biggest pctChange —
    // it must NOT get the top-gainer ring.
    const strikes = [90, 95, 100, 105, 110, 115];
    const expirations = ['2024-03-15'];
    const cells = new Map<string, PctChangeCell>();
    strikes.forEach((s, i) => {
      cells.set(cellKey(s, '2024-03-15'), makeCell({ strike: s, pctChange: i + 1 }));
    });
    cells.set(
      cellKey(125, '2024-03-15'),
      makeCell({ strike: 125, pctChange: 9999, startPrice: 0.01, targetPrice: 3 }),
    );
    const grid = makeGrid({
      strikes: [...strikes, 125],
      expirations,
      cells,
      p5: 0,
      p95: 10,
    });
    const { fixture } = setupComponent(grid);
    const marked = fixture.nativeElement.querySelectorAll('.data-cell.top-gainer');
    expect(marked.length).toBe(5); // the 5 non-penny gainers
    const penny = fixture.nativeElement.querySelector(
      `[data-cell-key="${cellKey(125, '2024-03-15')}"]`,
    ) as HTMLElement;
    expect(penny.classList.contains('top-gainer')).toBe(false);
  });

  it('excludes cells with a penny TARGET price from top-5 too', () => {
    const strikes = [90, 95, 100, 105, 110, 115];
    const cells = new Map<string, PctChangeCell>();
    strikes.forEach((s, i) => {
      cells.set(cellKey(s, '2024-03-15'), makeCell({ strike: s, pctChange: i + 1 }));
    });
    // Normal start, penny target — still degenerate, excluded.
    cells.set(
      cellKey(125, '2024-03-15'),
      makeCell({ strike: 125, pctChange: 9999, startPrice: 1, targetPrice: 0.01 }),
    );
    const grid = makeGrid({
      strikes: [...strikes, 125],
      expirations: ['2024-03-15'],
      cells,
      p5: 0,
      p95: 10,
    });
    const { fixture } = setupComponent(grid);
    expect(fixture.nativeElement.querySelectorAll('.data-cell.top-gainer').length).toBe(5);
    const penny = fixture.nativeElement.querySelector(
      `[data-cell-key="${cellKey(125, '2024-03-15')}"]`,
    ) as HTMLElement;
    expect(penny.classList.contains('top-gainer')).toBe(false);
  });

  it('suppresses cell tooltips while a contract chart is active', () => {
    const { fixture } = setupComponent();
    const store = TestBed.inject(OptionChainPctChangeStore);
    const cellEl = fixture.nativeElement.querySelector('.data-cell') as HTMLElement;
    expect(cellEl.getAttribute('title')).toBeTruthy();

    const cell = makeCell();
    store.previewContract(cell, '2024-02-15', undefined);
    fixture.detectChanges();
    expect(cellEl.getAttribute('title')).toBeNull();

    // Restored once the chart selection clears.
    store.clearContractSelection();
    fixture.detectChanges();
    expect(cellEl.getAttribute('title')).toBeTruthy();
  });

  it('outlines the linked contract cell when linkedKey is set', () => {
    const { fixture } = setupComponent();
    const key = cellKey(100, '2024-03-15');
    fixture.componentRef.setInput('linkedKey', key);
    fixture.detectChanges();
    const dataCell = fixture.nativeElement.querySelector(
      `[data-cell-key="${key}"]`,
    ) as HTMLElement;
    expect(dataCell.classList.contains('linked-cell')).toBe(true);
  });

  it('clicking a cell body sets the cross-grid highlight', () => {
    const { fixture } = setupComponent();
    const store = TestBed.inject(OptionChainPctChangeStore);
    const cellEl = fixture.nativeElement.querySelector('.data-cell') as HTMLElement;
    cellEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(store.highlightedContract()).toEqual({ strike: 100, expiration: '2024-03-15' });
  });

  it('clicking the chart icon also sets the cross-grid highlight', () => {
    const { fixture } = setupComponent();
    const store = TestBed.inject(OptionChainPctChangeStore);
    const cellEl = fixture.nativeElement.querySelector('.data-cell') as HTMLElement;
    cellEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    fixture.detectChanges();
    const icon = fixture.nativeElement.querySelector('.chart-icon-btn') as HTMLElement;
    icon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(store.highlightedContract()).toEqual({ strike: 100, expiration: '2024-03-15' });
  });

  it('renders empty cell when no contract at strike/expiration', () => {
    const grid = makeGrid({
      strikes: [100, 110],
      expirations: ['2024-03-15'],
    });
    // Only strike 100 has a cell; strike 110 should be empty.
    const { fixture } = setupComponent(grid);
    const emptyCells = fixture.nativeElement.querySelectorAll('.empty-cell');
    expect(emptyCells.length).toBe(1);
  });

  it('builds tooltip with contract details', () => {
    const { component } = setupComponent();
    const cell = makeCell();
    const tooltip = component.cellTooltip(cell);
    expect(tooltip).toContain('TEST');
    expect(tooltip).toContain('100');
    expect(tooltip).toContain('2024-03-15');
    expect(tooltip).toContain('0.500');
    expect(tooltip).toContain('$10.00');
    expect(tooltip).toContain('$15.00');
    expect(tooltip).toContain('+50.0%');
  });

  it('shows N/A delta in tooltip when delta is null', () => {
    const { component } = setupComponent();
    const cell = makeCell({ delta: null });
    const tooltip = component.cellTooltip(cell);
    expect(tooltip).toContain('N/A');
  });

  it('precomputes rows with cells ordered by expiration', () => {
    const cell1 = makeCell({ strike: 100, expiration: '2024-03-15' });
    const cell2 = makeCell({ strike: 100, expiration: '2024-04-19', contractID: 'B' });
    const cells = new Map<string, PctChangeCell>();
    cells.set(cellKey(cell1.strike, cell1.expiration), cell1);
    cells.set(cellKey(cell2.strike, cell2.expiration), cell2);
    const grid = makeGrid({
      strikes: [100],
      expirations: ['2024-03-15', '2024-04-19'],
      cells,
    });
    const { component } = setupComponent(grid);
    const rows = component.rows();
    expect(rows.length).toBe(1);
    expect(rows[0].strike).toBe(100);
    expect(rows[0].cells.length).toBe(2);
    expect(rows[0].cells[0]?.contractID).toBe('TEST');
    expect(rows[0].cells[1]?.contractID).toBe('B');
  });

  it('renders negative percentage without + sign', () => {
    const cell = makeCell({ pctChange: -25 });
    const cells = new Map<string, PctChangeCell>();
    cells.set(cellKey(cell.strike, cell.expiration), cell);
    const grid = makeGrid({ cells, p5: -50, p95: 50 });
    const { fixture } = setupComponent(grid);
    const pctEl = fixture.nativeElement.querySelector('.pct-change');
    expect(pctEl.textContent).toContain('-25.0%');
    expect(pctEl.textContent).not.toContain('+');
  });

  it('renders zero percentage without sign', () => {
    const cell = makeCell({ pctChange: 0 });
    const cells = new Map<string, PctChangeCell>();
    cells.set(cellKey(cell.strike, cell.expiration), cell);
    const grid = makeGrid({ cells, p5: -50, p95: 50 });
    const { fixture } = setupComponent(grid);
    const pctEl = fixture.nativeElement.querySelector('.pct-change');
    expect(pctEl.textContent).toContain('0.0%');
    expect(pctEl.textContent).not.toContain('+');
  });

  // ===========================================================================
  // Chart popup — icon, selection wiring, overlay
  // ===========================================================================

  describe('chart popup', () => {
    let store: InstanceType<typeof OptionChainPctChangeStore>;

    const iconOf = (f: import('@angular/core/testing').ComponentFixture<PctChangeGridComponent>) =>
      f.nativeElement.querySelector('.chart-icon-btn') as HTMLElement;
    const dataCellAt = (f: import('@angular/core/testing').ComponentFixture<PctChangeGridComponent>, i = 0) =>
      f.nativeElement.querySelectorAll('.data-cell')[i] as HTMLElement;
    const overlayChart = () =>
      document.querySelector('.cdk-overlay-pane app-contract-mini-chart');

    // The icon renders only inside the hovered cell; delegated listeners on
    // the grid body use bubbling mouseover/mouseout (not mouseenter/leave).
    const over = (el: HTMLElement, relatedTarget?: EventTarget | null) =>
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: relatedTarget ?? null }));
    const out = (el: HTMLElement, relatedTarget?: EventTarget | null) =>
      el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: relatedTarget ?? null }));
    const click = (el: HTMLElement) =>
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    /** Hover a cell to render its icon, then hover the icon (preview). */
    const hoverIcon = (
      f: import('@angular/core/testing').ComponentFixture<PctChangeGridComponent>,
      cellIndex = 0,
    ): HTMLElement => {
      over(dataCellAt(f, cellIndex));
      f.detectChanges();
      const icon = iconOf(f);
      over(icon);
      return icon;
    };

    beforeEach(() => {
      store = TestBed.inject(OptionChainPctChangeStore);
    });

    afterEach(() => {
      store.clearContractSelection();
      document.querySelectorAll('.cdk-overlay-pane, .cdk-overlay-container').forEach((el) => el.remove());
    });

    it('renders no chart icons before any cell is hovered', () => {
      const { fixture } = setupComponent();
      expect(fixture.nativeElement.querySelectorAll('.chart-icon-btn').length).toBe(0);
    });

    it('reveals the chart icon on hover for populated cells but not empty cells', () => {
      const cells = new Map<string, PctChangeCell>();
      cells.set(cellKey(100, '2024-03-15'), makeCell());
      const grid = makeGrid({
        strikes: [100, 110],
        expirations: ['2024-03-15', '2024-04-19'],
        cells,
      });
      const { fixture } = setupComponent(grid);
      const dataCell = fixture.nativeElement.querySelector('.data-cell') as HTMLElement;
      const emptyCell = fixture.nativeElement.querySelector('.empty-cell') as HTMLElement;

      over(dataCell);
      fixture.detectChanges();
      expect(dataCell.querySelector('.chart-icon-btn')).toBeTruthy();

      // Leaving to an empty cell hides the icon; empty cells never get one.
      out(dataCell, emptyCell);
      over(emptyCell);
      fixture.detectChanges();
      expect(emptyCell.querySelector('.chart-icon-btn')).toBeNull();
      expect(fixture.nativeElement.querySelectorAll('.chart-icon-btn').length).toBe(0);
    });

    it('clears a showing icon when the grid model rebuilds', () => {
      const grid = makeGrid({ strikes: [100], expirations: ['2024-03-15'] });
      const { fixture } = setupComponent(grid);
      const dataCell = dataCellAt(fixture);
      over(dataCell);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('.chart-icon-btn').length).toBe(1);

      fixture.componentRef.setInput(
        'grid',
        makeGrid({ strikes: [200], expirations: ['2024-03-15'] }),
      );
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('.chart-icon-btn').length).toBe(0);
    });

    it('nests the icon inside the data cell (no extra grid element)', () => {
      const { fixture } = setupComponent();
      const dataCell = dataCellAt(fixture);
      over(dataCell);
      fixture.detectChanges();
      // Icon is a child of the cell, absolutely positioned via CSS — it
      // does not add a row/column element that would shift the layout.
      expect(dataCell.contains(iconOf(fixture))).toBe(true);
      expect(iconOf(fixture).parentElement).toBe(dataCell);
    });

    it('hovering the icon selects the contract for this grid', () => {
      const { fixture } = setupComponent();
      hoverIcon(fixture);
      expect(store.selectedCell()).toEqual({
        contractID: 'TEST',
        strike: 100,
        expiration: '2024-03-15',
        targetDate: '2024-02-15',
      });
      expect(store.isContractPinned()).toBe(false);
    });

    it('does not select a contract on plain cell hover — only the icon opens the preview', () => {
      const { fixture } = setupComponent();
      over(dataCellAt(fixture));
      fixture.detectChanges();
      expect(store.selectedCell()).toBeNull();
    });

    it('leaving the icon clears the selection after the grace delay when not pinned', fakeAsync(() => {
      const { fixture } = setupComponent();
      const icon = hoverIcon(fixture);
      expect(store.selectedCell()).not.toBeNull();
      out(icon, fixture.nativeElement);
      expect(store.selectedCell()).not.toBeNull(); // still within grace window
      tick(250);
      expect(store.selectedCell()).toBeNull();
    }));

    it('leaving the icon into the overlay keeps the preview', () => {
      const { fixture } = setupComponent();
      const icon = hoverIcon(fixture);
      fixture.detectChanges();
      const pane = document.querySelector('.contract-chart-pane') as HTMLElement;
      expect(pane).toBeTruthy();
      out(icon, pane);
      expect(store.selectedCell()).not.toBeNull();
    });

    it('entering the pane within the grace delay cancels the pending clear', fakeAsync(() => {
      const { fixture } = setupComponent();
      const icon = hoverIcon(fixture);
      fixture.detectChanges();
      const chart = overlayChart() as HTMLElement;
      // Pointer crosses the gap to a non-pane element first (grace starts)…
      out(icon, fixture.nativeElement);
      tick(50);
      // …then enters the chart before the delay expires → preview kept.
      chart.dispatchEvent(new MouseEvent('mouseenter'));
      tick(250);
      expect(store.selectedCell()).not.toBeNull();
    }));

    it('sweeping from one icon to another does not wipe the new selection', fakeAsync(() => {
      const cells = new Map<string, PctChangeCell>();
      cells.set(cellKey(100, '2024-03-15'), makeCell());
      cells.set(cellKey(110, '2024-03-15'), makeCell({ contractID: 'OTHER', strike: 110 }));
      const grid = makeGrid({ strikes: [100, 110], cells });
      const { fixture } = setupComponent(grid);

      const iconA = hoverIcon(fixture, 0);
      expect(store.selectedCell()!.contractID).toBe('TEST');

      // Pointer leaves A's icon toward cell B, hovers B, enters B's icon.
      out(iconA, dataCellAt(fixture, 1));
      over(dataCellAt(fixture, 1));
      fixture.detectChanges();
      over(iconOf(fixture));
      tick(250); // A's pending clear must not wipe B's preview.
      expect(store.selectedCell()!.contractID).toBe('OTHER');
    }));

    it('leaving the icon does not clear a pinned selection', () => {
      const { fixture } = setupComponent();
      const icon = hoverIcon(fixture);
      click(icon);
      expect(store.isContractPinned()).toBe(true);
      out(icon, fixture.nativeElement);
      expect(store.selectedCell()).not.toBeNull();
      expect(store.isContractPinned()).toBe(true);
    });

    it('clicking the icon pins the selection', () => {
      const { fixture } = setupComponent();
      const icon = hoverIcon(fixture);
      click(icon);
      expect(store.selectedCell()!.contractID).toBe('TEST');
      expect(store.isContractPinned()).toBe(true);
    });

    it('shows the mini chart overlay only for the selected cell', () => {
      const { fixture } = setupComponent();
      expect(overlayChart()).toBeNull();
      hoverIcon(fixture);
      fixture.detectChanges();
      expect(overlayChart()).toBeTruthy();
    });

    it('does not show the overlay when the selection targets a different grid', () => {
      const { fixture } = setupComponent();
      // Anchor the shared overlay via a real icon hover (this grid's date),
      // then replace the selection with a foreign targetDate — the pane
      // must close because sel.targetDate no longer matches this grid.
      hoverIcon(fixture);
      fixture.detectChanges();
      expect(overlayChart()).toBeTruthy();
      store.previewContract(makeCell(), '2024-03-15');
      fixture.detectChanges();
      expect(overlayChart()).toBeNull();
    });

    it('renders at most one icon and one overlay regardless of cell count', () => {
      const cells = new Map<string, PctChangeCell>();
      cells.set(cellKey(100, '2024-03-15'), makeCell());
      cells.set(cellKey(110, '2024-03-15'), makeCell({ contractID: 'B', strike: 110 }));
      cells.set(cellKey(100, '2024-04-19'), makeCell({ contractID: 'C', expiration: '2024-04-19' }));
      cells.set(cellKey(110, '2024-04-19'), makeCell({ contractID: 'D', strike: 110, expiration: '2024-04-19' }));
      const grid = makeGrid({
        strikes: [100, 110],
        expirations: ['2024-03-15', '2024-04-19'],
        cells,
      });
      const { fixture } = setupComponent(grid);
      // No per-cell icons or overlay origins are instantiated up front.
      expect(fixture.nativeElement.querySelectorAll('.chart-icon-btn').length).toBe(0);

      const iconA = hoverIcon(fixture, 0);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('.chart-icon-btn').length).toBe(1);
      expect(document.querySelectorAll('.contract-chart-pane').length).toBe(1);

      // Moving to another cell relocates the single icon — still one pane.
      out(iconA, dataCellAt(fixture, 1));
      hoverIcon(fixture, 1);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('.chart-icon-btn').length).toBe(1);
      expect(document.querySelectorAll('.contract-chart-pane').length).toBe(1);
    });

    it('leaving the overlay clears a non-pinned selection after the grace delay', fakeAsync(() => {
      const { fixture } = setupComponent();
      hoverIcon(fixture);
      fixture.detectChanges();
      const chart = overlayChart() as HTMLElement;
      expect(chart).toBeTruthy();
      chart.dispatchEvent(new MouseEvent('mouseleave'));
      expect(store.selectedCell()).not.toBeNull(); // grace window
      tick(250);
      expect(store.selectedCell()).toBeNull();
    }));

    it('leaving the overlay keeps a pinned selection', () => {
      const { fixture } = setupComponent();
      const icon = hoverIcon(fixture);
      click(icon);
      fixture.detectChanges();
      const chart = overlayChart() as HTMLElement;
      expect(chart).toBeTruthy();
      chart.dispatchEvent(new MouseEvent('mouseleave'));
      expect(store.selectedCell()).not.toBeNull();
      expect(store.isContractPinned()).toBe(true);
    });

    it('hovering another icon while pinned does not change the selection', () => {
      const cells = new Map<string, PctChangeCell>();
      cells.set(cellKey(100, '2024-03-15'), makeCell());
      cells.set(cellKey(110, '2024-03-15'), makeCell({ contractID: 'OTHER', strike: 110 }));
      const grid = makeGrid({ strikes: [100, 110], cells });
      const { fixture } = setupComponent(grid);

      const iconA = hoverIcon(fixture, 0);
      click(iconA);
      expect(store.isContractPinned()).toBe(true);

      // Hovering cell B renders its icon, but the preview stays pinned to A.
      over(dataCellAt(fixture, 1));
      fixture.detectChanges();
      over(iconOf(fixture));
      expect(store.selectedCell()!.contractID).toBe('TEST');
    });
  });
});
