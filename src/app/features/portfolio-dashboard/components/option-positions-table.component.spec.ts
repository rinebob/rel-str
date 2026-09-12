import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { OptionPositionsTableComponent } from './option-positions-table.component';
import { OptionPositionWithPnL } from '../portfolio-dashboard.types';

function makeOption(overrides: Partial<OptionPositionWithPnL> = {}): OptionPositionWithPnL {
  return {
    instrumentId: 'opt-123',
    chainSymbol: 'AAPL',
    optionType: 'call',
    strikePrice: 150,
    expirationDate: '2026-12-18',
    quantity: 1,
    averageCost: 5.00,
    currentPrice: 7.50,
    pnl: 250.00,
    pnlPercent: 50.00,
    ...overrides,
  };
}

describe('OptionPositionsTableComponent', () => {
  let fixture: ComponentFixture<OptionPositionsTableComponent>;
  let component: OptionPositionsTableComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OptionPositionsTableComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(OptionPositionsTableComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => TestBed.resetTestingModule());

  it('creates', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('renders option positions with option-specific columns', () => {
    fixture.componentRef.setInput('positions', [
      makeOption({ chainSymbol: 'AAPL', optionType: 'call', strikePrice: 150 }),
      makeOption({ chainSymbol: 'SPY', optionType: 'put', strikePrice: 500, instrumentId: 'opt-456' }),
    ]);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('AAPL');
    expect(rows[0].textContent).toContain('call');
    expect(rows[0].textContent).toContain('150');
    expect(rows[1].textContent).toContain('SPY');
    expect(rows[1].textContent).toContain('put');
    expect(rows[1].textContent).toContain('500');
  });

  it('shows loading indicator when loading', () => {
    fixture.componentRef.setInput('positions', []);
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Loading');
  });

  it('shows error and retry when error set', () => {
    fixture.componentRef.setInput('positions', []);
    fixture.componentRef.setInput('error', 'Failed to load options');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Failed to load options');
    expect(text).toContain('Retry');
  });

  it('emits retry when retry clicked', () => {
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

    expect(fixture.nativeElement.textContent).toContain('No option positions');
  });

  it('applies positive/negative PnL classes', () => {
    fixture.componentRef.setInput('positions', [
      makeOption({ pnl: 250, pnlPercent: 50 }),
      makeOption({ pnl: -100, pnlPercent: -20, instrumentId: 'opt-neg' }),
    ]);
    fixture.detectChanges();

    const pnlCells = fixture.nativeElement.querySelectorAll('.pd-pnl');
    expect(pnlCells[0].classList.contains('pd-positive')).toBe(true);
    expect(pnlCells[1].classList.contains('pd-negative')).toBe(true);
  });
});
