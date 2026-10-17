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
import { SymbolListStore } from '../../stores/symbol-list.store';
import type { EquityQuote } from '../../../../core/robinhood-mcp/types/robinhood-mcp.types';
import type { StSymbolProfile } from '../../services/types';
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
  let priceServiceMock: {
    prices: ReturnType<typeof signal<Record<string, number>>>;
    quotes: ReturnType<typeof signal<Record<string, EquityQuote>>>;
    fetchPrices: jest.Mock;
  };
  let profiles: ReturnType<typeof signal<Map<string, StSymbolProfile>>>;
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
      quotes: signal<Record<string, EquityQuote>>({}),
      fetchPrices: jest.fn().mockResolvedValue(undefined),
    };
    profiles = signal<Map<string, StSymbolProfile>>(new Map());
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
        {
          provide: SymbolListStore,
          useValue: {
            profilesBySymbol: profiles,
            loadProfiles: jest.fn().mockResolvedValue(undefined),
          },
        },
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

  describe('subtitle — underlying identity + quote', () => {
    it('renders the symbol and company name under the title', () => {
      profiles.set(
        new Map([['AAPL', { symbol: 'AAPL', name: 'Apple Inc.' } as StSymbolProfile]]),
      );
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const identity = el.querySelector('[data-testid="underlying-identity"]');
      expect(identity?.textContent).toContain('AAPL');
      expect(identity?.textContent).toContain('Apple Inc.');
    });

    it('renders last, change, prev close, bid and ask when the quote lands', () => {
      priceServiceMock.quotes.set({
        AAPL: {
          symbol: 'AAPL',
          lastTradePrice: 200.5,
          previousClose: 198,
          bidPrice: 200.4,
          askPrice: 200.6,
        },
      });
      fixture.detectChanges();
      const quote = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="underlying-quote"]',
      );
      expect(quote?.textContent).toContain('$200.50');
      expect(quote?.textContent).toContain('+2.50');
      expect(quote?.textContent).toContain('+1.3%');
      expect(quote?.textContent).toContain('Prev $198.00');
      expect(quote?.textContent).toContain('Bid $200.40');
      expect(quote?.textContent).toContain('Ask $200.60');
    });

    it('omits the quote row until a quote arrives; tolerates missing bid/ask', () => {
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="underlying-quote"]')).toBeNull();

      priceServiceMock.quotes.set({
        AAPL: { symbol: 'AAPL', lastTradePrice: 200, previousClose: null },
      });
      fixture.detectChanges();
      const quote = el.querySelector('[data-testid="underlying-quote"]');
      expect(quote?.textContent).toContain('$200.00');
      expect(quote?.textContent).toContain('Prev —');
      expect(quote?.textContent).not.toContain('Bid');
    });
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
