import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { OpenOrdersTableComponent } from './open-orders-table.component';
import {
  BrokerOrder,
  BrokerOrderLeg,
} from '../../../core/robinhood-mcp/types/robinhood-mcp.types';

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

function makeLeg(overrides: Partial<BrokerOrderLeg> = {}): BrokerOrderLeg {
  return {
    side: 'buy',
    optionId: 'x',
    quantity: 1,
    positionEffect: 'open',
    strikePrice: null,
    expirationDate: null,
    optionType: null,
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

    const rows = fixture.nativeElement.querySelectorAll('tbody tr:not(.pd-group-row)');
    expect(rows.length).toBe(2);
  });

  it('filters out sell-side orders (position-closing, incl. stop-loss)', () => {
    fixture.componentRef.setInput('orders', [
      makeOrder({ orderId: 'ord-1', symbol: 'AAPL', side: 'buy' }),
      makeOrder({ orderId: 'ord-2', symbol: 'MSFT', side: 'sell', type: 'stop_market' }),
      makeOrder({ orderId: 'ord-3', symbol: 'NVDA', side: 'sell', type: 'limit' }),
    ]);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr:not(.pd-group-row)');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('AAPL');
  });

  it('filters option orders by leg positionEffect when present', () => {
    fixture.componentRef.setInput('orders', [
      makeOrder({
        orderId: 'ord-open',
        instrumentType: 'option',
        symbol: 'AAPL',
        legs: [makeLeg({ optionId: 'x' })],
      }),
      makeOrder({
        orderId: 'ord-close',
        instrumentType: 'option',
        symbol: 'MSFT',
        side: 'sell',
        legs: [makeLeg({ side: 'sell', optionId: 'y', positionEffect: 'close' })],
      }),
    ]);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr:not(.pd-group-row)');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('AAPL');
  });

  it('separates equity and option orders into labelled groups (#1411)', () => {
    fixture.componentRef.setInput('orders', [
      makeOrder({ orderId: 'ord-eq', symbol: 'NFLX' }),
      makeOrder({
        orderId: 'ord-opt',
        instrumentType: 'option',
        symbol: 'NFLX',
        legs: [
          makeLeg({
            strikePrice: 15,
            expirationDate: '2026-11-20',
            optionType: 'call',
          }),
        ],
      }),
    ]);
    fixture.detectChanges();

    const labels = [...fixture.nativeElement.querySelectorAll('.pd-group-label')]
      .map((el) => (el as HTMLElement).textContent?.trim());
    expect(labels[0]).toContain('Equity Orders');
    expect(labels[1]).toContain('Option Orders');

    // Same underlying stays unambiguous: bare ticker vs contract label.
    const symbols = [...fixture.nativeElement.querySelectorAll('.pd-symbol')]
      .map((el) => (el as HTMLElement).textContent?.trim());
    expect(symbols[0]).toBe('NFLX');
    expect(symbols[1]).toBe('NFLX $15.00 C 2026-11-20');
  });

  it('collapses and re-expands a group from its header', () => {
    fixture.componentRef.setInput('orders', [
      makeOrder({ orderId: 'ord-eq', symbol: 'AAPL' }),
      makeOrder({
        orderId: 'ord-opt',
        instrumentType: 'option',
        symbol: 'MSFT',
        legs: [makeLeg()],
      }),
    ]);
    fixture.detectChanges();

    const toggles = fixture.nativeElement.querySelectorAll('.pd-group-toggle');
    const equityToggle = toggles[0] as HTMLElement;
    const optionToggle = toggles[1] as HTMLElement;

    equityToggle.click();
    fixture.detectChanges();

    // Only the option row remains; the collapsed header + count persist.
    const rows = fixture.nativeElement.querySelectorAll('tbody tr:not(.pd-group-row)');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('MSFT');
    expect(equityToggle.textContent).toContain('Equity Orders');
    expect(optionToggle.textContent).toContain('Option Orders');

    equityToggle.click();
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

  it('declares the opening-only scope so excluded closing orders are explainable (#1411)', () => {
    fixture.componentRef.setInput('orders', [makeOrder({ side: 'buy' })]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.pd-scope-note')?.textContent)
      .toContain('Opening orders only');
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
      fixture.nativeElement.querySelectorAll('tbody tr:not(.pd-group-row) td.num').length,
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
        legs: [makeLeg({ optionId: 'opt-uuid-1' })],
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
          makeLeg({ optionId: 'opt-1' }),
          makeLeg({ side: 'sell', optionId: 'opt-2' }),
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
        legs: [makeLeg()],
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
