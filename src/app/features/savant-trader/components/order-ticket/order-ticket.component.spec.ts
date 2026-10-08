import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signal } from '@angular/core';
import { of } from 'rxjs';

import { By } from '@angular/platform-browser';

import { OrderTicketComponent } from './order-ticket.component';
import { StopLossFormComponent } from '../../../../shared/components/stop-loss-form/stop-loss-form.component';
import { OrderTicketStore } from '../../stores/order-ticket.store';
import { OrderExecutionService } from '../../services/order-execution.service';
import { PaperTradingService } from '../../services/paper-trading.service';
import { InstrumentType, OrderTicket, OrderTicketStatus, OrderSource, TradingConfig } from '../../services/order-ticket.types';
import type { PaperSignalOrderResponse } from '@paper-trading/contracts';
import { AllocationStore } from '../../../portfolio-dashboard/allocation.store';
import { BucketStatus } from '@portfolio-allocation/contracts';
import type { AllocationBucket } from '@portfolio-allocation/contracts';
import type { AccountAllocation, BucketDetail } from '../../../portfolio-dashboard/allocation.types';

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
    setTicketStatusLocal: jasmine.Spy;
    sendTicketToPaper: jasmine.Spy;
  };
  let dialog: { open: jasmine.Spy };
  let orderExecution: any;
  let paperTrading: { paperSignalOrder$: jest.Mock };
  let allocStore!: {
    byAccount: ReturnType<typeof signal<Record<string, AccountAllocation>>>;
    ensureAccount: jest.Mock;
    bucketDetail: jest.Mock;
  };

  function bucketFixture(name: string, status = BucketStatus.ACTIVE): AllocationBucket {
    return {
      id: `agentic-account_${name.toLowerCase().replace(/\s+/g, '-')}`,
      userId: 'u', accountNumber: 'agentic-account', name, targetPct: 25,
      status, createdAt: 'x', updatedAt: 'x',
    };
  }

  function allocWith(buckets: AllocationBucket[]): AccountAllocation {
    return {
      snapshot: null, positions: [], fills: [], buckets,
      attributions: [], asOf: null, loading: false, error: null,
    };
  }

  beforeEach(async () => {
    store = {
      tickets: signal<Record<string, OrderTicket>>({}),
      submitTicket: jasmine.createSpy('submitTicket'),
      updateTicket: jasmine.createSpy('updateTicket'),
      stageTicket: jasmine.createSpy('stageTicket'),
      setTicketStatusLocal: jasmine.createSpy('setTicketStatusLocal'),
      sendTicketToPaper: jasmine.createSpy('sendTicketToPaper').and.returnValue(
        Promise.resolve({ cohortId: 'cohort-9', expressionTradeIds: ['exp-1', 'exp-2'] }),
      ),
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
    paperTrading = {
      paperSignalOrder$: jest.fn().mockReturnValue(of<PaperSignalOrderResponse>({
        cohortId: 'cohort-9',
        equityTradeId: 'eq-1',
        expressionTradeIds: ['exp-1', 'exp-2'],
      })),
    };
    allocStore = {
      byAccount: signal<Record<string, AccountAllocation>>({}),
      ensureAccount: jest.fn(async () => undefined),
      bucketDetail: jest.fn(() => null),
    };

    await TestBed.configureTestingModule({
      imports: [OrderTicketComponent],
      providers: [
        provideNoopAnimations(),
        { provide: OrderTicketStore, useValue: store },
        { provide: OrderExecutionService, useValue: orderExecution },
        { provide: PaperTradingService, useValue: paperTrading },
        { provide: AllocationStore, useValue: allocStore },
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

  describe('trade cost recalculation (#723)', () => {
    const limitTicket = (limitPrice = '48.00') =>
      makeTicket('1', 'AAPL', { orderType: 'limit', limitPrice, quantity: '10' });

    it('costs a limit order at qty × limit price, not the live quote', () => {
      fixture.componentRef.setInput('ticket', limitTicket('48.00'));
      fixture.componentRef.setInput('price', 50);
      fixture.detectChanges();

      expect(component.actualCost()).toBe(480);
    });

    it('recalculates when the limit price is edited', () => {
      fixture.componentRef.setInput('ticket', limitTicket('48.00'));
      fixture.componentRef.setInput('price', 50);
      fixture.detectChanges();

      component.limitPrice.set('45.00');
      fixture.detectChanges();

      expect(component.actualCost()).toBe(450);
    });

    it('recalculates when quantity is edited', () => {
      fixture.componentRef.setInput('ticket', limitTicket('48.00'));
      fixture.componentRef.setInput('price', 50);
      fixture.detectChanges();

      component.quantity.set('20');
      fixture.detectChanges();

      expect(component.actualCost()).toBe(960);
    });

    it('falls back to the live quote when the limit field is empty/invalid', () => {
      fixture.componentRef.setInput('ticket', limitTicket('48.00'));
      fixture.componentRef.setInput('price', 50);
      fixture.detectChanges();

      component.limitPrice.set('');
      fixture.detectChanges();
      expect(component.actualCost()).toBe(500); // 10 × live 50

      component.limitPrice.set('abc');
      fixture.detectChanges();
      expect(component.actualCost()).toBe(500);
    });

    it('still uses the live quote for market orders', () => {
      fixture.componentRef.setInput('ticket', makeTicket('1', 'AAPL', { orderType: 'market', quantity: '10' }));
      fixture.componentRef.setInput('price', 50);
      fixture.detectChanges();

      expect(component.actualCost()).toBe(500);
    });

    it('shows the cost from limit price even with no live quote', () => {
      fixture.componentRef.setInput('ticket', limitTicket('48.00'));
      fixture.componentRef.setInput('price', null);
      fixture.detectChanges();

      expect(component.actualCost()).toBe(480);
      expect(fixture.nativeElement.textContent).toContain('$480.00');
    });
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

  // -- bucket selector (#592) — optional, never a submit gate --

  it('bucket picker lists the account\'s ACTIVE buckets; Unassigned is the default', () => {
    allocStore.byAccount.set({
      'agentic-account': allocWith([bucketFixture('Wheel'), bucketFixture('Old', BucketStatus.RETIRED)]),
    });
    fixture.componentRef.setInput('ticket', makeTicket('1'));
    fixture.componentRef.setInput('price', 50);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('[data-testid="bucket-select"]') as HTMLSelectElement;
    expect(select).toBeTruthy();
    const labels = Array.from(select.options).map((o) => o.textContent.trim());
    expect(labels).toEqual(['Unassigned', 'Wheel']); // retired excluded
    expect(select.value).toBe('');
    // Optional — a submit with no bucket still works.
    expect(allocStore.ensureAccount).toHaveBeenCalledWith('agentic-account');
  });

  it('selecting a bucket persists bucketId on saveEdits', () => {
    const wheel = bucketFixture('Wheel');
    allocStore.byAccount.set({ 'agentic-account': allocWith([wheel]) });
    fixture.componentRef.setInput('ticket', makeTicket('1'));
    fixture.componentRef.setInput('price', 50);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('[data-testid="bucket-select"]') as HTMLSelectElement;
    select.value = wheel.id;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(component.selectedBucketId()).toBe(wheel.id);
    component.saveEdits();
    expect(store.updateTicket).toHaveBeenCalledWith('1', jasmine.objectContaining({ bucketId: wheel.id }));
  });

  it('a ticket carrying bucketId preselects it; a stale bucketId shows Unassigned', () => {
    const wheel = bucketFixture('Wheel');
    allocStore.byAccount.set({ 'agentic-account': allocWith([wheel]) });
    fixture.componentRef.setInput('ticket', makeTicket('1', 'AAPL', { bucketId: wheel.id }));
    fixture.componentRef.setInput('price', 50);
    fixture.detectChanges();
    expect(component.selectedBucketId()).toBe(wheel.id);
    const select = fixture.nativeElement.querySelector('[data-testid="bucket-select"]') as HTMLSelectElement;
    expect(select.value).toBe(wheel.id);
    expect(component.selectedBucket()?.name).toBe('Wheel');

    // Bucket deleted/retired between stage and open → the id resolves to
    // nothing; select shows Unassigned, fill seed no-ops (service-side
    // txn re-verifies ACTIVE).
    fixture.componentRef.setInput('ticket', makeTicket('2', 'MSFT', { bucketId: 'agentic-account_gone' }));
    fixture.detectChanges();
    expect(component.selectedBucket()).toBeNull();
    expect(select.value).toBe('');
  });

  it('signal context row stays visible after a bucket is picked', () => {
    const wheel = bucketFixture('Wheel');
    allocStore.byAccount.set({ 'agentic-account': allocWith([wheel]) });
    fixture.componentRef.setInput('ticket', makeTicket('1', 'AAPL', {
      signalContext: { signalType: 'ST_ENTRY', barDate: '2026-09-29', timeframe: 'daily', direction: 'LONG', decisionId: 'd1' },
    }));
    fixture.componentRef.setInput('price', 50);
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector('[data-testid="signal-context-row"]');
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('ST_ENTRY');

    const select = fixture.nativeElement.querySelector('[data-testid="bucket-select"]') as HTMLSelectElement;
    select.value = wheel.id;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(component.selectedBucketId()).toBe(wheel.id);
    expect(fixture.nativeElement.querySelector('[data-testid="signal-context-row"]').textContent).toContain('ST_ENTRY');
  });

  it('over-target submit warns naming bucket/exposure/projected — still submittable', async () => {
    const wheel = bucketFixture('Wheel');
    allocStore.byAccount.set({ 'agentic-account': allocWith([wheel]) });
    allocStore.bucketDetail.mockReturnValue({
      bucket: wheel,
      stats: {
        bucketId: wheel.id,
        exposure: 900, netValue: 900, targetDollars: 100, drift: 800,
        realizedPnl: 0, unrealizedPnl: 0, openCount: 1, closedCount: 0,
        asOf: '2026-09-28T12:00:00Z', equityCurve: [],
      },
      positions: [], fills: [],
    } satisfies BucketDetail);
    fixture.componentRef.setInput('ticket', makeTicket('1', 'AAPL', { bucketId: wheel.id }));
    fixture.componentRef.setInput('price', 50); // 2 shares × $50 = $100 → 900+100 > 100
    fixture.detectChanges();

    await component.onSubmit();

    const warnings = (dialog.open.calls.mostRecent().args[1] as { data: { warnings: { message: string; severity: string }[] } }).data.warnings;
    const bucketWarn = warnings.find((w) => w.message.includes('Wheel'));
    expect(bucketWarn).toBeDefined();
    expect(bucketWarn?.severity).toBe('warning');
    expect(bucketWarn?.message).toContain('900');
    expect(bucketWarn?.message).toContain('1,000');
    expect(store.submitTicket).toHaveBeenCalledWith('1'); // warn, not block
  });

  it('confirms and submits a stop loss directly to RH after the entry fills', async () => {
    const entry = makeTicket('1', 'AAPL', { status: OrderTicketStatus.FILLED, result: { fillPrice: '100', filledQuantity: '2' } });
    fixture.componentRef.setInput('ticket', entry);
    fixture.componentRef.setInput('price', 100);
    fixture.detectChanges();

    await component.onPlaceStopLoss(92); // the form emits the derived price

    expect(dialog.open).toHaveBeenCalled();
    expect(orderExecution.submitEquityOrder).toHaveBeenCalledWith(jasmine.objectContaining({
      side: 'sell',
      quantity: '2',
      stopPrice: '92.00',
      // #886: stops are always GTC + regular hours.
      timeInForce: 'gtc',
      marketHours: 'regular_hours',
    }));
  });

  it('pins the stop to gtc/regular_hours — the entry ticket\'s pills must not leak into it (#886)', async () => {
    const entry = makeTicket('1', 'AAPL', { status: OrderTicketStatus.FILLED, result: { fillPrice: '100', filledQuantity: '2' } });
    fixture.componentRef.setInput('ticket', entry);
    fixture.componentRef.setInput('price', 100);
    fixture.detectChanges();

    // After detectChanges — the ticket-init effect re-seeds the signals
    // from the entry ticket on each input change. A gfd + extended-hours
    // entry must still produce a GTC regular-hours stop.
    component.timeInForce.set('gfd');
    component.marketHours.set('all_day_hours');

    await component.onPlaceStopLoss(92);

    expect(orderExecution.submitEquityOrder).toHaveBeenCalledWith(jasmine.objectContaining({
      timeInForce: 'gtc',
      marketHours: 'regular_hours',
    }));
  });

  it('hides the form\'s order-params pills and does NOT bind the entry\'s TIF/hours into it (#886)', async () => {
    const entry = makeTicket('1', 'AAPL', { status: OrderTicketStatus.FILLED, result: { fillPrice: '100', filledQuantity: '2' } });
    fixture.componentRef.setInput('ticket', entry);
    fixture.componentRef.setInput('price', 100);
    fixture.detectChanges();

    const form = fixture.debugElement.query(By.directive(StopLossFormComponent))?.componentInstance as StopLossFormComponent | undefined;
    expect(form).toBeTruthy();
    expect(form!.showOrderParams()).toBe(false);

    // Neither model is bound — the entry ticket's signals govern the entry
    // order only (its pills are hidden once it fills anyway). The form
    // keeps its own gtc/regular_hours defaults.
    component.timeInForce.set('gfd');
    component.marketHours.set('extended_hours');
    fixture.detectChanges();
    expect(form!.timeInForce()).toBe('gtc');
    expect(form!.marketHours()).toBe('regular_hours');
  });
});

// =============================================================================
// Accept as paper — staged signal tickets → paperSignalOrder → PAPER status
// =============================================================================

describe('OrderTicketComponent — accept as paper', () => {
  let fixture: ComponentFixture<OrderTicketComponent>;
  let component: OrderTicketComponent;
  let store: {
    tickets: ReturnType<typeof signal<Record<string, OrderTicket>>>;
    submitTicket: jasmine.Spy;
    updateTicket: jasmine.Spy;
    updateTicketAndWait: jasmine.Spy;
    stageTicket: jasmine.Spy;
    setTicketStatusLocal: jasmine.Spy;
    sendTicketToPaper: jasmine.Spy;
  };
  let dialog: { open: jasmine.Spy };
  let snackBar: { open: jest.Mock };
  let orderExec: { submitEquityOrder: jest.Mock; cancelEquityOrder: jest.Mock };

  const signalTicket = (overrides: Partial<OrderTicket> = {}): OrderTicket =>
    makeTicket('1', 'AAPL', {
      signalContext: {
        signalType: 'ST_ENTRY',
        barDate: '2026-08-24',
        timeframe: 'daily',
        direction: 'LONG',
        decisionId: 'run-1-AAPL-daily-ST_ENTRY',
      },
      ...overrides,
    });

  beforeEach(async () => {
    store = {
      tickets: signal<Record<string, OrderTicket>>({}),
      submitTicket: jasmine.createSpy('submitTicket'),
      updateTicket: jasmine.createSpy('updateTicket'),
      updateTicketAndWait: jasmine.createSpy('updateTicketAndWait').and.returnValue(Promise.resolve(true)),
      stageTicket: jasmine.createSpy('stageTicket'),
      setTicketStatusLocal: jasmine.createSpy('setTicketStatusLocal'),
      sendTicketToPaper: jasmine.createSpy('sendTicketToPaper').and.returnValue(
        Promise.resolve({ cohortId: 'cohort-9', expressionTradeIds: ['exp-1', 'exp-2'] }),
      ),
    };
    dialog = {
      open: jasmine.createSpy('open').and.returnValue({ afterClosed: () => of(true) }),
    };
    snackBar = { open: jest.fn() };
    orderExec = {
      submitEquityOrder: jest.fn(),
      cancelEquityOrder: jest.fn().mockResolvedValue({ success: true }),
    };

    await TestBed.configureTestingModule({
      imports: [OrderTicketComponent],
      providers: [
        provideNoopAnimations(),
        { provide: OrderTicketStore, useValue: store },
        { provide: OrderExecutionService, useValue: orderExec },
        { provide: PaperTradingService, useValue: {} },
        { provide: AllocationStore, useValue: { byAccount: signal({}), ensureAccount: jest.fn(), bucketDetail: jest.fn(() => null) } },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrderTicketComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('tradingConfig', config);
  });

  function mount(ticket: OrderTicket): void {
    fixture.componentRef.setInput('ticket', ticket);
    fixture.componentRef.setInput('price', 50);
    fixture.detectChanges();
  }

  it('shows the paper action only on staged signal tickets', () => {
    mount(signalTicket());
    expect(fixture.nativeElement.querySelector('[data-testid="accept-as-paper-btn"]')).toBeTruthy();

    fixture.componentRef.setInput('ticket', signalTicket({ status: OrderTicketStatus.PAPER }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="accept-as-paper-btn"]')).toBeFalsy();

    fixture.componentRef.setInput(
      'ticket',
      signalTicket({ source: OrderSource.MANUAL }),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="accept-as-paper-btn"]')).toBeFalsy();

    fixture.componentRef.setInput(
      'ticket',
      signalTicket({ status: OrderTicketStatus.SUBMITTED }),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="accept-as-paper-btn"]')).toBeFalsy();
  });

  it('opens the confirm dialog in paper mode', async () => {
    mount(signalTicket());
    await component.onAcceptAsPaper();
    const data = dialog.open.calls.mostRecent().args[1].data;
    expect(data.paper).toBe(true);
    expect(data.ticket.symbol).toBe('AAPL');
  });

  it('the confirm dialog reflects edited quantity (merged preview)', async () => {
    mount(signalTicket());
    component.quantity.set('7');
    await component.onAcceptAsPaper();
    const data = dialog.open.calls.mostRecent().args[1].data;
    expect(data.ticket.quantity).toBe('7');
    // The component hands the edited whole-share quantity to the shared
    // store transaction — request shape/SUBMITTING/PAPER live there (#755).
    expect(store.sendTicketToPaper).toHaveBeenCalledWith(
      jasmine.objectContaining({ id: '1' }),
      7,
      'Paper accept failed: ',
    );
  });

  it('persists edits via updateTicketAndWait BEFORE the dialog/send — the backend reads the stored quantity (#755 review r3)', async () => {
    mount(signalTicket());
    component.quantity.set('7');

    let saveResolved = false;
    let sendRanWithSavePending = false;
    store.updateTicketAndWait.and.callFake(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
      saveResolved = true;
      return true;
    });
    store.sendTicketToPaper.and.callFake(async () => {
      sendRanWithSavePending = !saveResolved;
      return { cohortId: 'c', expressionTradeIds: [] };
    });

    await component.onAcceptAsPaper();

    expect(store.updateTicketAndWait).toHaveBeenCalledWith('1', jasmine.objectContaining({ quantity: '7' }));
    expect(store.sendTicketToPaper).toHaveBeenCalled();
    expect(sendRanWithSavePending).toBe(false);
  });

  it('aborts the paper send when the edit save fails', async () => {
    store.updateTicketAndWait.and.returnValue(Promise.resolve(false));
    mount(signalTicket());
    component.quantity.set('7');
    await component.onAcceptAsPaper();

    expect(dialog.open).not.toHaveBeenCalled();
    expect(store.sendTicketToPaper).not.toHaveBeenCalled();
    expect(component.acceptingPaper()).toBe(false);
  });

  it('a second click during the edit-save await is a no-op — the guard wraps the save (#755 review r4)', async () => {
    mount(signalTicket());
    let resolveSave!: (v: boolean) => void;
    store.updateTicketAndWait.and.returnValue(
      new Promise<boolean>((r) => { resolveSave = r; }),
    );

    const first = component.onAcceptAsPaper();
    await new Promise<void>((r) => setTimeout(r, 0)); // first call parked on the save
    expect(component.acceptingPaper()).toBe(true);

    await component.onAcceptAsPaper(); // re-entry during the save window
    expect(store.updateTicketAndWait).toHaveBeenCalledTimes(1);
    expect(dialog.open).not.toHaveBeenCalled();

    resolveSave(true);
    await first;
    expect(store.sendTicketToPaper).toHaveBeenCalledTimes(1);
    expect(component.acceptingPaper()).toBe(false);
  });

  it('re-entry while accepting is a no-op', async () => {
    mount(signalTicket());
    component.acceptingPaper.set(true);
    await component.onAcceptAsPaper();
    expect(store.sendTicketToPaper).not.toHaveBeenCalled();
    expect(dialog.open).not.toHaveBeenCalled();
  });

  it('delegates to the shared sendTicketToPaper transaction, then reports the cohort', async () => {
    mount(signalTicket());
    await component.onAcceptAsPaper();
    // The store transaction owns request shape, SUBMITTING transient,
    // PAPER on success, STAGED+error on failure — covered in the store spec.
    expect(store.sendTicketToPaper).toHaveBeenCalledWith(
      jasmine.objectContaining({ id: '1' }),
      2,
      'Paper accept failed: ',
    );
    expect(snackBar.open).toHaveBeenCalledWith(
      expect.stringContaining('cohort-9'),
      'Dismiss',
      expect.anything(),
    );
    expect(component.acceptingPaper()).toBe(false);
  });

  it('passes sell-side tickets through — direction mapping lives in the store request builder', async () => {
    mount(signalTicket({
      side: 'sell',
      signalContext: {
        signalType: 'ST_ENTRY', barDate: '2026-08-24', timeframe: 'daily',
        direction: 'SHORT', decisionId: 'run-1-AAPL-daily-ST_ENTRY',
      },
    }));
    await component.onAcceptAsPaper();
    expect(store.sendTicketToPaper).toHaveBeenCalledWith(
      jasmine.objectContaining({ side: 'sell' }),
      jasmine.anything(),
      'Paper accept failed: ',
    );
  });

  it('surfaces the error when the shared send fails — the ticket stays STAGED', async () => {
    store.sendTicketToPaper.and.returnValue(Promise.reject(new Error('unauthenticated')));
    mount(signalTicket());
    await component.onAcceptAsPaper();
    // The store already reverted STAGED + attached the error — the
    // component only reports it.
    expect(snackBar.open).toHaveBeenCalledWith(
      expect.stringContaining('Failed to accept as paper'),
      'Dismiss',
      expect.anything(),
    );
    expect(component.acceptingPaper()).toBe(false);
  });

  it('does nothing when the dialog is cancelled', async () => {
    dialog.open.and.returnValue({ afterClosed: () => of(false) });
    mount(signalTicket());
    await component.onAcceptAsPaper();
    expect(store.sendTicketToPaper).not.toHaveBeenCalled();
    // Edits were persisted pessimistically before the dialog, but the
    // ticket never transitions to PAPER.
    expect(store.updateTicket).not.toHaveBeenCalledWith(
      '1',
      jasmine.objectContaining({ status: OrderTicketStatus.PAPER }),
    );
    // Flag released — a retry remains possible.
    expect(component.acceptingPaper()).toBe(false);
  });

  it('refuses when the ticket has no signal context', async () => {
    mount(signalTicket({ signalContext: undefined }));
    await component.onAcceptAsPaper();
    expect(store.sendTicketToPaper).not.toHaveBeenCalled();
  });

  it('a FAILED ticket is not editable — Requeue is the only path back (#717)', () => {
    // A failed RH order burned its refId; submitting it directly 409s.
    mount(signalTicket({ status: OrderTicketStatus.FAILED }));

    expect(component.isEditable()).toBe(false);
    const labels = [...fixture.nativeElement.querySelectorAll('button')].map(
      (b) => b.textContent as string,
    );
    expect(labels.some((t) => t.includes('Submit Order'))).toBe(false);
    expect(labels.some((t) => t.includes('Requeue'))).toBe(true);
  });

  it('emits requeueRequested when Requeue is clicked on a FAILED ticket', async () => {
    mount(signalTicket({ status: OrderTicketStatus.FAILED }));
    let emitted: string | null = null;
    component.requeueRequested.subscribe((id) => (emitted = id));

    component.onRequeue();
    await fixture.whenStable();

    expect(emitted).toBe('1');
    expect(store.submitTicket).not.toHaveBeenCalled();
  });

  it('onSubmit refuses a FAILED ticket even if invoked directly', async () => {
    mount(signalTicket({ status: OrderTicketStatus.FAILED }));
    await component.onSubmit();
    expect(dialog.open).not.toHaveBeenCalled();
    expect(store.submitTicket).not.toHaveBeenCalled();
  });

  it('onModify cancels at RH then reverts to STAGED with a FRESH refId (#717)', async () => {
    // The cancel makes the order terminal at RH — the old refId is burned,
    // so the reverted ticket must not resubmit it.
    mount(signalTicket({
      status: OrderTicketStatus.SUBMITTED,
      refId: 'ref-burned',
      result: { orderId: 'rh-9', state: 'confirmed' },
    }));

    await component.onModify();

    expect(orderExec.cancelEquityOrder).toHaveBeenCalledWith('agentic-account', 'rh-9');
    const patch = store.updateTicketAndWait.calls.mostRecent().args[1];
    expect(patch.status).toBe(OrderTicketStatus.STAGED);
    expect(patch.refId).toBeTruthy();
    expect(patch.refId).not.toBe('ref-burned');
    expect(patch.result).toBeUndefined();
  });
});
