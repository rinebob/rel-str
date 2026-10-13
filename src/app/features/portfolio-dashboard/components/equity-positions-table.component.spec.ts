import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { EquityPositionsTableComponent } from './equity-positions-table.component';
import { EquityPositionWithPnL } from '../portfolio-dashboard.types';

function makePosition(overrides: Partial<EquityPositionWithPnL> = {}): EquityPositionWithPnL {
  return {
    symbol: 'AAPL',
    quantity: 100,
    averageBuyPrice: 150.00,
    sharesHeldForSells: 0,
    currentPrice: 175.00,
    pnl: 2500.00,
    pnlPercent: 16.67,
    closed: false,
    entryDate: null,
    ...overrides,
  };
}

describe('EquityPositionsTableComponent', () => {
  let fixture: ComponentFixture<EquityPositionsTableComponent>;
  let component: EquityPositionsTableComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EquityPositionsTableComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(EquityPositionsTableComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => TestBed.resetTestingModule());

  it('creates', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('renders positions in table', () => {
    fixture.componentRef.setInput('positions', [
      makePosition({ symbol: 'AAPL', pnl: 2500 }),
      makePosition({ symbol: 'MSFT', pnl: -500 }),
    ]);
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('error', null);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('AAPL');
    expect(rows[1].textContent).toContain('MSFT');
  });

  it('shows loading indicator when loading', () => {
    fixture.componentRef.setInput('positions', []);
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Loading');
  });

  it('shows error and retry button when error set', () => {
    fixture.componentRef.setInput('positions', []);
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('error', 'Failed to load positions');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Failed to load positions');
    expect(text).toContain('Retry');
  });

  it('emits retry when retry button clicked', () => {
    fixture.componentRef.setInput('error', 'Failed');
    fixture.detectChanges();

    const spy = jasmine.createSpy('retry');
    component.retry.subscribe(spy);

    fixture.nativeElement.querySelector('.pd-section-retry').click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('shows empty state when no positions', () => {
    fixture.componentRef.setInput('positions', []);
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('error', null);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No equity positions');
  });

  it('applies negative class to negative PnL', () => {
    fixture.componentRef.setInput('positions', [makePosition({ pnl: -500 })]);
    fixture.detectChanges();

    const pnlCell = fixture.nativeElement.querySelector('.pd-pnl');
    expect(pnlCell.classList.contains('pd-negative')).toBe(true);
  });

  it('applies positive class to positive PnL', () => {
    fixture.componentRef.setInput('positions', [makePosition({ pnl: 2500 })]);
    fixture.detectChanges();

    const pnlCell = fixture.nativeElement.querySelector('.pd-pnl');
    expect(pnlCell.classList.contains('pd-positive')).toBe(true);
  });

  it('formats null PnL as dash', () => {
    fixture.componentRef.setInput('positions', [makePosition({ pnl: null, pnlPercent: null })]);
    fixture.detectChanges();

    const pnlCell = fixture.nativeElement.querySelector('.pd-pnl');
    expect(pnlCell.textContent.trim()).toContain('—');
  });

  it('wraps the table in a scrollable container for the sticky header', () => {
    fixture.componentRef.setInput('positions', [makePosition()]);
    fixture.detectChanges();

    const wrap = fixture.nativeElement.querySelector('.pd-table-wrap');
    expect(wrap).toBeTruthy();
    expect(wrap.querySelector('table.pd-table')).toBeTruthy();
  });

  it('sorts by a column ascending on first header click, descending on second', () => {
    fixture.componentRef.setInput('positions', [
      makePosition({ symbol: 'MSFT', pnl: 100 }),
      makePosition({ symbol: 'AAPL', pnl: 500 }),
      makePosition({ symbol: 'GOOG', pnl: -300 }),
    ]);
    fixture.detectChanges();

    const headers = fixture.nativeElement.querySelectorAll('.pd-sort');
    const pnlHeader = headers[headers.length - 2]; // PnL, before PnL%
    pnlHeader.click();
    fixture.detectChanges();

    let symbols = [...fixture.nativeElement.querySelectorAll('tbody .pd-symbol')].map((el) => el.textContent.trim());
    expect(symbols).toEqual(['GOOG', 'MSFT', 'AAPL']);

    pnlHeader.click();
    fixture.detectChanges();

    symbols = [...fixture.nativeElement.querySelectorAll('tbody .pd-symbol')].map((el) => el.textContent.trim());
    expect(symbols).toEqual(['AAPL', 'MSFT', 'GOOG']);
  });

  it('sorts symbol ascending by default', () => {
    fixture.componentRef.setInput('positions', [
      makePosition({ symbol: 'MSFT' }),
      makePosition({ symbol: 'AAPL' }),
    ]);
    fixture.detectChanges();

    const symbols = [...fixture.nativeElement.querySelectorAll('tbody .pd-symbol')].map((el) => el.textContent.trim());
    expect(symbols).toEqual(['AAPL', 'MSFT']);
  });

  it('keeps null values last in both sort directions', () => {
    fixture.componentRef.setInput('positions', [
      makePosition({ symbol: 'MSFT', pnl: 100 }),
      makePosition({ symbol: 'NULLS', pnl: null }),
      makePosition({ symbol: 'AAPL', pnl: 500 }),
    ]);
    fixture.detectChanges();

    const headers = fixture.nativeElement.querySelectorAll('.pd-sort');
    const pnlHeader = headers[headers.length - 2];
    pnlHeader.click(); // asc
    fixture.detectChanges();

    let symbols = [...fixture.nativeElement.querySelectorAll('tbody .pd-symbol')].map((el) => el.textContent.trim());
    expect(symbols[symbols.length - 1]).toBe('NULLS');

    pnlHeader.click(); // desc
    fixture.detectChanges();

    symbols = [...fixture.nativeElement.querySelectorAll('tbody .pd-symbol')].map((el) => el.textContent.trim());
    expect(symbols[symbols.length - 1]).toBe('NULLS');
  });

  it('renders the entry date column as a date or dash', () => {
    fixture.componentRef.setInput('positions', [
      makePosition({ symbol: 'AAPL', entryDate: '2026-01-15T14:30:00Z' }),
      makePosition({ symbol: 'MSFT', entryDate: null }),
    ]);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows[0].textContent).toContain('2026-01-15');
    expect(rows[1].textContent).toContain('—');
  });

  it('filters out closed positions', () => {
    fixture.componentRef.setInput('positions', [
      makePosition({ symbol: 'AAPL', closed: false }),
      makePosition({ symbol: 'CLOSED1', closed: true, quantity: 0 }),
    ]);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('AAPL');
  });

  it('shows Close action on open position rows', () => {
    fixture.componentRef.setInput('positions', [makePosition({ symbol: 'AAPL', quantity: 100, closed: false })]);
    fixture.detectChanges();

    const closeBtn = fixture.nativeElement.querySelector('.pd-close-action');
    expect(closeBtn).toBeTruthy();
    expect(closeBtn.textContent).toContain('Close');
  });

  it('emits closePosition with the position when Close clicked', () => {
    const pos = makePosition({ symbol: 'AAPL', quantity: 100, closed: false });
    fixture.componentRef.setInput('positions', [pos]);
    fixture.detectChanges();

    const spy = jasmine.createSpy('closePosition');
    component.closePosition.subscribe(spy);

    fixture.nativeElement.querySelector('.pd-close-action').click();
    expect(spy).toHaveBeenCalledWith(pos);
  });

  it('shows Add Stop action on unprotected open position rows', () => {
    fixture.componentRef.setInput('positions', [makePosition({ symbol: 'AAPL', quantity: 100, closed: false })]);
    fixture.componentRef.setInput('protectedSymbols', new Set<string>());
    fixture.detectChanges();

    const addStopBtn = fixture.nativeElement.querySelector('.pd-add-stop-action');
    expect(addStopBtn).toBeTruthy();
    expect(addStopBtn.textContent).toContain('Add Stop');
  });

  it('disables Add Stop action on protected positions', () => {
    fixture.componentRef.setInput('positions', [makePosition({ symbol: 'AAPL', quantity: 100, closed: false })]);
    fixture.componentRef.setInput('protectedSymbols', new Set<string>(['AAPL']));
    fixture.detectChanges();

    const addStopBtn = fixture.nativeElement.querySelector('.pd-add-stop-action');
    expect(addStopBtn).toBeTruthy();
    expect(addStopBtn.disabled).toBe(true);
  });

  it('does not disable Add Stop action on unprotected positions', () => {
    fixture.componentRef.setInput('positions', [makePosition({ symbol: 'AAPL', quantity: 100, closed: false })]);
    fixture.componentRef.setInput('protectedSymbols', new Set<string>());
    fixture.detectChanges();

    const addStopBtn = fixture.nativeElement.querySelector('.pd-add-stop-action');
    expect(addStopBtn).toBeTruthy();
    expect(addStopBtn.disabled).toBe(false);
  });

  it('emits addStopLoss with the position when Add Stop clicked', () => {
    const pos = makePosition({ symbol: 'AAPL', quantity: 100, closed: false });
    fixture.componentRef.setInput('positions', [pos]);
    fixture.componentRef.setInput('protectedSymbols', new Set<string>());
    fixture.detectChanges();

    const spy = jasmine.createSpy('addStopLoss');
    component.addStopLoss.subscribe(spy);

    fixture.nativeElement.querySelector('.pd-add-stop-action').click();
    expect(spy).toHaveBeenCalledWith(pos);
  });

  it('does not show Close or Add Stop actions when account is not agent-enabled', () => {
    fixture.componentRef.setInput('positions', [makePosition({ symbol: 'AAPL', quantity: 100, closed: false })]);
    fixture.componentRef.setInput('protectedSymbols', new Set<string>());
    fixture.componentRef.setInput('agenticAllowed', false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.pd-close-action')).toBeNull();
    expect(fixture.nativeElement.querySelector('.pd-add-stop-action')).toBeNull();
  });

  it('marks numeric columns with the dense-table num class', () => {
    fixture.componentRef.setInput('positions', [makePosition()]);
    fixture.detectChanges();

    // Quantity, Avg Cost, Cost Basis, Current Price, Value, PnL, PnL%
    expect(fixture.nativeElement.querySelectorAll('thead th.num').length).toBe(7);
    expect(
      fixture.nativeElement.querySelectorAll('tbody tr:first-child td.num').length,
    ).toBe(7);
  });
});
