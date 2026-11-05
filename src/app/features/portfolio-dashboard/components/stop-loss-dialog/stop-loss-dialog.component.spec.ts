import { TestBed } from '@angular/core/testing';
import { DS_DIALOG_DATA, DsDialogRef } from '../../../../shared/ds/ds-dialog';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';


import { StopLossDialogComponent } from './stop-loss-dialog.component';
import { OrderExecutionService } from '../../../savant-trader/services/order-execution.service';
import { BrokerOrder, EquityPosition } from '../../../../core/robinhood-mcp/types/robinhood-mcp.types';
import { EquityOrderTicket } from '../../../savant-trader/services/order-ticket.types';
import { StopLossFormComponent } from '../../../../shared/components/stop-loss-form/stop-loss-form.component';

describe('StopLossDialogComponent', () => {
  let component: StopLossDialogComponent;
  let orderExecution: { submitEquityOrder: jasmine.Spy };
  let dialogRef: { close: jasmine.Spy; disableClose?: boolean };

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
        { provide: DS_DIALOG_DATA, useValue: { position, currentPrice: 175, accountNumber: 'acc-1' } },
        { provide: DsDialogRef, useValue: dialogRef },
        { provide: OrderExecutionService, useValue: orderExecution },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(StopLossDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('pre-fills symbol and quantity from position', () => {
    expect(component.symbol).toBe('AAPL');
    expect(component.quantity).toBe('100');
  });

  it('truncates fractional quantity to whole shares', async () => {
    // quantity is a plain field evaluated at construction — the fractional
    // position must be injected BEFORE createComponent.
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        {
          provide: DS_DIALOG_DATA,
          useValue: {
            position: { ...position, quantity: 100.5 },
            currentPrice: 175,
            accountNumber: 'acc-1',
          },
        },
        { provide: DsDialogRef, useValue: dialogRef },
        { provide: OrderExecutionService, useValue: orderExecution },
      ],
    }).compileComponents();
    const fracFixture = TestBed.createComponent(StopLossDialogComponent);
    expect(fracFixture.componentInstance.quantity).toBe('100');
  });

  it('initializes with editing state', () => {
    expect(component.state()).toBe('editing');
  });

  it('calls submitEquityOrder with stop-loss ticket on submit', async () => {
    orderExecution.submitEquityOrder.and.returnValue(Promise.resolve({
      success: true,
      result: { orderId: 'rh-sl-1', state: 'confirmed', brokerOrder: { stopPrice: '160.00' } },
    }));

    await component.onSubmit({ stopPrice: 160, timeInForce: 'gtc', marketHours: 'regular_hours' });

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

  it('carries the form-emitted TIF but pins hours to regular — RH rejects extended-hours stops (#886)', async () => {
    orderExecution.submitEquityOrder.and.returnValue(Promise.resolve({
      success: true,
      result: { orderId: 'rh-sl-9', state: 'confirmed' },
    }));

    await component.onSubmit({ stopPrice: 160, timeInForce: 'gfd', marketHours: 'extended_hours' });

    const ticket = orderExecution.submitEquityOrder.calls.mostRecent().args[0];
    expect(ticket.timeInForce).toBe('gfd');
    expect(ticket.marketHours).toBe('regular_hours');
  });

  it('shows success state with order details after successful submit', async () => {
    orderExecution.submitEquityOrder.and.returnValue(Promise.resolve({
      success: true,
      result: { orderId: 'rh-sl-2', state: 'confirmed', brokerOrder: { stopPrice: '155.00' } },
    }));

    await component.onSubmit({ stopPrice: 155, timeInForce: 'gtc', marketHours: 'regular_hours' });

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

    await component.onSubmit({ stopPrice: 160, timeInForce: 'gtc', marketHours: 'regular_hours' });

    expect(component.state()).toBe('error');
    expect(component.error()).toBe('Market closed');
  });

  it('retries with the same ticket (preserving refId idempotency)', async () => {
    orderExecution.submitEquityOrder.and.returnValue(Promise.resolve({
      success: false,
      error: { message: 'Network error', retryable: true },
    }));

    await component.onSubmit({ stopPrice: 160, timeInForce: 'gtc', marketHours: 'regular_hours' });
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

    component.onSubmit({ stopPrice: 160, timeInForce: 'gtc', marketHours: 'regular_hours' });
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

  it('closes true on cancel after a submission attempt so the dashboard refreshes', async () => {
    // A failed/ambiguous placement may still have registered broker-side —
    // dismissing must not leave the reopened view on a stale position.
    orderExecution.submitEquityOrder.and.returnValue(Promise.resolve({
      success: false,
      error: { message: 'placement unconfirmed — no order id in response', code: 'PLACEMENT_UNCONFIRMED', retryable: true },
    }));

    await component.onSubmit({ stopPrice: 160, timeInForce: 'gtc', marketHours: 'regular_hours' });
    component.onCancel();

    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  it('blocks dismiss once a submission runs — in flight and after', async () => {
    let resolveSubmit!: (v: unknown) => void;
    orderExecution.submitEquityOrder.and.returnValue(
      new Promise((r) => { resolveSubmit = r; }),
    );

    const submit = component.onSubmit({ stopPrice: 160, timeInForce: 'gtc', marketHours: 'regular_hours' });
    await Promise.resolve();
    expect(dialogRef.disableClose).toBe(true);

    resolveSubmit({ success: true, result: { orderId: 'rh-x', state: 'confirmed' } });
    await submit;
    // Stays disabled after settle — the order registered, so an ESC/backdrop
    // dismiss would skip the refresh; only Cancel/Done (both close true) exit.
    expect(dialogRef.disableClose).toBe(true);
  });

  it('hides retry button when error is non-retryable', async () => {
    orderExecution.submitEquityOrder.and.returnValue(Promise.resolve({
      success: false,
      error: { message: 'Market closed', retryable: false },
    }));

    await component.onSubmit({ stopPrice: 160, timeInForce: 'gtc', marketHours: 'regular_hours' });

    expect(component.canRetry()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Update mode (#888)
// ---------------------------------------------------------------------------

describe('StopLossDialogComponent — update mode', () => {
  let orderExecution: { submitEquityOrder: jasmine.Spy; updateEquityStopOrder: jasmine.Spy };
  let dialogRef: { close: jasmine.Spy; disableClose?: boolean };

  const position: EquityPosition = {
    symbol: 'AAPL',
    quantity: 100,
    averageBuyPrice: 150,
    sharesHeldForSells: 0,
  };

  function makeStop(overrides: Partial<BrokerOrder> = {}): BrokerOrder {
    return {
      orderId: 'order-old-1',
      accountNumber: 'acc-1',
      instrumentType: 'equity',
      symbol: 'AAPL',
      side: 'sell',
      type: 'stop_market',
      state: 'confirmed',
      quantity: 100,
      cumulativeQuantity: 0,
      price: null,
      stopPrice: 160,
      averageFillPrice: null,
      createdAt: '2026-10-01T10:00:00Z',
      timeInForce: 'gfd',
      marketHours: 'regular_hours',
      ...overrides,
    };
  }

  async function setup(data: Record<string, unknown>) {
    orderExecution = {
      submitEquityOrder: jasmine.createSpy('submitEquityOrder'),
      updateEquityStopOrder: jasmine.createSpy('updateEquityStopOrder'),
    };
    dialogRef = { close: jasmine.createSpy('close') };
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: DS_DIALOG_DATA, useValue: data },
        { provide: DsDialogRef, useValue: dialogRef },
        { provide: OrderExecutionService, useValue: orderExecution },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(StopLossDialogComponent);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance };
  }

  const baseData = { position, currentPrice: 175, accountNumber: 'acc-1' };

  it('goes straight to editing when update.target is set — no picker', async () => {
    const target = makeStop();
    const { component } = await setup({ ...baseData, update: { candidates: [target], target } });

    expect(component.state()).toBe('editing');
    expect(component.isUpdate).toBe(true);
  });

  it('opens in picking when multiple candidates and no target; selecting one moves to editing', async () => {
    const first = makeStop({ orderId: 'order-1' });
    const second = makeStop({ orderId: 'order-2', stopPrice: 158 });
    const { component } = await setup({ ...baseData, update: { candidates: [first, second] } });

    expect(component.state()).toBe('picking');

    component.selectCandidate(second);

    expect(component.state()).toBe('editing');
    expect(component.targetOrder()?.orderId).toBe('order-2');
  });

  it('goes straight to editing on a single candidate with no target — no picker', async () => {
    const only = makeStop({ orderId: 'order-solo' });
    const { component } = await setup({ ...baseData, update: { candidates: [only] } });

    expect(component.state()).toBe('editing');
    expect(component.targetOrder()?.orderId).toBe('order-solo');
  });

  it('prefills the form with the target stop price and the original TIF', async () => {
    const target = makeStop({ stopPrice: 162.5, timeInForce: 'gfd' });
    const { fixture } = await setup({ ...baseData, update: { candidates: [target], target } });

    const form = fixture.debugElement.query(
      (el) => el.componentInstance instanceof StopLossFormComponent,
    ).componentInstance as StopLossFormComponent;

    expect(form.initialStopPrice()).toBe(162.5);
    expect(form.timeInForce()).toBe('gfd');
  });

  it('falls back to gtc / regular_hours when the target order lacks TIF and market hours', async () => {
    const target = makeStop({ timeInForce: undefined, marketHours: undefined });
    const { component, fixture } = await setup({
      ...baseData,
      update: { candidates: [target], target },
    });

    const form = fixture.debugElement.query(
      (el) => el.componentInstance instanceof StopLossFormComponent,
    ).componentInstance as StopLossFormComponent;

    expect(component.formTimeInForce()).toBe('gtc');
    expect(component.formMarketHours()).toBe('regular_hours');
    expect(form.timeInForce()).toBe('gtc');
    expect(form.marketHours()).toBe('regular_hours');
  });

  it('submit calls updateEquityStopOrder with a stop_loss_update ticket — never submitEquityOrder', async () => {
    const target = makeStop({ orderId: 'order-old-9' });
    const { component } = await setup({ ...baseData, update: { candidates: [target], target } });
    orderExecution.updateEquityStopOrder.and.returnValue(
      Promise.resolve({ success: true, result: { orderId: 'rh-new', state: 'confirmed' } }),
    );

    await component.onSubmit({ stopPrice: 155, timeInForce: 'gtc', marketHours: 'regular_hours' });

    expect(orderExecution.updateEquityStopOrder).toHaveBeenCalledTimes(1);
    const [acct, orderId, ticket] = orderExecution.updateEquityStopOrder.calls.argsFor(0) as [
      string,
      string,
      EquityOrderTicket,
    ];
    expect(acct).toBe('acc-1');
    expect(orderId).toBe('order-old-9');
    expect(ticket.sourceRef).toEqual({ type: 'stop_loss_update', id: 'order-old-9' });
    expect(ticket.stopPrice).toBe('155.00');
    expect(ticket.timeInForce).toBe('gtc');
    expect(orderExecution.submitEquityOrder).not.toHaveBeenCalled();
    expect(component.state()).toBe('success');
  });

  it('place-phase unprotected failure retries by re-placing via submitEquityOrder — never re-cancels', async () => {
    const target = makeStop();
    const { component } = await setup({ ...baseData, update: { candidates: [target], target } });
    orderExecution.updateEquityStopOrder.and.returnValue(
      Promise.resolve({
        success: false,
        phase: 'place',
        unprotected: true,
        error: { message: 'replacement rejected', retryable: true },
      }),
    );
    orderExecution.submitEquityOrder.and.returnValue(
      Promise.resolve({ success: true, result: { orderId: 'rh-new', state: 'confirmed' } }),
    );

    await component.onSubmit({ stopPrice: 155, timeInForce: 'gtc', marketHours: 'regular_hours' });
    expect(component.state()).toBe('error');
    expect(component.unprotectedWarning()).toBe(true);

    await component.onRetry();

    expect(orderExecution.submitEquityOrder).toHaveBeenCalledTimes(1);
    expect(orderExecution.updateEquityStopOrder).toHaveBeenCalledTimes(1);
    expect(component.state()).toBe('success');
  });

  it('place-phase unconfirmed failure (unprotected false) offers no retry — close reconciles', async () => {
    const target = makeStop();
    const { component } = await setup({ ...baseData, update: { candidates: [target], target } });
    orderExecution.updateEquityStopOrder.and.returnValue(
      Promise.resolve({
        success: false,
        phase: 'place',
        unprotected: false,
        error: { message: 'placement unconfirmed', retryable: true },
      }),
    );

    await component.onSubmit({ stopPrice: 155, timeInForce: 'gtc', marketHours: 'regular_hours' });

    expect(component.state()).toBe('error');
    expect(component.canRetry()).toBe(false);
  });

  it('PLACEMENT_DEAD retry re-places with a fresh refId', async () => {
    const target = makeStop();
    const { component } = await setup({ ...baseData, update: { candidates: [target], target } });
    orderExecution.updateEquityStopOrder.and.returnValue(
      Promise.resolve({
        success: false,
        phase: 'place',
        unprotected: true,
        // PLACEMENT_DEAD arrives retryable:false — dead is not transient —
        // but unprotected:true still warrants a re-place with a fresh refId.
        error: { message: 'placement landed dead', retryable: false, code: 'PLACEMENT_DEAD' },
      }),
    );
    orderExecution.submitEquityOrder.and.returnValue(
      Promise.resolve({ success: true, result: { orderId: 'rh-new', state: 'confirmed' } }),
    );

    await component.onSubmit({ stopPrice: 155, timeInForce: 'gtc', marketHours: 'regular_hours' });

    expect(component.state()).toBe('error');
    expect(component.canRetry()).toBe(true);

    await component.onRetry();

    const updateTicket = orderExecution.updateEquityStopOrder.calls.argsFor(0)[2];
    const retriedTicket = orderExecution.submitEquityOrder.calls.argsFor(0)[0];
    expect(retriedTicket.refId).not.toBe(updateTicket.refId);
    expect(component.state()).toBe('success');
  });

  it('selectCandidate reseeds the form TIF/hours from the picked stop', async () => {
    const first = makeStop({ orderId: 'order-1', timeInForce: 'gtc' });
    const second = makeStop({ orderId: 'order-2', timeInForce: 'gfd' });
    const { component } = await setup({ ...baseData, update: { candidates: [first, second] } });

    component.selectCandidate(second);

    expect(component.formTimeInForce()).toBe('gfd');
  });

  it('failed re-place with a ref-id conflict stamps place/unprotected:false — no retry, reconcile', async () => {
    const target = makeStop();
    const { component } = await setup({ ...baseData, update: { candidates: [target], target } });
    orderExecution.updateEquityStopOrder.and.returnValue(
      Promise.resolve({
        success: false,
        phase: 'place',
        unprotected: true,
        error: { message: 'placement timed out', retryable: true },
      }),
    );
    // The re-place hits the 409 — the earlier attempt registered; retrying the
    // same ticket can only fail again. Retry must disarm (reconcile via close).
    orderExecution.submitEquityOrder.and.returnValue(
      Promise.resolve({
        success: false,
        error: {
          message: 'Conflict: Reference ID must be unique.',
          retryable: false,
        },
      }),
    );

    await component.onSubmit({ stopPrice: 155, timeInForce: 'gtc', marketHours: 'regular_hours' });
    await component.onRetry();

    expect(component.state()).toBe('error');
    expect(component.result()?.phase).toBe('place');
    expect(component.result()?.unprotected).toBe(false);
    expect(component.canRetry()).toBe(false);
    expect(component.unprotectedWarning()).toBe(false);
  });

  it('failed re-place with an ordinary retryable error keeps retry armed and the warning live', async () => {
    const target = makeStop();
    const { component } = await setup({ ...baseData, update: { candidates: [target], target } });
    orderExecution.updateEquityStopOrder.and.returnValue(
      Promise.resolve({
        success: false,
        phase: 'place',
        unprotected: true,
        error: { message: 'placement timed out', retryable: true },
      }),
    );
    orderExecution.submitEquityOrder.and.callFake(() =>
      Promise.resolve({
        success: orderExecution.submitEquityOrder.calls.count() > 1,
        ...(orderExecution.submitEquityOrder.calls.count() > 1
          ? { result: { orderId: 'rh-new', state: 'confirmed' } }
          : { error: { message: 'service unavailable', retryable: true } }),
      }),
    );

    await component.onSubmit({ stopPrice: 155, timeInForce: 'gtc', marketHours: 'regular_hours' });
    await component.onRetry();

    expect(component.state()).toBe('error');
    expect(component.result()?.phase).toBe('place');
    expect(component.result()?.unprotected).toBe(true);
    expect(component.unprotectedWarning()).toBe(true);
    expect(component.canRetry()).toBe(true);

    await component.onRetry();
    expect(component.state()).toBe('success');
  });

  it('thrown error from the primitive stamps cancel phase — retry re-runs cancel-first', async () => {
    const target = makeStop();
    const { component } = await setup({ ...baseData, update: { candidates: [target], target } });
    let calls = 0;
    orderExecution.updateEquityStopOrder.and.callFake(() =>
      calls++ === 0
        ? Promise.reject(new Error('transport blew up'))
        : Promise.resolve({ success: true, result: { orderId: 'rh-new', state: 'confirmed' } }),
    );

    await component.onSubmit({ stopPrice: 155, timeInForce: 'gtc', marketHours: 'regular_hours' });

    expect(component.state()).toBe('error');
    expect(component.result()?.phase).toBe('cancel');
    expect(component.result()?.unprotected).toBe(false);
    expect(component.canRetry()).toBe(true);

    await component.onRetry();

    // Re-ran the whole primitive — a phase-less update failure must never
    // route to a bare re-place (the old stop's state is unknown).
    expect(orderExecution.updateEquityStopOrder).toHaveBeenCalledTimes(2);
    expect(orderExecution.submitEquityOrder).not.toHaveBeenCalled();
    expect(component.state()).toBe('success');
  });

  it('cancel-phase retryable failure retries the whole primitive on the same ticket', async () => {
    const target = makeStop();
    const { component } = await setup({ ...baseData, update: { candidates: [target], target } });
    let calls = 0;
    orderExecution.updateEquityStopOrder.and.callFake(() =>
      calls++ === 0
        ? Promise.resolve({
            success: false,
            phase: 'cancel',
            unprotected: false,
            error: { message: 'cancel timed out', retryable: true },
          })
        : Promise.resolve({ success: true, result: { orderId: 'rh-new', state: 'confirmed' } }),
    );

    await component.onSubmit({ stopPrice: 155, timeInForce: 'gtc', marketHours: 'regular_hours' });
    await component.onRetry();

    expect(orderExecution.updateEquityStopOrder).toHaveBeenCalledTimes(2);
    // Same ticket object → same refId (idempotency).
    const first = orderExecution.updateEquityStopOrder.calls.argsFor(0)[2] as EquityOrderTicket;
    const second = orderExecution.updateEquityStopOrder.calls.argsFor(1)[2] as EquityOrderTicket;
    expect(second).toBe(first);
    expect(orderExecution.submitEquityOrder).not.toHaveBeenCalled();
    expect(component.state()).toBe('success');
  });
});
