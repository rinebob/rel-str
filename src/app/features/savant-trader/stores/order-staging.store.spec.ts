import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';

import { OrderStagingStore } from './order-staging.store';
import { OrderIntentService } from '../services/order-intent.service';
import {
  OrderIntent,
  OrderIntentStatus,
  OrderSource,
  InstrumentType,
  EquityOrderIntent,
} from '../services/order-intent.types';

describe('OrderStagingStore', () => {
  let store: InstanceType<typeof OrderStagingStore>;
  let intentService: any;
  let snackBar: any;

  function mockEquityIntent(overrides: Partial<EquityOrderIntent> = {}): EquityOrderIntent {
    return {
      id: 'intent-1',
      refId: 'ref-abc-123',
      source: OrderSource.SIGNAL_PIPELINE,
      status: OrderIntentStatus.STAGED,
      accountNumber: '123456789',
      side: 'buy',
      orderType: 'market',
      timeInForce: 'gfd',
      marketHours: 'regular_hours',
      instrumentType: InstrumentType.EQUITY,
      symbol: 'AAPL',
      quantity: '10',
      createdAt: '2026-08-25T12:00:00Z',
      updatedAt: '2026-08-25T12:00:00Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    intentService = {
      createIntent: jasmine.createSpy('createIntent'),
      updateIntent: jasmine.createSpy('updateIntent'),
      deleteIntent: jasmine.createSpy('deleteIntent'),
      loadAllIntents: jasmine.createSpy('loadAllIntents').and.returnValue(of([])),
      loadIntent: jasmine.createSpy('loadIntent'),
    };

    snackBar = { open: jasmine.createSpy('open') };

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: OrderIntentService, useValue: intentService },
        { provide: MatSnackBar, useValue: snackBar },
        OrderStagingStore,
      ],
    });

    store = TestBed.inject(OrderStagingStore);
  });

  describe('stageIntent', () => {
    it('optimistically adds the intent and calls createIntent', () => {
      intentService.createIntent.and.returnValue(of(undefined));
      const intent = mockEquityIntent();

      store.stageIntent(intent);

      expect(store.intents()['intent-1']).toEqual(intent);
      expect(intentService.createIntent).toHaveBeenCalledWith(intent);
    });

    it('rolls back on createIntent error and shows snackbar', () => {
      intentService.createIntent.and.returnValue(throwError(() => new Error('Firestore down')));
      const intent = mockEquityIntent();

      store.stageIntent(intent);

      expect(store.intents()['intent-1']).toBeUndefined();
      expect(snackBar.open).toHaveBeenCalled();
    });
  });

  describe('removeIntent', () => {
    it('optimistically removes the intent and calls deleteIntent', () => {
      intentService.createIntent.and.returnValue(of(undefined));
      intentService.deleteIntent.and.returnValue(of(undefined));
      store.stageIntent(mockEquityIntent());

      store.removeIntent('intent-1');

      expect(store.intents()['intent-1']).toBeUndefined();
      expect(intentService.deleteIntent).toHaveBeenCalledWith('intent-1');
    });

    it('rolls back on deleteIntent error', () => {
      intentService.createIntent.and.returnValue(of(undefined));
      intentService.deleteIntent.and.returnValue(throwError(() => new Error('Delete failed')));
      store.stageIntent(mockEquityIntent());

      store.removeIntent('intent-1');

      expect(store.intents()['intent-1']).toBeDefined();
      expect(snackBar.open).toHaveBeenCalled();
    });
  });

  describe('submitIntent', () => {
    it('transitions STAGED → SUBMITTING and calls updateIntent', () => {
      intentService.createIntent.and.returnValue(of(undefined));
      intentService.updateIntent.and.returnValue(of(undefined));
      store.stageIntent(mockEquityIntent());

      store.submitIntent('intent-1');

      expect(store.intents()['intent-1'].status).toBe(OrderIntentStatus.SUBMITTING);
      expect(intentService.updateIntent).toHaveBeenCalledWith('intent-1', { status: OrderIntentStatus.SUBMITTING });
    });

    it('rolls back to previous status on updateIntent error', () => {
      intentService.createIntent.and.returnValue(of(undefined));
      intentService.updateIntent.and.returnValue(throwError(() => new Error('Update failed')));
      store.stageIntent(mockEquityIntent({ status: OrderIntentStatus.READY }));

      store.submitIntent('intent-1');

      expect(store.intents()['intent-1'].status).toBe(OrderIntentStatus.READY);
      expect(snackBar.open).toHaveBeenCalled();
    });
  });

  describe('retryIntent', () => {
    it('transitions FAILED → SUBMITTING and clears error, preserving refId', () => {
      intentService.createIntent.and.returnValue(of(undefined));
      intentService.updateIntent.and.returnValue(of(undefined));
      const intent = mockEquityIntent({
        status: OrderIntentStatus.FAILED,
        refId: 'ref-preserved',
        error: { message: 'Network error', retryable: true },
      });
      store.stageIntent(intent);

      store.retryIntent('intent-1');

      const result = store.intents()['intent-1'];
      expect(result.status).toBe(OrderIntentStatus.SUBMITTING);
      expect(result.error).toBeUndefined();
      expect(result.refId).toBe('ref-preserved');
    });

    it('does nothing if intent is not FAILED', () => {
      intentService.createIntent.and.returnValue(of(undefined));
      intentService.updateIntent.and.returnValue(of(undefined));
      store.stageIntent(mockEquityIntent({ status: OrderIntentStatus.STAGED }));

      store.retryIntent('intent-1');

      expect(store.intents()['intent-1'].status).toBe(OrderIntentStatus.STAGED);
      expect(intentService.updateIntent).not.toHaveBeenCalled();
    });
  });

  describe('cancelIntent', () => {
    it('transitions to CANCELLED and calls updateIntent', () => {
      intentService.createIntent.and.returnValue(of(undefined));
      intentService.updateIntent.and.returnValue(of(undefined));
      store.stageIntent(mockEquityIntent({ status: OrderIntentStatus.SUBMITTED }));

      store.cancelIntent('intent-1');

      expect(store.intents()['intent-1'].status).toBe(OrderIntentStatus.CANCELLED);
      expect(intentService.updateIntent).toHaveBeenCalledWith('intent-1', { status: OrderIntentStatus.CANCELLED });
    });
  });

  describe('loadIntents', () => {
    it('hydrates non-terminal intents from Firestore', () => {
      const intents = [
        mockEquityIntent({ id: 'i1', status: OrderIntentStatus.STAGED }),
        mockEquityIntent({ id: 'i2', status: OrderIntentStatus.SUBMITTED }),
      ];
      intentService.loadAllIntents.and.returnValue(of(intents));

      store.loadIntents();

      expect(store.intents()['i1']).toBeDefined();
      expect(store.intents()['i2']).toBeDefined();
      expect(store.loading()).toBe(false);
    });

    it('sets error on load failure', () => {
      intentService.loadAllIntents.and.returnValue(throwError(() => new Error('Load failed')));

      store.loadIntents();

      expect(store.loading()).toBe(false);
      expect(store.error()).toBe('Load failed');
    });
  });

  describe('reconcileStuckIntents', () => {
    it('marks stuck SUBMITTING intents as FAILED', () => {
      intentService.createIntent.and.returnValue(of(undefined));
      intentService.updateIntent.and.returnValue(of(undefined));
      store.stageIntent(mockEquityIntent({ id: 'stuck-1', status: OrderIntentStatus.SUBMITTING }));

      store.reconcileStuckIntents();

      const intent = store.intents()['stuck-1'];
      expect(intent.status).toBe(OrderIntentStatus.FAILED);
      expect(intent.error?.retryable).toBe(true);
    });

    it('does nothing when no stuck intents exist', () => {
      intentService.createIntent.and.returnValue(of(undefined));
      store.stageIntent(mockEquityIntent({ status: OrderIntentStatus.STAGED }));

      store.reconcileStuckIntents();

      expect(store.intents()['intent-1'].status).toBe(OrderIntentStatus.STAGED);
    });
  });

  describe('computed values', () => {
    beforeEach(() => {
      intentService.createIntent.and.returnValue(of(undefined));
      const intents: OrderIntent[] = [
        mockEquityIntent({ id: 'i1', status: OrderIntentStatus.STAGED, symbol: 'AAPL' }),
        mockEquityIntent({ id: 'i2', status: OrderIntentStatus.SUBMITTING, symbol: 'AAPL' }),
        mockEquityIntent({ id: 'i3', status: OrderIntentStatus.SUBMITTED, symbol: 'MSFT' }),
        mockEquityIntent({ id: 'i4', status: OrderIntentStatus.FILLED, symbol: 'MSFT' }),
        mockEquityIntent({ id: 'i5', status: OrderIntentStatus.FAILED, symbol: 'GOOG' }),
        mockEquityIntent({ id: 'i6', status: OrderIntentStatus.READY, symbol: 'GOOG' }),
      ];
      const map: Record<string, OrderIntent> = {};
      for (const i of intents) { map[i.id] = i; }
      // Directly patch state via loadIntents mock
      intentService.loadAllIntents.and.returnValue(of(intents));
      store.loadIntents();
    });

    it('stagedIntents returns STAGED and READY intents', () => {
      const ids = store.stagedIntents().map((i) => i.id);
      expect(ids).toContain('i1');
      expect(ids).toContain('i6');
      expect(ids.length).toBe(2);
    });

    it('submittingIntents returns SUBMITTING intents', () => {
      const ids = store.submittingIntents().map((i) => i.id);
      expect(ids).toEqual(['i2']);
    });

    it('activeIntents returns SUBMITTED intents', () => {
      const ids = store.activeIntents().map((i) => i.id);
      expect(ids).toEqual(['i3']);
    });

    it('terminalIntents returns FILLED, FAILED, CANCELLED intents', () => {
      const ids = store.terminalIntents().map((i) => i.id);
      expect(ids).toContain('i4');
      expect(ids).toContain('i5');
      expect(ids.length).toBe(2);
    });

    it('intentsBySymbol groups intents by symbol', () => {
      const bySymbol = store.intentsBySymbol();
      expect(bySymbol['AAPL'].length).toBe(2);
      expect(bySymbol['MSFT'].length).toBe(2);
      expect(bySymbol['GOOG'].length).toBe(2);
    });
  });

  describe('refId preservation', () => {
    it('refId is preserved across retry', () => {
      intentService.createIntent.and.returnValue(of(undefined));
      intentService.updateIntent.and.returnValue(of(undefined));
      const originalRefId = 'ref-keep-me';
      store.stageIntent(mockEquityIntent({
        status: OrderIntentStatus.FAILED,
        refId: originalRefId,
      }));

      store.retryIntent('intent-1');

      expect(store.intents()['intent-1'].refId).toBe(originalRefId);
    });
  });
});
