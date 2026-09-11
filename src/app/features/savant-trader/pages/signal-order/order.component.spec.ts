import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { OrderComponent } from './order.component';
import { OrderTicketStore } from '../../stores/order-ticket.store';
import { TradingConfigService } from '../../services/trading-config.service';
import { EquityPriceService } from '../../services/equity-price.service';
import { PortfolioService } from '../../services/portfolio.service';
import { RobinhoodMcpObservationService } from '../../../../core/robinhood-mcp/robinhood-mcp-observation.service';
import { OrderTicketService } from '../../services/order-ticket.service';
import { UiStateService } from '../../../../core/services/ui-state.service';
import {
  OrderTicket,
  OrderTicketStatus,
  OrderSource,
  InstrumentType,
} from '../../services/order-ticket.types';
import { BrokerOrderSnapshot } from '../../services/order-ticket.types';

function makeTicket(id: string, symbol: string, status: OrderTicketStatus = OrderTicketStatus.STAGED): OrderTicket {
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
    symbol,
    quantity: '100',
    createdAt: '2026-08-25T12:00:00Z',
    updatedAt: '2026-08-25T12:00:00Z',
  } as OrderTicket;
}

describe('OrderComponent', () => {
  let fixture: ComponentFixture<OrderComponent>;
  let component: OrderComponent;
  let storeMock: any;
  let uiStateMock: any;
  let routerMock: any;

  beforeEach(async () => {
    storeMock = {
      tickets: signal({}),
      loading: signal(false),
      error: signal(null),
      loadTickets: jasmine.createSpy('loadTickets'),
      removeTicket: jasmine.createSpy('removeTicket'),
      updateTicket: jasmine.createSpy('updateTicket'),
      reconcileTerminalStatuses: jasmine.createSpy('reconcileTerminalStatuses'),
    };

    uiStateMock = {
      setFullscreen: jasmine.createSpy('setFullscreen'),
    };

    routerMock = {
      navigate: jasmine.createSpy('navigate'),
    };

    await TestBed.configureTestingModule({
      imports: [OrderComponent],
      providers: [
        provideNoopAnimations(),
        { provide: OrderTicketStore, useValue: storeMock },
        { provide: UiStateService, useValue: uiStateMock },
        { provide: Router, useValue: routerMock },
        { provide: TradingConfigService, useValue: { loadConfig: jasmine.createSpy('loadConfig').and.returnValue(of(null)) } },
        { provide: EquityPriceService, useValue: { prices: signal({}), loading: signal(false), fetchPrices: jasmine.createSpy('fetchPrices') } },
        { provide: PortfolioService, useValue: { getSnapshot: jasmine.createSpy('getSnapshot').and.returnValue(Promise.resolve(null)) } },
        { provide: RobinhoodMcpObservationService, useValue: { reauthenticate: jasmine.createSpy('reauthenticate') } },
        { provide: OrderTicketService, useValue: {} },
        { provide: MatDialog, useValue: { open: jasmine.createSpy('open').and.returnValue({ afterClosed: () => of(false) }) } },
        { provide: MatSnackBar, useValue: { open: jasmine.createSpy('open') } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrderComponent);
    component = fixture.componentInstance;
  });

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  it('loads tickets and sets fullscreen on init', () => {
    component.ngOnInit();

    expect(storeMock.loadTickets).toHaveBeenCalledTimes(1);
    expect(uiStateMock.setFullscreen).toHaveBeenCalledWith(true);
  });

  it('computes allTickets from store', () => {
    const ticket = makeTicket('1', 'AAPL');
    storeMock.tickets.set({ '1': ticket });
    fixture.detectChanges();

    expect(component.allTickets().length).toBe(1);
    expect(component.allTickets()[0].id).toBe('1');
  });

  it('computes ticketCount from allTickets', () => {
    storeMock.tickets.set({
      '1': makeTicket('1', 'AAPL'),
      '2': makeTicket('2', 'NVDA'),
    });
    fixture.detectChanges();

    expect(component.ticketCount()).toBe(2);
  });

  it('sets selectedTicketId on selection', () => {
    component.onTicketSelected('abc-123');
    expect(component.selectedTicketId()).toBe('abc-123');
  });

  it('computes selectedTicket from store', () => {
    const ticket = makeTicket('1', 'AAPL');
    storeMock.tickets.set({ '1': ticket });
    component.selectedTicketId.set('1');
    fixture.detectChanges();

    expect(component.selectedTicket()?.id).toBe('1');
  });

  it('returns null selectedTicket when no selection', () => {
    expect(component.selectedTicket()).toBeNull();
  });

  it('calls removeTicket for each id in batch remove', () => {
    component.onRemoveTickets(['1', '2', '3']);

    expect(storeMock.removeTicket).toHaveBeenCalledTimes(3);
    expect(storeMock.removeTicket).toHaveBeenCalledWith('1');
    expect(storeMock.removeTicket).toHaveBeenCalledWith('2');
    expect(storeMock.removeTicket).toHaveBeenCalledWith('3');
  });

  it('clears selection when selected ticket is removed', () => {
    component.selectedTicketId.set('2');
    component.onRemoveTickets(['1', '2']);

    expect(component.selectedTicketId()).toBeNull();
  });

  it('does not clear selection when removed tickets do not include selection', () => {
    component.selectedTicketId.set('3');
    component.onRemoveTickets(['1', '2']);

    expect(component.selectedTicketId()).toBe('3');
  });

  it('renders scoreboard values from the canonical account snapshot', () => {
    component.tradingConfig.set({
      accountNumber: 'agentic-account', defaultDollarAmount: 100, maxUnits: 200,
      maxAllocationPercent: 80, updatedAt: '2026-08-25T12:00:00Z',
    });
    component.accountSnapshot.set({
      accountValue: 24964.02642795, exposure: 163.80642795, cash: 24800.22,
      positionCount: 2, units: 1.64, positions: [],
    });
    fixture.detectChanges();

    const scoreboard = fixture.nativeElement.querySelector('.scoreboard').textContent;
    expect(scoreboard).toContain('$24,964.03');
    expect(scoreboard).toContain('$163.81');
    expect(scoreboard).toContain('$24,800.22');
    expect(scoreboard).toContain('2');
    expect(scoreboard).toContain('1.64');
  });

  it('navigates back to signal-review on goBack', () => {
    component.goBack();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/signal-review']);
  });

  it('selects the first loaded ticket automatically', () => {
    storeMock.tickets.set({ '1': makeTicket('1', 'AAPL') });
    fixture.detectChanges();

    expect(component.selectedTicketId()).toBe('1');
    expect(fixture.nativeElement.querySelector('.ticket-content').textContent).toContain('AAPL');
  });

  it('shows ticket content when an ticket is selected', () => {
    const ticket = makeTicket('1', 'AAPL');
    storeMock.tickets.set({ '1': ticket });
    component.selectedTicketId.set('1');
    fixture.detectChanges();

    const ticketContent = fixture.nativeElement.querySelector('.ticket-content');
    expect(ticketContent).toBeTruthy();
    expect(ticketContent.textContent).toContain('AAPL');
  });

  it('shows loading state when store is loading', () => {
    storeMock.loading.set(true);
    fixture.detectChanges();

    const loading = fixture.nativeElement.querySelector('.loading-state');
    expect(loading).toBeTruthy();
    expect(loading.textContent).toContain('Loading');
  });

  it('shows error state when store has error', () => {
    storeMock.error.set('Failed to load tickets');
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector('.error-state');
    expect(error).toBeTruthy();
    expect(error.textContent).toContain('Failed to load orders');
    expect(error.textContent).toContain('Failed to load tickets');
  });

  describe('RH stop-loss orders in allTickets', () => {
    function makeStopOrder(id: string, symbol: string, state = 'confirmed'): BrokerOrderSnapshot {
      return {
        id, symbol, side: 'sell', type: 'market', state,
        quantity: '100', stopPrice: '95.00',
        trigger: 'stop',
        createdAt: '2026-09-08T12:00:00Z',
        lastTransactionAt: '2026-09-08T12:00:00Z',
      };
    }

    it('includes RH stop-loss orders as resting rows', () => {
      component.rhOrders.set({ 'rh-stop-1': makeStopOrder('rh-stop-1', 'AAPL') });
      component.rhOrdersLoaded.set(true);
      fixture.detectChanges();

      const all = component.allTickets();
      const stopRow = all.find((t) => t.id === 'rh-stop-rh-stop-1');
      expect(stopRow).toBeTruthy();
      expect(stopRow!.side).toBe('sell');
      expect(stopRow!.orderType).toBe('stop_loss');
      expect(stopRow!.status).toBe(OrderTicketStatus.RESTING);
    });

    it('filters out non-signal local tickets (only SIGNAL_PIPELINE tickets are shown)', () => {
      const signalTicket = makeTicket('1', 'AAPL', OrderTicketStatus.SUBMITTED);
      signalTicket.source = OrderSource.SIGNAL_PIPELINE;
      const manualTicket = makeTicket('2', 'NVDA', OrderTicketStatus.SUBMITTED);
      manualTicket.source = OrderSource.MANUAL;
      const posMgmtTicket = makeTicket('3', 'TSLA', OrderTicketStatus.SUBMITTED);
      posMgmtTicket.source = OrderSource.POSITION_MANAGEMENT;
      storeMock.tickets.set({ '1': signalTicket, '2': manualTicket, '3': posMgmtTicket });
      component.rhOrdersLoaded.set(true);
      fixture.detectChanges();

      const all = component.allTickets();
      const symbols = all.filter((t) => 'symbol' in t).map((t) => (t as any).symbol);
      expect(symbols).toContain('AAPL');
      expect(symbols).not.toContain('NVDA');
      expect(symbols).not.toContain('TSLA');
    });

    it('hides local submitted/queued tickets until RH orders are loaded', () => {
      const ticket = makeTicket('1', 'AAPL', OrderTicketStatus.SUBMITTED);
      ticket.result = { orderId: 'rh-1', state: 'confirmed' };
      storeMock.tickets.set({ '1': ticket });
      fixture.detectChanges();

      // RH orders not loaded yet — submitted ticket should be hidden
      expect(component.allTickets().length).toBe(0);

      // RH orders loaded — ticket should now appear
      component.rhOrdersLoaded.set(true);
      fixture.detectChanges();
      expect(component.allTickets().length).toBe(1);
    });

    it('shows staged tickets even before RH orders are loaded', () => {
      storeMock.tickets.set({ '1': makeTicket('1', 'AAPL', OrderTicketStatus.STAGED) });
      fixture.detectChanges();

      expect(component.allTickets().length).toBe(1);
    });

    it('computes protectedSymbols from RH orders', () => {
      component.rhOrders.set({
        'rh-stop-1': makeStopOrder('rh-stop-1', 'AAPL'),
        'rh-stop-2': makeStopOrder('rh-stop-2', 'NVDA'),
        'rh-cancelled': { ...makeStopOrder('rh-cancelled', 'TSLA'), state: 'cancelled' },
      });
      fixture.detectChanges();

      const protectedSyms = component.protectedSymbols();
      expect(protectedSyms.has('AAPL')).toBe(true);
      expect(protectedSyms.has('NVDA')).toBe(true);
      expect(protectedSyms.has('TSLA')).toBe(false);
    });
  });

  describe('terminal-state reconciliation', () => {
    it('calls reconcileTerminalStatuses when RH reports cancelled', () => {
      const ticket = makeTicket('1', 'AAPL', OrderTicketStatus.SUBMITTED);
      ticket.result = { orderId: 'rh-1', state: 'confirmed' };
      storeMock.tickets.set({ '1': ticket });
      component.rhOrders.set({
        'rh-1': { id: 'rh-1', symbol: 'AAPL', side: 'buy', type: 'market', state: 'cancelled', trigger: 'immediate' },
      });
      component.rhOrdersLoaded.set(true);
      fixture.detectChanges();

      expect(storeMock.reconcileTerminalStatuses).toHaveBeenCalledWith(jasmine.objectContaining({
        'rh-1': jasmine.objectContaining({ state: 'cancelled' }),
      }));
    });

    it('calls reconcileTerminalStatuses when RH reports filled', () => {
      const ticket = makeTicket('1', 'AAPL', OrderTicketStatus.SUBMITTED);
      ticket.result = { orderId: 'rh-1', state: 'confirmed' };
      storeMock.tickets.set({ '1': ticket });
      component.rhOrders.set({
        'rh-1': { id: 'rh-1', symbol: 'AAPL', side: 'buy', type: 'market', state: 'filled', trigger: 'immediate' },
      });
      component.rhOrdersLoaded.set(true);
      fixture.detectChanges();

      expect(storeMock.reconcileTerminalStatuses).toHaveBeenCalled();
    });

    it('still calls reconcileTerminalStatuses when RH reports non-terminal state', () => {
      const ticket = makeTicket('1', 'AAPL', OrderTicketStatus.SUBMITTED);
      ticket.result = { orderId: 'rh-1', state: 'confirmed' };
      storeMock.tickets.set({ '1': ticket });
      component.rhOrders.set({
        'rh-1': { id: 'rh-1', symbol: 'AAPL', side: 'buy', type: 'market', state: 'confirmed', trigger: 'immediate' },
      });
      component.rhOrdersLoaded.set(true);
      fixture.detectChanges();

      // The store method is always called; it decides whether to write.
      expect(storeMock.reconcileTerminalStatuses).toHaveBeenCalled();
    });

    it('does not call reconcileTerminalStatuses before RH orders are loaded', () => {
      const ticket = makeTicket('1', 'AAPL', OrderTicketStatus.SUBMITTED);
      ticket.result = { orderId: 'rh-1', state: 'confirmed' };
      storeMock.tickets.set({ '1': ticket });
      component.rhOrders.set({
        'rh-1': { id: 'rh-1', symbol: 'AAPL', side: 'buy', type: 'market', state: 'cancelled', trigger: 'immediate' },
      });
      // rhOrdersLoaded is false
      fixture.detectChanges();

      expect(storeMock.reconcileTerminalStatuses).not.toHaveBeenCalled();
    });
  });

  describe('cancelled ticket recency filter', () => {
    it('shows cancelled tickets within the last 24 hours (terminalAt)', () => {
      const recent = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
      const ticket = makeTicket('1', 'AAPL', OrderTicketStatus.CANCELLED);
      ticket.terminalAt = recent;
      storeMock.tickets.set({ '1': ticket });
      component.rhOrdersLoaded.set(true);
      fixture.detectChanges();

      const all = component.allTickets();
      expect(all.some((t) => t.id === '1')).toBe(true);
    });

    it('hides cancelled tickets older than 24 hours (terminalAt)', () => {
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48h ago
      const ticket = makeTicket('1', 'AAPL', OrderTicketStatus.CANCELLED);
      ticket.terminalAt = old;
      storeMock.tickets.set({ '1': ticket });
      component.rhOrdersLoaded.set(true);
      fixture.detectChanges();

      const all = component.allTickets();
      expect(all.some((t) => t.id === '1')).toBe(false);
    });

    it('falls back to updatedAt when terminalAt is missing', () => {
      const recent = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
      const ticket = makeTicket('1', 'AAPL', OrderTicketStatus.CANCELLED);
      ticket.updatedAt = recent;
      storeMock.tickets.set({ '1': ticket });
      component.rhOrdersLoaded.set(true);
      fixture.detectChanges();

      const all = component.allTickets();
      expect(all.some((t) => t.id === '1')).toBe(true);
    });
  });

  describe('requeue', () => {
    it('moves a cancelled ticket back to STAGED', async () => {
      const ticket = makeTicket('1', 'AAPL', OrderTicketStatus.CANCELLED);
      ticket.terminalAt = new Date().toISOString();
      storeMock.tickets.set({ '1': ticket });
      fixture.detectChanges();

      await component.onRequeueTicket('1');

      expect(storeMock.updateTicket).toHaveBeenCalledWith('1', jasmine.objectContaining({
        status: OrderTicketStatus.STAGED,
        result: undefined,
        error: undefined,
      }));
      expect(component.selectedTicketId()).toBe('1');
    });

    it('does not requeue a non-cancelled ticket', async () => {
      const ticket = makeTicket('1', 'AAPL', OrderTicketStatus.SUBMITTED);
      storeMock.tickets.set({ '1': ticket });
      fixture.detectChanges();

      await component.onRequeueTicket('1');

      expect(storeMock.updateTicket).not.toHaveBeenCalled();
    });
  });
});

// Helper: create a signal-like function for the mock store
function signal<T>(initial: T) {
  let value = initial;
  const s: any = () => value;
  s.set = (v: T) => { value = v; };
  s.update = (fn: (v: T) => T) => { value = fn(value); };
  return s;
}
