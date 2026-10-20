/**
 * AnalysisTableComponent (task #1083) — manifest-driven grid: columns by
 * kind, #1067 sort chain, per-kind SliceFilter controls, chips + count +
 * reset, open-row quarantine markers.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { MatMenuTrigger } from '@angular/material/menu';

import { AnalysisTableComponent } from './analysis-table.component';
import { PaperTradeStatus } from '@paper-trading/contracts';
import { TradeSide } from '@common';
import { AnalysisCohort, type TradeAnalysisRow } from '@paper-trading/analysis';
import type { SliceFilter } from '@paper-trading/analysis';

function row(over: Partial<TradeAnalysisRow> = {}): TradeAnalysisRow {
  return {
    datasetId: 'ds-1',
    tradeId: 'tr-x',
    signalId: 'sig-x',
    signalType: 'D_ST_TREND_RIDER_V1_LONG',
    cohortId: null,
    positionGroupId: null,
    symbol: 'AMAT',
    direction: TradeSide.LONG,
    expression: 'EQ',
    captureList: 'watch',
    sector: 'Tech',
    industry: 'Semis',
    capTier: 'large',
    source: 'replay',
    analysisCohort: AnalysisCohort.SIGNAL_EQUITY,
    status: PaperTradeStatus.CLOSED,
    signalStatus: 'CONFIRMED',
    signalBarDate: '2024-10-01',
    entryDate: '2024-10-01',
    entryPrice: 100,
    exitDate: '2024-10-10',
    exitPrice: 106.51,
    qty: 10,
    daysHeld: 9,
    exitReason: 'trailing',
    tradeRetPct: 6.51,
    symbolMovePct: 6.4,
    realizedPnl: 65.1,
    capitalRequired: 1000,
    mfePct: 9.2,
    maePct: -1.8,
    mfeDate: '2024-10-08',
    maeDate: '2024-10-02',
    daysToMfe: 7,
    givebackRatio: 0.29,
    excursionSource: 'replay',
    'ind.delta': 1,
    'ind.windowV2': 8,
    'ind.zoneV1': 3,
    'ind.zoneV1Prev': 2,
    'ind.zoneV2': 4,
    'ind.zoneV2Prev': 4,
    'strength.diPlus': 25,
    'strength.diMinus': 18,
    'strength.diHist': 7,
    'strength.adx': 30,
    ...over,
  } as TradeAnalysisRow;
}

const PRESENT = [
  'tradeId', 'symbol', 'signalType', 'direction', 'entryDate',
  'exitDate', 'tradeRetPct', 'realizedPnl', 'status', 'analysisCohort',
  'ind.zoneV2', 'datasetId',
];

const ROWS = [
  row({ tradeId: 'tr-1', tradeRetPct: -4.91 }),
  row({ tradeId: 'tr-2', tradeRetPct: 6.51, symbol: 'NVDA' }),
  row({ tradeId: 'tr-3', status: PaperTradeStatus.OPEN, exitDate: null, exitPrice: null }),
];

describe('AnalysisTableComponent', () => {
  let fixture: ComponentFixture<AnalysisTableComponent>;
  let component: AnalysisTableComponent;

  const el = (sel: string) =>
    fixture.nativeElement.querySelector(sel) as HTMLElement | null;
  const els = (sel: string) =>
    Array.from(fixture.nativeElement.querySelectorAll(sel)) as HTMLElement[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalysisTableComponent, NoopAnimationsModule],
    }).compileComponents();
    fixture = TestBed.createComponent(AnalysisTableComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('rows', ROWS);
    fixture.componentRef.setInput('universeRows', ROWS);
    fixture.componentRef.setInput('columns', PRESENT);
    fixture.componentRef.setInput('sorts', []);
    fixture.componentRef.setInput('filters', []);
    fixture.detectChanges();
  });

  // ── AC1: every manifest column renders / sorts / filters per kind ────

  const headerLabels = () =>
    els('thead tr:first-child th').map((th) =>
      th.childNodes[0]?.textContent?.trim(),
    );

  it('renders a header per default-visible present column, honoring manifest order', () => {
    const labels = headerLabels();
    expect(labels).toContain('Trade');
    expect(labels).toContain('Signal Type');
    expect(labels).toContain('Zone V2');
    expect(labels).not.toContain('Dataset'); // defaultVisible: false
  });

  it('column picker unhides a default-invisible column', () => {
    component['toggleHidden']('datasetId');
    fixture.detectChanges();
    expect(headerLabels()).toContain('Dataset');
  });

  it('cells render by kind — numbers tabular + formatted, nulls as dash, status as chip', () => {
    const first = els('tbody tr')[0];
    expect(first.querySelector('.mono')?.textContent?.trim()).toBe('-4.91');
    const statusCell = first.querySelector('.status-chip');
    expect(statusCell?.textContent?.trim()).toBe('CLOSED');
    const openRow = els('tbody tr')[2];
    expect(openRow.querySelector('.status-chip')?.textContent?.trim()).toBe('OPEN');
    expect(openRow.classList.contains('provisional')).toBe(true);
  });

  it('sort header click emits the column; shift emits additive', () => {
    const emitted: { column: string; additive: boolean }[] = [];
    component.sortToggled.subscribe((e) => emitted.push(e));
    const th = els('thead tr:first-child th')[0];
    th.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    th.dispatchEvent(
      new MouseEvent('click', { bubbles: true, shiftKey: true }),
    );
    th.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(emitted).toEqual([
      { column: 'tradeId', additive: false },
      { column: 'tradeId', additive: true },
      { column: 'tradeId', additive: false },
    ]);
  });

  it('aria-sort + icon + rank reflect the sorts input', () => {
    fixture.componentRef.setInput('sorts', [
      { column: 'symbol', dir: 'desc' },
      { column: 'tradeId', dir: 'asc' },
    ]);
    fixture.detectChanges();
    const ths = els('thead tr:first-child th');
    const symTh = ths.find((t) => t.textContent?.includes('Symbol'))!;
    const idTh = ths.find((t) => t.textContent?.includes('Trade'))!;
    expect(symTh.getAttribute('aria-sort')).toBe('descending');
    expect(idTh.getAttribute('aria-sort')).toBe('ascending');
    expect(symTh.querySelector('.sort-rank')?.textContent?.trim()).toBe('1');
    expect(idTh.querySelector('.sort-rank')?.textContent?.trim()).toBe('2');
  });

  it('filterable headers carry a lazy filter trigger; the popup renders per-kind controls on open', () => {
    const btns = els('.col-filter-btn');
    // filterable cols among PRESENT: tradeId, symbol, signalType, direction,
    // entryDate, exitDate, tradeRetPct, realizedPnl, status, analysisCohort, ind.zoneV2
    expect(btns.length).toBe(11);
    const symBtn = fixture.debugElement
      .queryAll(By.directive(MatMenuTrigger))
      .find((de) => de.nativeElement.getAttribute('aria-label') === 'Filter Symbol')!;
    symBtn.injector.get(MatMenuTrigger).openMenu();
    fixture.detectChanges();
    const panel = document.querySelector('.filter-panel')!;
    expect(panel.textContent).toContain('Symbol');
    expect(panel.querySelector('.in-filter-list')).not.toBeNull();
  });

  it('the filter icon marks columns with an active filter', () => {
    const statusCol = component['columnDefs']().find((c) => c.key === 'status')!;
    expect(component['hasFilter'](statusCol)).toBe(false);
    fixture.componentRef.setInput('filters', [
      { column: 'status', op: 'in', value: ['CLOSED'] },
    ]);
    expect(component['hasFilter'](statusCol)).toBe(true);
  });

  it('enum columns emit an in filter; clearing emits its removal', () => {
    const emitted: SliceFilter[][] = [];
    component.filtersChanged.subscribe((f) => emitted.push(f));
    const dirCol = component['columnDefs']().find((c) => c.key === 'direction')!;
    component['setInFilter'](dirCol, ['LONG']);
    component['setInFilter'](dirCol, []);
    expect(emitted[0]).toEqual([
      { column: 'direction', op: 'in', value: ['LONG'] },
    ]);
    expect(emitted[1]).toEqual([]);
  });

  it('string columns offer distinct row values for the in picker', () => {
    const symCol = component['columnDefs']().find((c) => c.key === 'symbol')!;
    expect(component['optionsFor'](symCol)).toEqual(['AMAT', 'NVDA']);
  });

  it('enum pickers only offer values present in the universe — no dead-end choices', () => {
    // CLOSED + OPEN rows exist in the universe → both offered, canonical order
    const statusCol = component['columnDefs']().find((c) => c.key === 'status')!;
    expect(component['optionsFor'](statusCol)).toEqual(['OPEN', 'CLOSED']);
    // a closed-only universe (quarantine on) drops OPEN from the picker
    fixture.componentRef.setInput('universeRows', ROWS.slice(0, 2));
    expect(component['optionsFor'](statusCol)).toEqual(['CLOSED']);
  });

  it('number columns emit a range filter with partial bounds kept', () => {
    const emitted: SliceFilter[][] = [];
    component.filtersChanged.subscribe((f) => emitted.push(f));
    const retCol = component['columnDefs']().find((c) => c.key === 'tradeRetPct')!;
    component['setRangeFilter'](retCol, 'min', '3');
    expect(emitted[0]).toEqual([
      { column: 'tradeRetPct', op: 'range', value: { min: 3 } },
    ]);
  });

  it('a range filter that empties both bounds removes the filter', () => {
    fixture.componentRef.setInput('filters', [
      { column: 'tradeRetPct', op: 'range', value: { min: 3 } },
    ]);
    fixture.detectChanges();
    const emitted: SliceFilter[][] = [];
    component.filtersChanged.subscribe((f) => emitted.push(f));
    const retCol = component['columnDefs']().find((c) => c.key === 'tradeRetPct')!;
    component['setRangeFilter'](retCol, 'min', '');
    expect(emitted[0]).toEqual([]);
  });

  it('date columns emit a dateRange filter', () => {
    const emitted: SliceFilter[][] = [];
    component.filtersChanged.subscribe((f) => emitted.push(f));
    const dateCol = component['columnDefs']().find((c) => c.key === 'entryDate')!;
    component['setDateFilter'](dateCol, 'from', '2024-10-01');
    // the parent feeds the new chain back (store.setFilters is sync)
    fixture.componentRef.setInput('filters', emitted[0]);
    component['setDateFilter'](dateCol, 'to', '2024-12-31');
    expect(emitted[1]).toEqual([
      {
        column: 'entryDate',
        op: 'dateRange',
        value: { from: '2024-10-01', to: '2024-12-31' },
      },
    ]);
  });

  // ── AC2: count + chips + reset ────────────────────────────────────────

  it('the filtered row count is always visible', () => {
    expect(el('.row-count')?.textContent?.trim()).toBe('3 of 3 rows');
    fixture.componentRef.setInput('rows', [ROWS[0]]);
    fixture.componentRef.setInput('universeRows', ROWS);
    fixture.detectChanges();
    expect(el('.row-count')?.textContent?.trim()).toBe('1 of 3 rows');
  });

  it('active filters render as removable chips; reset emits the empty chain', () => {
    fixture.componentRef.setInput('filters', [
      { column: 'direction', op: 'in', value: ['LONG'] },
      { column: 'tradeRetPct', op: 'range', value: { min: 3 } },
    ]);
    fixture.detectChanges();
    const chips = els('.filter-chip');
    expect(chips[0].textContent).toContain('direction: LONG');
    expect(chips[1].textContent).toContain('tradeRetPct: ≥ 3');

    const emitted: SliceFilter[][] = [];
    component.filtersChanged.subscribe((f) => emitted.push(f));
    (chips[0].querySelector('.chip-x') as HTMLButtonElement).click();
    (el('.reset-filters') as HTMLButtonElement).click();
    expect(emitted[0]).toEqual([
      { column: 'tradeRetPct', op: 'range', value: { min: 3 } },
    ]);
    expect(emitted[1]).toEqual([]);
  });

  // ── AC3: open-row quarantine markers ─────────────────────────────────

  it('the include-open toggle emits and carries the hidden count', () => {
    fixture.componentRef.setInput('hiddenRowCount', 2);
    fixture.detectChanges();
    const box = el('.include-open input') as HTMLInputElement;
    expect(el('.include-open')?.textContent).toContain('(2)');
    const emitted: boolean[] = [];
    component.includeOpenRowsChanged.subscribe((v) => emitted.push(v));
    box.click();
    expect(emitted).toEqual([true]);
  });

  it('the provisional banner renders only when open rows are included', () => {
    expect(el('.provisional-banner')).toBeNull();
    fixture.componentRef.setInput('includeOpenRows', true);
    fixture.detectChanges();
    expect(el('.provisional-banner')?.textContent).toContain('provisional');
  });

  it('empty filtered set shows an empty-state row, not a blank grid', () => {
    fixture.componentRef.setInput('rows', []);
    fixture.detectChanges();
    expect(el('.empty-row')?.textContent).toContain('No rows match');
  });
});
