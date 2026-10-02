import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError, Subject } from 'rxjs';
import { tap } from 'rxjs/operators';

import { OrderTicketStore } from './order-ticket.store';
import { OrderTicketService } from '../services/order-ticket.service';
import { OrderExecutionService } from '../services/order-execution.service';
import { PositionAttributionService } from '../../portfolio-dashboard/position-attribution.service';
import {
  OrderTicket,
  OrderTicketStatus,
  OrderSource,
  InstrumentType,
  EquityOrderTicket,
} from '../services/order-ticket.types';

describe('OrderTicketStore', () => {
  let store: InstanceType<typeof OrderTicketStore>;
  let ticketService: any;
  let orderExecution: any;
  let snackBar: any;
  let attrService: { seedFromTicket$: jest.Mock };

  function mockEquityTicket(overrides: Partial<EquityOrderTicket> = {}): EquityOrderTicket {
    return {
      id: 'ticket-1',
      refId: 'ref-abc-123',
      source: OrderSource.SIGNAL_PIPELINE,
      status: OrderTicketStatus.STAGED,
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
    ticketService = {
      createTicket: jasmine.createSpy('createTicket'),
      updateTicket: jasmine.createSpy('updateTicket'),
      deleteTicket: jasmine.createSpy('deleteTicket'),
      loadAllTickets: jasmine.createSpy('loadAllTickets').and.returnValue(of([])),
      loadTicket: jasmine.createSpy('loadTicket'),
      batchUpdateTerminalStatus: jasmine.createSpy('batchUpdateTerminalStatus').and.returnValue(of(undefined)),
    };

    snackBar = { open: jasmine.createSpy('open') };
    attrService = { seedFromTicket$: jest.fn(() => of(null)) };
    orderExecution = {
      submitEquityOrder: jasmine.createSpy('submitEquityOrder').and.returnValue(
        Promise.resolve({ success: true, result: { orderId: 'o1', state: 'confirmed' } }),
      ),
      cancelEquityOrder: jasmine.createSpy('cancelEquityOrder').and.returnValue(
        Promise.resolve({ success: true }),
      ),
    };

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: OrderTicketService, useValue: ticketService },
        { provide: OrderExecutionService, useValue: orderExecution },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: PositionAttributionService, useValue: attrService },
        OrderTicketStore,
      ],
    });

    store = TestBed.inject(OrderTicketStore);
  });

  describe('stageTicket', () => {
    it('optimistically adds the ticket and calls createTicket', () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      const ticket = mockEquityTicket();

      store.stageTicket(ticket);

      expect(store.tickets()['ticket-1']).toEqual(ticket);
      expect(ticketService.createTicket).toHaveBeenCalledWith(ticket);
    });

    it('rolls back on createTicket error and shows snackbar', () => {
      ticketService.createTicket.and.returnValue(throwError(() => new Error('Firestore down')));
      const ticket = mockEquityTicket();

      store.stageTicket(ticket);

      expect(store.tickets()['ticket-1']).toBeUndefined();
      expect(snackBar.open).toHaveBeenCalled();
    });
  });

  describe('removeTicket', () => {
    it('optimistically removes the ticket and calls deleteTicket', () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.deleteTicket.and.returnValue(of(undefined));
      store.stageTicket(mockEquityTicket());

      store.removeTicket('ticket-1');

      expect(store.tickets()['ticket-1']).toBeUndefined();
      expect(ticketService.deleteTicket).toHaveBeenCalledWith('ticket-1');
    });

    it('rolls back on deleteTicket error', () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.deleteTicket.and.returnValue(throwError(() => new Error('Delete failed')));
      store.stageTicket(mockEquityTicket());

      store.removeTicket('ticket-1');

      expect(store.tickets()['ticket-1']).toBeDefined();
      expect(snackBar.open).toHaveBeenCalled();
    });
  });

  describe('submitTicket', () => {
    it('sets SUBMITTING locally and calls orderExecution.submitEquityOrder', async () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.updateTicket.and.returnValue(of(undefined));
      store.stageTicket(mockEquityTicket());

      store.submitTicket('ticket-1');

      expect(store.tickets()['ticket-1'].status).toBe(OrderTicketStatus.SUBMITTING);
      expect(orderExecution.submitEquityOrder).toHaveBeenCalled();

      // Wait for the async result
      await Promise.resolve();
      await Promise.resolve();

      // After success, status is SUBMITTED and rhOrderId is recorded
      const result = store.tickets()['ticket-1'];
      expect(result.status).toBe(OrderTicketStatus.SUBMITTED);
      expect(result.result?.orderId).toBe('o1');
    });

    it('reverts to STAGED on submit failure', async () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      orderExecution.submitEquityOrder.and.returnValue(
        Promise.resolve({ success: false, error: { message: 'Insufficient funds', retryable: false } }),
      );
      store.stageTicket(mockEquityTicket());

      store.submitTicket('ticket-1');

      await Promise.resolve();
      await Promise.resolve();

      const result = store.tickets()['ticket-1'];
      expect(result.status).toBe(OrderTicketStatus.STAGED);
      expect(result.error?.message).toBe('Insufficient funds');
    });

    it('reverts to STAGED on submit exception', async () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      orderExecution.submitEquityOrder.and.returnValue(
        Promise.reject(new Error('Network error')),
      );
      store.stageTicket(mockEquityTicket());

      store.submitTicket('ticket-1');

      await Promise.resolve();
      await Promise.resolve();

      const result = store.tickets()['ticket-1'];
      expect(result.status).toBe(OrderTicketStatus.STAGED);
      expect(result.error?.retryable).toBe(true);
    });

    it('preserves refId across submit', async () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.updateTicket.and.returnValue(of(undefined));
      const originalRefId = 'ref-keep-me';
      store.stageTicket(mockEquityTicket({ refId: originalRefId }));

      store.submitTicket('ticket-1');

      await Promise.resolve();
      await Promise.resolve();

      expect(store.tickets()['ticket-1'].refId).toBe(originalRefId);
    });

    it('rejects double-submit while a submission is in flight', async () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.updateTicket.and.returnValue(of(undefined));
      // Make submitEquityOrder return a pending promise that we control
      let resolveSubmit!: (v: { success: boolean; result?: { orderId: string; state: string } }) => void;
      orderExecution.submitEquityOrder.and.returnValue(
        new Promise((r) => { resolveSubmit = r; }),
      );
      store.stageTicket(mockEquityTicket());

      store.submitTicket('ticket-1');
      expect(store.tickets()['ticket-1'].status).toBe(OrderTicketStatus.SUBMITTING);

      // Second call should be a no-op — still SUBMITTING, only one RH call
      store.submitTicket('ticket-1');
      expect(store.tickets()['ticket-1'].status).toBe(OrderTicketStatus.SUBMITTING);
      expect(orderExecution.submitEquityOrder).toHaveBeenCalledTimes(1);

      // Resolve the first submit
      resolveSubmit({ success: true, result: { orderId: 'o1', state: 'confirmed' } });
      await Promise.resolve();
      await Promise.resolve();

      expect(store.tickets()['ticket-1'].status).toBe(OrderTicketStatus.SUBMITTED);
    });

    it('does nothing for a non-existent ticket id', () => {
      store.submitTicket('nonexistent');
      expect(orderExecution.submitEquityOrder).not.toHaveBeenCalled();
    });
  });

  describe('updateTicket', () => {
    it('optimistically merges partial fields and calls updateTicket service', () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.updateTicket.and.returnValue(of(undefined));
      store.stageTicket(mockEquityTicket({ quantity: '10' }));

      store.updateTicket('ticket-1', { quantity: '20' } as Partial<EquityOrderTicket>);

      expect(store.tickets()['ticket-1'].quantity).toBe('20');
      expect(ticketService.updateTicket).toHaveBeenCalledWith('ticket-1', { quantity: '20' } as Partial<EquityOrderTicket>);
    });

    it('rolls back on updateTicket error', () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.updateTicket.and.returnValue(throwError(() => new Error('Update failed')));
      store.stageTicket(mockEquityTicket({ quantity: '10' }));

      store.updateTicket('ticket-1', { quantity: '20' } as Partial<EquityOrderTicket>);

      expect(store.tickets()['ticket-1'].quantity).toBe('10');
      expect(snackBar.open).toHaveBeenCalled();
    });

    it('does nothing for a non-existent ticket id', () => {
      store.updateTicket('nonexistent', { quantity: '20' });
      expect(ticketService.updateTicket).not.toHaveBeenCalled();
    });

    it('error rollback restores only the failed entry — a sibling\u2019s local SUBMITTING survives', () => {
      // A wholesale map revert would clobber the transient SUBMITTING on
      // another ticket (in-flight paper send), reopening the remove/submit
      // race it exists to prevent.
      const pending = new Subject<void>();
      ticketService.createTicket.and.returnValue(of(undefined));
      store.stageTicket(mockEquityTicket({ id: 't1' }));
      store.stageTicket(mockEquityTicket({ id: 't2', status: OrderTicketStatus.STAGED }));
      ticketService.updateTicket.and.returnValue(pending);

      store.updateTicket('t1', { quantity: '20' } as Partial<EquityOrderTicket>);
      store.setTicketStatusLocal('t2', OrderTicketStatus.SUBMITTING);
      pending.error(new Error('write failed'));

      expect(store.tickets()['t1'].quantity).toBe('10'); // rolled back
      expect(store.tickets()['t2'].status).toBe(OrderTicketStatus.SUBMITTING); // not clobbered
    });
  });

  describe('setTicketStatusLocal (#709 transient in-flight status)', () => {
    it('patches the local status WITHOUT calling the service — transient only', () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      store.stageTicket(mockEquityTicket({ status: OrderTicketStatus.STAGED }));
      ticketService.updateTicket.calls.reset();

      store.setTicketStatusLocal('ticket-1', OrderTicketStatus.SUBMITTING);

      expect(store.tickets()['ticket-1'].status).toBe(OrderTicketStatus.SUBMITTING);
      expect(ticketService.updateTicket).not.toHaveBeenCalled();
    });

    it('is a no-op for a missing ticket or a no-change status', () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      store.stageTicket(mockEquityTicket({ status: OrderTicketStatus.STAGED }));

      store.setTicketStatusLocal('nonexistent', OrderTicketStatus.SUBMITTING);
      store.setTicketStatusLocal('ticket-1', OrderTicketStatus.STAGED);

      expect(store.tickets()['nonexistent']).toBeUndefined();
      expect(store.tickets()['ticket-1'].status).toBe(OrderTicketStatus.STAGED);
      expect(ticketService.updateTicket).not.toHaveBeenCalled();
    });
  });

  describe('updateTicketAndWait (#717 refId ordering)', () => {
    it('resolves only after the service write lands', async () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      store.stageTicket(mockEquityTicket({ quantity: '10' }));
      let writeLanded = false;
      ticketService.updateTicket.and.returnValue(
        of(undefined).pipe(tap(() => (writeLanded = true))),
      );

      await store.updateTicketAndWait('ticket-1', { refId: 'fresh-ref' });

      expect(writeLanded).toBe(true);
      expect(store.tickets()['ticket-1'].refId).toBe('fresh-ref');
    });

    it('rolls back and resolves false (no throw) on service error', async () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.updateTicket.and.returnValue(throwError(() => new Error('write failed')));
      store.stageTicket(mockEquityTicket({ quantity: '10' }));

      const ok = await store.updateTicketAndWait('ticket-1', { quantity: '20' } as Partial<EquityOrderTicket>);

      expect(ok).toBe(false);
      expect(store.tickets()['ticket-1'].quantity).toBe('10');
      expect(snackBar.open).toHaveBeenCalled();
    });
  });

  describe('loadTickets', () => {
    it('hydrates tickets from Firestore', () => {
      const tickets = [
        mockEquityTicket({ id: 'i1', status: OrderTicketStatus.STAGED }),
        mockEquityTicket({ id: 'i2', status: OrderTicketStatus.SUBMITTED }),
      ];
      ticketService.loadAllTickets.and.returnValue(of(tickets));

      store.loadTickets();

      expect(store.tickets()['i1']).toBeDefined();
      expect(store.tickets()['i2']).toBeDefined();
      expect(store.loading()).toBe(false);
    });

    it('preserves a transient local SUBMITTING over a persisted STAGED doc', () => {
      // The in-flight paper-send/submit marker is never persisted — a
      // rehydrate mid-flight must not drop the ticket back into the
      // removable/submittable staged pool.
      ticketService.createTicket.and.returnValue(of(undefined));
      store.stageTicket(mockEquityTicket({ id: 'i1', status: OrderTicketStatus.STAGED }));
      store.setTicketStatusLocal('i1', OrderTicketStatus.SUBMITTING);

      ticketService.loadAllTickets.and.returnValue(of([
        mockEquityTicket({ id: 'i1', status: OrderTicketStatus.STAGED }),
      ]));
      store.loadTickets();

      expect(store.tickets()['i1'].status).toBe(OrderTicketStatus.SUBMITTING);
    });

    it('lets the server win when the stored doc moved past STAGED', () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      store.stageTicket(mockEquityTicket({ id: 'i1', status: OrderTicketStatus.STAGED }));
      store.setTicketStatusLocal('i1', OrderTicketStatus.SUBMITTING);

      ticketService.loadAllTickets.and.returnValue(of([
        mockEquityTicket({ id: 'i1', status: OrderTicketStatus.FAILED }),
      ]));
      store.loadTickets();

      expect(store.tickets()['i1'].status).toBe(OrderTicketStatus.FAILED);
    });

    it('sets error on load failure', () => {
      ticketService.loadAllTickets.and.returnValue(throwError(() => new Error('Load failed')));

      store.loadTickets();

      expect(store.loading()).toBe(false);
      expect(store.error()).toBe('Load failed');
    });
  });

  describe('reconcileTerminalStatuses — fill-time attribution seeding (#592)', () => {
    function rhFilledOrder(orderId: string): Record<string, import('../services/order-ticket.types').BrokerOrderSnapshot> {
      return {
        [orderId]: {
          id: orderId, symbol: 'AAPL', side: 'buy', type: 'market',
          state: 'filled', lastTransactionAt: '2026-09-01T15:00:00Z',
        },
      };
    }

    it('a filled ticket with bucketId seeds the position attribution', () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.batchUpdateTerminalStatus.and.returnValue(of(undefined));
      store.stageTicket(mockEquityTicket({
        id: 't1', status: OrderTicketStatus.SUBMITTED, bucketId: 'acct_wheel',
        result: { orderId: 'o1' },
      }));

      store.reconcileTerminalStatuses(rhFilledOrder('o1'));

      expect(store.tickets()['t1'].status).toBe(OrderTicketStatus.FILLED);
      expect(attrService.seedFromTicket$).toHaveBeenCalledWith('123456789', 'AAPL', 'acct_wheel', 'o1');
    });

    it('a filled ticket WITHOUT bucketId does not seed', () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.batchUpdateTerminalStatus.and.returnValue(of(undefined));
      store.stageTicket(mockEquityTicket({
        id: 't1', status: OrderTicketStatus.SUBMITTED,
        result: { orderId: 'o1' },
      }));

      store.reconcileTerminalStatuses(rhFilledOrder('o1'));

      expect(store.tickets()['t1'].status).toBe(OrderTicketStatus.FILLED);
      expect(attrService.seedFromTicket$).not.toHaveBeenCalled();
    });

    it('a filled SELL ticket does not seed — sells exit positions', () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.batchUpdateTerminalStatus.and.returnValue(of(undefined));
      store.stageTicket(mockEquityTicket({
        id: 't1', status: OrderTicketStatus.SUBMITTED, side: 'sell',
        bucketId: 'acct_wheel', result: { orderId: 'o1' },
      }));

      store.reconcileTerminalStatuses(rhFilledOrder('o1'));

      expect(store.tickets()['t1'].status).toBe(OrderTicketStatus.FILLED);
      expect(attrService.seedFromTicket$).not.toHaveBeenCalled();
    });

    it('does not re-seed a ticket already FILLED', () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      store.stageTicket(mockEquityTicket({
        id: 't1', status: OrderTicketStatus.FILLED, bucketId: 'acct_wheel',
        result: { orderId: 'o1' },
      }));

      store.reconcileTerminalStatuses(rhFilledOrder('o1'));

      expect(attrService.seedFromTicket$).not.toHaveBeenCalled();
    });
  });

  describe('ticketsBySymbol', () => {
    it('groups tickets by symbol', () => {
      const tickets: OrderTicket[] = [
        mockEquityTicket({ id: 'i1', status: OrderTicketStatus.STAGED, symbol: 'AAPL' }),
        mockEquityTicket({ id: 'i2', status: OrderTicketStatus.SUBMITTED, symbol: 'MSFT' }),
        mockEquityTicket({ id: 'i3', status: OrderTicketStatus.FILLED, symbol: 'AAPL' }),
      ];
      ticketService.loadAllTickets.and.returnValue(of(tickets));
      store.loadTickets();

      const bySymbol = store.ticketsBySymbol();
      expect(bySymbol['AAPL'].length).toBe(2);
      expect(bySymbol['MSFT'].length).toBe(1);
    });
  });
});
