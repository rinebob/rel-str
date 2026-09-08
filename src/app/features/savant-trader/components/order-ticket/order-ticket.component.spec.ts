import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signal } from '@angular/core';
import { of } from 'rxjs';

import { OrderTicketComponent } from './order-ticket.component';
import { OrderTicketStore } from '../../stores/order-ticket.store';
import { OrderExecutionService } from '../../services/order-execution.service';
import { InstrumentType, OrderTicket, OrderTicketStatus, OrderSource, TradingConfig } from '../../services/order-ticket.types';

function makeTicket(id: string, symbol = 'AAPL', overrides: Partial<OrderTicket> = {}): OrderTicket {
  return {
    id,
    refId: `ref-${id}`,
    source: OrderSource.SIGNAL_PIPELINE,
    status: OrderTicketStatus.STAGED,
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
  } as OrderTicket;
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
    tickets: ReturnType<typeof signal<Record<string, OrderTicket>>>;
    submitTicket: jasmine.Spy;
    updateTicket: jasmine.Spy;
    stageTicket: jasmine.Spy;
  };
  let dialog: { open: jasmine.Spy };
  let orderExecution: any;

  beforeEach(async () => {
    store = {
      tickets: signal<Record<string, OrderTicket>>({}),
      submitTicket: jasmine.createSpy('submitTicket'),
      updateTicket: jasmine.createSpy('updateTicket'),
      stageTicket: jasmine.createSpy('stageTicket'),
    };
    dialog = {
      open: jasmine.createSpy('open').and.returnValue({ afterClosed: () => of(true) }),
    };
    orderExecution = {
      submitEquityOrder: jasmine.createSpy('submitEquityOrder').and.returnValue(
        Promise.resolve({ success: true, result: { orderId: 'sl-1', state: 'confirmed' } }),
      ),
      cancelEquityOrder: jasmine.createSpy('cancelEquityOrder').and.returnValue(
        Promise.resolve({ success: true }),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [OrderTicketComponent],
      providers: [
        provideNoopAnimations(),
        { provide: OrderTicketStore, useValue: store },
        { provide: OrderExecutionService, useValue: orderExecution },
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
    fixture.componentRef.setInput('ticket', makeTicket('1'));
    fixture.componentRef.setInput('price', 50);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Qty');
    expect(fixture.nativeElement.textContent).not.toContain('$ Amt');
    expect(fixture.nativeElement.querySelector('.pill-group')).toBeTruthy();
  });

  it('derives an 8% stop price from the fill price after entry fills', () => {
    fixture.componentRef.setInput('ticket', makeTicket('1', 'AAPL', {
      status: OrderTicketStatus.FILLED,
      result: { fillPrice: '100.00', filledQuantity: '2' },
    }));
    fixture.componentRef.setInput('price', 100);
    fixture.detectChanges();

    expect(component.stopLossPercent()).toBe('8');
    expect(component.stopLossPrice()).toBe('92.00');
    expect(fixture.nativeElement.querySelector('.stop-loss-section')).toBeTruthy();
  });

  it('recalculates the default stop when selection changes', () => {
    fixture.componentRef.setInput('ticket', makeTicket('1', 'AAPL', {
      status: OrderTicketStatus.FILLED,
      result: { fillPrice: '100.00', filledQuantity: '2' },
    }));
    fixture.componentRef.setInput('price', 100);
    fixture.detectChanges();
    component.stopLossPrice.set('95.00');

    fixture.componentRef.setInput('ticket', makeTicket('2', 'DELL', {
      status: OrderTicketStatus.FILLED,
      result: { fillPrice: '200.00', filledQuantity: '2' },
    }));
    fixture.componentRef.setInput('price', 200);
    fixture.detectChanges();

    expect(component.stopLossPrice()).toBe('184.00');
    expect(component.stopLossPercent()).toBe('8');
  });

  it('removes stale notional amount from the saved whole-share ticket', () => {
    fixture.componentRef.setInput('ticket', makeTicket('1', 'AAPL', { dollarAmount: '500' }));
    fixture.componentRef.setInput('price', 50);
    fixture.detectChanges();

    component.saveEdits();

    expect(store.updateTicket).toHaveBeenCalledWith('1', jasmine.objectContaining({
      quantity: '2',
      dollarAmount: undefined,
    }));
  });

  it('shows price and status beside the symbol', () => {
    fixture.componentRef.setInput('ticket', makeTicket('1'));
    fixture.componentRef.setInput('price', 123.45);
    fixture.detectChanges();

    const header = fixture.nativeElement.querySelector('.ticket-symbol');
    expect(header.textContent).toContain('AAPL');
    expect(header.textContent).toContain('$123.45');
    expect(header.textContent).toContain('STAGED');
  });

  it('opens confirmation and submits using the configured account', async () => {
    fixture.componentRef.setInput('ticket', makeTicket('1'));
    fixture.componentRef.setInput('price', 50);
    fixture.detectChanges();

    await component.onSubmit();

    expect(dialog.open).toHaveBeenCalled();
    expect(store.submitTicket).toHaveBeenCalledWith('1');
  });

  it('confirms and submits a stop loss directly to RH after the entry fills', async () => {
    const entry = makeTicket('1', 'AAPL', { status: OrderTicketStatus.FILLED, result: { fillPrice: '100', filledQuantity: '2' } });
    fixture.componentRef.setInput('ticket', entry);
    fixture.componentRef.setInput('price', 100);
    fixture.detectChanges();

    await component.onPlaceStopLoss();

    expect(dialog.open).toHaveBeenCalled();
    expect(orderExecution.submitEquityOrder).toHaveBeenCalledWith(jasmine.objectContaining({
      side: 'sell',
      quantity: '2',
      stopPrice: '92.00',
      timeInForce: 'gtc',
    }));
  });
});
