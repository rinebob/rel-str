import { TestBed } from '@angular/core/testing';

import { PctChangeGridComponent } from './pct-change-grid.component';
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
});
