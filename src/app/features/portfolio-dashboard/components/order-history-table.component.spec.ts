import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { OrderHistoryTableComponent } from './order-history-table.component';
import { BrokerOrder } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';

function makeOrder(overrides: Partial<BrokerOrder> = {}): BrokerOrder {
  return {
    orderId: 'ord-1',
    accountNumber: '123',
    instrumentType: 'equity',
    symbol: 'AAPL',
    side: 'buy',
    type: 'market',
    state: 'filled',
    quantity: 100,
    cumulativeQuantity: 100,
    price: 175.00,
    stopPrice: null,
    averageFillPrice: 175.50,
    createdAt: '2026-09-12T10:00:00Z',
    ...overrides,
  };
}

describe('OrderHistoryTableComponent', () => {
  let fixture: ComponentFixture<OrderHistoryTableComponent>;
  let component: OrderHistoryTableComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrderHistoryTableComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(OrderHistoryTableComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => TestBed.resetTestingModule());

  it('creates', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('renders historical orders in table', () => {
    fixture.componentRef.setInput('orders', [
      makeOrder({ orderId: 'ord-1', symbol: 'AAPL', state: 'filled' }),
      makeOrder({ orderId: 'ord-2', symbol: 'MSFT', state: 'cancelled' }),
    ]);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('AAPL');
    expect(rows[0].textContent).toContain('filled');
    expect(rows[1].textContent).toContain('MSFT');
    expect(rows[1].textContent).toContain('cancelled');
  });

  it('shows loading indicator when loading', () => {
    fixture.componentRef.setInput('orders', []);
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Loading');
  });

  it('shows error and retry when error set', () => {
    fixture.componentRef.setInput('orders', []);
    fixture.componentRef.setInput('error', 'Failed to load history');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Failed to load history');
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

    expect(fixture.nativeElement.textContent).toContain('No order history');
  });

  it('renders the scrollable table wrapper', () => {
    fixture.componentRef.setInput('orders', [makeOrder()]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.pd-table-wrap')).toBeTruthy();
  });

  it('sorts by symbol ascending on first header click', () => {
    fixture.componentRef.setInput('orders', [
      makeOrder({ orderId: 'ord-1', symbol: 'MSFT' }),
      makeOrder({ orderId: 'ord-2', symbol: 'AAPL' }),
    ]);
    fixture.detectChanges();

    const symbolBtn = fixture.nativeElement.querySelectorAll('th .pd-sort')[0];
    symbolBtn.click();
    fixture.detectChanges();

    const cells = fixture.nativeElement.querySelectorAll('tbody tr .pd-symbol');
    expect(cells[0].textContent).toContain('AAPL');
    expect(cells[1].textContent).toContain('MSFT');
  });

  it('marks numeric columns with the dense-table num class', () => {
    fixture.componentRef.setInput('orders', [makeOrder()]);
    fixture.detectChanges();

    // Qty, Fill Qty, Avg Fill
    expect(fixture.nativeElement.querySelectorAll('thead th.num').length).toBe(3);
    expect(
      fixture.nativeElement.querySelectorAll('tbody tr:first-child td.num').length,
    ).toBe(3);
  });
});
