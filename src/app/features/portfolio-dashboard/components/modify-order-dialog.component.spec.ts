import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';

import {
  ModifyOrderDialogComponent,
  ModifyOrderDialogData,
} from './modify-order-dialog.component';
import { BrokerOrder } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';

function makeOrder(overrides: Partial<BrokerOrder> = {}): BrokerOrder {
  return {
    orderId: 'ord-1',
    accountNumber: '123',
    instrumentType: 'equity',
    symbol: 'AAPL',
    side: 'buy',
    type: 'limit',
    state: 'queued',
    quantity: 10,
    cumulativeQuantity: 0,
    price: 170,
    stopPrice: null,
    averageFillPrice: null,
    createdAt: null,
    ...overrides,
  };
}

function createComponent(data: ModifyOrderDialogData) {
  TestBed.configureTestingModule({
    imports: [ModifyOrderDialogComponent],
    providers: [provideNoopAnimations(), { provide: MAT_DIALOG_DATA, useValue: data }],
  });
  const fixture = TestBed.createComponent(ModifyOrderDialogComponent);
  return fixture;
}

describe('ModifyOrderDialogComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('initializes the price input to the order limit', () => {
    const fixture = createComponent({ order: makeOrder({ price: 170 }), markPrice: null });
    expect(fixture.componentInstance.price()).toBe(170);
  });

  it('rejects a same-price modify — the cancel burns queue priority for a no-op', () => {
    const fixture = createComponent({ order: makeOrder({ price: 170 }), markPrice: null });
    fixture.detectChanges();

    fixture.componentInstance.price.set(170);
    expect(fixture.componentInstance.valid()).toBe(false);
    expect(
      fixture.nativeElement.querySelector('[data-testid="modify-confirm"]')?.disabled,
    ).toBe(true);
  });

  it('accepts a changed positive price', () => {
    const fixture = createComponent({ order: makeOrder({ price: 170 }), markPrice: null });
    fixture.componentInstance.price.set(180.5);
    expect(fixture.componentInstance.valid()).toBe(true);
  });

  it.each([0, -5, NaN])('rejects a non-positive or non-finite price (%s)', (p) => {
    const fixture = createComponent({ order: makeOrder({ price: 170 }), markPrice: null });
    fixture.componentInstance.price.set(p);
    expect(fixture.componentInstance.valid()).toBe(false);
  });

  it('renders the mark when a quote was passed', () => {
    const fixture = createComponent({ order: makeOrder(), markPrice: 180.25 });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.mod-context').textContent).toContain(
      'mark $180.25',
    );
  });

  it('renders no mark segment when the quote is unavailable', () => {
    const fixture = createComponent({ order: makeOrder(), markPrice: null });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.mod-context').textContent).not.toContain(
      'mark',
    );
  });
});
