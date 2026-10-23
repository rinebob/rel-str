import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NEVER, of, throwError, Subject, from } from 'rxjs';
import { tap } from 'rxjs/operators';

import { OrderTicketStore } from './order-ticket.store';
import { OrderTicketService } from '../services/order-ticket.service';
import { OrderExecutionService } from '../services/order-execution.service';
import { PaperTradingService } from '../services/paper-trading.service';
import { PositionAttributionService } from '../../portfolio-dashboard/position-attribution.service';
import {
  OrderTicket,
  OrderTicketStatus,
  OrderSource,
  InstrumentType,
  EquityOrderTicket,
  OptionOrderTicket,
} from '../services/order-ticket.types';

describe('OrderTicketStore', () => {
  let store: InstanceType<typeof OrderTicketStore>;
  let ticketService: any;
  let orderExecution: any;
  let snackBar: any;
  let attrService: { seedFromTicket$: jest.Mock };
  let paperTrading: { paperSignalOrder$: jest.Mock };

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

  function mockOptionTicket(overrides: Partial<OptionOrderTicket> = {}): OptionOrderTicket {
    return {
      id: 'opt-1',
      refId: 'ref-opt-1',
      source: OrderSource.SIGNAL_PIPELINE,
      status: OrderTicketStatus.STAGED,
      accountNumber: '123456789',
      side: 'buy',
      orderType: 'limit',
      timeInForce: 'gfd',
      marketHours: 'regular_hours',
      instrumentType: InstrumentType.OPTION,
      symbol: 'QQQ',
      legs: [{
        side: 'buy',
        symbol: 'QQQ  260320C00500000',
        optionId: 'opt-uuid-1',
        positionEffect: 'open',
      }],
      quantity: '2',
      price: '3.50',
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
    paperTrading = {
      paperSignalOrder$: jest.fn().mockReturnValue(
        of({ cohortId: 'c1', equityTradeId: 'eq-1', expressionTradeIds: ['e1'] }),
      ),
    };
    orderExecution = {
      submitEquityOrder: jasmine.createSpy('submitEquityOrder').and.returnValue(
        Promise.resolve({ success: true, result: { orderId: 'o1', state: 'confirmed' } }),
      ),
      submitOptionOrder: jasmine.createSpy('submitOptionOrder').and.returnValue(
        Promise.resolve({ success: true, result: { orderId: 'o-opt-1', state: 'confirmed' } }),
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
        { provide: PaperTradingService, useValue: paperTrading },
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

  describe('discardIfStaged (#1177 discard-on-close guard)', () => {
    it('removes a STAGED ticket, keeps an advanced one, and ignores a missing id', () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.deleteTicket.and.returnValue(of(undefined));
      store.stageTicket(mockEquityTicket({ id: 'staged-1' }));
      store.stageTicket(mockEquityTicket({ id: 'live-1', status: OrderTicketStatus.SUBMITTED }));

      store.discardIfStaged('staged-1');
      store.discardIfStaged('live-1');
      store.discardIfStaged('missing');

      expect(ticketService.deleteTicket).toHaveBeenCalledTimes(1);
      expect(ticketService.deleteTicket).toHaveBeenCalledWith('staged-1');
      expect(store.tickets()['staged-1']).toBeUndefined();
      expect(store.tickets()['live-1']?.status).toBe(OrderTicketStatus.SUBMITTED);
    });

    it('finds a rehydrated liv_-keyed twin — a rekeyed entry is still discarded', () => {
      // loadTickets() can rekey a session-staged bare entry under its
      // liv_ doc id mid-dialog; the bare id the close path holds must
      // still resolve (#1188 review r2).
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.deleteTicket.and.returnValue(of(undefined));
      store.stageTicket(mockEquityTicket({ id: 'liv_staged-1' }));

      store.discardIfStaged('staged-1');

      expect(ticketService.deleteTicket).toHaveBeenCalledWith('liv_staged-1');
      expect(store.tickets()['liv_staged-1']).toBeUndefined();
    });

    it('queues a SUBMITTING ticket — a failed submit reverts to STAGED and the drain removes it (#1017 r2)', () => {
      // Dialog closed mid-submit: the in-flight callable owns the ticket,
      // so the discard queues until the status settles.
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.deleteTicket.and.returnValue(of(undefined));
      store.stageTicket(mockEquityTicket({ id: 'sub-1' }));
      store.setTicketStatusLocal('sub-1', OrderTicketStatus.SUBMITTING);

      store.discardIfStaged('sub-1');
      expect(store.tickets()['sub-1']).toBeDefined();
      expect(ticketService.deleteTicket).not.toHaveBeenCalled();

      store.setTicketStatusLocal('sub-1', OrderTicketStatus.STAGED);
      TestBed.tick();

      expect(store.tickets()['sub-1']).toBeUndefined();
      expect(ticketService.deleteTicket).toHaveBeenCalledWith('sub-1');
    });

    it('clears the queued discard when the submit succeeds — the order survives (#1017 r2)', () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.deleteTicket.and.returnValue(of(undefined));
      store.stageTicket(mockEquityTicket({ id: 'sub-ok' }));
      store.setTicketStatusLocal('sub-ok', OrderTicketStatus.SUBMITTING);

      store.discardIfStaged('sub-ok');
      store.setTicketStatusLocal('sub-ok', OrderTicketStatus.SUBMITTED);
      TestBed.tick();

      // SUBMITTED survives — and the stale queue entry must not fire on a
      // later requeue back to STAGED.
      expect(store.tickets()['sub-ok']?.status).toBe(OrderTicketStatus.SUBMITTED);
      store.setTicketStatusLocal('sub-ok', OrderTicketStatus.STAGED);
      TestBed.tick();
      expect(store.tickets()['sub-ok']?.status).toBe(OrderTicketStatus.STAGED);
      expect(ticketService.deleteTicket).not.toHaveBeenCalled();
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

    it('mints a fresh refId on PLACEMENT_DEAD and records the dead orderId', async () => {
      // The dead order consumed the refId — resubmitting it would 409 forever.
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.updateTicket.and.returnValue(of(undefined));
      orderExecution.submitEquityOrder.and.returnValue(
        Promise.resolve({
          success: false,
          result: { orderId: 'order-dead', state: 'rejected' },
          error: { message: 'order order-dead placed but already terminal (rejected)', code: 'PLACEMENT_DEAD', retryable: false },
        }),
      );
      store.stageTicket(mockEquityTicket({ refId: 'ref-burned' }));

      store.submitTicket('ticket-1');

      await Promise.resolve();
      await Promise.resolve();

      const result = store.tickets()['ticket-1'];
      expect(result.status).toBe(OrderTicketStatus.STAGED);
      expect(result.refId).not.toBe('ref-burned');
      expect(result.result?.orderId).toBe('order-dead');
      // The fresh refId must be persisted — a reload restoring the burned
      // refId would wedge the ticket on 409s (r6-M6.1).
      expect(ticketService.updateTicket).toHaveBeenCalledWith(
        'ticket-1',
        jasmine.objectContaining({ refId: result.refId }),
      );
    });

    it('keeps the burned refId when the dead order carried fills', async () => {
      // Dead-with-fills means the position shrank — the ticket's quantity is
      // stale. A fresh refId would let a resubmit oversell; the burned one
      // 409s harmlessly while the user refreshes and re-stages.
      ticketService.createTicket.and.returnValue(of(undefined));
      orderExecution.submitEquityOrder.and.returnValue(
        Promise.resolve({
          success: false,
          result: { orderId: 'order-dead', state: 'cancelled', filledQuantity: '1' },
          error: { message: 'order order-dead placed but already terminal (cancelled) with 1 filled', code: 'PLACEMENT_DEAD', retryable: false },
        }),
      );
      store.stageTicket(mockEquityTicket({ refId: 'ref-burned' }));

      store.submitTicket('ticket-1');

      await Promise.resolve();
      await Promise.resolve();

      const result = store.tickets()['ticket-1'];
      expect(result.status).toBe(OrderTicketStatus.STAGED);
      expect(result.refId).toBe('ref-burned');
      expect(result.error?.message).toContain('re-stage');
    });

    it('keeps the burned refId when the dead order has an absent fill field', async () => {
      // cancelled with no fillQuantity is ambiguous — a fresh-refId resubmit
      // would carry the stale quantity over a possibly-shrunken position.
      ticketService.createTicket.and.returnValue(of(undefined));
      orderExecution.submitEquityOrder.and.returnValue(
        Promise.resolve({
          success: false,
          result: { orderId: 'order-dead', state: 'cancelled' },
          error: { message: 'order order-dead placed but already terminal (cancelled)', code: 'PLACEMENT_DEAD', retryable: false },
        }),
      );
      store.stageTicket(mockEquityTicket({ refId: 'ref-burned' }));

      store.submitTicket('ticket-1');

      await Promise.resolve();
      await Promise.resolve();

      const result = store.tickets()['ticket-1'];
      expect(result.status).toBe(OrderTicketStatus.STAGED);
      expect(result.refId).toBe('ref-burned');
      expect(result.error?.message).toContain('re-stage');
    });

    it('keeps the refId on PLACEMENT_UNCONFIRMED so a retry converges', async () => {
      // The order may be live — resubmitting the same refId dedupes via 409
      // instead of minting a duplicate.
      ticketService.createTicket.and.returnValue(of(undefined));
      orderExecution.submitEquityOrder.and.returnValue(
        Promise.resolve({
          success: false,
          error: { message: 'placement unconfirmed — no order id in response', code: 'PLACEMENT_UNCONFIRMED', retryable: true },
        }),
      );
      store.stageTicket(mockEquityTicket({ refId: 'ref-maybe-live' }));

      store.submitTicket('ticket-1');

      await Promise.resolve();
      await Promise.resolve();

      const result = store.tickets()['ticket-1'];
      expect(result.status).toBe(OrderTicketStatus.STAGED);
      expect(result.refId).toBe('ref-maybe-live');
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

    it('routes an OPTION ticket to submitOptionOrder — SUBMITTED on success', async () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.updateTicket.and.returnValue(of(undefined));
      store.stageTicket(mockOptionTicket());

      store.submitTicket('opt-1');
      await Promise.resolve();
      await Promise.resolve();

      expect(orderExecution.submitOptionOrder).toHaveBeenCalled();
      expect(orderExecution.submitEquityOrder).not.toHaveBeenCalled();
      const result = store.tickets()['opt-1'];
      expect(result.status).toBe(OrderTicketStatus.SUBMITTED);
      expect(result.result?.orderId).toBe('o-opt-1');
    });

    it('reverts an OPTION ticket to STAGED on submit failure — no snackbar block', async () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      orderExecution.submitOptionOrder.and.returnValue(
        Promise.resolve({ success: false, error: { message: 'insufficient buying power', retryable: false } }),
      );
      store.stageTicket(mockOptionTicket());

      store.submitTicket('opt-1');
      await Promise.resolve();
      await Promise.resolve();

      const result = store.tickets()['opt-1'];
      expect(result.status).toBe(OrderTicketStatus.STAGED);
      expect(result.error?.message).toBe('insufficient buying power');
      expect(snackBar.open).not.toHaveBeenCalled();
    });
  });

  describe('updateTicket', () => {
    it('optimistically merges partial fields and calls updateTicket service', () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.updateTicket.and.returnValue(of(undefined));
      store.stageTicket(mockEquityTicket({ quantity: '10' }));

      store.updateTicket('ticket-1', { quantity: '20' });

      expect(store.tickets()['ticket-1'].quantity).toBe('20');
      expect(ticketService.updateTicket).toHaveBeenCalledWith('ticket-1', { quantity: '20' });
    });

    it('rolls back on updateTicket error', () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.updateTicket.and.returnValue(throwError(() => new Error('Update failed')));
      store.stageTicket(mockEquityTicket({ quantity: '10' }));

      store.updateTicket('ticket-1', { quantity: '20' });

      expect(store.tickets()['ticket-1'].quantity).toBe('10');
      expect(snackBar.open).toHaveBeenCalled();
    });

    it('does nothing for a non-existent ticket id', () => {
      store.updateTicket('nonexistent', { quantity: '20' });
      expect(ticketService.updateTicket).not.toHaveBeenCalled();
    });

    it('round-trips updated option legs through the merge', () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.updateTicket.and.returnValue(of(undefined));
      store.stageTicket(mockOptionTicket());
      const newLegs = [{
        side: 'buy' as const,
        symbol: 'QQQ  260320P00480000',
        optionId: 'opt-uuid-2',
        positionEffect: 'open' as const,
      }];

      // OrderTicketPatch is a distributive-omit union — option-only
      // fields like legs type-check without a variant cast.
      store.updateTicket('opt-1', { legs: newLegs });

      expect((store.tickets()['opt-1'] as OptionOrderTicket).legs).toEqual(newLegs);
      expect(ticketService.updateTicket).toHaveBeenCalledWith('opt-1', { legs: newLegs });
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

      store.updateTicket('t1', { quantity: '20' });
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

      const ok = await store.updateTicketAndWait('ticket-1', { quantity: '20' });

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

    it('hydrates an option ticket preserving leg optionId/positionEffect/side', () => {
      const option = mockOptionTicket();
      ticketService.loadAllTickets.and.returnValue(of([option]));

      store.loadTickets();

      const hydrated = store.tickets()['opt-1'] as OptionOrderTicket;
      expect(hydrated).toEqual(option);
      expect(hydrated.legs[0].optionId).toBe('opt-uuid-1');
      expect(hydrated.legs[0].positionEffect).toBe('open');
      expect(hydrated.legs[0].side).toBe('buy');
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

    it('preserves a transient local SUBMITTING across the liv_ doc-id boundary (#1015)', () => {
      // Locally-staged tickets key on the bare id; hydrated docs carry
      // the {liv|pap}_ prefix. The preserve-merge must normalize or a
      // mid-flight ticket falls back into the staged pool.
      ticketService.createTicket.and.returnValue(of(undefined));
      store.stageTicket(mockEquityTicket({ id: 'i1', status: OrderTicketStatus.STAGED }));
      store.setTicketStatusLocal('i1', OrderTicketStatus.SUBMITTING);

      ticketService.loadAllTickets.and.returnValue(of([
        mockEquityTicket({ id: 'liv_i1', status: OrderTicketStatus.STAGED }),
      ]));
      store.loadTickets();

      expect(store.tickets()['liv_i1'].status).toBe(OrderTicketStatus.SUBMITTING);
    });

    it('preserves a local PAPER over a stale persisted STAGED doc — the optimistic mark precedes the write (#755 review r3)', () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      store.stageTicket(mockEquityTicket({ id: 'i1', status: OrderTicketStatus.STAGED }));
      store.setTicketStatusLocal('i1', OrderTicketStatus.PAPER);

      ticketService.loadAllTickets.and.returnValue(of([
        mockEquityTicket({ id: 'i1', status: OrderTicketStatus.STAGED }),
      ]));
      store.loadTickets();

      expect(store.tickets()['i1'].status).toBe(OrderTicketStatus.PAPER);
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

    it('reconciles a non-signal ticket — a CANCEL_PENDING management ticket must still reach terminal (#1015)', () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      store.stageTicket(mockEquityTicket({
        id: 'm1', status: OrderTicketStatus.CANCEL_PENDING,
        source: OrderSource.POSITION_MANAGEMENT, result: { orderId: 'o-mgmt' },
      }));

      store.reconcileTerminalStatuses({
        'o-mgmt': {
          id: 'o-mgmt', symbol: 'AAPL', side: 'sell', type: 'market',
          state: 'cancelled', lastTransactionAt: '2026-09-01T15:00:00Z',
        },
      });

      expect(store.tickets()['m1'].status).toBe(OrderTicketStatus.CANCELLED);
      expect(ticketService.batchUpdateTerminalStatus).toHaveBeenCalledWith([
        jasmine.objectContaining({ id: 'm1', status: OrderTicketStatus.CANCELLED }),
      ]);
    });

    it('carries fillSummary and lastError through to the canonical write (#1015)', () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      store.stageTicket(mockEquityTicket({
        id: 't1', status: OrderTicketStatus.SUBMITTED, result: { orderId: 'o1' },
      }));
      store.stageTicket(mockEquityTicket({
        id: 't2', status: OrderTicketStatus.SUBMITTED, symbol: 'MSFT', result: { orderId: 'o2' },
      }));

      store.reconcileTerminalStatuses({
        o1: {
          id: 'o1', symbol: 'AAPL', side: 'buy', type: 'market',
          state: 'filled', price: '150.25', cumulativeQuantity: '10',
          lastTransactionAt: '2026-09-01T15:00:00Z',
        },
        o2: {
          id: 'o2', symbol: 'MSFT', side: 'buy', type: 'market',
          state: 'rejected', lastTransactionAt: '2026-09-01T15:00:00Z',
        },
      });

      // The canonical audit requires fillSummary (incl. its filledAt) on
      // filled docs and lastError on failed docs — both travel with the batch.
      expect(ticketService.batchUpdateTerminalStatus).toHaveBeenCalledWith([
        jasmine.objectContaining({
          id: 't1', status: OrderTicketStatus.FILLED,
          fillSummary: { averagePrice: 150.25, filledQty: 10, filledAt: '2026-09-01T15:00:00Z' },
        }),
        jasmine.objectContaining({
          id: 't2', status: OrderTicketStatus.FAILED,
          lastError: { category: 'broker_rejected', message: "Order reached 'rejected' at the broker" },
        }),
      ]);
      expect(store.tickets()['t1'].result?.fillPrice).toBe('150.25');
      expect(store.tickets()['t2'].error?.code).toBe('broker_rejected');
    });

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

    it('a filled OPTION ticket with bucketId does not seed — the position key is the underlying, not a contract', () => {
      // OptionOrderTicket carries `symbol` (underlying) — a `in`-probe guard
      // would seed attribution keyed by the ticker, not the option instrument.
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.batchUpdateTerminalStatus.and.returnValue(of(undefined));
      store.stageTicket(mockOptionTicket({
        id: 't1', status: OrderTicketStatus.SUBMITTED, bucketId: 'acct_wheel',
        result: { orderId: 'o1' },
      }));

      store.reconcileTerminalStatuses(rhFilledOrder('o1'));

      expect(store.tickets()['t1'].status).toBe(OrderTicketStatus.FILLED);
      expect(attrService.seedFromTicket$).not.toHaveBeenCalled();
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

    it('groups an option ticket under its underlying symbol, not the OCC leg symbol', () => {
      // Deliberately mismatched namespaces: underlying 'AAPL' vs a QQQ
      // contract leg — proves the grouping key is ticket.symbol.
      const option = mockOptionTicket({ id: 'opt-1', symbol: 'AAPL' });
      const equity = mockEquityTicket({ id: 'i2', status: OrderTicketStatus.STAGED, symbol: 'AAPL' });
      ticketService.loadAllTickets.and.returnValue(of([option, equity]));

      store.loadTickets();

      const bySymbol = store.ticketsBySymbol();
      expect(bySymbol['AAPL']).toContain(option);
      expect(bySymbol['AAPL'].length).toBe(2);
      expect(bySymbol['QQQ  260320C00500000']).toBeUndefined();
    });
  });

  describe('stageTicketAndWait (#755)', () => {
    it('lands the ticket only after the Firestore write resolves', async () => {
      let release!: () => void;
      ticketService.createTicket.and.returnValue(
        from(new Promise<void>((r) => (release = r))),
      );
      const ticket = mockEquityTicket();

      const pending = store.stageTicketAndWait(ticket);
      // Mid-write: nothing optimistic — the local map stays empty until
      // the persist lands (paperSignalOrder looks the doc up by refId).
      expect(store.tickets()['ticket-1']).toBeUndefined();

      release();
      expect(await pending).toBe(true);
      expect(store.tickets()['ticket-1']).toEqual(ticket);
      expect(ticketService.createTicket).toHaveBeenCalledWith(ticket);
    });

    it('resolves false, leaves the map empty, and reports on write error', async () => {
      ticketService.createTicket.and.returnValue(
        throwError(() => new Error('Firestore down')),
      );

      expect(await store.stageTicketAndWait(mockEquityTicket())).toBe(false);
      expect(store.tickets()['ticket-1']).toBeUndefined();
      expect(snackBar.open).toHaveBeenCalled();
    });
  });

  describe('sendTicketToPaper (#755 shared transaction)', () => {
    const signalTicket = (overrides: Partial<EquityOrderTicket> = {}): EquityOrderTicket =>
      mockEquityTicket({
        signalContext: {
          signalType: 'ST_ENTRY',
          barDate: '2026-08-24',
          timeframe: 'daily',
          direction: 'LONG',
          // Legacy hyphenated id — canonicalized to the doc id.
          decisionId: 'run-1-AAPL-daily-ST_ENTRY',
        },
        ...overrides,
      });

    it('marks SUBMITTING during the callable then consumes the liv_ doc and lands PAPER under the pap_ id (#1015)', async () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.deleteTicket.and.returnValue(of(undefined));
      store.stageTicket(signalTicket());
      const statuses: OrderTicketStatus[] = [];
      paperTrading.paperSignalOrder$.mockImplementation(() => {
        statuses.push(store.tickets()['ticket-1'].status);
        return of({ cohortId: 'c1', equityTradeId: 'eq-1', expressionTradeIds: [] });
      });

      const res = await store.sendTicketToPaper(store.tickets()['ticket-1'] as EquityOrderTicket, 7);

      // Transient SUBMITTING guarded the callable window (C1, #709).
      expect(statuses).toEqual([OrderTicketStatus.SUBMITTING]);
      expect(res.cohortId).toBe('c1');
      // The liv_ doc is consumed — never patched to mode:'paper' (the
      // {liv|pap}_ prefix must mirror mode). The callable's own
      // pap_{tradeId} lifecycle doc is the paper record.
      expect(ticketService.deleteTicket).toHaveBeenCalledWith('ticket-1');
      expect(ticketService.updateTicket).not.toHaveBeenCalledWith(
        'ticket-1',
        jasmine.objectContaining({ status: OrderTicketStatus.PAPER }),
      );
      expect(store.tickets()['ticket-1']).toBeUndefined();
      expect(store.tickets()['pap_eq-1'].status).toBe(OrderTicketStatus.PAPER);
    });

    it('builds the request from the ticket — canonical signalId, side-derived direction, refId', async () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.updateTicket.and.returnValue(of(undefined));
      store.stageTicket(signalTicket());

      await store.sendTicketToPaper(store.tickets()['ticket-1'] as EquityOrderTicket, 7);

      expect(paperTrading.paperSignalOrder$).toHaveBeenCalledWith({
        signalId: 'run-1_AAPL_daily_ST_ENTRY',
        symbol: 'AAPL',
        direction: 'long',
        quantity: 7,
        refId: 'ref-abc-123',
      });
    });

    it('maps a sell-side ticket to SHORT', async () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.updateTicket.and.returnValue(of(undefined));
      store.stageTicket(signalTicket({ side: 'sell' }));

      await store.sendTicketToPaper(store.tickets()['ticket-1'] as EquityOrderTicket, 3);

      expect(paperTrading.paperSignalOrder$).toHaveBeenCalledWith(
        jasmine.objectContaining({ direction: 'short' }),
      );
    });

    it('reverts to STAGED with the error attached and rethrows on callable failure', async () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.updateTicket.and.returnValue(of(undefined));
      store.stageTicket(signalTicket());
      paperTrading.paperSignalOrder$.mockReturnValueOnce(
        throwError(() => new Error('boom')),
      );

      await expect(
        store.sendTicketToPaper(store.tickets()['ticket-1'] as EquityOrderTicket, 7, 'Paper accept failed: '),
      ).rejects.toThrow('boom');

      // Revert is a persisted update — STAGED + retryable error with the
      // caller's prefix, not a local-only patch.
      expect(ticketService.updateTicket).toHaveBeenCalledWith(
        'ticket-1',
        jasmine.objectContaining({
          status: OrderTicketStatus.STAGED,
          error: jasmine.objectContaining({ retryable: true }),
        }),
      );
    });

    it('rejects a stale snapshot — the store copy must still be paper-eligible (#755 review)', async () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.updateTicket.and.returnValue(of(undefined));
      store.stageTicket(signalTicket());
      const snapshot = store.tickets()['ticket-1'] as EquityOrderTicket;
      // The ticket advances (e.g. submitted elsewhere) while the caller
      // holds the old STAGED snapshot.
      store.setTicketStatusLocal('ticket-1', OrderTicketStatus.SUBMITTED);

      await expect(store.sendTicketToPaper(snapshot, 7)).rejects.toThrow('no longer paper-eligible');
      expect(paperTrading.paperSignalOrder$).not.toHaveBeenCalled();
      expect(store.tickets()['ticket-1'].status).toBe(OrderTicketStatus.SUBMITTED);
    });

    it('guards a concurrent send — a ticket already SUBMITTING is not paper-eligible', async () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.updateTicket.and.returnValue(of(undefined));
      store.stageTicket(signalTicket());
      // Hold the first send open so the ticket sits on SUBMITTING.
      paperTrading.paperSignalOrder$.mockReturnValue(NEVER);
      const first = store.sendTicketToPaper(store.tickets()['ticket-1'] as EquityOrderTicket, 7);
      expect(store.tickets()['ticket-1'].status).toBe(OrderTicketStatus.SUBMITTING);

      await expect(
        store.sendTicketToPaper(store.tickets()['ticket-1'] as EquityOrderTicket, 7),
      ).rejects.toThrow('no longer paper-eligible');
      expect(paperTrading.paperSignalOrder$).toHaveBeenCalledTimes(1);
      void first;
    });

    it('a failed liv_ cleanup still lands PAPER — the paper order already exists; the stale doc is best-effort (#1015)', async () => {
      ticketService.createTicket.and.returnValue(of(undefined));
      ticketService.deleteTicket.and.returnValue(throwError(() => new Error('write down')));
      store.stageTicket(signalTicket());
      paperTrading.paperSignalOrder$.mockReturnValue(
        of({ cohortId: 'c1', equityTradeId: 'eq-1', expressionTradeIds: [] }),
      );

      await store.sendTicketToPaper(store.tickets()['ticket-1'] as EquityOrderTicket, 7);

      // The accept already happened server-side — the local ticket still
      // repoints at the canonical pap_ id; the orphaned liv_ doc is a
      // cleanup concern, not a reason to wedge the flow.
      expect(store.tickets()['pap_eq-1']?.status).toBe(OrderTicketStatus.PAPER);
    });
  });
});
