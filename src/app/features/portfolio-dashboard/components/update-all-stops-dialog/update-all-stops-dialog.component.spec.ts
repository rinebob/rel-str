/**
 * UpdateAllStopsDialogComponent — preview/confirm/results steps render the
 * service's signals; confirm hands the candidate set + context to
 * UpdateAllStopsService; per-order retry delegates to retryOne behind the
 * service's canRetry contract. Includes a real-service integration block
 * (OrderExecutionService mocked) covering confirm → per-order calls.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import {
  UpdateAllStopsDialogComponent,
  UpdateAllStopsDialogData,
} from './update-all-stops-dialog.component';
import { DS_DIALOG_DATA, DsDialogRef } from '../../../../shared/ds/ds-dialog';
import {
  StopUpdateOutcome,
  UpdateAllStopsService,
} from '../../services/update-all-stops.service';
import { OrderExecutionService } from '../../../savant-trader/services/order-execution.service';
import type { UpdateStopResult } from '../../../savant-trader/services/order-execution.service';
import { BrokerOrder } from '../../../../core/robinhood-mcp/types/robinhood-mcp.types';
import type { EquityPositionWithPnL } from '../../portfolio-dashboard.types';

function makeOrder(overrides: Partial<BrokerOrder> = {}): BrokerOrder {
  return {
    orderId: 'stop-1',
    accountNumber: '123456789',
    instrumentType: 'equity',
    symbol: 'AAPL',
    side: 'sell',
    type: 'stop_market',
    state: 'confirmed',
    quantity: 100,
    cumulativeQuantity: 0,
    price: null,
    stopPrice: 145,
    averageFillPrice: null,
    createdAt: '2026-01-15T10:00:00Z',
    ...overrides,
  };
}

function makePosition(overrides: Partial<EquityPositionWithPnL> = {}): EquityPositionWithPnL {
  return {
    symbol: 'AAPL',
    quantity: 100,
    averageBuyPrice: 120,
    sharesHeldForSells: 0,
    currentPrice: 200,
    pnl: 8000,
    pnlPercent: 66.67,
    closed: false,
    entryDate: null,
    ...overrides,
  };
}

const DATA: UpdateAllStopsDialogData = {
  accountNumber: '123456789',
  positions: [makePosition()],
  orders: [makeOrder()],
  peaks: {
    AAPL: {
      symbol: 'AAPL',
      entryDate: '2026-01-05',
      lastFillDate: '2026-01-05',
      lifetime: { price: 200, date: '2026-02-10' },
      sinceLastFill: null,
    },
  },
};

describe('UpdateAllStopsDialogComponent (service mocked)', () => {
  let fixture: ComponentFixture<UpdateAllStopsDialogComponent>;
  let component: UpdateAllStopsDialogComponent;
  let svcStatus: ReturnType<typeof signal<'idle' | 'running' | 'done' | 'aborted'>>;
  let svcResults: ReturnType<typeof signal<StopUpdateOutcome[]>>;
  let svcCurrentIndex: ReturnType<typeof signal<number>>;
  let svcCurrentSymbol: ReturnType<typeof signal<string>>;
  let run: jest.Mock<Promise<void>>;
  let retryOne: jest.Mock<Promise<void>>;
  let canRetry: jest.Mock<boolean>;
  let reset: jest.Mock;
  let close: jest.Mock;
  let dialogRef: { close: jest.Mock; disableClose?: boolean };

  beforeEach(async () => {
    svcStatus = signal<'idle' | 'running' | 'done' | 'aborted'>('idle');
    svcResults = signal<StopUpdateOutcome[]>([]);
    svcCurrentIndex = signal(-1);
    svcCurrentSymbol = signal('');
    run = jest.fn(async () => {});
    retryOne = jest.fn(async () => {});
    canRetry = jest.fn(() => true);
    reset = jest.fn();
    close = jest.fn();
    dialogRef = { close };

    await TestBed.configureTestingModule({
      imports: [UpdateAllStopsDialogComponent],
      providers: [
        { provide: DS_DIALOG_DATA, useValue: DATA },
        { provide: DsDialogRef, useValue: dialogRef },
        {
          provide: UpdateAllStopsService,
          useValue: {
            status: svcStatus,
            results: svcResults,
            currentIndex: svcCurrentIndex,
            currentSymbol: svcCurrentSymbol,
            run,
            retryOne,
            canRetry,
            reset,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UpdateAllStopsDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('starts on the max-giveback input step', () => {
    expect(fixture.nativeElement.textContent).toContain('Max giveback from peak');
    expect(fixture.nativeElement.querySelector('input[type="number"]')).toBeTruthy();
  });

  it('preview lists each candidate with peak, stop, exposure, and disposition', () => {
    component.onPreview();
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('.candidate-item');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toContain('AAPL');
    expect(items[0].textContent).toContain('200'); // lifetime peak
    expect(items[0].textContent).toContain('145'); // current stop
    expect(items[0].textContent).toContain('184'); // 200 × 0.92 floor
    expect(items[0].textContent).toContain('27.5% off peak');
    expect(items[0].textContent).toContain('exposed');
  });

  it('a stop already inside the giveback renders within giveback, not exposed', () => {
    const tight = makeOrder({ orderId: 'stop-2', stopPrice: 190 });
    (DATA.orders as BrokerOrder[]).push(tight);
    try {
      component.onPreview();
      fixture.detectChanges();

      const items = fixture.nativeElement.querySelectorAll('.candidate-item');
      expect(items.length).toBe(2);
      expect(items[1].textContent).toContain('190');
      expect(items[1].textContent).toContain('within giveback');
      expect(component.updateCount()).toBe(1);
    } finally {
      DATA.orders.pop();
    }
  });

  it('confirm hands the preview candidates plus the account context to the service', async () => {
    component.onPreview();
    fixture.detectChanges();
    await component.onConfirm();

    expect(run).toHaveBeenCalledTimes(1);
    const [candidates, ctx] = run.mock.calls[0];
    expect(candidates).toBe(component.candidates());
    expect(ctx).toEqual({ accountNumber: '123456789' });
    expect(component.step()).toBe('results');
    expect(dialogRef.disableClose).toBe(true);
  });

  it('results step renders live service outcomes and disables Done while running', () => {
    component.onPreview();
    component.step.set('results');
    svcStatus.set('running');
    svcCurrentIndex.set(0);
    svcCurrentSymbol.set('AAPL');
    svcResults.set([
      { candidate: component.candidates()[0], status: 'running' },
    ]);
    fixture.detectChanges();

    const doneBtn = fixture.nativeElement.querySelector('.actions .ds-btn.fill') as HTMLButtonElement;
    expect(doneBtn.disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Updating AAPL');
  });

  it('a failed settled row shows its error and a per-order Retry → retryOne', async () => {
    component.onPreview();
    component.step.set('results');
    const outcome: StopUpdateOutcome = {
      candidate: component.candidates()[0],
      status: 'failed',
      error: 'placement failed',
      unprotected: true,
    };
    svcStatus.set('aborted');
    svcResults.set([outcome]);
    fixture.detectChanges();

    const retryBtn = fixture.nativeElement.querySelector('.c-retry') as HTMLButtonElement;
    expect(retryBtn).toBeTruthy();
    retryBtn.click();
    expect(retryOne).toHaveBeenCalledWith(outcome);
    expect(fixture.nativeElement.textContent).toContain('placement failed');
    expect(fixture.nativeElement.textContent).toContain('UNPROTECTED');
  });

  it('hides Retry when the service contract says the row cannot retry (e.g. likely-registered)', () => {
    component.onPreview();
    component.step.set('results');
    canRetry.mockReturnValue(false);
    svcStatus.set('aborted');
    svcResults.set([{ candidate: component.candidates()[0], status: 'failed' }]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.c-retry')).toBeNull();
  });

  it('close reports true only when a broker attempt ran', () => {
    // Preview-only dismiss → undefined (no reconcile).
    component.onPreview();
    component.onClose();
    expect(close).toHaveBeenLastCalledWith(undefined);

    // A run that attempted an order → true (orders reconcile).
    component.step.set('results');
    svcResults.set([{ candidate: component.candidates()[0], status: 'updated' }]);
    component.onClose();
    expect(close).toHaveBeenLastCalledWith(true);
  });

  it('an all-skipped run closes without reconcile — no broker attempt ran', () => {
    component.step.set('results');
    svcStatus.set('done');
    svcResults.set([{ candidate: component.candidates()[0], status: 'skipped' }]);
    component.onClose();
    expect(close).toHaveBeenLastCalledWith(undefined);
  });

  // ── givebackPct validation — a cleared/invalid input must not reach preview ──

  it('a cleared giveback input fails validation and gates Audit — null would floor AT peak', () => {
    component.givebackPct.set(null);
    fixture.detectChanges();

    const auditBtn = fixture.nativeElement.querySelector('.actions .ds-btn.fill') as HTMLButtonElement;
    expect(auditBtn.disabled).toBe(true);
    component.onPreview(); // even a direct call is a no-op
    expect(component.step()).toBe('input');
  });

  it('rejects zero, negative, and over-90 givebacks — and accepts a sane value', () => {
    for (const bad of [0, -5, 91, NaN]) {
      component.givebackPct.set(bad);
      expect(component.givebackPctValid()).toBe(false);
    }
    component.givebackPct.set(10);
    expect(component.givebackPctValid()).toBe(true);
    component.givebackPct.set(0.5);
    expect(component.givebackPctValid()).toBe(true);
  });

  it('gates Audit while peaks are still deriving — a premature audit would report every row no-peak', () => {
    const original = DATA.peaksPending;
    DATA.peaksPending = true;
    try {
      fixture.detectChanges();

      const auditBtn = fixture.nativeElement.querySelector('.actions .ds-btn.fill') as HTMLButtonElement;
      expect(auditBtn.disabled).toBe(true);
      expect(fixture.nativeElement.textContent).toContain('still deriving');
      component.onPreview();
      expect(component.step()).toBe('input');
    } finally {
      DATA.peaksPending = original;
    }
  });

  it('a floor at/above the mark renders above market — left for a manual decision', () => {
    // Mark 175 < floor 184 (peak 200 × 0.92): a sell-stop at the floor
    // would trigger immediately on placement.
    DATA.positions[0].currentPrice = 175;
    try {
      component.onPreview();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('above market');
      expect(component.updateCount()).toBe(0);
    } finally {
      DATA.positions[0].currentPrice = 200;
    }
  });

  it('the nothing-exposed copy counts skipped rows instead of claiming all within giveback', () => {
    const peaks = DATA.peaks;
    DATA.peaks = {}; // every row skip-no-peak
    try {
      component.onPreview();
      fixture.detectChanges();

      expect(component.updateCount()).toBe(0);
      expect(fixture.nativeElement.textContent).toContain('Nothing to tighten');
      expect(fixture.nativeElement.textContent).toContain('1 skipped');
    } finally {
      DATA.peaks = peaks;
    }
  });
});

// ── Integration: dialog + REAL UpdateAllStopsService, exec mocked ────────

describe('UpdateAllStopsDialogComponent + real UpdateAllStopsService', () => {
  let fixture: ComponentFixture<UpdateAllStopsDialogComponent>;
  let component: UpdateAllStopsDialogComponent;
  let update: jest.Mock<Promise<UpdateStopResult>>;

  beforeEach(async () => {
    update = jest
      .fn<Promise<UpdateStopResult>, [string, string, unknown]>()
      .mockResolvedValue({ success: true });
    await TestBed.configureTestingModule({
      imports: [UpdateAllStopsDialogComponent],
      providers: [
        { provide: DS_DIALOG_DATA, useValue: DATA },
        { provide: DsDialogRef, useValue: { close: jest.fn(), disableClose: false } },
        UpdateAllStopsService,
        {
          provide: OrderExecutionService,
          useValue: {
            updateEquityStopOrder: update,
            submitEquityOrder: jest.fn(async () => ({ success: true })),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(UpdateAllStopsDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('input → preview → confirm drives a real per-order update call and lands on done', async () => {
    const svc = TestBed.inject(UpdateAllStopsService);

    // input → preview
    const previewBtn = fixture.nativeElement.querySelector('.actions .ds-btn.fill') as HTMLButtonElement;
    previewBtn.click();
    fixture.detectChanges();
    expect(component.step()).toBe('preview');
    expect(fixture.nativeElement.textContent).toContain('1 of 1 stops are exposed');

    // confirm → results (run resolves inside — native async: flush via a
    // macrotask boundary per the repo's jest convention).
    const confirmBtn = fixture.nativeElement.querySelector('.actions .ds-btn.fill') as HTMLButtonElement;
    confirmBtn.click();
    await new Promise<void>((r) => setTimeout(r, 0));
    fixture.detectChanges();

    expect(update).toHaveBeenCalledTimes(1);
    const [acct, orderId, ticket] = update.mock.calls[0] as [string, string, { stopPrice: string }];
    expect(acct).toBe('123456789');
    expect(orderId).toBe('stop-1');
    expect(ticket.stopPrice).toBe('184.00'); // peak 200 × 0.92
    expect(svc.status()).toBe('done');
    expect(fixture.nativeElement.textContent).toContain('Update run complete');
    expect(fixture.nativeElement.textContent).toContain('1 tightened');
    expect(fixture.nativeElement.textContent).toContain('tightened');
  });
});
