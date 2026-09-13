import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { StopLossDialogComponent } from './stop-loss-dialog.component';
import { OrderExecutionService } from '../../../savant-trader/services/order-execution.service';
import { EquityPosition } from '../../../../core/robinhood-mcp/types/robinhood-mcp.types';

describe('StopLossDialogComponent', () => {
  let component: StopLossDialogComponent;
  let orderExecution: { submitEquityOrder: jasmine.Spy };
  let dialogRef: { close: jasmine.Spy };

  const position: EquityPosition = {
    symbol: 'AAPL',
    quantity: 100,
    averageBuyPrice: 150,
    sharesHeldForSells: 0,
  };

  beforeEach(async () => {
    orderExecution = {
      submitEquityOrder: jasmine.createSpy('submitEquityOrder'),
    };
    dialogRef = { close: jasmine.createSpy('close') };

    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: { position, currentPrice: 175, accountNumber: 'acc-1' } },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: OrderExecutionService, useValue: orderExecution },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(StopLossDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('pre-fills symbol and quantity from position', () => {
    expect(component.symbol()).toBe('AAPL');
    expect(component.quantity()).toBe('100');
  });

  it('truncates fractional quantity to whole shares', () => {
    const fracPosition: EquityPosition = { ...position, quantity: 100.5 };
    const fracFixture = TestBed.createComponent(StopLossDialogComponent);
    // Override MAT_DIALOG_DATA
    fracFixture.componentRef.injector.get(MAT_DIALOG_DATA).position = fracPosition;
    fracFixture.detectChanges();
    expect(fracFixture.componentInstance.quantity()).toBe('100');
  });

  it('initializes with editing state', () => {
    expect(component.state()).toBe('editing');
  });

  it('calls submitEquityOrder with stop-loss ticket on submit', async () => {
    orderExecution.submitEquityOrder.and.returnValue(Promise.resolve({
      success: true,
      result: { orderId: 'rh-sl-1', state: 'confirmed', brokerOrder: { stopPrice: '160.00' } },
    }));

    await component.onSubmit({ stopPrice: 160 });

    expect(orderExecution.submitEquityOrder).toHaveBeenCalledTimes(1);
    const ticket = orderExecution.submitEquityOrder.calls.mostRecent().args[0];
    expect(ticket.symbol).toBe('AAPL');
    expect(ticket.side).toBe('sell');
    expect(ticket.orderType).toBe('stop_loss');
    expect(ticket.quantity).toBe('100');
    expect(ticket.stopPrice).toBe('160.00');
    expect(ticket.accountNumber).toBe('acc-1');
    expect(ticket.timeInForce).toBe('gtc');
  });

  it('shows success state with order details after successful submit', async () => {
    orderExecution.submitEquityOrder.and.returnValue(Promise.resolve({
      success: true,
      result: { orderId: 'rh-sl-2', state: 'confirmed', brokerOrder: { stopPrice: '155.00' } },
    }));

    await component.onSubmit({ stopPrice: 155 });

    expect(component.state()).toBe('success');
    expect(component.result()?.result?.orderId).toBe('rh-sl-2');
    expect(component.result()?.result?.state).toBe('confirmed');
    expect(component.lastStopPrice()).toBe(155);
  });

  it('shows error state with message after failed submit', async () => {
    orderExecution.submitEquityOrder.and.returnValue(Promise.resolve({
      success: false,
      error: { message: 'Market closed', retryable: false },
    }));

    await component.onSubmit({ stopPrice: 160 });

    expect(component.state()).toBe('error');
    expect(component.error()).toBe('Market closed');
  });

  it('retries with the same ticket (preserving refId idempotency)', async () => {
    orderExecution.submitEquityOrder.and.returnValue(Promise.resolve({
      success: false,
      error: { message: 'Network error', retryable: true },
    }));

    await component.onSubmit({ stopPrice: 160 });
    expect(component.state()).toBe('error');

    const firstTicket = orderExecution.submitEquityOrder.calls.mostRecent().args[0];

    orderExecution.submitEquityOrder.and.returnValue(Promise.resolve({
      success: true,
      result: { orderId: 'rh-sl-3', state: 'confirmed', brokerOrder: { stopPrice: '160.00' } },
    }));

    await component.onRetry();

    expect(orderExecution.submitEquityOrder).toHaveBeenCalledTimes(2);
    const secondTicket = orderExecution.submitEquityOrder.calls.mostRecent().args[0];
    expect(secondTicket).toBe(firstTicket);
    expect(secondTicket.refId).toBe(firstTicket.refId);
    expect(component.state()).toBe('success');
  });

  it('guards against concurrent submission', async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    orderExecution.submitEquityOrder.and.returnValue(
      new Promise((r) => { resolveFirst = r; }),
    );

    component.onSubmit({ stopPrice: 160 });
    component.onRetry();

    expect(orderExecution.submitEquityOrder).toHaveBeenCalledTimes(1);

    resolveFirst({ success: true, result: { orderId: 'rh-sl-1', state: 'confirmed' } });
  });

  it('closes dialog on done', () => {
    component.onDone();
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  it('closes dialog on cancel', () => {
    component.onCancel();
    expect(dialogRef.close).toHaveBeenCalledWith(false);
  });

  it('hides retry button when error is non-retryable', async () => {
    orderExecution.submitEquityOrder.and.returnValue(Promise.resolve({
      success: false,
      error: { message: 'Market closed', retryable: false },
    }));

    await component.onSubmit({ stopPrice: 160 });

    expect(component.canRetry()).toBe(false);
  });
});
