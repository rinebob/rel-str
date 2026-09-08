import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';

import { OrderTicketStore } from './order-ticket.store';
import { OrderTicketService } from '../services/order-ticket.service';
import { OrderExecutionService } from '../services/order-execution.service';
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
    };

    snackBar = { open: jasmine.createSpy('open') };
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

    it('sets error on load failure', () => {
      ticketService.loadAllTickets.and.returnValue(throwError(() => new Error('Load failed')));

      store.loadTickets();

      expect(store.loading()).toBe(false);
      expect(store.error()).toBe('Load failed');
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
