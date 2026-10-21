/**
 * @topic #984 — ST Firestore Reorg (task #1015)
 *
 * Pins OrderTicketService against the canonical `st-order-tickets` root:
 * path spellings on the Firestore boundary, canonical write payloads
 * (state/mode/terms — never legacy status/source fields), the `state`
 * hydration query, and doc→OrderTicket hydration.
 */
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';

import { OrderTicketService } from './order-ticket.service';
import {
  EquityOrderTicket,
  InstrumentType,
  OrderSource,
  OrderTicketStatus,
} from './order-ticket.types';
import { ST_ORDER_TICKETS_ROOT } from '@st/collections';
import type { StOrderTicket } from '@st/order-tickets';

jest.mock('@angular/fire/firestore', () => ({
  ...jest.requireActual('@angular/fire/firestore'),
  collection: jest.fn(),
  doc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  query: jest.fn((_c: unknown, ...args: unknown[]) => ({ _args: args })),
  where: jest.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  writeBatch: jest.fn(),
}));

const mockCollection = collection as jest.Mock;
const mockDoc = doc as jest.Mock;
const mockGetDoc = getDoc as jest.Mock;
const mockGetDocs = getDocs as jest.Mock;
const mockQuery = query as jest.Mock;
const mockWhere = where as jest.Mock;
const mockWriteBatch = writeBatch as jest.Mock;

const TICKET: EquityOrderTicket = {
  id: 'AAPL-BUY-261020-TUE-1200PT',
  refId: 'ref-1',
  source: OrderSource.SIGNAL_PIPELINE,
  status: OrderTicketStatus.STAGED,
  accountNumber: '5XB12345',
  side: 'buy',
  orderType: 'limit',
  timeInForce: 'gfd',
  marketHours: 'regular_hours',
  signalContext: {
    signalType: 'T',
    barDate: '2026-10-20',
    timeframe: 'D',
    direction: 'long',
    decisionId: 'dec-1',
  },
  createdAt: '2026-10-20T16:00:00Z',
  updatedAt: '2026-10-20T16:00:00Z',
  instrumentType: InstrumentType.EQUITY,
  symbol: 'AAPL',
  quantity: '10',
  limitPrice: '150.25',
};

const CANONICAL: StOrderTicket = {
  id: 'liv_AAPL-BUY-261020-TUE-1200PT',
  origin: { type: 'signal' },
  auto: false,
  mode: 'live',
  terms: {
    symbol: 'AAPL', side: 'buy', instrument: 'equity', quantity: 10,
    limits: { limitPrice: 150.25 },
    orderType: 'limit', timeInForce: 'gfd', marketHours: 'regular_hours',
  },
  state: 'submitted',
  refId: 'ref-1',
  brokerOrderId: 'rh-1',
  accountTarget: '5XB12345',
  userId: 'user-123',
  createdAt: '2026-10-20T16:00:00Z',
  updatedAt: '2026-10-20T16:05:00Z',
};

