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

  it('renders opening orders in table', () => {
    fixture.componentRef.setInput('orders', [
      makeOrder({ orderId: 'ord-1', symbol: 'AAPL', side: 'buy', type: 'market' }),
      makeOrder({ orderId: 'ord-2', symbol: 'MSFT', side: 'buy', type: 'limit' }),
    ]);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
  });

  it('filters out sell-side orders (position-closing, incl. stop-loss)', () => {
    fixture.componentRef.setInput('orders', [
      makeOrder({ orderId: 'ord-1', symbol: 'AAPL', side: 'buy' }),
      makeOrder({ orderId: 'ord-2', symbol: 'MSFT', side: 'sell', type: 'stop_market' }),
      makeOrder({ orderId: 'ord-3', symbol: 'NVDA', side: 'sell', type: 'limit' }),
    ]);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('AAPL');
  });

  it('filters option orders by leg positionEffect when present', () => {
    fixture.componentRef.setInput('orders', [
      makeOrder({
        orderId: 'ord-open',
        instrumentType: 'option',
        symbol: 'AAPL',
        legs: [{ side: 'buy', optionId: 'x', quantity: 1, positionEffect: 'open' }],
      }),
      makeOrder({
        orderId: 'ord-close',
        instrumentType: 'option',
        symbol: 'MSFT',
        side: 'sell',
        legs: [{ side: 'sell', optionId: 'y', quantity: 1, positionEffect: 'close' }],
      }),
    ]);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('AAPL');
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

  it('shows empty state when no opening orders', () => {
    fixture.componentRef.setInput('orders', [
      makeOrder({ side: 'sell', type: 'stop_market' }),
    ]);
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('error', null);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No open orders');
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

  it('emits cancelOrder when Cancel clicked', () => {
    const order = makeOrder({ orderId: 'ord-1' });
    fixture.componentRef.setInput('orders', [order]);
    fixture.detectChanges();

    const spy = jasmine.createSpy('cancelOrder');
    component.cancelOrder.subscribe(spy);

    fixture.nativeElement.querySelector('.pd-cancel-action').click();
    expect(spy).toHaveBeenCalledWith(order);
  });

  it('hides the Actions column when account is not agent-enabled', () => {
    fixture.componentRef.setInput('orders', [makeOrder()]);
    fixture.componentRef.setInput('agenticAllowed', false);
    fixture.detectChanges();

    const headers = [...fixture.nativeElement.querySelectorAll('th')].map(
      (th: HTMLElement) => th.textContent.trim(),
    );
    expect(headers.some((h: string) => h.includes('Actions'))).toBeFalsy();
    expect(fixture.nativeElement.querySelector('.pd-cancel-action')).toBeNull();
  });

  it('exposes no selection affordances when account is not agent-enabled', () => {
    fixture.componentRef.setInput('orders', [makeOrder(), makeOrder({ orderId: 'ord-2' })]);
    fixture.componentRef.setInput('agenticAllowed', false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('thead input[type="checkbox"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('tbody input[type="checkbox"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.pd-bulk-bar')).toBeNull();
    // Even if selection state were forced, the bulk bar stays gated.
    component.selected.set(new Set(['ord-1', 'ord-2']));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.pd-bulk-bar')).toBeNull();
  });

  it('marks numeric columns with the dense-table num class', () => {
    fixture.componentRef.setInput('orders', [makeOrder()]);
    fixture.detectChanges();

    // Qty, Price, Stop, Mark, Dist
    expect(fixture.nativeElement.querySelectorAll('thead th.num').length).toBe(5);
    expect(
      fixture.nativeElement.querySelectorAll('tbody tr:first-child td.num').length,
    ).toBe(5);
  });

  it('renders mark price from the equity quote for equity orders', () => {
    fixture.componentRef.setInput('orders', [makeOrder({ symbol: 'AAPL' })]);
    fixture.componentRef.setInput(
      'equityQuotes',
      new Map([['AAPL', { lastTradePrice: 180.25 }]]),
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('td.pd-mark').textContent).toContain('180.25');
  });

  it('computes distance-to-limit for a limit order', () => {
    fixture.componentRef.setInput('orders', [
      makeOrder({ symbol: 'AAPL', type: 'limit', price: 170 }),
    ]);
    fixture.componentRef.setInput(
      'equityQuotes',
      new Map([['AAPL', { lastTradePrice: 180 }]]),
    );
    fixture.detectChanges();

    // |170 - 180| / 180 = 5.56%
    expect(fixture.nativeElement.querySelector('td.pd-dist').textContent).toContain('5.56%');
  });

  it('renders dash for mark/dist when quote missing or order is market', () => {
    fixture.componentRef.setInput('orders', [
      makeOrder({ symbol: 'AAPL', type: 'market', price: null }),
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('td.pd-mark').textContent).toContain('—');
    expect(fixture.nativeElement.querySelector('td.pd-dist').textContent).toContain('—');
  });

  it('joins a single-leg option order on legs[0].optionId', () => {
    fixture.componentRef.setInput('orders', [
      makeOrder({
        instrumentType: 'option',
        symbol: 'AAPL 260102C00150000',
        type: 'limit',
        price: 5.0,
        legs: [{ side: 'buy', optionId: 'opt-uuid-1', quantity: 1, positionEffect: 'open' }],
      }),
    ]);
    fixture.componentRef.setInput(
      'optionQuotes',
      new Map([['opt-uuid-1', { lastTradePrice: 5.5 }]]),
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('td.pd-mark').textContent).toContain('5.50');
  });

  it('renders dash for a multi-leg option order (ambiguous mark)', () => {
    fixture.componentRef.setInput('orders', [
      makeOrder({
        instrumentType: 'option',
        type: 'limit',
        price: 1.0,
        legs: [
          { side: 'buy', optionId: 'opt-1', quantity: 1, positionEffect: 'open' },
          { side: 'sell', optionId: 'opt-2', quantity: 1, positionEffect: 'open' },
        ],
      }),
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('td.pd-mark').textContent).toContain('—');
  });

  it('emits modifyOrder for an equity limit order', () => {
    const order = makeOrder({ type: 'limit', price: 170 });
    fixture.componentRef.setInput('orders', [order]);
    fixture.detectChanges();

    const spy = jasmine.createSpy('modifyOrder');
    component.modifyOrder.subscribe(spy);

    fixture.nativeElement.querySelector('.pd-modify-action').click();
    expect(spy).toHaveBeenCalledWith(order);
  });

  it('shows Modify only on equity limit orders', () => {
    fixture.componentRef.setInput('orders', [
      makeOrder({ orderId: 'eq-limit', type: 'limit', price: 170 }),
      makeOrder({ orderId: 'eq-mkt', type: 'market', price: null }),
      makeOrder({
        orderId: 'opt-limit',
        instrumentType: 'option',
        type: 'limit',
        price: 5,
        legs: [{ side: 'buy', optionId: 'x', quantity: 1, positionEffect: 'open' }],
      }),
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.pd-modify-action').length).toBe(1);
  });

  it('selects rows and emits the selection on bulk Cancel', () => {
    const a = makeOrder({ orderId: 'ord-a', symbol: 'AAPL' });
    const b = makeOrder({ orderId: 'ord-b', symbol: 'MSFT' });
    fixture.componentRef.setInput('orders', [a, b]);
    fixture.detectChanges();

    const checks = fixture.nativeElement.querySelectorAll('tbody input[type="checkbox"]');
    checks[0].click();
    checks[1].click();
    fixture.detectChanges();

    const spy = jasmine.createSpy('cancelSelected');
    component.cancelSelected.subscribe(spy);

    fixture.nativeElement.querySelector('.pd-bulk-cancel').click();
    expect(spy).toHaveBeenCalledWith([a, b]);
  });

  it('select-all header checkbox selects every row', () => {
    fixture.componentRef.setInput('orders', [
      makeOrder({ orderId: 'ord-a' }),
      makeOrder({ orderId: 'ord-b' }),
    ]);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('thead input[type="checkbox"]').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('2 selected');
  });
});
