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
import { RobinhoodMcpObservationService } from '../../services/robinhood-mcp-observation.service';
import { OrderTicketService } from '../../services/order-ticket.service';
import { UiStateService } from '../../../../core/services/ui-state.service';
import {
  OrderTicket,
  OrderTicketStatus,
  OrderSource,
  InstrumentType,
} from '../../services/order-ticket.types';

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
});

// Helper: create a signal-like function for the mock store
function signal<T>(initial: T) {
  let value = initial;
  const s: any = () => value;
  s.set = (v: T) => { value = v; };
  s.update = (fn: (v: T) => T) => { value = fn(value); };
  return s;
}
