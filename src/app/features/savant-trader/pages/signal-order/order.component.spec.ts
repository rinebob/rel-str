import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router, provideRouter } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError, from } from 'rxjs';
import { TradeSide } from '@common';

import { OrderComponent } from './order.component';
import { OrderTicketStore } from '../../stores/order-ticket.store';
import { OccurrenceDecisionStore } from '../../stores/occurrence-decision.store';
import { TradingConfigService } from '../../services/trading-config.service';
import { EquityPriceService } from '../../services/equity-price.service';
import { PortfolioService } from '../../services/portfolio.service';
import { RobinhoodMcpObservationService } from '../../../../core/robinhood-mcp/robinhood-mcp-observation.service';
import { OrderTicketService } from '../../services/order-ticket.service';
import { PaperTradingService } from '../../services/paper-trading.service';
import { AllocationStore } from '../../../portfolio-dashboard/allocation.store';
import { UiStateService } from '../../../../core/services/ui-state.service';
import {
  OrderTicket,
  OrderTicketStatus,
  OrderSource,
  InstrumentType,
  EquityOrderTicket,
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

/** Shared signalContext factory — the shape buildSignalOrderTickets writes. */
const ctx = (decisionId: string) => ({
  signalType: 'D_ZONE_V1_UPTICK',
  barDate: '2026-08-25',
  timeframe: 'weekly',
  direction: 'long',
  decisionId,
});

describe('OrderComponent', () => {
  let fixture: ComponentFixture<OrderComponent>;
  let component: OrderComponent;
  let storeMock: any;
  let uiStateMock: any;
  let occurrenceMock: any;

  beforeEach(async () => {
    storeMock = {
      tickets: signal({}),
      loading: signal(false),
      error: signal(null),
      loadTickets: jasmine.createSpy('loadTickets'),
      // Mimics the real store's synchronous optimistic delete — the
      // protection check in onRemoveTickets reads tickets() after removal.
      removeTicket: jasmine.createSpy('removeTicket').and.callFake((id: string) => {
        const next = { ...storeMock.tickets() };
        delete next[id];
        storeMock.tickets.set(next);
      }),
      updateTicket: jasmine.createSpy('updateTicket'),
      updateTicketAndWait: jasmine.createSpy('updateTicketAndWait').and.returnValue(Promise.resolve(true)),
      setTicketStatusLocal: jasmine.createSpy('setTicketStatusLocal'),
      // Shared paper transaction (#755) — resolves the cohort response
      // by default; individual tests reject to exercise the failure path.
      sendTicketToPaper: jest.fn().mockResolvedValue({ cohortId: 'c1', expressionTradeIds: [] }),
      reconcileTerminalStatuses: jasmine.createSpy('reconcileTerminalStatuses'),
    };

    uiStateMock = {
      setFullscreen: jasmine.createSpy('setFullscreen'),
    };

    occurrenceMock = {
      clearDecisionById: jasmine.createSpy('clearDecisionById'),
    };

    await TestBed.configureTestingModule({
      imports: [OrderComponent],
      providers: [
        provideNoopAnimations(),
        { provide: OrderTicketStore, useValue: storeMock },
        { provide: OccurrenceDecisionStore, useValue: occurrenceMock },
        { provide: UiStateService, useValue: uiStateMock },
        provideRouter([]),
        { provide: TradingConfigService, useValue: { loadConfig: jasmine.createSpy('loadConfig').and.returnValue(of(null)) } },
        { provide: EquityPriceService, useValue: { prices: signal({}), loading: signal(false), fetchPrices: jasmine.createSpy('fetchPrices') } },
        { provide: PortfolioService, useValue: { getSnapshot: jasmine.createSpy('getSnapshot').and.returnValue(Promise.resolve(null)) } },
        { provide: RobinhoodMcpObservationService, useValue: { reauthenticate: jasmine.createSpy('reauthenticate') } },
        { provide: OrderTicketService, useValue: {} },
        { provide: PaperTradingService, useValue: { paperSignalOrder$: jest.fn() } },
        // OrderTicketComponent injects AllocationStore for the bucket
        // picker — stub it so the real store's Firestore deps stay out.
        { provide: AllocationStore, useValue: { byAccount: signal({}), ensureAccount: jest.fn(), bucketDetail: jest.fn(() => null) } },
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

  it('resets fullscreen on destroy', () => {
    fixture.destroy();
    expect(uiStateMock.setFullscreen).toHaveBeenCalledWith(false);
  });

  it('computes allTickets from store', () => {
    const ticket = makeTicket('1', 'AAPL');
    storeMock.tickets.set({ '1': ticket });
    fixture.detectChanges();

    expect(component.allTickets().length).toBe(1);
    expect(component.allTickets()[0].id).toBe('1');
  });

  it('re-selects the first visible ticket when the selected ticket leaves the queue', () => {
    storeMock.tickets.set({
      '1': makeTicket('1', 'AAPL'),
      '2': makeTicket('2', 'NVDA'),
    });
    component.rhOrdersLoaded.set(true);
    fixture.detectChanges();

    component.selectedTicketId.set('2');
    fixture.detectChanges();
    expect(component.selectedTicket()?.id).toBe('2');

    // '2' becomes PAPER (accept-as-paper from the detail pane) → filtered
    storeMock.tickets.set({
      '1': makeTicket('1', 'AAPL'),
      '2': makeTicket('2', 'NVDA', OrderTicketStatus.PAPER),
    });
    component.rhOrders.set({}); // re-dirty allTickets so the effect re-runs
    fixture.detectChanges();

    expect(component.selectedTicketId()).toBe('1');
    expect(component.selectedTicket()?.id).toBe('1');
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

  it('calls removeTicket for each removable id in batch remove', () => {
    // Only existing STAGED/terminal tickets are removed — the guard reads
    // the store, so nonexistent ids are skipped too.
    storeMock.tickets.set({
      '1': makeTicket('1', 'AAPL'),
      '2': makeTicket('2', 'NVDA'),
      '3': makeTicket('3', 'MSFT'),
    });
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

  it('nets resting limit-buy notional out of available cash (#707)', () => {
    component.accountSnapshot.set({
      accountValue: 24964.03, exposure: 163.81, cash: 24800.22,
      positionCount: 2, units: 1.64, positions: [],
    });
    component.rhOrders.set({
      resting: { id: 'r1', symbol: 'AAPL', side: 'buy', type: 'limit', state: 'confirmed', price: '50.00', quantity: '10' },
      cancelled: { id: 'c1', symbol: 'MSFT', side: 'buy', type: 'limit', state: 'cancelled', price: '99.00', quantity: '10' },
      sell: { id: 's1', symbol: 'QQQ', side: 'sell', type: 'limit', state: 'confirmed', price: '60.00', quantity: '5' },
    });
    fixture.detectChanges();

    expect(component.restingLimitBuyNotional()).toBe(500);
    expect(component.availableCash()).toBe(24300.22);
    const scoreboard = fixture.nativeElement.querySelector('.scoreboard').textContent;
    expect(scoreboard).toContain('$24,300.22');
    expect(scoreboard).toContain('$500');
  });

  it('navigates back to signal-review on goBack', () => {
    const router = TestBed.inject(Router);
    const navSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    component.goBack();
    expect(navSpy).toHaveBeenCalledWith(['/signals/review']);
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

    it('excludes PAPER tickets from allTickets — once paper, this page does not care', () => {
      storeMock.tickets.set({
        '1': makeTicket('1', 'AAPL', OrderTicketStatus.PAPER),
        '2': makeTicket('2', 'NVDA', OrderTicketStatus.STAGED),
      });
      fixture.detectChanges();

      // Before RH load — paper still hidden
      expect(component.allTickets().map((t) => t.id)).toEqual(['2']);

      // After RH load — same
      component.rhOrdersLoaded.set(true);
      fixture.detectChanges();
      expect(component.allTickets().map((t) => t.id)).toEqual(['2']);
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

  describe('onRemoveTickets', () => {
    it('skips non-removable statuses — PAPER and in-flight tickets are not deletable', () => {
      const staged = makeTicket('1', 'AAPL', OrderTicketStatus.STAGED);
      const paper = makeTicket('2', 'NVDA', OrderTicketStatus.PAPER);
      const submitting = makeTicket('3', 'MSFT', OrderTicketStatus.SUBMITTING);
      storeMock.tickets.set({ '1': staged, '2': paper, '3': submitting });
      fixture.detectChanges();

      component.onRemoveTickets(['1', '2', '3']);

      expect(storeMock.removeTicket).toHaveBeenCalledTimes(1);
      expect(storeMock.removeTicket).toHaveBeenCalledWith('1');
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

      expect(storeMock.updateTicketAndWait).toHaveBeenCalledWith('1', jasmine.objectContaining({
        status: OrderTicketStatus.STAGED,
        result: undefined,
        error: undefined,
      }));
      expect(component.selectedTicketId()).toBe('1');
    });

    it('mints a fresh refId on requeue — the cancelled order burned the old one at RH', async () => {
      const ticket = makeTicket('1', 'AAPL', OrderTicketStatus.CANCELLED);
      ticket.refId = 'ref-burned';
      ticket.terminalAt = new Date().toISOString();
      storeMock.tickets.set({ '1': ticket });
      fixture.detectChanges();

      await component.onRequeueTicket('1');

      const patch = storeMock.updateTicketAndWait.calls.mostRecent().args[1] as Partial<OrderTicket>;
      expect(patch.refId).toBeTruthy();
      expect(patch.refId).not.toBe('ref-burned');
      expect(patch.refId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('requeues a FAILED ticket — a rejected order already burned its refId at RH', async () => {
      const ticket = makeTicket('1', 'AAPL', OrderTicketStatus.FAILED);
      ticket.refId = 'ref-burned';
      ticket.result = { orderId: 'rh-ord-1', state: 'rejected' };
      ticket.error = { message: 'rejected', retryable: false };
      storeMock.tickets.set({ '1': ticket });
      fixture.detectChanges();

      await component.onRequeueTicket('1');

      const patch = storeMock.updateTicketAndWait.calls.mostRecent().args[1] as Partial<OrderTicket>;
      expect(patch.status).toBe(OrderTicketStatus.STAGED);
      expect(patch.refId).not.toBe('ref-burned');
      expect(patch.result).toBeUndefined();
      expect(patch.error).toBeUndefined();
    });

    it('does not requeue a non-terminal ticket', async () => {
      const ticket = makeTicket('1', 'AAPL', OrderTicketStatus.SUBMITTED);
      storeMock.tickets.set({ '1': ticket });
      fixture.detectChanges();

      await component.onRequeueTicket('1');

      expect(storeMock.updateTicketAndWait).not.toHaveBeenCalled();
    });
  });

  describe('ticket removal clears the accepted decision (#719)', () => {
    it('clears the decision when its queue ticket is removed', () => {
      const ticket = makeTicket('1', 'AAPL');
      ticket.signalContext = ctx('run1-AAPL-weekly-up');
      storeMock.tickets.set({ '1': ticket });
      fixture.detectChanges();

      component.onRemoveTickets(['1']);

      expect(storeMock.removeTicket).toHaveBeenCalledWith('1');
      expect(occurrenceMock.clearDecisionById).toHaveBeenCalledWith('run1-AAPL-weekly-up');
    });

    it('keeps the decision while another live ticket references it', () => {
      const t1 = makeTicket('1', 'AAPL');
      t1.signalContext = ctx('dec-shared');
      const t2 = makeTicket('2', 'AAPL');
      t2.signalContext = ctx('dec-shared');
      storeMock.tickets.set({ '1': t1, '2': t2 });
      fixture.detectChanges();

      component.onRemoveTickets(['1']);

      expect(occurrenceMock.clearDecisionById).not.toHaveBeenCalled();
    });

    it('clears each distinct decision on a multi-ticket removal', () => {
      const t1 = makeTicket('1', 'AAPL');
      t1.signalContext = ctx('dec-a');
      const t2 = makeTicket('2', 'MSFT');
      t2.signalContext = ctx('dec-b');
      storeMock.tickets.set({ '1': t1, '2': t2 });
      fixture.detectChanges();

      component.onRemoveTickets(['1', '2']);

      expect(occurrenceMock.clearDecisionById).toHaveBeenCalledWith('dec-a');
      expect(occurrenceMock.clearDecisionById).toHaveBeenCalledWith('dec-b');
    });

    it('skips removal of a mid-flight ticket — the queue can render terminal from a merged RH state', () => {
      // A ticket whose store status is SUBMITTING may still display as
      // terminal (merged from a stale RH order) and show a dismiss button.
      // The guard reads the store ticket, not the merged row.
      const t = makeTicket('1', 'AAPL', OrderTicketStatus.SUBMITTING);
      t.signalContext = ctx('dec-a');
      storeMock.tickets.set({ '1': t });
      fixture.detectChanges();

      component.onRemoveTickets(['1']);

      expect(storeMock.removeTicket).not.toHaveBeenCalled();
      expect(occurrenceMock.clearDecisionById).not.toHaveBeenCalled();
      expect(TestBed.inject(MatSnackBar).open).toHaveBeenCalled();
    });

    it('does not touch decisions for tickets without signalContext', () => {
      const ticket = makeTicket('1', 'AAPL');
      ticket.signalContext = undefined;
      storeMock.tickets.set({ '1': ticket });
      fixture.detectChanges();

      component.onRemoveTickets(['1']);

      expect(occurrenceMock.clearDecisionById).not.toHaveBeenCalled();
    });

    it('normalizes a legacy hyphen-format decisionId to the canonical doc id', () => {
      // Tickets staged before the producer used buildStOccurrenceDecisionId
      // carry `${runId}-${symbol}-${tf}-${type}`; the doc id is
      // `${runId}_${SYMBOL}_${tf}_${type}`. Removing such a ticket must
      // still delete the real decision doc (round-2 review critical).
      const ticket = makeTicket('1', 'AAPL');
      ticket.signalContext = ctx('run-2026-09-01-AAPL-weekly-D_ZONE_V1_UPTICK');
      storeMock.tickets.set({ '1': ticket });
      fixture.detectChanges();

      component.onRemoveTickets(['1']);

      expect(occurrenceMock.clearDecisionById).toHaveBeenCalledWith(
        'run-2026-09-01_AAPL_weekly_D_ZONE_V1_UPTICK',
      );
    });

    it('clears every decisionId owned by a ticket — one accept writes N decisions but stages one deduped ticket', () => {
      // Regression for the QA failure: two same-side signals → two decision
      // docs but a single ticket. Clearing only `decisionId` left siblings
      // live and the Accept toggle stayed on.
      const ticket = makeTicket('1', 'AAPL');
      ticket.signalContext = { ...ctx('run1_AAPL_D_SIG1'), decisionIds: ['dec-1', 'dec-2'] };
      storeMock.tickets.set({ '1': ticket });
      fixture.detectChanges();

      component.onRemoveTickets(['1']);

      expect(occurrenceMock.clearDecisionById).toHaveBeenCalledWith('dec-1');
      expect(occurrenceMock.clearDecisionById).toHaveBeenCalledWith('dec-2');
    });

    it('a live ticket\'s decisionIds also protect shared decisions', () => {
      const t1 = makeTicket('1', 'AAPL');
      t1.signalContext = { ...ctx('dec-a'), decisionIds: ['dec-a', 'dec-shared'] };
      const t2 = makeTicket('2', 'AAPL');
      t2.signalContext = { ...ctx('dec-b'), decisionIds: ['dec-b', 'dec-shared'] };
      storeMock.tickets.set({ '1': t1, '2': t2 });
      fixture.detectChanges();

      component.onRemoveTickets(['1']);

      expect(occurrenceMock.clearDecisionById).toHaveBeenCalledWith('dec-a');
      expect(occurrenceMock.clearDecisionById).not.toHaveBeenCalledWith('dec-shared');
    });

    it('calls clearDecisionById once when two removed tickets share a decision', () => {
      const t1 = makeTicket('1', 'AAPL');
      t1.signalContext = ctx('dec-shared');
      const t2 = makeTicket('2', 'AAPL');
      t2.signalContext = ctx('dec-shared');
      storeMock.tickets.set({ '1': t1, '2': t2 });
      fixture.detectChanges();

      component.onRemoveTickets(['1', '2']);

      expect(occurrenceMock.clearDecisionById).toHaveBeenCalledTimes(1);
      expect(occurrenceMock.clearDecisionById).toHaveBeenCalledWith('dec-shared');
    });
  });

  describe('bulk send to paper (#709)', () => {
    let priceMock: { prices: any };
    let snack: any;

    beforeEach(() => {
      priceMock = TestBed.inject(EquityPriceService) as any;
      snack = TestBed.inject(MatSnackBar);
      storeMock.sendTicketToPaper.mockReset();
      storeMock.sendTicketToPaper.mockResolvedValue({ cohortId: 'c1', expressionTradeIds: ['e1'] });
      priceMock.prices.set({});
    });

    it('sends each checked staged signal ticket through the shared store transaction', async () => {
      const t1 = makeTicket('1', 'AAPL');
      t1.signalContext = ctx('dec-a');
      const t2 = makeTicket('2', 'NVDA');
      t2.signalContext = ctx('dec-b');
      storeMock.tickets.set({ '1': t1, '2': t2 });
      fixture.detectChanges();

      await component.onSendTicketsToPaper(['1', '2']);

      // Request shape, SUBMITTING transient, PAPER/STAGED transitions all
      // live inside sendTicketToPaper (#755) — covered in the store spec.
      expect(storeMock.sendTicketToPaper).toHaveBeenCalledTimes(2);
      expect(storeMock.sendTicketToPaper).toHaveBeenCalledWith(t1, 100);
      expect(storeMock.sendTicketToPaper).toHaveBeenCalledWith(t2, 100);
      expect(snack.open).toHaveBeenCalledWith(
        expect.stringContaining('2 sent to paper'),
        'Dismiss',
        expect.anything(),
      );
    });

    it('passes sell-side tickets through — direction mapping lives in the store request builder', async () => {
      const t = makeTicket('1', 'AAPL');
      t.side = 'sell';
      t.signalContext = ctx('dec-s');
      storeMock.tickets.set({ '1': t });
      fixture.detectChanges();

      await component.onSendTicketsToPaper(['1']);

      expect(storeMock.sendTicketToPaper).toHaveBeenCalledWith(
        expect.objectContaining({ side: 'sell' }),
        expect.anything(),
      );
    });

    it('skips ineligible tickets — option, non-signal, or not staged', async () => {
      const opt = {
        ...makeTicket('1', 'SPY'),
        instrumentType: InstrumentType.OPTION,
        signalContext: ctx('d1'),
        legs: [],
      } as OrderTicket;
      const filled = makeTicket('2', 'NVDA', OrderTicketStatus.FILLED);
      filled.signalContext = ctx('d2');
      const manual = { ...makeTicket('3', 'MSFT'), source: OrderSource.MANUAL } as OrderTicket;
      manual.signalContext = undefined;
      storeMock.tickets.set({ '1': opt, '2': filled, '3': manual });
      fixture.detectChanges();

      await component.onSendTicketsToPaper(['1', '2', '3']);

      expect(storeMock.sendTicketToPaper).not.toHaveBeenCalled();
      expect(storeMock.updateTicket).not.toHaveBeenCalled();
      expect(snack.open).toHaveBeenCalledWith(
        expect.stringContaining('skipped'),
        'Dismiss',
        expect.anything(),
      );
    });

    it('reports the failure count when a send rejects — the store owns the STAGED revert', async () => {
      const t1 = makeTicket('1', 'AAPL');
      t1.signalContext = ctx('dec-a');
      const t2 = makeTicket('2', 'NVDA');
      t2.signalContext = ctx('dec-b');
      storeMock.tickets.set({ '1': t1, '2': t2 });
      fixture.detectChanges();

      storeMock.sendTicketToPaper
        .mockResolvedValueOnce({ cohortId: 'c', expressionTradeIds: [] })
        .mockRejectedValueOnce(new Error('boom'));

      await component.onSendTicketsToPaper(['1', '2']);

      expect(snack.open).toHaveBeenCalledWith(
        expect.stringContaining('1 failed'),
        'Dismiss',
        expect.anything(),
      );
    });

    it('derives quantity from dollarAmount at the live price for unedited tickets', async () => {
      // Signal-staged tickets carry dollarAmount only — quantity exists
      // only if the ticket was opened in the detail pane (auto-calc).
      // Without derivation the callable would 400 'no usable quantity'.
      const t = makeTicket('1', 'AAPL') as EquityOrderTicket;
      t.signalContext = ctx('dec-a');
      t.quantity = undefined;
      t.dollarAmount = '500';
      storeMock.tickets.set({ '1': t });
      priceMock.prices.set({ AAPL: 50 });
      fixture.detectChanges();

      await component.onSendTicketsToPaper(['1']);

      expect(storeMock.sendTicketToPaper).toHaveBeenCalledWith(
        expect.objectContaining({ id: '1' }), 10, // $500 / $50
      );
    });

    it('skips a ticket that left the staged pool mid-batch', async () => {
      const t = makeTicket('1', 'AAPL');
      t.signalContext = ctx('dec-a');
      storeMock.tickets.set({ '1': t });
      fixture.detectChanges();

      // The batch re-reads each ticket before sending — flip ticket 2 out
      // of STAGED while ticket 1's send is in flight.
      const t2 = makeTicket('2', 'NVDA');
      t2.signalContext = ctx('dec-b');
      storeMock.tickets.set({ '1': t, '2': t2 });
      storeMock.sendTicketToPaper.mockImplementation(async () => {
        storeMock.tickets.set({
          '1': t,
          '2': { ...t2, status: OrderTicketStatus.SUBMITTED },
        });
        return { cohortId: 'c', expressionTradeIds: [] };
      });

      await component.onSendTicketsToPaper(['1', '2']);

      expect(storeMock.sendTicketToPaper).toHaveBeenCalledTimes(1);
      expect(snack.open).toHaveBeenCalledWith(
        expect.stringContaining('no longer staged'),
        'Dismiss',
        expect.anything(),
      );
    });

    it('ignores a second batch invocation while one is in flight', async () => {
      const t = makeTicket('1', 'AAPL');
      t.signalContext = ctx('dec-a');
      storeMock.tickets.set({ '1': t });
      fixture.detectChanges();

      // Hold the send open while the second invocation fires.
      let release!: (v: unknown) => void;
      storeMock.sendTicketToPaper.mockReturnValueOnce(
        new Promise((res) => (release = res)),
      );
      const first = component.onSendTicketsToPaper(['1']);
      await component.onSendTicketsToPaper(['1']);
      release({ cohortId: 'c', expressionTradeIds: [] });
      await first;

      expect(storeMock.sendTicketToPaper).toHaveBeenCalledTimes(1);
    });

    it('fails the ticket with a visible error when quantity is uncomputable (no price)', async () => {
      const t = makeTicket('1', 'AAPL') as EquityOrderTicket;
      t.signalContext = ctx('dec-a');
      t.quantity = undefined;
      t.dollarAmount = '500';
      storeMock.tickets.set({ '1': t });
      fixture.detectChanges();

      await component.onSendTicketsToPaper(['1']);

      expect(storeMock.sendTicketToPaper).not.toHaveBeenCalled();
      expect(storeMock.updateTicket).toHaveBeenCalledWith(
        '1',
        expect.objectContaining({ error: expect.objectContaining({ retryable: true }) }),
      );
      expect(snack.open).toHaveBeenCalledWith(
        expect.stringContaining('1 failed'),
        'Dismiss',
        expect.anything(),
      );
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
