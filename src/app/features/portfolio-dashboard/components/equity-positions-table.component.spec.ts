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

  it('emits toggleClosed when toggle button clicked', () => {
    fixture.componentRef.setInput('positions', [makePosition()]);
    fixture.componentRef.setInput('showClosed', false);
    fixture.detectChanges();

    const spy = jasmine.createSpy('toggleClosed');
    component.toggleClosed.subscribe(spy);

    fixture.nativeElement.querySelector('.pd-toggle-closed').click();
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

  it('shows toggle button text reflecting showClosed state', () => {
    fixture.componentRef.setInput('positions', [makePosition()]);
    fixture.componentRef.setInput('showClosed', false);
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector('.pd-toggle-closed');
    expect(toggle.textContent).toContain('Show Closed');

    fixture.componentRef.setInput('showClosed', true);
    fixture.detectChanges();

    expect(toggle.textContent).toContain('Hide Closed');
  });

  it('formats null PnL as dash', () => {
    fixture.componentRef.setInput('positions', [makePosition({ pnl: null, pnlPercent: null })]);
    fixture.detectChanges();

    const pnlCell = fixture.nativeElement.querySelector('.pd-pnl');
    expect(pnlCell.textContent.trim()).toContain('—');
  });

  it('hides closed positions by default', () => {
    fixture.componentRef.setInput('positions', [
      makePosition({ symbol: 'AAPL', closed: false }),
      makePosition({ symbol: 'CLOSED1', closed: true, quantity: 0 }),
    ]);
    fixture.componentRef.setInput('showClosed', false);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('AAPL');
  });

  it('shows closed positions when showClosed is true', () => {
    fixture.componentRef.setInput('positions', [
      makePosition({ symbol: 'AAPL', closed: false }),
      makePosition({ symbol: 'CLOSED1', closed: true, quantity: 0 }),
    ]);
    fixture.componentRef.setInput('showClosed', true);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[1].textContent).toContain('CLOSED1');
  });

  it('applies muted styling to closed position rows', () => {
    fixture.componentRef.setInput('positions', [
      makePosition({ symbol: 'CLOSED1', closed: true, quantity: 0 }),
    ]);
    fixture.componentRef.setInput('showClosed', true);
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector('tbody tr');
    expect(row.classList.contains('pd-closed')).toBe(true);
  });
});
