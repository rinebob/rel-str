import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { ClosePositionDialogComponent } from './close-position-dialog.component';
import { OrderExecutionService } from '../../../savant-trader/services/order-execution.service';
import { EquityPosition } from '../../../../core/robinhood-mcp/types/robinhood-mcp.types';

describe('ClosePositionDialogComponent', () => {
  let component: ClosePositionDialogComponent;
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
        { provide: MAT_DIALOG_DATA, useValue: { position, currentPrice: 155, accountNumber: 'acc-1' } },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: OrderExecutionService, useValue: orderExecution },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ClosePositionDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('pre-fills symbol (read-only) and quantity from position', () => {
    expect(component.symbol()).toBe('AAPL');
    expect(component.quantity()).toBe('100');
  });

  it('makes quantity editable', () => {
    expect(component.quantity()).toBe('100');
    component.quantity.set('50');
    expect(component.quantity()).toBe('50');
  });

  it('validates quantity must be positive', () => {
    component.quantity.set('0');
    expect(component.canSubmit()).toBe(false);

    component.quantity.set('-5');
    expect(component.canSubmit()).toBe(false);
  });

  it('validates quantity must not exceed position quantity', () => {
    component.quantity.set('101');
    expect(component.canSubmit()).toBe(false);
  });

  it('allows quantity equal to position quantity', () => {
    component.quantity.set('100');
    expect(component.canSubmit()).toBe(true);
  });

  it('defaults to market order type', () => {
    expect(component.orderType()).toBe('market');
  });

  it('switches between market and limit', () => {
    component.onOrderTypeChange('limit');
    expect(component.orderType()).toBe('limit');
    expect(component.isLimit()).toBe(true);

    component.onOrderTypeChange('market');
    expect(component.isLimit()).toBe(false);
  });

  it('shows limit price field only when limit selected', () => {
    expect(component.isLimit()).toBe(false);

    component.onOrderTypeChange('limit');
    expect(component.isLimit()).toBe(true);
  });

  it('defaults limit price to current price when limit first selected', () => {
    component.onOrderTypeChange('limit');
    expect(component.limitPrice()).toBe('155.00');
  });

  it('calls submitEquityOrder with correct ticket on submit', async () => {
    orderExecution.submitEquityOrder.and.returnValue(Promise.resolve({
      success: true,
      result: { orderId: 'rh-123', state: 'filled', fillPrice: '155.00', filledQuantity: '100' },
    }));

    await component.onSubmit();

    expect(orderExecution.submitEquityOrder).toHaveBeenCalledTimes(1);
    const ticket = orderExecution.submitEquityOrder.calls.mostRecent().args[0];
    expect(ticket.symbol).toBe('AAPL');
    expect(ticket.side).toBe('sell');
    expect(ticket.orderType).toBe('market');
    expect(ticket.quantity).toBe('100');
    expect(ticket.accountNumber).toBe('acc-1');
  });

  it('shows success state with fill details after successful submit', async () => {
    orderExecution.submitEquityOrder.and.returnValue(Promise.resolve({
      success: true,
      result: { orderId: 'rh-456', state: 'filled', fillPrice: '154.50', filledQuantity: '100' },
    }));

    await component.onSubmit();

    expect(component.state()).toBe('success');
    expect(component.result()?.result?.orderId).toBe('rh-456');
    expect(component.result()?.result?.fillPrice).toBe('154.50');
    expect(component.result()?.result?.filledQuantity).toBe('100');
  });

  it('shows error state with message after failed submit', async () => {
    orderExecution.submitEquityOrder.and.returnValue(Promise.resolve({
      success: false,
      error: { message: 'Insufficient buying power', retryable: false },
    }));

    await component.onSubmit();

    expect(component.state()).toBe('error');
    expect(component.error()).toBe('Insufficient buying power');
  });

  it('retries with same parameters on retry', async () => {
    orderExecution.submitEquityOrder.and.returnValue(Promise.resolve({
      success: false,
      error: { message: 'Network error', retryable: true },
    }));

    await component.onSubmit();
    expect(component.state()).toBe('error');

    // Retry
    orderExecution.submitEquityOrder.and.returnValue(Promise.resolve({
      success: true,
      result: { orderId: 'rh-789', state: 'filled', fillPrice: '155.00', filledQuantity: '100' },
    }));

    await component.onRetry();

    expect(orderExecution.submitEquityOrder).toHaveBeenCalledTimes(2);
    expect(component.state()).toBe('success');
  });

  it('closes dialog on done', () => {
    component.onDone();
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  it('closes dialog on cancel', () => {
    component.onCancel();
    expect(dialogRef.close).toHaveBeenCalledWith(false);
  });

  it('includes limitPrice in ticket when limit order submitted', async () => {
    component.onOrderTypeChange('limit');
    component.limitPrice.set('160.00');

    orderExecution.submitEquityOrder.and.returnValue(Promise.resolve({
      success: true,
      result: { orderId: 'rh-lim-1', state: 'filled', fillPrice: '160.00', filledQuantity: '100' },
    }));

    await component.onSubmit();

    const ticket = orderExecution.submitEquityOrder.calls.mostRecent().args[0];
    expect(ticket.orderType).toBe('limit');
    expect(ticket.limitPrice).toBe('160.00');
  });

  it('hides retry button when error is non-retryable', async () => {
    orderExecution.submitEquityOrder.and.returnValue(Promise.resolve({
      success: false,
      error: { message: 'Insufficient buying power', retryable: false },
    }));

    await component.onSubmit();

    expect(component.state()).toBe('error');
    expect(component.canRetry()).toBe(false);
  });
});
