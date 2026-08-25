import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { OrderTicketComponent } from './order-ticket.component';
import { OrderStagingStore } from '../../stores/order-staging.store';
import { TradingConfigService } from '../../services/trading-config.service';
import {
  OrderIntent,
  OrderIntentStatus,
  OrderSource,
  InstrumentType,
} from '../../services/order-intent.types';

function makeIntent(
  id: string,
  status: OrderIntentStatus = OrderIntentStatus.STAGED,
  overrides: Partial<OrderIntent> = {},
): OrderIntent {
  return {
    id,
    refId: `ref-${id}`,
    source: OrderSource.SIGNAL_PIPELINE,
    status,
    accountNumber: '123456789',
    side: 'buy',
    orderType: 'market',
    timeInForce: 'gfd',
    marketHours: 'regular_hours',
    instrumentType: InstrumentType.EQUITY,
    symbol: 'AAPL',
    quantity: '100',
    createdAt: '2026-08-25T12:00:00Z',
    updatedAt: '2026-08-25T12:00:00Z',
    ...overrides,
  } as OrderIntent;
}

describe('OrderTicketComponent', () => {
  let fixture: ComponentFixture<OrderTicketComponent>;
  let component: OrderTicketComponent;
  let storeMock: any;
  let configServiceMock: any;
  let dialogMock: any;
  let snackBarMock: any;

  beforeEach(async () => {
    storeMock = {
      submitIntent: jasmine.createSpy('submitIntent'),
      retryIntent: jasmine.createSpy('retryIntent'),
      cancelIntent: jasmine.createSpy('cancelIntent'),
      updateIntent: jasmine.createSpy('updateIntent'),
    };

    configServiceMock = {
      loadConfig: jasmine.createSpy('loadConfig').and.returnValue(of({ accountNumber: '123456789', updatedAt: '2026-08-25T12:00:00Z' })),
    };

    dialogMock = {
      open: jasmine.createSpy('open').and.returnValue({
        afterClosed: () => of(true),
      }),
    };

    snackBarMock = {
      open: jasmine.createSpy('open'),
    };

    await TestBed.configureTestingModule({
      imports: [OrderTicketComponent],
      providers: [
        provideNoopAnimations(),
        { provide: OrderStagingStore, useValue: storeMock },
        { provide: TradingConfigService, useValue: configServiceMock },
        { provide: MatDialog, useValue: dialogMock },
        { provide: MatSnackBar, useValue: snackBarMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrderTicketComponent);
    component = fixture.componentInstance;
  });

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  it('loads trading config on init', () => {
    component.ngOnInit();
    expect(configServiceMock.loadConfig).toHaveBeenCalledTimes(1);
  });

  describe('no selection', () => {
    it('shows no-selection message when intent is null', () => {
      fixture.componentRef.setInput('intent', null);
      fixture.detectChanges();

      const noSelection = fixture.nativeElement.querySelector('.no-selection');
      expect(noSelection).toBeTruthy();
      expect(noSelection.textContent).toContain('Select an order');
    });
  });

  describe('ticket rendering', () => {
    it('shows symbol and side when intent is provided', () => {
      fixture.componentRef.setInput('intent', makeIntent('1'));
      fixture.detectChanges();

      const header = fixture.nativeElement.querySelector('.ticket-header');
      expect(header.textContent).toContain('AAPL');
      expect(header.textContent).toContain('BUY');
    });

    it('shows account number when configured', () => {
      fixture.componentRef.setInput('intent', makeIntent('1'));
      component.ngOnInit();
      fixture.detectChanges();

      const account = fixture.nativeElement.querySelector('.account-section');
      expect(account.textContent).toContain('123456789');
    });

    it('shows account warning when not configured', () => {
      configServiceMock.loadConfig.and.returnValue(of(null));
      fixture.componentRef.setInput('intent', makeIntent('1'));
      component.ngOnInit();
      fixture.detectChanges();

      const warning = fixture.nativeElement.querySelector('.account-warning');
      expect(warning).toBeTruthy();
      expect(warning.textContent).toContain('No account number configured');
    });

    it('shows editable form when intent is STAGED', () => {
      fixture.componentRef.setInput('intent', makeIntent('1', OrderIntentStatus.STAGED));
      fixture.detectChanges();

      const form = fixture.nativeElement.querySelector('.form-section');
      expect(form).toBeTruthy();
    });

    it('hides editable form when intent is SUBMITTED', () => {
      fixture.componentRef.setInput('intent', makeIntent('1', OrderIntentStatus.SUBMITTED));
      fixture.detectChanges();

      const form = fixture.nativeElement.querySelector('.form-section');
      expect(form).toBeFalsy();
    });

    it('shows live preview section', () => {
      fixture.componentRef.setInput('intent', makeIntent('1'));
      fixture.detectChanges();

      const preview = fixture.nativeElement.querySelector('.preview-section');
      expect(preview).toBeTruthy();
    });

    it('shows submit button when editable', () => {
      fixture.componentRef.setInput('intent', makeIntent('1', OrderIntentStatus.STAGED));
      fixture.detectChanges();

      const submitBtn = fixture.nativeElement.querySelector('button[color="primary"]');
      expect(submitBtn).toBeTruthy();
      expect(submitBtn.textContent).toContain('Submit Order');
    });

    it('shows status section with current status', () => {
      fixture.componentRef.setInput('intent', makeIntent('1', OrderIntentStatus.SUBMITTED));
      fixture.detectChanges();

      const status = fixture.nativeElement.querySelector('.status-section');
      expect(status).toBeTruthy();
      expect(status.textContent).toContain('SUBMITTED');
    });
  });

  describe('submit flow', () => {
    it('opens confirmation dialog and submits on confirm', async () => {
      const intent = makeIntent('1', OrderIntentStatus.STAGED);
      fixture.componentRef.setInput('intent', intent);
      component.ngOnInit();
      fixture.detectChanges();

      await component.onSubmit();

      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      expect(storeMock.submitIntent).toHaveBeenCalledWith('1');
    });

    it('does not submit when dialog is cancelled', async () => {
      dialogMock.open.and.returnValue({
        afterClosed: () => of(false),
      });
      fixture.componentRef.setInput('intent', makeIntent('1', OrderIntentStatus.STAGED));
      component.ngOnInit();
      fixture.detectChanges();

      await component.onSubmit();

      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      expect(storeMock.submitIntent).not.toHaveBeenCalled();
    });

    it('shows snackbar and does not submit when no account configured', async () => {
      configServiceMock.loadConfig.and.returnValue(of(null));
      fixture.componentRef.setInput('intent', makeIntent('1', OrderIntentStatus.STAGED));
      component.ngOnInit();
      fixture.detectChanges();

      await component.onSubmit();

      expect(snackBarMock.open).toHaveBeenCalled();
      expect(storeMock.submitIntent).not.toHaveBeenCalled();
    });

    it('saves edits before submitting', async () => {
      const intent = makeIntent('1', OrderIntentStatus.STAGED);
      fixture.componentRef.setInput('intent', intent);
      component.ngOnInit();
      fixture.detectChanges();

      component.orderType.set('limit');
      component.limitPrice.set('150.00');

      await component.onSubmit();

      expect(storeMock.updateIntent).toHaveBeenCalledWith('1', jasmine.objectContaining({
        orderType: 'limit',
        limitPrice: '150.00',
      }));
    });

    it('passes edited values to confirmation dialog', async () => {
      const intent = makeIntent('1', OrderIntentStatus.STAGED);
      fixture.componentRef.setInput('intent', intent);
      component.ngOnInit();
      fixture.detectChanges();

      component.orderType.set('limit');
      component.limitPrice.set('175.50');
      component.quantity.set('200');

      await component.onSubmit();

      expect(dialogMock.open).toHaveBeenCalled();
      const dialogData = dialogMock.open.calls.mostRecent().args[1].data;
      expect(dialogData.intent.orderType).toBe('limit');
      expect(dialogData.intent.limitPrice).toBe('175.50');
      expect(dialogData.intent.quantity).toBe('200');
    });
  });

  describe('retry', () => {
    it('calls retryIntent for retryable FAILED intent', () => {
      const intent = makeIntent('1', OrderIntentStatus.FAILED, {
        error: { message: 'Network error', retryable: true },
      });
      fixture.componentRef.setInput('intent', intent);
      fixture.detectChanges();

      component.onRetry();

      expect(storeMock.retryIntent).toHaveBeenCalledWith('1');
    });

    it('does not call retryIntent for non-retryable FAILED intent', () => {
      const intent = makeIntent('1', OrderIntentStatus.FAILED, {
        error: { message: 'Insufficient buying power', retryable: false },
      });
      fixture.componentRef.setInput('intent', intent);
      fixture.detectChanges();

      component.onRetry();

      expect(storeMock.retryIntent).not.toHaveBeenCalled();
    });

    it('does not call retryIntent for non-FAILED intent', () => {
      fixture.componentRef.setInput('intent', makeIntent('1', OrderIntentStatus.STAGED));
      fixture.detectChanges();

      component.onRetry();

      expect(storeMock.retryIntent).not.toHaveBeenCalled();
    });

    it('shows retry button for retryable FAILED intent', () => {
      const intent = makeIntent('1', OrderIntentStatus.FAILED, {
        error: { message: 'Network error', retryable: true },
      });
      fixture.componentRef.setInput('intent', intent);
      fixture.detectChanges();

      const retryBtn = fixture.nativeElement.querySelector('button[color="primary"]');
      // The retry button is a stroked button, not flat — check by text
      const buttons = fixture.nativeElement.querySelectorAll('button');
      const retryBtnText = Array.from(buttons).find((b: any) => b.textContent.includes('Retry'));
      expect(retryBtnText).toBeTruthy();
    });

    it('shows error section with message for FAILED intent', () => {
      const intent = makeIntent('1', OrderIntentStatus.FAILED, {
        error: { message: 'Insufficient buying power', retryable: false },
      });
      fixture.componentRef.setInput('intent', intent);
      fixture.detectChanges();

      const error = fixture.nativeElement.querySelector('.error-section');
      expect(error).toBeTruthy();
      expect(error.textContent).toContain('Insufficient buying power');
      expect(error.textContent).toContain('not retryable');
    });
  });

  describe('cancel', () => {
    it('calls cancelIntent for SUBMITTED intent', () => {
      fixture.componentRef.setInput('intent', makeIntent('1', OrderIntentStatus.SUBMITTED));
      fixture.detectChanges();

      component.onCancel();

      expect(storeMock.cancelIntent).toHaveBeenCalledWith('1');
    });

    it('calls cancelIntent for SUBMITTING intent', () => {
      fixture.componentRef.setInput('intent', makeIntent('1', OrderIntentStatus.SUBMITTING));
      fixture.detectChanges();

      component.onCancel();

      expect(storeMock.cancelIntent).toHaveBeenCalledWith('1');
    });

    it('does not call cancelIntent for STAGED intent', () => {
      fixture.componentRef.setInput('intent', makeIntent('1', OrderIntentStatus.STAGED));
      fixture.detectChanges();

      component.onCancel();

      expect(storeMock.cancelIntent).not.toHaveBeenCalled();
    });

    it('shows cancel button for SUBMITTED intent', () => {
      fixture.componentRef.setInput('intent', makeIntent('1', OrderIntentStatus.SUBMITTED));
      fixture.detectChanges();

      const buttons = fixture.nativeElement.querySelectorAll('button');
      const cancelBtn = Array.from(buttons).find((b: any) => b.textContent.includes('Cancel Order'));
      expect(cancelBtn).toBeTruthy();
    });
  });

  describe('new manual order', () => {
    it('shows snackbar placeholder', () => {
      component.onNewManualOrder();
      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Manual order creation coming soon',
        'Dismiss',
        { duration: 3000 },
      );
    });
  });

  describe('order type field visibility', () => {
    it('shows limit price when order type is limit', () => {
      fixture.componentRef.setInput('intent', makeIntent('1', OrderIntentStatus.STAGED));
      fixture.detectChanges();

      component.orderType.set('limit');
      fixture.detectChanges();
      // Wait for the @if block to render
      fixture.detectChanges();

      expect(component.showLimitPrice()).toBe(true);
    });

    it('hides limit price when order type is market', () => {
      fixture.componentRef.setInput('intent', makeIntent('1', OrderIntentStatus.STAGED));
      fixture.detectChanges();

      component.orderType.set('market');
      fixture.detectChanges();

      expect(component.showLimitPrice()).toBe(false);
    });
  });
});
