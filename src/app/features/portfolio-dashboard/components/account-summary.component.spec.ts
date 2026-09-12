import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { AccountSummaryComponent } from './account-summary.component';
import { PortfolioSnapshot } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';

function makeSnapshot(overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return {
    totalValue: 100000,
    equityValue: 80000,
    cash: 20000,
    buyingPower: 40000,
    marginExposure: null,
    ...overrides,
  };
}

describe('AccountSummaryComponent', () => {
  let fixture: ComponentFixture<AccountSummaryComponent>;
  let component: AccountSummaryComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountSummaryComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountSummaryComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => TestBed.resetTestingModule());

  it('creates', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('renders snapshot values when data is present', () => {
    fixture.componentRef.setInput('snapshot', makeSnapshot());
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('error', null);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Total Value');
    expect(text).toContain('$100,000.00');
    expect(text).toContain('Equity Value');
    expect(text).toContain('$80,000.00');
    expect(text).toContain('Cash');
    expect(text).toContain('$20,000.00');
    expect(text).toContain('Buying Power');
    expect(text).toContain('$40,000.00');
  });

  it('renders margin exposure when available', () => {
    fixture.componentRef.setInput('snapshot', makeSnapshot({ marginExposure: 50000 }));
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Margin Exposure');
    expect(text).toContain('$50,000.00');
  });

  it('hides margin exposure when null', () => {
    fixture.componentRef.setInput('snapshot', makeSnapshot({ marginExposure: null }));
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).not.toContain('Margin Exposure');
  });

  it('shows loading indicator when loading is true', () => {
    fixture.componentRef.setInput('snapshot', null);
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Loading');
  });

  it('shows error message and retry button when error is set', () => {
    fixture.componentRef.setInput('snapshot', null);
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('error', 'Failed to load portfolio');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Failed to load portfolio');
    expect(text).toContain('Retry');
  });

  it('emits retry when retry button clicked', () => {
    fixture.componentRef.setInput('snapshot', null);
    fixture.componentRef.setInput('error', 'Failed');
    fixture.detectChanges();

    const spy = jasmine.createSpy('retry');
    component.retry.subscribe(spy);

    const button = fixture.nativeElement.querySelector('.pd-section-retry');
    button.click();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('renders dashes for null values', () => {
    fixture.componentRef.setInput('snapshot', makeSnapshot({
      totalValue: null,
      equityValue: null,
      cash: null,
      buyingPower: null,
      marginExposure: null,
    }));
    fixture.detectChanges();

    const values = fixture.nativeElement.querySelectorAll('.pd-summary-value');
    expect(values.length).toBe(4);
    for (const v of values) {
      expect(v.textContent.trim()).toBe('—');
    }
  });

  it('shows empty state when snapshot is null, not loading, no error', () => {
    fixture.componentRef.setInput('snapshot', null);
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('error', null);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('No portfolio data');
  });
});
