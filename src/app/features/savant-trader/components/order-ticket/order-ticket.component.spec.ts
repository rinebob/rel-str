import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signal } from '@angular/core';
import { of } from 'rxjs';

import { OrderTicketComponent } from './order-ticket.component';
import { OrderStagingStore } from '../../stores/order-staging.store';
import { InstrumentType, OrderIntent, OrderIntentStatus, OrderSource, TradingConfig } from '../../services/order-intent.types';

function makeIntent(id: string, symbol = 'AAPL', overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    id,
    refId: `ref-${id}`,
    source: OrderSource.SIGNAL_PIPELINE,
    status: OrderIntentStatus.STAGED,
    accountNumber: 'agentic-account',
    side: 'buy',
    orderType: 'market',
    timeInForce: 'gfd',
    marketHours: 'regular_hours',
    instrumentType: InstrumentType.EQUITY,
    symbol,
    quantity: '2',
    createdAt: '2026-08-25T12:00:00Z',
    updatedAt: '2026-08-25T12:00:00Z',
    ...overrides,
  } as OrderIntent;
}

const config: TradingConfig = {
  accountNumber: 'agentic-account',
  defaultDollarAmount: 100,
  maxUnits: 200,
  maxAllocationPercent: 80,
  updatedAt: '2026-08-25T12:00:00Z',
};

describe('OrderTicketComponent', () => {
  let fixture: ComponentFixture<OrderTicketComponent>;
  let component: OrderTicketComponent;
  let store: {
    intents: ReturnType<typeof signal<Record<string, OrderIntent>>>;
    submitIntent: jasmine.Spy;
    retryIntent: jasmine.Spy;
    cancelIntent: jasmine.Spy;
    modifyIntent: jasmine.Spy;
    updateIntent: jasmine.Spy;
    stageIntent: jasmine.Spy;
  };
  let dialog: { open: jasmine.Spy };

  beforeEach(async () => {
    store = {
      intents: signal<Record<string, OrderIntent>>({}),
      submitIntent: jasmine.createSpy('submitIntent'),
      retryIntent: jasmine.createSpy('retryIntent'),
      cancelIntent: jasmine.createSpy('cancelIntent'),
      modifyIntent: jasmine.createSpy('modifyIntent'),
      updateIntent: jasmine.createSpy('updateIntent'),
      stageIntent: jasmine.createSpy('stageIntent'),
    };
    dialog = {
      open: jasmine.createSpy('open').and.returnValue({ afterClosed: () => of(true) }),
    };

    await TestBed.configureTestingModule({
      imports: [OrderTicketComponent],
      providers: [
        provideNoopAnimations(),
        { provide: OrderStagingStore, useValue: store },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: { open: jasmine.createSpy('open') } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrderTicketComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('tradingConfig', config);
    fixture.componentRef.setInput('guardrailContext', {
      currentExposure: 1000,
      currentUnits: 10,
      availableCash: 9000,
      allocationCap: 8000,
      maxUnits: 200,
    });
  });

  it('renders compact whole-share controls without a dollar amount field', () => {
    fixture.componentRef.setInput('intent', makeIntent('1'));
    fixture.componentRef.setInput('price', 50);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.compact-field').textContent).toContain('Qty');
    expect(fixture.nativeElement.textContent).not.toContain('$ Amt');
    expect(fixture.nativeElement.querySelector('.pill-group')).toBeTruthy();
  });

  it('derives an 8% stop price from the selected symbol price', () => {
    fixture.componentRef.setInput('intent', makeIntent('1'));
    fixture.componentRef.setInput('price', 100);
    fixture.detectChanges();

    expect(component.stopLossPercent()).toBe('8');
    expect(component.stopLossPrice()).toBe('92.00');
    expect(fixture.nativeElement.querySelector('.stop-loss-section')).toBeTruthy();
  });

  it('recalculates the default stop when selection changes', () => {
    fixture.componentRef.setInput('intent', makeIntent('1', 'AAPL'));
    fixture.componentRef.setInput('price', 100);
    fixture.detectChanges();
    component.stopLossPrice.set('95.00');

    fixture.componentRef.setInput('intent', makeIntent('2', 'DELL'));
    fixture.componentRef.setInput('price', 200);
    fixture.detectChanges();

    expect(component.stopLossPrice()).toBe('184.00');
    expect(component.stopLossPercent()).toBe('8');
  });

  it('removes stale notional amount from the saved whole-share intent', () => {
    fixture.componentRef.setInput('intent', makeIntent('1', 'AAPL', { dollarAmount: '500' }));
    fixture.componentRef.setInput('price', 50);
    fixture.detectChanges();

    component.saveEdits();

    expect(store.updateIntent).toHaveBeenCalledWith('1', jasmine.objectContaining({
      quantity: '2',
      dollarAmount: undefined,
    }));
  });

  it('shows price and status beside the symbol', () => {
    fixture.componentRef.setInput('intent', makeIntent('1'));
    fixture.componentRef.setInput('price', 123.45);
    fixture.detectChanges();

    const header = fixture.nativeElement.querySelector('.ticket-symbol');
    expect(header.textContent).toContain('AAPL');
    expect(header.textContent).toContain('$123.45');
    expect(header.textContent).toContain('STAGED');
  });

  it('opens confirmation and submits using the configured account', async () => {
    fixture.componentRef.setInput('intent', makeIntent('1'));
    fixture.componentRef.setInput('price', 50);
    fixture.detectChanges();

    await component.onSubmit();

    expect(dialog.open).toHaveBeenCalled();
    expect(store.submitIntent).toHaveBeenCalledWith('1');
  });

  it('stages a same-quantity stop loss after the entry fills', () => {
    const entry = makeIntent('1', 'AAPL', { status: OrderIntentStatus.FILLED, result: { fillPrice: '100' } });
    fixture.componentRef.setInput('intent', entry);
    fixture.componentRef.setInput('price', 100);
    fixture.detectChanges();

    component.onPlaceStopLoss();

    expect(store.stageIntent).toHaveBeenCalledWith(jasmine.objectContaining({
      side: 'sell',
      quantity: '2',
      stopPrice: '92.00',
      timeInForce: 'gtc',
    }));
  });
});
