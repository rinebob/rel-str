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
import { RobinhoodMcpClient } from '../../../../core/robinhood-mcp/robinhood-mcp-client.service';
import { PortfolioService } from '../../services/portfolio.service';
import { AllocationStore } from '../../../portfolio-dashboard/allocation.store';
import { StOccurrenceDecision, StSignalItem } from '../../services/types';
import { SignalDirection, SignalStatus, SignalTimeframe } from '../../common/constants';
import { of } from 'rxjs';
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

function optionSeed(over: Record<string, unknown> = {}) {
  const sig: StSignalItem = {
    id: '2026-08-25',
    symbol: 'AAPL',
    barDate: '2026-08-25',
    marketDate: '2026-08-25',
    runId: 'run-1',
    timeframe: SignalTimeframe.DAILY,
    direction: SignalDirection.LONG,
    signalType: 'RS_RISE',
    status: SignalStatus.INTERIM,
    indicators: {},
  };
  return {
    symbol: 'AAPL',
    runId: 'run-1',
    signals: [sig],
    decisions: signal<Record<string, StOccurrenceDecision>>({}),
    onStaged: jest.fn(),
    ...over,
  };
}

describe('GalleryTicketDialogComponent', () => {
  let fixture: ComponentFixture<GalleryTicketDialogComponent>;
  let tickets: ReturnType<typeof signal<Record<string, OrderTicket>>>;
  let dialogRefMock: { close: jest.Mock };
  let priceServiceMock: { prices: ReturnType<typeof signal<Record<string, number>>>; fetchPrices: jest.Mock };
  let mcpClientMock: {
    getOptionChains: jest.Mock;
    getOptionInstruments: jest.Mock;
    getOptionQuotes: jest.Mock;
  };
  let seedOnStaged: jest.Mock;

  beforeEach(async () => {
    tickets = signal<Record<string, OrderTicket>>({ 't-1': stagedTicket() });
    dialogRefMock = { close: jest.fn() };
    priceServiceMock = {
      prices: signal<Record<string, number>>({}),
      fetchPrices: jest.fn().mockResolvedValue(undefined),
    };
    mcpClientMock = {
      getOptionChains: jest.fn().mockResolvedValue([]),
      getOptionInstruments: jest.fn().mockResolvedValue([]),
      getOptionQuotes: jest.fn().mockResolvedValue({}),
    };
    seedOnStaged = jest.fn();

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
            option: optionSeed({ onStaged: seedOnStaged }),
          },
        },
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: OrderTicketStore, useValue: { tickets } },
        { provide: EquityPriceService, useValue: priceServiceMock },
        // OrderTicketComponent's + OptionOrderTicketComponent's injected
        // services — stubbed so Firebase tokens never resolve (AGENTS.md).
        { provide: PaperTradingService, useValue: {} },
        { provide: OrderExecutionService, useValue: {} },
        { provide: RobinhoodMcpClient, useValue: mcpClientMock },
        { provide: PortfolioService, useValue: { getSnapshot: jest.fn().mockResolvedValue(null) } },
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

  describe('option tab (#964)', () => {
    it('renders Stock and Option tabs — the equity ticket mounts on Stock by default', () => {
      const el = fixture.nativeElement as HTMLElement;
      const labels = Array.from(el.querySelectorAll('.mat-mdc-tab')).map((t) => t.textContent?.trim());
      expect(labels).toEqual(['Stock', 'Option']);
      expect(el.querySelector('app-order-ticket')).toBeTruthy();
      // Lazy tab — the option ticket is not instantiated (no chain call)
      // until the user activates it.
      expect(el.querySelector('app-option-order-ticket')).toBeNull();
      expect(mcpClientMock.getOptionChains).not.toHaveBeenCalled();
    });

    it('activating the Option tab mounts the ticket and starts chain loading', async () => {
      const el = fixture.nativeElement as HTMLElement;
      const tab = el.querySelectorAll<HTMLElement>('.mat-mdc-tab')[1];
      tab.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const opt = el.querySelector('app-option-order-ticket');
      expect(opt).toBeTruthy();
      expect(mcpClientMock.getOptionChains).toHaveBeenCalled();
    });

    it('switching tabs preserves both panes — the option ticket is not remounted', async () => {
      const el = fixture.nativeElement as HTMLElement;
      const tabs = () => el.querySelectorAll<HTMLElement>('.mat-mdc-tab');
      tabs()[1].click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const first = el.querySelector('app-option-order-ticket');
      expect(first).toBeTruthy();

      tabs()[0].click();
      fixture.detectChanges();
      tabs()[1].click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      // A remount would refire the chain fetch — one call means the pane
      // (and its form state) survived the round-trip.
      expect(el.querySelector('app-option-order-ticket')).toBeTruthy();
      expect(mcpClientMock.getOptionChains).toHaveBeenCalledTimes(1);
      expect(el.querySelector('app-order-ticket')).toBeTruthy();
    });

    it('an option staged emit binds the option ticket id and forwards {ticketId, created} to the host', () => {
      fixture.componentInstance.onOptionStaged({ ticketId: 'opt-1', created: true });
      expect(fixture.componentInstance.optionTicketId()).toBe('opt-1');
      expect(seedOnStaged).toHaveBeenCalledWith({ ticketId: 'opt-1', created: true });
      expect(dialogRefMock.close).not.toHaveBeenCalled();
    });

    it('closes when the OPTION ticket reaches a done status even though the equity ticket is still STAGED', () => {
      fixture.componentInstance.onOptionStaged({ ticketId: 'opt-1', created: true });
      tickets.set({
        't-1': stagedTicket(),
        'opt-1': {
          ...stagedTicket(),
          id: 'opt-1',
          instrumentType: InstrumentType.OPTION,
          status: OrderTicketStatus.SUBMITTED,
        } as OrderTicket,
      });
      fixture.detectChanges();
      expect(dialogRefMock.close).toHaveBeenCalled();
    });

    it('closes when a bound option ticket is removed elsewhere', () => {
      fixture.componentInstance.onOptionStaged({ ticketId: 'opt-1', created: true });
      tickets.set({ 't-1': stagedTicket() });
      fixture.detectChanges();
      expect(dialogRefMock.close).toHaveBeenCalled();
    });

    it('stays open while the option ticket is STAGED or SUBMITTING', () => {
      fixture.componentInstance.onOptionStaged({ ticketId: 'opt-1', created: true });
      tickets.set({
        't-1': stagedTicket(),
        'opt-1': {
          ...stagedTicket(),
          id: 'opt-1',
          instrumentType: InstrumentType.OPTION,
          status: OrderTicketStatus.SUBMITTING,
        } as OrderTicket,
      });
      fixture.detectChanges();
      expect(dialogRefMock.close).not.toHaveBeenCalled();
    });
  });
});
