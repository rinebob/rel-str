/**
 * GalleryTicketDialogComponent spec (#759) — hosts OrderTicketComponent bound
 * to a staged ticket; on a done status it shows a confirmation panel and
 * stays open until the user dismisses it (#762).
 */
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';

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
import { AppRoutes } from '../../../../core/common/interfaces';
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
  let routerMock: { navigate: jest.Mock };

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
    routerMock = { navigate: jest.fn().mockResolvedValue(true) };

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
        { provide: Router, useValue: routerMock },
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

  it('shows the confirmation panel on a done status instead of closing (#762)', () => {
    tickets.set({ 't-1': { ...stagedTicket(), status: OrderTicketStatus.SUBMITTED } });
    fixture.detectChanges();
    expect(dialogRefMock.close).not.toHaveBeenCalled();

    const el = fixture.nativeElement as HTMLElement;
    const panel = el.querySelector('[data-testid="order-confirmation"]');
    expect(panel?.textContent).toContain('Order submitted');
    expect(panel?.textContent).toContain('AAPL');
    expect(panel?.textContent).toContain('buy market');
    // The ticket form is replaced by the confirmation.
    expect(el.querySelector('app-order-ticket')).toBeNull();
  });

  it('shows the paper outcome message on PAPER', () => {
    tickets.set({ 't-1': { ...stagedTicket(), status: OrderTicketStatus.PAPER } });
    fixture.detectChanges();
    const panel = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="order-confirmation"]',
    );
    expect(panel?.textContent).toContain('Sent to paper trade');
  });

  it('Done closes after the confirmation is acknowledged', () => {
    tickets.set({ 't-1': { ...stagedTicket(), status: OrderTicketStatus.RESTING } });
    fixture.detectChanges();
    const done = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('mat-dialog-actions button'),
    ).find((b) => b.textContent?.trim() === 'Done');
    done?.click();
    expect(dialogRefMock.close).toHaveBeenCalled();
  });

  it('View order deep-links the ticket on the live-order page and closes', () => {
    tickets.set({ 't-1': { ...stagedTicket(), status: OrderTicketStatus.SUBMITTED } });
    fixture.detectChanges();
    const viewOrder = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('mat-dialog-actions button'),
    ).find((b) => b.textContent?.trim() === 'View order');
    viewOrder?.click();
    expect(routerMock.navigate).toHaveBeenCalledWith(
      ['/', 'trading/live'],
      { queryParams: { ticket: 't-1' } },
    );
    expect(dialogRefMock.close).toHaveBeenCalled();
  });

  it('clears the confirmation back to the form when the done ticket reverts — requeue or reconcile to FAILED (#762 review)', () => {
    const el = fixture.nativeElement as HTMLElement;
    tickets.set({ 't-1': { ...stagedTicket(), status: OrderTicketStatus.SUBMITTED } });
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="order-confirmation"]')).toBeTruthy();

    tickets.set({ 't-1': { ...stagedTicket(), status: OrderTicketStatus.FAILED } });
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="order-confirmation"]')).toBeNull();
    expect(el.querySelector('app-order-ticket')).toBeTruthy();
    expect(dialogRefMock.close).not.toHaveBeenCalled();
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

    it('shows the confirmation when the OPTION ticket is done even though the equity ticket is still STAGED', () => {
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
      expect(dialogRefMock.close).not.toHaveBeenCalled();
      const panel = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="order-confirmation"]',
      );
      expect(panel?.textContent).toContain('Order submitted');
    });

    it('closes when a bound option ticket is removed elsewhere', () => {
      fixture.componentInstance.onOptionStaged({ ticketId: 'opt-1', created: true });
      tickets.set({ 't-1': stagedTicket() });
      fixture.detectChanges();
      expect(dialogRefMock.close).toHaveBeenCalled();
    });

    it('FAILED on a bound leg outranks the other leg\'s done status — the error is not masked (#762 round 2)', () => {
      fixture.componentInstance.onOptionStaged({ ticketId: 'opt-1', created: true });
      // Equity done + option failed → form, not the equity confirmation.
      tickets.set({
        't-1': { ...stagedTicket(), status: OrderTicketStatus.SUBMITTED },
        'opt-1': {
          ...stagedTicket(),
          id: 'opt-1',
          instrumentType: InstrumentType.OPTION,
          status: OrderTicketStatus.FAILED,
        } as OrderTicket,
      });
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="order-confirmation"]')).toBeNull();
      expect(el.querySelector('app-order-ticket')).toBeTruthy();
      expect(dialogRefMock.close).not.toHaveBeenCalled();
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

  describe('manual mode (#1177)', () => {
    let manualFixture: ComponentFixture<GalleryTicketDialogComponent>;
    let manualOnStaged: jest.Mock;
    let manualStage: jest.Mock;

    beforeEach(async () => {
      // The outer beforeEach already instantiated a card-mode module —
      // reset before reconfiguring with a manual seed.
      TestBed.resetTestingModule();
      manualOnStaged = jest.fn();
      manualStage = jest.fn().mockResolvedValue(null);
      await TestBed.configureTestingModule({
        imports: [GalleryTicketDialogComponent],
        providers: [
          provideNoopAnimations(),
          {
            provide: MAT_DIALOG_DATA,
            useValue: {
              manual: {
                stageEquityTicket: manualStage,
                onStaged: manualOnStaged,
              },
              tradingConfig: signal<TradingConfig | null>({
                accountNumber: 'acct-1',
                defaultDollarAmount: 100,
                updatedAt: 'x',
              }),
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
          { provide: Router, useValue: routerMock },
        ],
      }).compileComponents();
    });

    it('stays open with no ticket bound — the symbol-resolve flow owns the close path', () => {
      manualFixture = TestBed.createComponent(GalleryTicketDialogComponent);
      manualFixture.detectChanges();
      // Card mode would self-close on a missing ticket; manual mode must
      // not — the user hasn't resolved a symbol yet.
      expect(dialogRefMock.close).not.toHaveBeenCalled();
      expect(manualFixture.componentInstance.ticket()).toBeNull();
    });

    it('onOptionStaged forwards the emit to the manual seed so session ids reach the opener', () => {
      manualFixture = TestBed.createComponent(GalleryTicketDialogComponent);
      manualFixture.detectChanges();
      manualFixture.componentInstance.onOptionStaged({ ticketId: 'opt-1', created: true });
      expect(manualOnStaged).toHaveBeenCalledWith({ ticketId: 'opt-1', created: true });
      expect(manualFixture.componentInstance.optionTicketId()).toBe('opt-1');
    });

    it('renders symbol entry + hint before resolution — no tabs yet', () => {
      manualFixture = TestBed.createComponent(GalleryTicketDialogComponent);
      manualFixture.detectChanges();
      const el = manualFixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="manual-symbol-input"]')).toBeTruthy();
      expect(el.querySelector('[data-testid="manual-symbol-resolve"]')).toBeTruthy();
      expect(el.querySelector('[data-testid="manual-hint"]')).toBeTruthy();
      expect(el.querySelector('mat-tab-group')).toBeFalsy();
      expect(el.querySelector('app-order-ticket')).toBeFalsy();
    });

    it('resolve stages the manual ticket and binds the Stock tab', async () => {
      manualStage.mockImplementation(async () => {
        const t = { ...stagedTicket(), id: 'man-1', source: OrderSource.MANUAL };
        tickets.update((m) => ({ ...m, 'man-1': t }));
        return t;
      });
      manualFixture = TestBed.createComponent(GalleryTicketDialogComponent);
      manualFixture.detectChanges();
      // The card-mode fixture in the outer beforeEach already fetched —
      // clear so this assertion means the resolve fetched.
      priceServiceMock.fetchPrices.mockClear();
      priceServiceMock.prices.set({ AAPL: 189.5 });
      manualFixture.componentInstance.symbolInput.set('aapl');
      await manualFixture.componentInstance.resolveSymbol();
      manualFixture.detectChanges();

      expect(priceServiceMock.fetchPrices).toHaveBeenCalledWith(['AAPL']);
      expect(manualStage).toHaveBeenCalledWith('AAPL');
      const el = manualFixture.nativeElement as HTMLElement;
      expect(el.querySelector('mat-tab-group')).toBeTruthy();
      expect(el.querySelector('app-order-ticket')).toBeTruthy();
      expect(manualFixture.componentInstance.ticket()?.id).toBe('man-1');
      // Both tabs render in manual mode — no card seed required (#1189).
      expect(el.querySelectorAll('mat-tab-body').length).toBe(2);
      expect(el.querySelectorAll('.mdc-tab').length).toBe(2);
      expect(manualFixture.componentInstance.displaySymbol()).toBe('AAPL');
    });

    it('invalid symbol shows an inline error and burns no fetch or stage', async () => {
      priceServiceMock.fetchPrices.mockClear();
      manualFixture = TestBed.createComponent(GalleryTicketDialogComponent);
      manualFixture.detectChanges();
      manualFixture.componentInstance.symbolInput.set('!!!');
      await manualFixture.componentInstance.resolveSymbol();
      manualFixture.detectChanges();

      expect(priceServiceMock.fetchPrices).not.toHaveBeenCalled();
      const el = manualFixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="manual-symbol-error"]')).toBeTruthy();
      expect(el.querySelector('mat-tab-group')).toBeFalsy();
    });

    it('an unresolvable ticker (seed returns null) shows an inline error and binds nothing', async () => {
      manualFixture = TestBed.createComponent(GalleryTicketDialogComponent);
      manualFixture.detectChanges();
      // Default manualStage resolves null — the seed's own fetch found
      // no quote (or stage failed); the inline error names the ticker.
      manualFixture.componentInstance.symbolInput.set('ZZZZ');
      await manualFixture.componentInstance.resolveSymbol();
      manualFixture.detectChanges();

      expect(manualStage).toHaveBeenCalledWith('ZZZZ');
      const el = manualFixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="manual-symbol-error"]')?.textContent).toContain('ZZZZ');
      expect(manualFixture.componentInstance.enteredSymbol()).toBeNull();
      expect(el.querySelector('mat-tab-group')).toBeFalsy();
    });

    it('view order navigates to the portfolio dashboard in manual mode', () => {
      manualFixture = TestBed.createComponent(GalleryTicketDialogComponent);
      manualFixture.detectChanges();
      manualFixture.componentInstance.confirmation.set({
        ...stagedTicket(),
        status: OrderTicketStatus.SUBMITTED,
      });
      manualFixture.componentInstance.onViewOrder();
      expect(routerMock.navigate).toHaveBeenCalledWith(
        ['/', AppRoutes.PORTFOLIO_DASHBOARD],
      );
      expect(dialogRefMock.close).toHaveBeenCalled();
    });

    it('the Option tab mounts on the resolved symbol without a card seed — manual placeholder, not the signal form', async () => {
      manualStage.mockImplementation(async () => {
        const t = { ...stagedTicket(), id: 'man-1', source: OrderSource.MANUAL };
        tickets.update((m) => ({ ...m, 'man-1': t }));
        return t;
      });
      manualFixture = TestBed.createComponent(GalleryTicketDialogComponent);
      manualFixture.detectChanges();
      priceServiceMock.prices.set({ AAPL: 189.5 });
      manualFixture.componentInstance.symbolInput.set('AAPL');
      await manualFixture.componentInstance.resolveSymbol();
      manualFixture.detectChanges();

      // The Option tab is lazy — activating it mounts the component on
      // the resolved symbol with empty provenance. Manual mode renders a
      // placeholder, not the signal staging form (#1189; staging is #1190).
      const tabs = manualFixture.nativeElement.querySelectorAll('.mdc-tab');
      (tabs[1] as HTMLElement).click();
      manualFixture.detectChanges();
      await manualFixture.whenStable();
      manualFixture.detectChanges();

      const opt = manualFixture.nativeElement.querySelector('app-option-order-ticket');
      expect(opt).toBeTruthy();
      expect(opt.querySelector('[data-testid="manual-option-placeholder"]')).toBeTruthy();
      expect(opt.querySelector('[data-testid="expiration-select"]')).toBeFalsy();
    });

    it('re-resolve is gated while a ticket is bound — no silent rebind or orphan (#1189 review)', async () => {
      manualStage.mockImplementation(async () => {
        const t = { ...stagedTicket(), id: 'man-1', source: OrderSource.MANUAL };
        tickets.update((m) => ({ ...m, 'man-1': t }));
        return t;
      });
      manualFixture = TestBed.createComponent(GalleryTicketDialogComponent);
      manualFixture.detectChanges();
      manualFixture.componentInstance.symbolInput.set('AAPL');
      await manualFixture.componentInstance.resolveSymbol();
      manualFixture.detectChanges();

      // Bound: the input + button disable and the resolve call no-ops.
      const el = manualFixture.nativeElement as HTMLElement;
      const input = el.querySelector('[data-testid="manual-symbol-input"]') as HTMLInputElement;
      const btn = el.querySelector('[data-testid="manual-symbol-resolve"]') as HTMLButtonElement;
      expect(input.disabled).toBe(true);
      expect(btn.disabled).toBe(true);
      expect(el.querySelector('[data-testid="manual-bound-hint"]')).toBeTruthy();

      manualStage.mockClear();
      manualFixture.componentInstance.symbolInput.set('MSFT');
      await manualFixture.componentInstance.resolveSymbol();
      expect(manualStage).not.toHaveBeenCalled();
      expect(manualFixture.componentInstance.ticket()?.id).toBe('man-1');
    });

    it('a done manual ticket renders the confirmation panel via the store status', async () => {
      manualStage.mockImplementation(async () => {
        const t = { ...stagedTicket(), id: 'man-1', source: OrderSource.MANUAL };
        tickets.update((m) => ({ ...m, 'man-1': t }));
        return t;
      });
      manualFixture = TestBed.createComponent(GalleryTicketDialogComponent);
      manualFixture.detectChanges();
      manualFixture.componentInstance.symbolInput.set('AAPL');
      await manualFixture.componentInstance.resolveSymbol();
      manualFixture.detectChanges();

      // Submit transitions land through the store — the same watcher as
      // card mode surfaces the confirmation (and the dialog stays open).
      tickets.update((m) => ({
        ...m,
        'man-1': { ...m['man-1'], status: OrderTicketStatus.SUBMITTED },
      }));
      manualFixture.detectChanges();
      const el = manualFixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="order-confirmation"]')).toBeTruthy();
      expect(dialogRefMock.close).not.toHaveBeenCalled();
    });

    it('a second resolve while one is in flight is a no-op (resolving guard)', async () => {
      let release!: (t: OrderTicket) => void;
      manualStage.mockImplementation(
        () => new Promise<OrderTicket>((r) => { release = r; }),
      );
      manualFixture = TestBed.createComponent(GalleryTicketDialogComponent);
      manualFixture.detectChanges();
      manualFixture.componentInstance.symbolInput.set('AAPL');

      const first = manualFixture.componentInstance.resolveSymbol();
      const second = manualFixture.componentInstance.resolveSymbol();
      await second; // returns immediately — guard tripped
      const t = { ...stagedTicket(), id: 'man-1', source: OrderSource.MANUAL };
      tickets.update((m) => ({ ...m, 'man-1': t }));
      release(t);
      await first;

      expect(manualStage).toHaveBeenCalledTimes(1);
    });

    it('a rejected stage surfaces the inline error instead of an unhandled rejection', async () => {
      manualStage.mockRejectedValue(new Error('config load failed'));
      manualFixture = TestBed.createComponent(GalleryTicketDialogComponent);
      manualFixture.detectChanges();
      manualFixture.componentInstance.symbolInput.set('AAPL');
      await manualFixture.componentInstance.resolveSymbol();
      manualFixture.detectChanges();

      const el = manualFixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="manual-symbol-error"]')?.textContent).toContain('AAPL');
      expect(manualFixture.componentInstance.resolving()).toBe(false);
      expect(manualFixture.componentInstance.enteredSymbol()).toBeNull();
    });

    it('a bound ticket that vanishes resets to the entry row — tabs unmount, input re-enables', async () => {
      manualStage.mockImplementation(async () => {
        const t = { ...stagedTicket(), id: 'man-1', source: OrderSource.MANUAL };
        tickets.update((m) => ({ ...m, 'man-1': t }));
        return t;
      });
      manualFixture = TestBed.createComponent(GalleryTicketDialogComponent);
      manualFixture.detectChanges();
      manualFixture.componentInstance.symbolInput.set('AAPL');
      await manualFixture.componentInstance.resolveSymbol();
      manualFixture.detectChanges();
      expect(manualFixture.componentInstance.ticket()?.id).toBe('man-1');

      // External discard (queue removal / store rekey) — the dialog must
      // not keep rendering a dead bound form (#1189 review r3).
      tickets.set({});
      manualFixture.detectChanges();

      const el = manualFixture.nativeElement as HTMLElement;
      expect(manualFixture.componentInstance.enteredSymbol()).toBeNull();
      expect(el.querySelector('mat-tab-group')).toBeFalsy();
      expect(
        (el.querySelector('[data-testid="manual-symbol-input"]') as HTMLInputElement)
          .disabled,
      ).toBe(false);
      expect(el.querySelector('[data-testid="manual-hint"]')).toBeTruthy();
      // Manual mode still owns its close path — the dialog stays open.
      expect(dialogRefMock.close).not.toHaveBeenCalled();
    });
  });
});
