import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { OpenOrdersTableComponent } from './open-orders-table.component';
import { BrokerOrder } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';

function makeOrder(overrides: Partial<BrokerOrder> = {}): BrokerOrder {
  return {
    orderId: 'ord-1',
    accountNumber: '123',
    instrumentType: 'equity',
    symbol: 'AAPL',
    side: 'buy',
    type: 'market',
    state: 'queued',
    quantity: 100,
    cumulativeQuantity: 0,
    price: 175.00,
    stopPrice: null,
    averageFillPrice: null,
    createdAt: '2026-09-12T10:00:00Z',
    ...overrides,
  };
}

describe('OpenOrdersTableComponent', () => {
  let fixture: ComponentFixture<OpenOrdersTableComponent>;
  let component: OpenOrdersTableComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OpenOrdersTableComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(OpenOrdersTableComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => TestBed.resetTestingModule());

  it('creates', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('renders open orders in table', () => {
    fixture.componentRef.setInput('orders', [
      makeOrder({ orderId: 'ord-1', symbol: 'AAPL', side: 'buy', type: 'market' }),
      makeOrder({ orderId: 'ord-2', symbol: 'MSFT', side: 'sell', type: 'limit' }),
    ]);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('AAPL');
    expect(rows[1].textContent).toContain('MSFT');
  });

  it('shows loading indicator when loading', () => {
    fixture.componentRef.setInput('orders', []);
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Loading');
  });

  it('shows error and retry when error set', () => {
    fixture.componentRef.setInput('orders', []);
    fixture.componentRef.setInput('error', 'Failed to load orders');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Failed to load orders');
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

  it('shows empty state when no orders', () => {
    fixture.componentRef.setInput('orders', []);
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('error', null);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No open orders');
  });

  it('shows stop-loss indicator for protected symbols', () => {
    fixture.componentRef.setInput('orders', [
      makeOrder({ orderId: 'ord-1', symbol: 'AAPL', type: 'stop_market' }),
      makeOrder({ orderId: 'ord-2', symbol: 'MSFT', type: 'limit' }),
    ]);
    fixture.componentRef.setInput('protectedSymbols', new Set(['AAPL']));
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows[0].textContent).toContain('Stop-loss');
    expect(rows[1].textContent).not.toContain('Stop-loss');
  });

  it('does not show stop-loss indicator when symbol not in protectedSymbols', () => {
    fixture.componentRef.setInput('orders', [
      makeOrder({ orderId: 'ord-1', symbol: 'AAPL', type: 'stop_market' }),
    ]);
    fixture.componentRef.setInput('protectedSymbols', new Set());
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector('tbody tr');
    expect(row.textContent).not.toContain('Stop-loss');
  });
});
