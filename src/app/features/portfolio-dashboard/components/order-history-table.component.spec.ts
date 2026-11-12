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

function makeOptionOrder(overrides: Partial<BrokerOrder> = {}): BrokerOrder {
  return makeOrder({
    instrumentType: 'option',
    symbol: 'NFLX',
    legs: [
      {
        side: 'buy',
        optionId: 'opt-inst-1',
        quantity: 1,
        positionEffect: 'open',
        strikePrice: 15,
        expirationDate: '2026-11-20',
        optionType: 'call',
      },
    ],
    ...overrides,
  });
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

    const rows = fixture.nativeElement.querySelectorAll('tbody tr:not(.pd-group-row)');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('AAPL');
    expect(rows[0].textContent).toContain('filled');
    expect(rows[1].textContent).toContain('MSFT');
    expect(rows[1].textContent).toContain('cancelled');
  });

  it('separates equity and option orders into labelled groups', () => {
    fixture.componentRef.setInput('orders', [
      makeOrder({ orderId: 'ord-1', symbol: 'NFLX', state: 'filled' }),
      makeOptionOrder({ orderId: 'ord-2' }),
    ]);
    fixture.detectChanges();

    const labels = [...fixture.nativeElement.querySelectorAll('.pd-group-label')]
      .map((el) => (el as HTMLElement).textContent?.trim());
    expect(labels[0]).toContain('Equity Orders');
    expect(labels[1]).toContain('Option Orders');

    // Same underlying symbol stays unambiguous: equity shows the bare
    // ticker, the option row shows its contract label.
    const symbols = [...fixture.nativeElement.querySelectorAll('.pd-symbol')]
      .map((el) => (el as HTMLElement).textContent?.trim());
    expect(symbols[0]).toBe('NFLX');
    expect(symbols[1]).toBe('NFLX $15.00 C 2026-11-20');
  });

  it('labels a multi-leg option order by leg count', () => {
    fixture.componentRef.setInput('orders', [
      makeOptionOrder({
        orderId: 'ord-2',
        legs: [
          {
            side: 'buy', optionId: 'a', quantity: 1, positionEffect: 'open',
            strikePrice: 15, expirationDate: '2026-11-20', optionType: 'call',
          },
          {
            side: 'sell', optionId: 'b', quantity: 1, positionEffect: 'open',
            strikePrice: 20, expirationDate: '2026-11-20', optionType: 'call',
          },
        ],
      }),
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.pd-symbol')?.textContent?.trim())
      .toBe('NFLX 2-leg');
  });

  it('omits an instrument group that has no orders', () => {
    fixture.componentRef.setInput('orders', [makeOptionOrder()]);
    fixture.detectChanges();

    const labels = fixture.nativeElement.querySelectorAll('.pd-group-label');
    expect(labels.length).toBe(1);
    expect(labels[0].textContent).toContain('Option Orders');
  });

  it('collapses and re-expands a group from its header', () => {
    fixture.componentRef.setInput('orders', [
      makeOrder({ orderId: 'ord-1', symbol: 'AAPL' }),
      makeOrder({ orderId: 'ord-2', symbol: 'MSFT' }),
    ]);
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector('.pd-group-toggle') as HTMLElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(
      fixture.nativeElement.querySelectorAll('tbody tr:not(.pd-group-row)').length,
    ).toBe(2);

    toggle.click();
    fixture.detectChanges();

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(
      fixture.nativeElement.querySelectorAll('tbody tr:not(.pd-group-row)').length,
    ).toBe(0);
    // Header + count stay visible while collapsed.
    expect(toggle.textContent).toContain('Equity Orders');
    expect(toggle.textContent).toContain('2');

    toggle.click();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll('tbody tr:not(.pd-group-row)').length,
    ).toBe(2);
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
      fixture.nativeElement.querySelectorAll('tbody tr:not(.pd-group-row) td.num').length,
    ).toBe(3);
  });
});
