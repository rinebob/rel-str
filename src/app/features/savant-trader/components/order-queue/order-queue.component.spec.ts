import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { OrderQueueComponent } from './order-queue.component';
import {
  OrderTicket,
  OrderTicketStatus,
  OrderSource,
  InstrumentType,
  EquityOrderTicket,
  OptionLeg,
} from '../../services/order-ticket.types';

/** Typed fixture overrides — every key exists on a real ticket shape
 *  (equity fields + the option discriminant/legs). */
type TicketOverrides = Partial<Omit<EquityOrderTicket, 'instrumentType'>> & {
  instrumentType?: InstrumentType;
  legs?: OptionLeg[];
};

function makeTicket(
  id: string,
  status: OrderTicketStatus,
  symbol: string,
  side: 'buy' | 'sell' = 'buy',
  overrides: TicketOverrides = {},
): OrderTicket {
  // The base literal is equity-shaped; option fixtures override
  // instrumentType + legs. The cast narrows the merged object to the union.
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
    ...overrides,
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

    it('keeps locally-submitted tickets in Submitted until the RH merge derives Resting', () => {
      const limit = makeTicket('1', OrderTicketStatus.SUBMITTED, 'AAPL');
      limit.orderType = 'limit';
      const market = makeTicket('2', OrderTicketStatus.SUBMITTED, 'MSFT');

      fixture.componentRef.setInput('tickets', [limit, market]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      // Resting is derived by the page's RH merge — local SUBMITTED stays
      // Submitted here regardless of order type.
      const groups = component.groups();
      const submitted = groups.find((group) => group.label === 'Submitted');
      expect(submitted?.tickets).toContain(market);
      expect(submitted?.tickets).toContain(limit);
    });

    it('places RESTING tickets in the Resting group', () => {
      const resting = makeTicket('1', OrderTicketStatus.RESTING, 'AAPL');
      resting.orderType = 'limit';

      fixture.componentRef.setInput('tickets', [resting]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const groups = component.groups();
      expect(groups.find((group) => group.label === 'Resting')?.tickets).toEqual([resting]);
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

  describe('staged group aggregates', () => {
    it('sums shares, units, and dollars across staged tickets in the group header', () => {
      const tickets = [
        makeTicket('1', OrderTicketStatus.STAGED, 'AAPL', 'buy', { quantity: '10', dollarAmount: '1000' }),
        makeTicket('2', OrderTicketStatus.STAGED, 'NVDA', 'buy', { quantity: '5', dollarAmount: '500' }),
      ];
      fixture.componentRef.setInput('tickets', tickets);
      fixture.componentRef.setInput('selectedId', null);
      fixture.componentRef.setInput('defaultDollarAmount', 100);
      fixture.detectChanges();

      const stagedHeader = fixture.nativeElement.querySelector('.group-staged .group-header');
      const agg = stagedHeader.querySelector('.staged-agg');
      expect(agg).toBeTruthy();
      expect(agg.textContent).toContain('15 sh');
      expect(agg.textContent).toContain('15u'); // (1000+500)/100
      expect(agg.textContent).toContain('$1,500');
    });

    it('excludes option tickets and non-staged tickets from the staged aggregates', () => {
      const optionTicket = makeTicket('opt', OrderTicketStatus.STAGED, 'QQQ', 'buy', {
        instrumentType: InstrumentType.OPTION,
        legs: [{ type: 'buy', symbol: 'QQQ  260320C00500000', quantity: '2' }],
        quantity: '2',
        dollarAmount: '9999',
      });
      const tickets = [
        makeTicket('1', OrderTicketStatus.STAGED, 'AAPL', 'buy', { quantity: '10', dollarAmount: '1500' }),
        optionTicket,
        makeTicket('3', OrderTicketStatus.SUBMITTED, 'MSFT', 'buy', { quantity: '4', dollarAmount: '999' }),
      ];
      fixture.componentRef.setInput('tickets', tickets);
      fixture.componentRef.setInput('selectedId', null);
      fixture.componentRef.setInput('defaultDollarAmount', 100);
      fixture.detectChanges();

      const agg = fixture.nativeElement.querySelector('.group-staged .staged-agg');
      expect(agg.textContent).toContain('10 sh');
      expect(agg.textContent).toContain('15u');
      expect(agg.textContent).toContain('$1,500');
    });

    it('does not show the aggregate when the staged group is empty', () => {
      fixture.componentRef.setInput('tickets', [makeTicket('1', OrderTicketStatus.FILLED, 'AAPL')]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.staged-agg')).toBeNull();
    });

    it('reports staged sells in a separate bucket instead of inflating the buy total', () => {
      const tickets = [
        makeTicket('1', OrderTicketStatus.STAGED, 'AAPL', 'buy', { quantity: '10', dollarAmount: '1500' }),
        makeTicket('2', OrderTicketStatus.STAGED, 'NVDA', 'sell', { quantity: '4', dollarAmount: '500' }),
      ];
      fixture.componentRef.setInput('tickets', tickets);
      fixture.componentRef.setInput('selectedId', null);
      fixture.componentRef.setInput('defaultDollarAmount', 100);
      fixture.detectChanges();

      const agg = fixture.nativeElement.querySelector('.group-staged .staged-agg');
      expect(agg.textContent).toContain('10 sh');
      expect(agg.textContent).toContain('15u');
      expect(agg.textContent).toContain('$1,500');
      const sell = agg.querySelector('.staged-agg-sell');
      expect(sell.textContent).toContain('4 sh');
      expect(sell.textContent).toContain('5u');
      expect(sell.textContent).toContain('$500');
    });

    it('excludes tickets with neither quantity nor dollarAmount — no default-dollar estimates in the total', () => {
      const tickets = [
        makeTicket('1', OrderTicketStatus.STAGED, 'AAPL', 'buy', { quantity: '10', dollarAmount: '1000' }),
        makeTicket('2', OrderTicketStatus.STAGED, 'NVDA', 'buy', { quantity: undefined, dollarAmount: undefined }),
      ];
      fixture.componentRef.setInput('tickets', tickets);
      fixture.componentRef.setInput('selectedId', null);
      fixture.componentRef.setInput('defaultDollarAmount', 100);
      fixture.detectChanges();

      const agg = fixture.nativeElement.querySelector('.group-staged .staged-agg');
      expect(agg.textContent).toContain('10 sh');
      expect(agg.textContent).toContain('10u');
      expect(agg.textContent).toContain('$1,000');
    });

    it('hides the aggregate when staged tickets carry nothing computable', () => {
      const ticket = makeTicket('1', OrderTicketStatus.STAGED, 'AAPL', 'buy', {
        quantity: undefined,
        dollarAmount: undefined,
      });
      fixture.componentRef.setInput('tickets', [ticket]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.staged-agg')).toBeNull();
    });

    it('skips NaN ticket fields — a malformed ticket contributes nothing', () => {
      const tickets = [
        makeTicket('1', OrderTicketStatus.STAGED, 'AAPL', 'buy', { quantity: '10', dollarAmount: '1000' }),
        makeTicket('2', OrderTicketStatus.STAGED, 'NVDA', 'buy', { quantity: 'abc', dollarAmount: 'xyz' }),
      ];
      fixture.componentRef.setInput('tickets', tickets);
      fixture.componentRef.setInput('selectedId', null);
      fixture.componentRef.setInput('defaultDollarAmount', 100);
      fixture.detectChanges();

      const agg = fixture.nativeElement.querySelector('.group-staged .staged-agg');
      expect(agg.textContent).toContain('10 sh');
      expect(agg.textContent).toContain('$1,000');
    });
  });

  describe('row display', () => {
    it('shows symbol, side, shares, units, and dollar amount', () => {
      const ticket = makeTicket('1', OrderTicketStatus.STAGED, 'AAPL', 'sell', {
        quantity: '50',
        dollarAmount: '5000',
      });
      fixture.componentRef.setInput('tickets', [ticket]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.componentRef.setInput('defaultDollarAmount', 100);
      fixture.detectChanges();

      const row = fixture.nativeElement.querySelector('.queue-item');
      expect(row.textContent).toContain('AAPL');
      expect(row.textContent).toContain('SELL');
      expect(row.textContent).toContain('50 sh');
      expect(row.textContent).toContain('50u'); // $5000 / $100 default
      expect(row.textContent).toContain('$5,000');
    });

    it('computes whole-share count and real cost from dollarAmount when quantity is absent', () => {
      const ticket = makeTicket('1', OrderTicketStatus.STAGED, 'AAPL', 'buy', {
        quantity: undefined,
        dollarAmount: '500',
      });
      fixture.componentRef.setInput('tickets', [ticket]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.componentRef.setInput('prices', { AAPL: 120 });
      fixture.detectChanges();

      const row = fixture.nativeElement.querySelector('.queue-item');
      expect(row.textContent).toContain('4 sh'); // round(500/120)
      expect(row.textContent).toContain('$480'); // 4 × 120
      expect(row.textContent).toContain('4.8u'); // 480 / 100 default
    });

    it('shows fractional quantity verbatim — never rounded to zero', () => {
      const ticket = makeTicket('1', OrderTicketStatus.STAGED, 'AAPL', 'sell', {
        quantity: '0.33',
        dollarAmount: undefined,
      });
      fixture.componentRef.setInput('tickets', [ticket]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.componentRef.setInput('prices', { AAPL: 200 });
      fixture.detectChanges();

      const row = fixture.nativeElement.querySelector('.queue-item');
      expect(row.textContent).toContain('0.33 sh');
      expect(row.textContent).toContain('$66');
    });

    it('prefers quantity × price over the stored dollarAmount when both exist', () => {
      const ticket = makeTicket('1', OrderTicketStatus.STAGED, 'AAPL', 'buy', {
        quantity: '10',
        dollarAmount: '1500',
      });
      fixture.componentRef.setInput('tickets', [ticket]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.componentRef.setInput('prices', { AAPL: 120 });
      fixture.componentRef.setInput('defaultDollarAmount', 100);
      fixture.detectChanges();

      const row = fixture.nativeElement.querySelector('.queue-item');
      expect(row.textContent).toContain('10 sh');
      expect(row.textContent).toContain('$1,200'); // 10 × 120 — not the stale stored 1500
      expect(row.textContent).toContain('12u');
    });

    it('marks default-dollar-derived fields as estimates', () => {
      const ticket = makeTicket('1', OrderTicketStatus.STAGED, 'AAPL', 'buy', {
        quantity: undefined,
        dollarAmount: undefined,
      });
      fixture.componentRef.setInput('tickets', [ticket]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.componentRef.setInput('prices', { AAPL: 200 });
      fixture.componentRef.setInput('defaultDollarAmount', 400);
      fixture.detectChanges();

      const dollars = fixture.nativeElement.querySelector('.item-dollars');
      expect(dollars.textContent).toContain('~$400'); // sizing: 2 sh × 200
      expect(dollars.classList.contains('estimated')).toBe(true);
      const shares = fixture.nativeElement.querySelector('.item-shares');
      expect(shares.textContent).toContain('~');
    });

    it('shows contract count for option tickets instead of share math', () => {
      const ticket = makeTicket('1', OrderTicketStatus.STAGED, 'QQQ', 'buy', {
        instrumentType: InstrumentType.OPTION,
        legs: [{ type: 'buy', symbol: 'QQQ  260320C00500000', quantity: '2' }],
        quantity: '2',
      });
      fixture.componentRef.setInput('tickets', [ticket]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const row = fixture.nativeElement.querySelector('.queue-item');
      expect(row.textContent).toContain('2 contracts');
    });

    it('shows source badge', () => {
      const ticket = makeTicket('1', OrderTicketStatus.STAGED, 'AAPL');
      fixture.componentRef.setInput('tickets', [ticket]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector('.source-badge');
      expect(badge.textContent).toContain('SIG');
    });

    it('omits the source badge for an unrecognized source instead of showing ???', () => {
      const ticket = makeTicket('1', OrderTicketStatus.STAGED, 'AAPL', 'buy', {
        source: 'legacy_feed' as OrderSource,
      });
      fixture.componentRef.setInput('tickets', [ticket]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector('.source-badge');
      expect(badge).toBeNull();
    });

    it('omits the date span when the ticket has no signalContext or createdAt date', () => {
      const ticket = makeTicket('1', OrderTicketStatus.STAGED, 'AAPL', 'buy', {
        signalContext: undefined,
        createdAt: '',
      });
      fixture.componentRef.setInput('tickets', [ticket]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.item-date')).toBeNull();
    });

    it('omits shares and dollars when nothing on the ticket is computable (no price, no quantity)', () => {
      const ticket = makeTicket('1', OrderTicketStatus.STAGED, 'AAPL', 'buy', {
        quantity: undefined,
        dollarAmount: undefined,
      });
      fixture.componentRef.setInput('tickets', [ticket]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const row = fixture.nativeElement.querySelector('.queue-item');
      // Column spans stay rendered for alignment but render empty.
      expect(row.querySelector('.item-shares').textContent.trim()).toBe('');
      expect(row.querySelector('.item-units').textContent.trim()).toBe('');
      expect(row.querySelector('.item-dollars').textContent.trim()).toBe('');
    });

    it('shows quantity, notional, and units for worked tickets (integer shares, varying amount)', () => {
      const ticket = makeTicket('1', OrderTicketStatus.STAGED, 'AAPL', 'buy', {
        quantity: '7',
        dollarAmount: undefined,
      });
      fixture.componentRef.setInput('tickets', [ticket]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.componentRef.setInput('prices', { AAPL: 200 });
      fixture.componentRef.setInput('defaultDollarAmount', 500);
      fixture.detectChanges();

      const row = fixture.nativeElement.querySelector('.queue-item');
      expect(row.textContent).toContain('7 sh');
      expect(row.textContent).toContain('$1,400'); // 7 × 200
      expect(row.textContent).toContain('2.8u'); // 1400 / 500
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

  describe('protected badge', () => {
    it('shows PROTECTED badge when protectedSymbols contains the ticket symbol', () => {
      const ticket = makeTicket('1', OrderTicketStatus.FILLED, 'AAPL');
      fixture.componentRef.setInput('tickets', [ticket]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.componentRef.setInput('protectedSymbols', new Set(['AAPL']));
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector('.protected-badge');
      expect(badge).toBeTruthy();
      expect(badge.textContent).toContain('PROTECTED');
    });

    it('does not show PROTECTED badge when protectedSymbols does not contain the symbol', () => {
      const ticket = makeTicket('1', OrderTicketStatus.FILLED, 'AAPL');
      fixture.componentRef.setInput('tickets', [ticket]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.componentRef.setInput('protectedSymbols', new Set(['NVDA']));
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector('.protected-badge');
      expect(badge).toBeFalsy();
    });

    it('does not show PROTECTED badge for sell-side tickets', () => {
      const ticket = makeTicket('1', OrderTicketStatus.FILLED, 'AAPL', 'sell');
      fixture.componentRef.setInput('tickets', [ticket]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.componentRef.setInput('protectedSymbols', new Set(['AAPL']));
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector('.protected-badge');
      expect(badge).toBeFalsy();
    });
  });
});
