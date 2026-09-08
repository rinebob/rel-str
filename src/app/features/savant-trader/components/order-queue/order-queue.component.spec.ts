import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { OrderQueueComponent } from './order-queue.component';
import {
  OrderTicket,
  OrderTicketStatus,
  OrderSource,
  InstrumentType,
} from '../../services/order-ticket.types';

function makeTicket(
  id: string,
  status: OrderTicketStatus,
  symbol: string,
  side: 'buy' | 'sell' = 'buy',
): OrderTicket {
  return {
    id,
    refId: `ref-${id}`,
    source: OrderSource.SIGNAL_PIPELINE,
    status,
    accountNumber: '123456789',
    side,
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

describe('OrderQueueComponent', () => {
  let fixture: ComponentFixture<OrderQueueComponent>;
  let component: OrderQueueComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrderQueueComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(OrderQueueComponent);
    component = fixture.componentInstance;
  });

  describe('empty state', () => {
    it('shows empty state message when no tickets', () => {
      fixture.componentRef.setInput('tickets', []);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const empty = fixture.nativeElement.querySelector('.empty-state');
      expect(empty).toBeTruthy();
      expect(empty.textContent).toContain('No staged orders');
    });

    it('does not show empty state when tickets exist', () => {
      fixture.componentRef.setInput('tickets', [makeTicket('1', OrderTicketStatus.STAGED, 'AAPL')]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const empty = fixture.nativeElement.querySelector('.empty-state');
      expect(empty).toBeFalsy();
    });
  });

  describe('grouping', () => {
    it('groups tickets by status', () => {
      const tickets = [
        makeTicket('1', OrderTicketStatus.STAGED, 'AAPL'),
        makeTicket('2', OrderTicketStatus.SUBMITTED, 'NVDA'),
        makeTicket('3', OrderTicketStatus.FILLED, 'MSFT'),
        makeTicket('4', OrderTicketStatus.FAILED, 'TSLA'),
      ];
      fixture.componentRef.setInput('tickets', tickets);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const groups = component.groups();
      expect(groups.length).toBe(4);
      expect(groups[0].label).toBe('Staged');
      expect(groups[0].tickets.length).toBe(1);
      expect(groups[1].label).toBe('Submitted');
      expect(groups[2].label).toBe('Open Positions');
      expect(groups[3].label).toBe('Failed');
    });

    it('places accepted non-market orders in the Resting group', () => {
      const limit = makeTicket('1', OrderTicketStatus.SUBMITTED, 'AAPL');
      limit.orderType = 'limit';
      const market = makeTicket('2', OrderTicketStatus.SUBMITTED, 'MSFT');

      fixture.componentRef.setInput('tickets', [limit, market]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const groups = component.groups();
      expect(groups.find((group) => group.label === 'Resting')?.tickets).toEqual([limit]);
      expect(groups.find((group) => group.label === 'Submitted')?.tickets).toEqual([market]);
    });

    it('groups STAGED tickets together', () => {
      const tickets = [
        makeTicket('1', OrderTicketStatus.STAGED, 'AAPL'),
        makeTicket('2', OrderTicketStatus.STAGED, 'NVDA'),
      ];
      fixture.componentRef.setInput('tickets', tickets);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const groups = component.groups();
      expect(groups.length).toBe(1);
      expect(groups[0].label).toBe('Staged');
      expect(groups[0].tickets.length).toBe(2);
    });

    it('hides groups with no tickets', () => {
      const tickets = [makeTicket('1', OrderTicketStatus.STAGED, 'AAPL')];
      fixture.componentRef.setInput('tickets', tickets);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const groups = component.groups();
      expect(groups.length).toBe(1);
      expect(groups[0].label).toBe('Staged');
    });

    it('renders group headers in the DOM', () => {
      const tickets = [
        makeTicket('1', OrderTicketStatus.STAGED, 'AAPL'),
        makeTicket('2', OrderTicketStatus.FILLED, 'NVDA'),
      ];
      fixture.componentRef.setInput('tickets', tickets);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const headers = fixture.nativeElement.querySelectorAll('.group-label');
      expect(headers.length).toBe(2);
      expect(headers[0].textContent).toContain('Staged');
      expect(headers[1].textContent).toContain('Open Positions');
    });
  });

  describe('selection', () => {
    it('emits ticketSelected when a row is clicked', () => {
      const tickets = [makeTicket('1', OrderTicketStatus.STAGED, 'AAPL')];
      fixture.componentRef.setInput('tickets', tickets);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      let emittedId: string | null = null;
      component.ticketSelected.subscribe((id) => (emittedId = id));

      const row = fixture.nativeElement.querySelector('.queue-item');
      row.click();
      fixture.detectChanges();

      expect(emittedId).toBe('1');
    });

    it('applies selected class to the selected row', () => {
      const tickets = [
        makeTicket('1', OrderTicketStatus.STAGED, 'AAPL'),
        makeTicket('2', OrderTicketStatus.STAGED, 'NVDA'),
      ];
      fixture.componentRef.setInput('tickets', tickets);
      fixture.componentRef.setInput('selectedId', '2');
      fixture.detectChanges();

      const rows = fixture.nativeElement.querySelectorAll('.queue-item');
      expect(rows[0].classList.contains('selected')).toBe(false);
      expect(rows[1].classList.contains('selected')).toBe(true);
    });

    it('does not emit selection when clicking checkbox', () => {
      const tickets = [makeTicket('1', OrderTicketStatus.STAGED, 'AAPL')];
      fixture.componentRef.setInput('tickets', tickets);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      let emitted = false;
      component.ticketSelected.subscribe(() => (emitted = true));

      const checkbox = fixture.nativeElement.querySelector('mat-checkbox');
      checkbox.click();
      fixture.detectChanges();

      expect(emitted).toBe(false);
    });
  });

  describe('batch select + remove', () => {
    it('emits removeTickets with checked ids', () => {
      const tickets = [
        makeTicket('1', OrderTicketStatus.STAGED, 'AAPL'),
        makeTicket('2', OrderTicketStatus.STAGED, 'NVDA'),
      ];
      fixture.componentRef.setInput('tickets', tickets);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      let removedIds: string[] | null = null;
      component.removeTickets.subscribe((ids) => (removedIds = ids));

      // Check both checkboxes
      component.toggleCheck('1', true);
      component.toggleCheck('2', true);
      fixture.detectChanges();

      component.removeChecked();
      fixture.detectChanges();

      expect(removedIds).toEqual(['1', '2']);
    });

    it('selects all tickets', () => {
      const tickets = [
        makeTicket('1', OrderTicketStatus.STAGED, 'AAPL'),
        makeTicket('2', OrderTicketStatus.FILLED, 'NVDA'),
      ];
      fixture.componentRef.setInput('tickets', tickets);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      component.selectAll();
      fixture.detectChanges();

      expect(component.isChecked('1')).toBe(true);
      expect(component.isChecked('2')).toBe(true);
      expect(component.hasChecked()).toBe(true);
    });

    it('clears selection', () => {
      const tickets = [makeTicket('1', OrderTicketStatus.STAGED, 'AAPL')];
      fixture.componentRef.setInput('tickets', tickets);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      component.toggleCheck('1', true);
      component.clearSelection();
      fixture.detectChanges();

      expect(component.isChecked('1')).toBe(false);
      expect(component.hasChecked()).toBe(false);
    });

    it('shows remove button only when checkboxes are checked', () => {
      fixture.componentRef.setInput('tickets', [makeTicket('1', OrderTicketStatus.STAGED, 'AAPL')]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      // No remove button initially
      expect(fixture.nativeElement.querySelector('.batch-link.remove')).toBeFalsy();

      // Check the box
      component.toggleCheck('1', true);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.batch-link.remove')).toBeTruthy();
    });
  });

  describe('row display', () => {
    it('shows symbol, side, order type, and quantity', () => {
      const ticket = makeTicket('1', OrderTicketStatus.STAGED, 'AAPL', 'sell');
      ticket.orderType = 'limit';
      ticket.quantity = '50';
      fixture.componentRef.setInput('tickets', [ticket]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const row = fixture.nativeElement.querySelector('.queue-item');
      expect(row.textContent).toContain('AAPL');
      expect(row.textContent).toContain('SELL');
      expect(row.textContent).toContain('LIMIT');
      expect(row.textContent).toContain('50');
    });

    it('shows source badge', () => {
      const ticket = makeTicket('1', OrderTicketStatus.STAGED, 'AAPL');
      fixture.componentRef.setInput('tickets', [ticket]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector('.source-badge');
      expect(badge.textContent).toContain('SIG');
    });

    it('shows status in group header', () => {
      const ticket = makeTicket('1', OrderTicketStatus.SUBMITTED, 'AAPL');
      fixture.componentRef.setInput('tickets', [ticket]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const header = fixture.nativeElement.querySelector('.group-label');
      expect(header).toBeTruthy();
      expect(header.textContent).toContain('Submitted');
    });
  });
});
