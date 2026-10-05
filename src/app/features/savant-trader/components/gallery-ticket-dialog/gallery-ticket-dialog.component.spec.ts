/**
 * GalleryTicketDialogComponent spec (#759) — hosts OrderTicketComponent bound
 * to a staged ticket; auto-closes when the ticket leaves STAGED.
 */
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { GalleryTicketDialogComponent } from './gallery-ticket-dialog.component';
import { OrderTicketStore } from '../../stores/order-ticket.store';
import { EquityPriceService } from '../../services/equity-price.service';
import { PaperTradingService } from '../../services/paper-trading.service';
import { OrderExecutionService } from '../../services/order-execution.service';
import { AllocationStore } from '../../../portfolio-dashboard/allocation.store';
import {
  EquityOrderTicket,
  InstrumentType,
  OrderSource,
  OrderTicket,
  OrderTicketStatus,
  TradingConfig,
} from '../../services/order-ticket.types';

function stagedTicket(): EquityOrderTicket {
  return {
    id: 't-1',
    refId: 'ref-1',
    source: OrderSource.SIGNAL_PIPELINE,
    status: OrderTicketStatus.STAGED,
    accountNumber: 'acct-1',
    side: 'buy',
    orderType: 'market',
    timeInForce: 'gfd',
    marketHours: 'regular_hours',
    instrumentType: InstrumentType.EQUITY,
    symbol: 'AAPL',
    quantity: '2',
    createdAt: '2026-08-25T00:00:00Z',
    updatedAt: '2026-08-25T00:00:00Z',
  };
}

describe('GalleryTicketDialogComponent', () => {
  let fixture: ComponentFixture<GalleryTicketDialogComponent>;
  let tickets: ReturnType<typeof signal<Record<string, OrderTicket>>>;
  let dialogRefMock: { close: jest.Mock };
  let priceServiceMock: { prices: ReturnType<typeof signal<Record<string, number>>>; fetchPrices: jest.Mock };

  beforeEach(async () => {
    tickets = signal<Record<string, OrderTicket>>({ 't-1': stagedTicket() });
    dialogRefMock = { close: jest.fn() };
    priceServiceMock = {
      prices: signal<Record<string, number>>({}),
      fetchPrices: jest.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [GalleryTicketDialogComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            ticketId: 't-1',
            // The dialog reads config through data, not the facade (#755).
            tradingConfig: signal<TradingConfig | null>({
              accountNumber: 'acct-1',
              defaultDollarAmount: 100,
              maxUnits: 200,
              maxAllocationPercent: 80,
              updatedAt: 'x',
            }),
          },
        },
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: OrderTicketStore, useValue: { tickets } },
        { provide: EquityPriceService, useValue: priceServiceMock },
        // OrderTicketComponent's injected services — stubbed so Firebase
        // tokens never resolve (AGENTS.md spec convention).
        { provide: PaperTradingService, useValue: {} },
        { provide: OrderExecutionService, useValue: {} },
        {
          provide: AllocationStore,
          useValue: {
            byAccount: signal({}),
            ensureAccount: jest.fn(),
            bucketDetail: jest.fn().mockReturnValue(undefined),
          },
        },
        { provide: MatDialog, useValue: { open: jest.fn() } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GalleryTicketDialogComponent);
    fixture.detectChanges();
  });

  it('hosts the order-ticket component bound to the staged ticket', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-order-ticket')).toBeTruthy();
    expect(el.textContent).toContain('AAPL');
    expect(priceServiceMock.fetchPrices).toHaveBeenCalledWith(['AAPL']);
    expect(dialogRefMock.close).not.toHaveBeenCalled();
  });

  it('auto-closes when the ticket leaves STAGED (submitted / papered)', () => {
    tickets.set({ 't-1': { ...stagedTicket(), status: OrderTicketStatus.SUBMITTED } });
    fixture.detectChanges();
    expect(dialogRefMock.close).toHaveBeenCalled();
  });

  it('stays open on the transient SUBMITTING marker (#755 review)', () => {
    tickets.set({ 't-1': { ...stagedTicket(), status: OrderTicketStatus.SUBMITTING } });
    fixture.detectChanges();
    expect(dialogRefMock.close).not.toHaveBeenCalled();
  });

  it('stays open on FAILED — closing would swallow the error (#755 review)', () => {
    tickets.set({ 't-1': { ...stagedTicket(), status: OrderTicketStatus.FAILED } });
    fixture.detectChanges();
    expect(dialogRefMock.close).not.toHaveBeenCalled();
  });

  it('closes when the ticket is removed elsewhere', () => {
    tickets.set({});
    fixture.detectChanges();
    expect(dialogRefMock.close).toHaveBeenCalled();
  });
});