describe('OrderTicketService (#1015 st-order-tickets cutover)', () => {
  let service: OrderTicketService;
  let batch: { set: jest.Mock; update: jest.Mock; delete: jest.Mock; commit: jest.Mock };

  beforeEach(() => {
    batch = {
      commit: jest.fn().mockResolvedValue(undefined),
    } as typeof batch;
    batch.set = jest.fn(() => batch);
    batch.update = jest.fn(() => batch);
    batch.delete = jest.fn(() => batch);
    mockWriteBatch.mockReturnValue(batch);
    mockCollection.mockReturnValue('COLLECTION_REF');
    mockDoc.mockImplementation((_fs: unknown, ...segments: string[]) => ({ path: segments.join('/') }));

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: Auth,
          useValue: {
            onAuthStateChanged: (cb: (u: unknown) => void) => {
              cb({ uid: 'user-123' });
              return () => {};
            },
          },
        },
        { provide: Firestore, useValue: {} },
        OrderTicketService,
      ],
    });
    service = TestBed.inject(OrderTicketService);
  });

  it('creates at st-order-tickets/liv_{id} with a canonical doc (no legacy fields)', async () => {
    await firstValueFrom(service.createTicket(TICKET));

    expect(mockDoc).toHaveBeenCalledWith(
      expect.anything(), ST_ORDER_TICKETS_ROOT, 'liv_AAPL-BUY-261020-TUE-1200PT',
    );
    const payload = batch.set.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).toEqual(expect.objectContaining({
      id: 'liv_AAPL-BUY-261020-TUE-1200PT',
      mode: 'live',
      state: 'staged',
      accountTarget: '5XB12345',
      userId: 'user-123',
    }));
    expect(payload['terms']).toEqual(expect.objectContaining({ symbol: 'AAPL', quantity: 10 }));
    for (const legacy of ['status', 'source', 'symbol', 'accountNumber', 'orderType', 'side']) {
      expect(payload).not.toHaveProperty(legacy);
    }
    expect(batch.commit).toHaveBeenCalled();
  });

  it('updates via canonical field paths — status→state+submittedAt', async () => {
    await firstValueFrom(
      service.updateTicket('liv_x', { status: OrderTicketStatus.SUBMITTED }),
    );
    const payload = batch.update.mock.calls[0][1] as Record<string, unknown>;
    expect(payload['state']).toBe('submitted');
    expect(payload['submittedAt']).toBeDefined();
    expect(payload).not.toHaveProperty('status');
    expect(payload['updatedAt']).toBeDefined();
  });

  it('maps term edits to terms.* dotted paths', async () => {
    await firstValueFrom(service.updateTicket('liv_x', { stopPrice: '99.5', quantity: '4' }));
    const payload = batch.update.mock.calls[0][1] as Record<string, unknown>;
    expect(payload['terms.limits.stopPrice']).toBe(99.5);
    expect(payload['terms.quantity']).toBe(4);
    expect(payload).not.toHaveProperty('stopPrice');
  });

  it('batch terminal updates write canonical state + stamps', async () => {
    await firstValueFrom(service.batchUpdateTerminalStatus([
      { id: 'liv_a', status: OrderTicketStatus.FILLED, terminalAt: 't1', fillSummary: { averagePrice: 150.25, filledQty: 10, filledAt: 't1' } },
      { id: 'liv_b', status: OrderTicketStatus.CANCELLED, terminalAt: 't2' },
      { id: 'liv_c', status: OrderTicketStatus.FAILED, terminalAt: 't3', lastError: { category: 'broker_rejected', message: 'Order rejected' } },
    ]));
    const [refA, payloadA] = batch.update.mock.calls[0] as [unknown, Record<string, unknown>];
    const [refB, payloadB] = batch.update.mock.calls[1] as [unknown, Record<string, unknown>];
    const [refC, payloadC] = batch.update.mock.calls[2] as [unknown, Record<string, unknown>];
    expect(payloadA).toEqual(expect.objectContaining({
      state: 'filled', terminalAt: 't1', filledAt: 't1',
      fillSummary: { averagePrice: 150.25, filledQty: 10, filledAt: 't1' },
    }));
    expect(payloadB).toEqual(expect.objectContaining({ state: 'cancelled', terminalAt: 't2', cancelledAt: 't2' }));
    // The canonical audit requires lastError on failed docs.
    expect(payloadC).toEqual(expect.objectContaining({
      state: 'failed', terminalAt: 't3',
      lastError: { category: 'broker_rejected', message: 'Order rejected' },
    }));
    expect(payloadA).not.toHaveProperty('status');
  });

  it('hydrates via state not-in query on the canonical root', async () => {
    mockGetDocs.mockResolvedValue({ docs: [{ data: () => CANONICAL }] });
    const tickets = await firstValueFrom(service.loadAllTickets());

    expect(mockCollection).toHaveBeenCalledWith(expect.anything(), ST_ORDER_TICKETS_ROOT);
    const whereArgs = mockWhere.mock.calls.map((c) => c.slice(0, 3));
    expect(whereArgs).toEqual(
      expect.arrayContaining([
        ['userId', '==', 'user-123'],
        ['state', 'not-in', ['filled']],
      ]),
    );
    expect(tickets).toHaveLength(1);
    expect(tickets[0].status).toBe(OrderTicketStatus.SUBMITTED);
    expect(tickets[0].result?.orderId).toBe('rh-1');
    expect((tickets[0] as EquityOrderTicket).symbol).toBe('AAPL');
  });

  it('loadTicket normalizes bare ids to the liv_ doc path', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => CANONICAL });
    const t = await firstValueFrom(service.loadTicket('AAPL-BUY-261020-TUE-1200PT'));
    expect(mockDoc).toHaveBeenCalledWith(
      expect.anything(), ST_ORDER_TICKETS_ROOT, 'liv_AAPL-BUY-261020-TUE-1200PT',
    );
    expect(t?.status).toBe(OrderTicketStatus.SUBMITTED);
  });

  it('deleteTicket targets the prefixed doc', async () => {
    await firstValueFrom(service.deleteTicket('pap_sig-9'));
    expect(mockDoc).toHaveBeenCalledWith(
      expect.anything(), ST_ORDER_TICKETS_ROOT, 'pap_sig-9',
    );
    expect(batch.delete).toHaveBeenCalled();
  });
});
