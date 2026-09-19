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

import { PctChangeGridComponent } from './pct-change-grid.component';
import { OptionChainPctChangeStore } from '../option-chain-pct-change.store';
import { OptionsContractService } from '../../../services/options-contract.service';
import { PctChangeConfigService } from '../services/pct-change-config.service';
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
      ],
    }).compileComponents();
  });

  it('renders the grid header with target date and duration', () => {
    const { fixture } = setupComponent(makeGrid({ targetDate: '2024-02-15', durationDays: 31 }));
    const headerEl = fixture.nativeElement.querySelector('.grid-header');
    expect(headerEl.textContent).toContain('2024-02-15');
    expect(headerEl.textContent).toContain('31d');
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

  it('applies background color from pctChangeToColor', () => {
    const { fixture } = setupComponent();
    const dataCell = fixture.nativeElement.querySelector('.data-cell') as HTMLElement;
    // pctChange=50, p5=-10, p95=50 → intensity=1 → full GREEN (0, 140, 60)
    expect(dataCell.style.backgroundColor).toBe('rgb(0, 140, 60)');
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
    const overlayChart = () =>
      document.querySelector('.cdk-overlay-pane app-contract-mini-chart');

    beforeEach(() => {
      store = TestBed.inject(OptionChainPctChangeStore);
    });

    afterEach(() => {
      store.clearContractSelection();
      document.querySelectorAll('.cdk-overlay-pane, .cdk-overlay-container').forEach((el) => el.remove());
    });

    it('renders a chart icon on populated cells but not on empty cells', () => {
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
      expect(dataCell.querySelector('.chart-icon-btn')).toBeTruthy();
      expect(emptyCell.querySelector('.chart-icon-btn')).toBeNull();
    });

    it('nests the icon inside the data cell (no extra grid element)', () => {
      const { fixture } = setupComponent();
      const dataCell = fixture.nativeElement.querySelector('.data-cell') as HTMLElement;
      // Icon is a child of the cell, absolutely positioned via CSS — it
      // does not add a row/column element that would shift the layout.
      expect(dataCell.contains(iconOf(fixture))).toBe(true);
      expect(iconOf(fixture).parentElement).toBe(dataCell);
    });

    it('hovering the icon selects the contract for this grid', () => {
      const { fixture } = setupComponent();
      iconOf(fixture).dispatchEvent(new MouseEvent('mouseenter'));
      expect(store.selectedCell()).toEqual({
        contractID: 'TEST',
        strike: 100,
        expiration: '2024-03-15',
        targetDate: '2024-02-15',
      });
      expect(store.isContractPinned()).toBe(false);
    });

    it('leaving the icon clears the selection after the grace delay when not pinned', fakeAsync(() => {
      const { fixture } = setupComponent();
      const icon = iconOf(fixture);
      icon.dispatchEvent(new MouseEvent('mouseenter'));
      expect(store.selectedCell()).not.toBeNull();
      icon.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: fixture.nativeElement }));
      expect(store.selectedCell()).not.toBeNull(); // still within grace window
      tick(250);
      expect(store.selectedCell()).toBeNull();
    }));

    it('leaving the icon into the overlay keeps the preview', () => {
      const { fixture } = setupComponent();
      const icon = iconOf(fixture);
      icon.dispatchEvent(new MouseEvent('mouseenter'));
      fixture.detectChanges();
      const pane = document.querySelector('.contract-chart-pane') as HTMLElement;
      expect(pane).toBeTruthy();
      icon.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: pane }));
      expect(store.selectedCell()).not.toBeNull();
    });

    it('entering the pane within the grace delay cancels the pending clear', fakeAsync(() => {
      const { fixture } = setupComponent();
      const icon = iconOf(fixture);
      icon.dispatchEvent(new MouseEvent('mouseenter'));
      fixture.detectChanges();
      const chart = overlayChart() as HTMLElement;
      // Pointer crosses the gap to a non-pane element first (grace starts)…
      icon.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: fixture.nativeElement }));
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
      const icons = fixture.nativeElement.querySelectorAll('.chart-icon-btn') as NodeListOf<HTMLElement>;
      icons[0].dispatchEvent(new MouseEvent('mouseenter'));
      icons[0].dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: icons[1] }));
      icons[1].dispatchEvent(new MouseEvent('mouseenter'));
      tick(250); // A's pending clear must not wipe B's preview.
      expect(store.selectedCell()!.contractID).toBe('OTHER');
    }));

    it('leaving the icon does not clear a pinned selection', () => {
      const { fixture } = setupComponent();
      const icon = iconOf(fixture);
      icon.dispatchEvent(new MouseEvent('click'));
      expect(store.isContractPinned()).toBe(true);
      icon.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: fixture.nativeElement }));
      expect(store.selectedCell()).not.toBeNull();
      expect(store.isContractPinned()).toBe(true);
    });

    it('clicking the icon pins the selection', () => {
      const { fixture } = setupComponent();
      iconOf(fixture).dispatchEvent(new MouseEvent('click'));
      expect(store.selectedCell()!.contractID).toBe('TEST');
      expect(store.isContractPinned()).toBe(true);
    });

    it('shows the mini chart overlay only for the selected cell', () => {
      const { fixture } = setupComponent();
      expect(overlayChart()).toBeNull();
      iconOf(fixture).dispatchEvent(new MouseEvent('mouseenter'));
      fixture.detectChanges();
      expect(overlayChart()).toBeTruthy();
    });

    it('does not show the overlay when the selection targets a different grid', () => {
      const { fixture } = setupComponent();
      // Anchor the shared overlay via a real icon hover (this grid's date),
      // then replace the selection with a foreign targetDate — the pane
      // must close because sel.targetDate no longer matches this grid.
      iconOf(fixture).dispatchEvent(new MouseEvent('mouseenter'));
      fixture.detectChanges();
      expect(overlayChart()).toBeTruthy();
      store.previewContract(makeCell(), '2024-03-15');
      fixture.detectChanges();
      expect(overlayChart()).toBeNull();
    });

    it('uses a single shared overlay — at most one pane exists regardless of cell count', () => {
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
      const icons = fixture.nativeElement.querySelectorAll('.chart-icon-btn') as NodeListOf<HTMLElement>;
      expect(icons.length).toBe(4);
      icons[0].dispatchEvent(new MouseEvent('mouseenter'));
      fixture.detectChanges();
      // One overlay per grid — re-anchored, never multiplied per cell.
      expect(document.querySelectorAll('.contract-chart-pane').length).toBe(1);
      icons[1].dispatchEvent(new MouseEvent('mouseenter'));
      fixture.detectChanges();
      expect(document.querySelectorAll('.contract-chart-pane').length).toBe(1);
    });

    it('leaving the overlay clears a non-pinned selection after the grace delay', fakeAsync(() => {
      const { fixture } = setupComponent();
      iconOf(fixture).dispatchEvent(new MouseEvent('mouseenter'));
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
      iconOf(fixture).dispatchEvent(new MouseEvent('click'));
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
      const icons = fixture.nativeElement.querySelectorAll('.chart-icon-btn') as NodeListOf<HTMLElement>;
      icons[0].dispatchEvent(new MouseEvent('click'));
      icons[1].dispatchEvent(new MouseEvent('mouseenter'));
      expect(store.selectedCell()!.contractID).toBe('TEST');
    });
  });
});
