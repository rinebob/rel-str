import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { OrderQueueComponent } from './order-queue.component';
import {
  OrderIntent,
  OrderIntentStatus,
  OrderSource,
  InstrumentType,
} from '../../services/order-intent.types';

function makeIntent(
  id: string,
  status: OrderIntentStatus,
  symbol: string,
  side: 'buy' | 'sell' = 'buy',
): OrderIntent {
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
  } as OrderIntent;
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
    it('shows empty state message when no intents', () => {
      fixture.componentRef.setInput('intents', []);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const empty = fixture.nativeElement.querySelector('.empty-state');
      expect(empty).toBeTruthy();
      expect(empty.textContent).toContain('No staged orders');
    });

    it('does not show empty state when intents exist', () => {
      fixture.componentRef.setInput('intents', [makeIntent('1', OrderIntentStatus.STAGED, 'AAPL')]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const empty = fixture.nativeElement.querySelector('.empty-state');
      expect(empty).toBeFalsy();
    });
  });

  describe('grouping', () => {
    it('groups intents by status', () => {
      const intents = [
        makeIntent('1', OrderIntentStatus.STAGED, 'AAPL'),
        makeIntent('2', OrderIntentStatus.SUBMITTED, 'NVDA'),
        makeIntent('3', OrderIntentStatus.FILLED, 'MSFT'),
        makeIntent('4', OrderIntentStatus.FAILED, 'TSLA'),
      ];
      fixture.componentRef.setInput('intents', intents);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const groups = component.groups();
      expect(groups.length).toBe(4);
      expect(groups[0].label).toBe('Staged');
      expect(groups[0].intents.length).toBe(1);
      expect(groups[1].label).toBe('Submitted');
      expect(groups[2].label).toBe('Filled');
      expect(groups[3].label).toBe('Failed');
    });

    it('combines STAGED and READY into one group', () => {
      const intents = [
        makeIntent('1', OrderIntentStatus.STAGED, 'AAPL'),
        makeIntent('2', OrderIntentStatus.READY, 'NVDA'),
      ];
      fixture.componentRef.setInput('intents', intents);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const groups = component.groups();
      expect(groups.length).toBe(1);
      expect(groups[0].label).toBe('Staged');
      expect(groups[0].intents.length).toBe(2);
    });

    it('hides groups with no intents', () => {
      const intents = [makeIntent('1', OrderIntentStatus.STAGED, 'AAPL')];
      fixture.componentRef.setInput('intents', intents);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const groups = component.groups();
      expect(groups.length).toBe(1);
      expect(groups[0].label).toBe('Staged');
    });

    it('renders group headers in the DOM', () => {
      const intents = [
        makeIntent('1', OrderIntentStatus.STAGED, 'AAPL'),
        makeIntent('2', OrderIntentStatus.FILLED, 'NVDA'),
      ];
      fixture.componentRef.setInput('intents', intents);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const headers = fixture.nativeElement.querySelectorAll('.group-label');
      expect(headers.length).toBe(2);
      expect(headers[0].textContent).toContain('Staged');
      expect(headers[1].textContent).toContain('Filled');
    });
  });

  describe('selection', () => {
    it('emits intentSelected when a row is clicked', () => {
      const intents = [makeIntent('1', OrderIntentStatus.STAGED, 'AAPL')];
      fixture.componentRef.setInput('intents', intents);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      let emittedId: string | null = null;
      component.intentSelected.subscribe((id) => (emittedId = id));

      const row = fixture.nativeElement.querySelector('.queue-item');
      row.click();
      fixture.detectChanges();

      expect(emittedId).toBe('1');
    });

    it('applies selected class to the selected row', () => {
      const intents = [
        makeIntent('1', OrderIntentStatus.STAGED, 'AAPL'),
        makeIntent('2', OrderIntentStatus.STAGED, 'NVDA'),
      ];
      fixture.componentRef.setInput('intents', intents);
      fixture.componentRef.setInput('selectedId', '2');
      fixture.detectChanges();

      const rows = fixture.nativeElement.querySelectorAll('.queue-item');
      expect(rows[0].classList.contains('selected')).toBe(false);
      expect(rows[1].classList.contains('selected')).toBe(true);
    });

    it('does not emit selection when clicking checkbox', () => {
      const intents = [makeIntent('1', OrderIntentStatus.STAGED, 'AAPL')];
      fixture.componentRef.setInput('intents', intents);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      let emitted = false;
      component.intentSelected.subscribe(() => (emitted = true));

      const checkbox = fixture.nativeElement.querySelector('mat-checkbox');
      checkbox.click();
      fixture.detectChanges();

      expect(emitted).toBe(false);
    });
  });

  describe('batch select + remove', () => {
    it('emits removeIntents with checked ids', () => {
      const intents = [
        makeIntent('1', OrderIntentStatus.STAGED, 'AAPL'),
        makeIntent('2', OrderIntentStatus.STAGED, 'NVDA'),
      ];
      fixture.componentRef.setInput('intents', intents);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      let removedIds: string[] | null = null;
      component.removeIntents.subscribe((ids) => (removedIds = ids));

      // Check both checkboxes
      component.toggleCheck('1', true);
      component.toggleCheck('2', true);
      fixture.detectChanges();

      component.removeChecked();
      fixture.detectChanges();

      expect(removedIds).toEqual(['1', '2']);
    });

    it('selects all intents', () => {
      const intents = [
        makeIntent('1', OrderIntentStatus.STAGED, 'AAPL'),
        makeIntent('2', OrderIntentStatus.FILLED, 'NVDA'),
      ];
      fixture.componentRef.setInput('intents', intents);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      component.selectAll();
      fixture.detectChanges();

      expect(component.isChecked('1')).toBe(true);
      expect(component.isChecked('2')).toBe(true);
      expect(component.hasChecked()).toBe(true);
    });

    it('clears selection', () => {
      const intents = [makeIntent('1', OrderIntentStatus.STAGED, 'AAPL')];
      fixture.componentRef.setInput('intents', intents);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      component.toggleCheck('1', true);
      component.clearSelection();
      fixture.detectChanges();

      expect(component.isChecked('1')).toBe(false);
      expect(component.hasChecked()).toBe(false);
    });

    it('shows remove button only when checkboxes are checked', () => {
      fixture.componentRef.setInput('intents', [makeIntent('1', OrderIntentStatus.STAGED, 'AAPL')]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      // No remove button initially
      expect(fixture.nativeElement.querySelector('.remove-btn')).toBeFalsy();

      // Check the box
      component.toggleCheck('1', true);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.remove-btn')).toBeTruthy();
    });
  });

  describe('row display', () => {
    it('shows symbol, side, order type, and quantity', () => {
      const intent = makeIntent('1', OrderIntentStatus.STAGED, 'AAPL', 'sell');
      intent.orderType = 'limit';
      intent.quantity = '50';
      fixture.componentRef.setInput('intents', [intent]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const row = fixture.nativeElement.querySelector('.queue-item');
      expect(row.textContent).toContain('AAPL');
      expect(row.textContent).toContain('SELL');
      expect(row.textContent).toContain('LIMIT');
      expect(row.textContent).toContain('50');
    });

    it('shows source badge', () => {
      const intent = makeIntent('1', OrderIntentStatus.STAGED, 'AAPL');
      fixture.componentRef.setInput('intents', [intent]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector('.source-badge');
      expect(badge.textContent).toContain('SIG');
    });

    it('shows status badge', () => {
      const intent = makeIntent('1', OrderIntentStatus.SUBMITTED, 'AAPL');
      fixture.componentRef.setInput('intents', [intent]);
      fixture.componentRef.setInput('selectedId', null);
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector('.status-badge');
      expect(badge.textContent).toContain('submitted');
    });
  });
});
