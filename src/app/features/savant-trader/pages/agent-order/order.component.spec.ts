import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { of } from 'rxjs';

import { OrderComponent } from './order.component';
import { OrderStagingStore } from '../../stores/order-staging.store';
import { UiStateService } from '../../../../core/services/ui-state.service';
import {
  OrderIntent,
  OrderIntentStatus,
  OrderSource,
  InstrumentType,
} from '../../services/order-intent.types';

function makeIntent(id: string, symbol: string, status: OrderIntentStatus = OrderIntentStatus.STAGED): OrderIntent {
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
  } as OrderIntent;
}

describe('OrderComponent', () => {
  let fixture: ComponentFixture<OrderComponent>;
  let component: OrderComponent;
  let storeMock: any;
  let uiStateMock: any;
  let routerMock: any;

  beforeEach(async () => {
    storeMock = {
      intents: signal({}),
      loading: signal(false),
      error: signal(null),
      loadIntents: jasmine.createSpy('loadIntents'),
      removeIntent: jasmine.createSpy('removeIntent'),
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
        { provide: OrderStagingStore, useValue: storeMock },
        { provide: UiStateService, useValue: uiStateMock },
        { provide: Router, useValue: routerMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrderComponent);
    component = fixture.componentInstance;
  });

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  it('loads intents and sets fullscreen on init', () => {
    component.ngOnInit();

    expect(storeMock.loadIntents).toHaveBeenCalledTimes(1);
    expect(uiStateMock.setFullscreen).toHaveBeenCalledWith(true);
  });

  it('computes allIntents from store', () => {
    const intent = makeIntent('1', 'AAPL');
    storeMock.intents.set({ '1': intent });
    fixture.detectChanges();

    expect(component.allIntents().length).toBe(1);
    expect(component.allIntents()[0].id).toBe('1');
  });

  it('computes intentCount from allIntents', () => {
    storeMock.intents.set({
      '1': makeIntent('1', 'AAPL'),
      '2': makeIntent('2', 'NVDA'),
    });
    fixture.detectChanges();

    expect(component.intentCount()).toBe(2);
  });

  it('sets selectedIntentId on selection', () => {
    component.onIntentSelected('abc-123');
    expect(component.selectedIntentId()).toBe('abc-123');
  });

  it('computes selectedIntent from store', () => {
    const intent = makeIntent('1', 'AAPL');
    storeMock.intents.set({ '1': intent });
    component.selectedIntentId.set('1');
    fixture.detectChanges();

    expect(component.selectedIntent()?.id).toBe('1');
  });

  it('returns null selectedIntent when no selection', () => {
    expect(component.selectedIntent()).toBeNull();
  });

  it('calls removeIntent for each id in batch remove', () => {
    component.onRemoveIntents(['1', '2', '3']);

    expect(storeMock.removeIntent).toHaveBeenCalledTimes(3);
    expect(storeMock.removeIntent).toHaveBeenCalledWith('1');
    expect(storeMock.removeIntent).toHaveBeenCalledWith('2');
    expect(storeMock.removeIntent).toHaveBeenCalledWith('3');
  });

  it('clears selection when selected intent is removed', () => {
    component.selectedIntentId.set('2');
    component.onRemoveIntents(['1', '2']);

    expect(component.selectedIntentId()).toBeNull();
  });

  it('does not clear selection when removed intents do not include selection', () => {
    component.selectedIntentId.set('3');
    component.onRemoveIntents(['1', '2']);

    expect(component.selectedIntentId()).toBe('3');
  });

  it('navigates back to signal-review on goBack', () => {
    component.goBack();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/signal-review']);
  });

  it('shows empty placeholder when no intent is selected', () => {
    storeMock.intents.set({ '1': makeIntent('1', 'AAPL') });
    fixture.detectChanges();

    const placeholder = fixture.nativeElement.querySelector('.ticket-placeholder');
    expect(placeholder).toBeTruthy();
    expect(placeholder.textContent).toContain('Select an order');
  });

  it('shows ticket placeholder with intent info when an intent is selected', () => {
    const intent = makeIntent('1', 'AAPL');
    storeMock.intents.set({ '1': intent });
    component.selectedIntentId.set('1');
    fixture.detectChanges();

    const placeholder = fixture.nativeElement.querySelector('.ticket-placeholder');
    expect(placeholder).toBeTruthy();
    expect(placeholder.textContent).toContain('Order Ticket');
  });

  it('shows loading state when store is loading', () => {
    storeMock.loading.set(true);
    fixture.detectChanges();

    const loading = fixture.nativeElement.querySelector('.loading-state');
    expect(loading).toBeTruthy();
    expect(loading.textContent).toContain('Loading');
  });

  it('shows error state when store has error', () => {
    storeMock.error.set('Failed to load intents');
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector('.error-state');
    expect(error).toBeTruthy();
    expect(error.textContent).toContain('Failed to load orders');
    expect(error.textContent).toContain('Failed to load intents');
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
