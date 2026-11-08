import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { EquityPositionsTableComponent } from './equity-positions-table.component';
import { EquityPositionWithPnL } from '../portfolio-dashboard.types';
import { BrokerOrder } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';
import { PositionPeak } from '../utils/position-peak.util';

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

function makeStopOrder(overrides: Partial<BrokerOrder> = {}): BrokerOrder {
  return {
    orderId: 'stop-1',
    accountNumber: '123456789',
    instrumentType: 'equity',
    symbol: 'AAPL',
    side: 'sell',
    type: 'stop_market',
    state: 'confirmed',
    quantity: 100,
    cumulativeQuantity: 0,
    price: null,
    stopPrice: 160.00,
    averageFillPrice: null,
    createdAt: '2026-01-15T10:00:00Z',
    timeInForce: 'gtc',
    ...overrides,
  };
}

function makePeak(overrides: Partial<PositionPeak> = {}): PositionPeak {
  return {
    symbol: 'AAPL',
    entryDate: '2026-01-15T10:00:00Z',
    lastFillDate: '2026-01-15T10:00:00Z',
    lifetime: { price: 190.00, date: '2026-02-01T00:00:00Z' },
    sinceLastFill: { price: 190.00, date: '2026-02-01T00:00:00Z' },
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
    const pnlHeader = headers[7]; // PnL — stop columns trail PnL% (#1414)
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
    const pnlHeader = headers[7]; // PnL
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

  it('shows enabled Update Stop action on protected positions with an updatable stop', () => {
    fixture.componentRef.setInput('positions', [makePosition({ symbol: 'AAPL', quantity: 100, closed: false })]);
    fixture.componentRef.setInput('protectedSymbols', new Set<string>(['AAPL']));
    fixture.componentRef.setInput('updatableSymbols', new Set<string>(['AAPL']));
    fixture.detectChanges();

    const updateBtn = fixture.nativeElement.querySelector('.pd-update-stop-action');
    expect(updateBtn).toBeTruthy();
    expect(updateBtn.textContent).toContain('Update Stop');
    expect(updateBtn.disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('.pd-add-stop-action')).toBeNull();
  });

  it('emits updateStopLoss with the position when Update Stop clicked', () => {
    const pos = makePosition({ symbol: 'AAPL', quantity: 100, closed: false });
    fixture.componentRef.setInput('positions', [pos]);
    fixture.componentRef.setInput('protectedSymbols', new Set<string>(['AAPL']));
    fixture.componentRef.setInput('updatableSymbols', new Set<string>(['AAPL']));
    fixture.detectChanges();

    const spy = jasmine.createSpy('updateStopLoss');
    component.updateStopLoss.subscribe(spy);

    fixture.nativeElement.querySelector('.pd-update-stop-action').click();
    expect(spy).toHaveBeenCalledWith(pos);
  });

  it('keeps the disabled Add Stop fallback when protected but the stop is not updatable', () => {
    fixture.componentRef.setInput('positions', [makePosition({ symbol: 'AAPL', quantity: 100, closed: false })]);
    fixture.componentRef.setInput('protectedSymbols', new Set<string>(['AAPL']));
    fixture.componentRef.setInput('updatableSymbols', new Set<string>());
    fixture.detectChanges();

    const addStopBtn = fixture.nativeElement.querySelector('.pd-add-stop-action');
    expect(addStopBtn).toBeTruthy();
    expect(addStopBtn.disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('.pd-update-stop-action')).toBeNull();
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

    // Quantity, Avg Cost, Cost Basis, Current Price, Value, PnL/%,
    // Stop/Dist, Peak/Retr% — paired metrics stack two-line (#1414)
    expect(fixture.nativeElement.querySelectorAll('thead th.num').length).toBe(8);
    expect(
      fixture.nativeElement.querySelectorAll('tbody tr:first-child td.num').length,
    ).toBe(8);
  });

  // ── Stop surfacing (#1414) ──────────────────────────────────────────────

  it('shows the live stop price, distance, and tooltip on a protected row', () => {
    fixture.componentRef.setInput('positions', [makePosition({ symbol: 'AAPL', currentPrice: 175 })]);
    fixture.componentRef.setInput('protectedSymbols', new Set<string>(['AAPL']));
    fixture.componentRef.setInput('stopOrders', new Map([['AAPL', makeStopOrder({ stopPrice: 160 })]]));
    fixture.detectChanges();

    const cells = fixture.nativeElement.querySelectorAll('tbody tr:first-child td');
    const stopCell = cells[8];
    expect(stopCell.textContent).toContain('$160.00');
    const tip = stopCell.querySelector('[title]');
    expect(tip?.getAttribute('title')).toContain('stop-market');
    expect(tip?.getAttribute('title')).toContain('qty 100');
    expect(tip?.getAttribute('title')).toContain('GTC');
    expect(tip?.getAttribute('title')).toContain('2026-01-15');

    // Dist rides the second line of the same cell: 160 − 175 = −$15 (−8.6%)
    expect(stopCell.textContent).toContain('-$15.00');
    expect(stopCell.textContent).toContain('-8.6%');
  });

  it('renders the UNPROTECTED marker in the Stop column when no live stop', () => {
    fixture.componentRef.setInput('positions', [makePosition({ symbol: 'AAPL' })]);
    fixture.componentRef.setInput('protectedSymbols', new Set<string>());
    fixture.componentRef.setInput('stopOrders', new Map());
    fixture.detectChanges();

    const marker = fixture.nativeElement.querySelector('.pd-unprotected');
    expect(marker).toBeTruthy();
    expect(marker.textContent.trim()).toBe('UNPROTECTED');
  });

  it('shows a stop-limit stop price but keeps it out of Update eligibility', () => {
    fixture.componentRef.setInput('positions', [makePosition({ symbol: 'AAPL' })]);
    fixture.componentRef.setInput('protectedSymbols', new Set<string>(['AAPL']));
    fixture.componentRef.setInput('updatableSymbols', new Set<string>()); // stop_limit → not updatable
    fixture.componentRef.setInput(
      'stopOrders',
      new Map([['AAPL', makeStopOrder({ type: 'stop_limit', stopPrice: 165 })]]),
    );
    fixture.detectChanges();

    const cells = fixture.nativeElement.querySelectorAll('tbody tr:first-child td');
    expect(cells[8].textContent).toContain('$165.00');
    expect(cells[8].querySelector('[title]')?.getAttribute('title')).toContain('stop-limit');
    expect(fixture.nativeElement.querySelector('.pd-update-stop-action')).toBeNull();
    expect(fixture.nativeElement.querySelector('.pd-unprotected')).toBeNull();
  });

  it('renders the peak price and retraced% for a derived peak', () => {
    fixture.componentRef.setInput('positions', [makePosition({ symbol: 'AAPL', currentPrice: 171 })]);
    fixture.componentRef.setInput('positionPeaks', { AAPL: makePeak() });
    fixture.detectChanges();

    const cells = fixture.nativeElement.querySelectorAll('tbody tr:first-child td');
    const peakCell = cells[9];
    expect(peakCell.textContent).toContain('$190.00');
    expect(peakCell.querySelector('[title]')?.getAttribute('title')).toContain('2026-02-01');
    // retraced rides the second line: (190 − 171) / 190 = 10.0%
    expect(peakCell.textContent).toContain('10.0%');
  });

  it('renders — for underivable peaks and … while derivation is pending', () => {
    fixture.componentRef.setInput('positions', [
      makePosition({ symbol: 'AAPL' }),
      makePosition({ symbol: 'GPRO' }),
      makePosition({ symbol: 'PEND' }),
    ]);
    fixture.componentRef.setInput('positionPeaks', {
      AAPL: makePeak({ lifetime: null, entryDate: null }),
      GPRO: makePeak({ lifetime: null, entryDate: null }),
      // PEND key absent — derive still running
    });
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    const cell = (r: number, c: number) => rows[r].querySelectorAll('td')[c].textContent.trim();
    expect(cell(0, 9)).toBe('——');
    expect(cell(1, 9)).toBe('——');
    expect(cell(2, 9)).toBe('……');
  });

  it('renders — instead of spinning … forever when the peaks derive fails', () => {
    fixture.componentRef.setInput('positions', [makePosition({ symbol: 'AAPL' })]);
    fixture.componentRef.setInput('positionPeaks', {});
    fixture.componentRef.setInput('peaksError', 'historicals down');
    fixture.detectChanges();

    const cells = fixture.nativeElement.querySelectorAll('tbody tr:first-child td');
    expect(cells[9].textContent.trim()).toBe('——');
  });

  it('sorts by stop price when the Stop header is clicked', () => {
    fixture.componentRef.setInput('positions', [
      makePosition({ symbol: 'AAPL' }),
      makePosition({ symbol: 'MSFT' }),
    ]);
    fixture.componentRef.setInput('stopOrders', new Map([
      ['AAPL', makeStopOrder({ stopPrice: 160 })],
      ['MSFT', makeStopOrder({ symbol: 'MSFT', stopPrice: 300 })],
    ]));
    fixture.detectChanges();

    const headers = fixture.nativeElement.querySelectorAll('.pd-sort');
    headers[8].click(); // Stop/Dist — after PnL
    fixture.detectChanges();

    let symbols = [...fixture.nativeElement.querySelectorAll('tbody .pd-symbol')].map((el) => el.textContent.trim());
    expect(symbols).toEqual(['AAPL', 'MSFT']);

    headers[8].click();
    fixture.detectChanges();
    symbols = [...fixture.nativeElement.querySelectorAll('tbody .pd-symbol')].map((el) => el.textContent.trim());
    expect(symbols).toEqual(['MSFT', 'AAPL']);
  });
});
