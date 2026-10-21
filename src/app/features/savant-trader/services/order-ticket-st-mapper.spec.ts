/**
 * @topic #984 — ST Firestore Reorg (task #1015)
 *
 * Pins the OrderTicket ↔ StOrderTicket boundary translation. The FE keeps
 * its legacy domain type; the mapper emits/reads the canonical
 * `st-order-tickets` schema (mode/origin/terms/state). Direction matters:
 * writes must produce docs indistinguishable from the BE writer's, reads
 * must not break on migrated or BE-emitted docs.
 */
import {
  fromStOrderTicket,
  stDocId,
  toStOrderTicket,
  toStTicketPatch,
} from './order-ticket-st-mapper';
import {
  EquityOrderTicket,
  InstrumentType,
  OptionOrderTicket,
  OrderSource,
  OrderTicketPatch,
  OrderTicketStatus,
} from './order-ticket.types';
import type { StOrderTicket } from '@st/order-tickets';

const EQUITY_TICKET: EquityOrderTicket = {
  id: 'AAPL-BUY-261020-TUE-1200PT',
  refId: 'ref-1',
  source: OrderSource.SIGNAL_PIPELINE,
  sourceRef: { type: 'occurrence_decision', id: 'dec-1' },
  status: OrderTicketStatus.STAGED,
  accountNumber: '5XB12345',
  side: 'buy',
  orderType: 'limit',
  timeInForce: 'gfd',
  marketHours: 'regular_hours',
  signalContext: {
    signalType: 'ST_TREND_RIDER_V1_SHORT',
    barDate: '2026-10-20',
    timeframe: 'D',
    direction: 'short',
    decisionId: 'dec-1',
    decisionIds: ['dec-1', 'dec-2'],
    signalPrice: 123.45,
  },
  bucketId: 'bucket-1',
  createdAt: '2026-10-20T16:00:00Z',
  updatedAt: '2026-10-20T16:00:00Z',
  instrumentType: InstrumentType.EQUITY,
  symbol: 'AAPL',
  quantity: '10',
  limitPrice: '150.25',
  stopPrice: '149.00',
  signalId: 'AAPL_2026-10-20_D_ST_TREND_RIDER_V1_SHORT',
  role: 'open',
};

const CANONICAL_LIVE: StOrderTicket = {
  id: 'liv_AAPL-BUY-261020-TUE-1200PT',
  origin: { type: 'signal', signalId: 'AAPL_2026-10-20_D_ST_TREND_RIDER_V1_SHORT', runId: 'run-1' },
  auto: false,
  mode: 'live',
  terms: {
    symbol: 'AAPL',
    side: 'buy',
    instrument: 'equity',
    quantity: 10,
    limits: { limitPrice: 150.25, stopPrice: 149 },
    orderType: 'limit',
    timeInForce: 'gfd',
    marketHours: 'regular_hours',
  },
  state: 'submitted',
  refId: 'ref-1',
  brokerOrderId: 'rh-order-9',
  fillSummary: { averagePrice: 150.25, filledQty: 10, filledAt: '2026-10-20T16:05:00Z' },
  lastError: { category: 'broker_reject', message: 'insufficient buying power' },
  accountTarget: '5XB12345',
  userId: 'uid-1',
  bucketId: 'bucket-1',
  signalContext: {
    signalId: 'legacysigid-1',
    signalType: 'ST_TREND_RIDER_V1_SHORT',
    barDate: '2026-10-20',
    timeframe: 'D',
    direction: 'short',
    decisionId: 'dec-1',
    decisionIds: ['dec-1', 'dec-2'],
    signalPrice: 123.45,
  },
  tracking: {
    role: 'open',
    linkedPositionId: 'pos-7',
    signalId: 'AAPL_2026-10-20_D_ST_TREND_RIDER_V1_SHORT',
    lastSeenState: 'confirmed',
  },
  migratedFrom: 'order-intents',
  terminalAt: '2026-10-20T17:00:00Z',
  createdAt: '2026-10-20T16:00:00Z',
  updatedAt: '2026-10-20T16:05:00Z',
  submittedAt: '2026-10-20T16:01:00Z',
};

describe('stDocId', () => {
  it('prefixes a bare FE id with the live ticket prefix', () => {
    expect(stDocId('AAPL-BUY-1')).toBe('liv_AAPL-BUY-1');
  });

  it.each(['liv_x', 'pap_y'])('passes already-prefixed ids through (%s)', (id) => {
    expect(stDocId(id)).toBe(id);
  });
});

describe('toStOrderTicket', () => {
  it('emits the canonical doc: liv_ id, origin, mode, terms, state, tracking', () => {
    const doc = toStOrderTicket(EQUITY_TICKET, 'uid-1');
    expect(doc.id).toBe('liv_AAPL-BUY-261020-TUE-1200PT');
    expect(doc.mode).toBe('live');
    expect(doc.state).toBe('staged');
    expect(doc.auto).toBe(true); // signal-accept staging is automated (migration parity)
    expect(doc.origin).toEqual({
      type: 'signal',
      // Canonical st-signals occurrence id — minted from signalContext
      // (stSignalOccurrenceId), not the tracking.signalId namespace.
      signalId: 'AAPL_2026-10-20_ST_TREND_RIDER_V1_SHORT',
    });
    expect(doc.terms).toEqual({
      symbol: 'AAPL',
      side: 'buy',
      instrument: 'equity',
      quantity: 10,
      limits: { limitPrice: 150.25, stopPrice: 149 },
      orderType: 'limit',
      timeInForce: 'gfd',
      marketHours: 'regular_hours',
    });
    expect(doc.accountTarget).toBe('5XB12345');
    expect(doc.userId).toBe('uid-1');
    expect(doc.refId).toBe('ref-1');
    expect(doc.bucketId).toBe('bucket-1');
    expect(doc.signalContext).toEqual({
      signalType: 'ST_TREND_RIDER_V1_SHORT',
      barDate: '2026-10-20',
      timeframe: 'D',
      direction: 'short',
      decisionId: 'dec-1',
      decisionIds: ['dec-1', 'dec-2'],
      signalPrice: 123.45,
    });
    expect(doc.tracking).toEqual({ role: 'open', signalId: 'AAPL_2026-10-20_D_ST_TREND_RIDER_V1_SHORT' });
    expect(doc.createdAt).toBe(EQUITY_TICKET.createdAt);
    expect(doc.updatedAt).toBe(EQUITY_TICKET.updatedAt);
  });

  it('maps option tickets: legs→occSymbol, price→limits.limitPrice', () => {
    const opt: OptionOrderTicket = {
      id: 'AAPL-OPT-1',
      refId: 'ref-1',
      source: OrderSource.SIGNAL_PIPELINE,
      status: OrderTicketStatus.STAGED,
      accountNumber: '5XB12345',
      side: 'buy',
      orderType: 'limit',
      timeInForce: 'gfd',
      marketHours: 'regular_hours',
      createdAt: '2026-10-20T16:00:00Z',
      updatedAt: '2026-10-20T16:00:00Z',
      instrumentType: InstrumentType.OPTION,
      symbol: 'AAPL',
      legs: [{ side: 'buy', symbol: 'AAPL  251121C00150000', optionId: 'opt-uuid', positionEffect: 'open' }],
      quantity: '2',
      price: '3.40',
      stopPrice: '149.00',
    };
    const doc = toStOrderTicket(opt, 'uid-1');
    expect(doc.terms.instrument).toBe('option');
    expect(doc.terms.legs).toEqual([
      { side: 'buy', occSymbol: 'AAPL  251121C00150000', optionId: 'opt-uuid', positionEffect: 'open' },
    ]);
    expect(doc.terms.quantity).toBe(2);
    expect(doc.terms.limits).toEqual({ limitPrice: 3.4, stopPrice: 149 });
  });

  it('emits a paper-mode doc when the ticket status is PAPER', () => {
    const doc = toStOrderTicket({ ...EQUITY_TICKET, status: OrderTicketStatus.PAPER }, 'uid-1');
    expect(doc.mode).toBe('paper');
    expect(doc.id).toBe('pap_AAPL-BUY-261020-TUE-1200PT');
    expect(doc.state).toBe('submitted');
  });

  it('rejects terms that violate the canonical sizing gate', () => {
    const bad = { ...EQUITY_TICKET, quantity: '10', dollarAmount: '500' };
    expect(() => toStOrderTicket(bad, 'uid-1')).toThrow(/mutually exclusive/);
  });

  it('maps management tickets: sourceRef.id → origin.positionGroupId, auto=false', () => {
    const mgmt: EquityOrderTicket = {
      ...EQUITY_TICKET,
      source: OrderSource.POSITION_MANAGEMENT,
      sourceRef: { type: 'position_close', id: 'AAPL' },
      signalContext: undefined,
      signalId: undefined,
      role: undefined,
    };
    const doc = toStOrderTicket(mgmt, 'uid-1');
    expect(doc.origin).toEqual({ type: 'management', positionGroupId: 'AAPL' });
    expect(doc.auto).toBe(false);
  });

  it('maps manual tickets: origin.type manual, auto=false, no origin.signalId', () => {
    const manual: EquityOrderTicket = {
      ...EQUITY_TICKET,
      source: OrderSource.MANUAL,
      sourceRef: undefined,
      signalContext: undefined,
      signalId: undefined,
      role: undefined,
    };
    const doc = toStOrderTicket(manual, 'uid-1');
    expect(doc.origin).toEqual({ type: 'manual' });
    expect(doc.auto).toBe(false);
  });

  it('maps program tickets: origin.type program, auto=true (prod convention)', () => {
    const program: EquityOrderTicket = {
      ...EQUITY_TICKET,
      source: OrderSource.PROGRAM,
      sourceRef: undefined,
      signalContext: undefined,
      signalId: undefined,
      role: undefined,
    };
    const doc = toStOrderTicket(program, 'uid-1');
    expect(doc.origin).toEqual({ type: 'program' });
    // Prod canonical program docs carry auto:true — a program pass is
    // an automated flow.
    expect(doc.auto).toBe(true);
  });
});

describe('toStTicketPatch', () => {
  it.each<[OrderTicketStatus, Record<string, unknown>]>([
    [OrderTicketStatus.STAGED, { state: 'staged' }],
    [OrderTicketStatus.SUBMITTED, { state: 'submitted' }],
    [OrderTicketStatus.QUEUED, { state: 'submitted' }],
    [OrderTicketStatus.RESTING, { state: 'submitted' }],
    [OrderTicketStatus.FILLED, { state: 'filled' }],
    [OrderTicketStatus.FAILED, { state: 'failed' }],
    [OrderTicketStatus.CANCELLED, { state: 'cancelled' }],
    [OrderTicketStatus.EXPIRED, { state: 'expired' }],
    [OrderTicketStatus.CANCEL_PENDING, { state: 'cancel_pending' }],
  ])('maps status %s → canonical state', (status, expected) => {
    expect(toStTicketPatch({ status }, 'now')).toEqual(
      expect.objectContaining(expected),
    );
  });

  it('throws on status PAPER — mode is bound to the doc-id prefix; paper is a doc move, not a patch (#1015)', () => {
    expect(() => toStTicketPatch({ status: OrderTicketStatus.PAPER }, 'now'))
      .toThrow(/not patchable/);
  });

  it('status STAGED strips every broker/terminal artifact — a requeued doc must not carry them', () => {
    const patch = toStTicketPatch({ status: OrderTicketStatus.STAGED }, 'now');
    expect(patch['state']).toBe('staged');
    for (const f of ['terminalAt', 'lastError', 'fillSummary', 'filledAt', 'cancelledAt', 'brokerOrderId', 'submittedAt']) {
      expect((patch[f] as { _methodName: string })._methodName).toBe('deleteField');
    }
  });

  it('maps result.orderId → brokerOrderId and fill fields → fillSummary', () => {
    expect(toStTicketPatch({ result: { orderId: 'rh-1', state: 'confirmed' } }, 'now'))
      .toEqual(expect.objectContaining({ brokerOrderId: 'rh-1' }));
    const filled = toStTicketPatch(
      { result: { orderId: 'rh-1', fillPrice: '150.25', filledQuantity: '10' } },
      'now',
    );
    // filledAt is schema-required on StTicketFillSummary — the patch
    // stamps it from the write time.
    expect(filled['fillSummary']).toEqual({ averagePrice: 150.25, filledQty: 10, filledAt: 'now' });
  });

  it('clears brokerOrderId AND fillSummary when result is deleted', () => {
    const cleared = toStTicketPatch({ result: undefined }, 'now');
    expect((cleared['brokerOrderId'] as { _methodName: string })._methodName).toBe('deleteField');
    expect((cleared['fillSummary'] as { _methodName: string })._methodName).toBe('deleteField');
  });

  it('maps error → lastError{category,message} and clears on undefined', () => {
    expect(toStTicketPatch({ error: { message: 'boom', code: 'X', retryable: false } }, 'now'))
      .toEqual(expect.objectContaining({ lastError: { category: 'X', message: 'boom' } }));
    const cleared = toStTicketPatch({ error: undefined }, 'now');
    expect((cleared['lastError'] as { _methodName: string })._methodName).toBe('deleteField');
  });

  it('maps term edits onto terms.* dotted paths', () => {
    const patch = toStTicketPatch(
      { quantity: '3', price: '1.10', stopPrice: '2.20', orderType: 'limit', legs: [{ side: 'buy', symbol: 'OCC1', optionId: 'o1', positionEffect: 'open' }] },
      'now',
    );
    expect(patch['terms.quantity']).toBe(3);
    expect(patch['terms.limits.limitPrice']).toBe(1.1);
    expect(patch['terms.limits.stopPrice']).toBe(2.2);
    expect(patch['terms.orderType']).toBe('limit');
    expect(patch['terms.legs']).toEqual([
      { side: 'buy', occSymbol: 'OCC1', optionId: 'o1', positionEffect: 'open' },
    ]);
  });

  it('passes through identity/audit keys and maps accountNumber→accountTarget', () => {
    const patch = toStTicketPatch(
      { refId: 'r2', bucketId: 'b2', terminalAt: 't1', accountNumber: 'ACCT', updatedAt: 'u1' },
      'now',
    );
    expect(patch).toEqual(expect.objectContaining({
      refId: 'r2', bucketId: 'b2', terminalAt: 't1', accountTarget: 'ACCT', updatedAt: 'u1',
    }));
  });

  it('throws on an unmapped patch key instead of writing legacy fields', () => {
    // `id`/`sourceRef` are excluded from OrderTicketPatch at the type
    // level — an untyped caller can still send them; the throw is the
    // runtime boundary.
    expect(() => toStTicketPatch({ id: 'new-id' } as OrderTicketPatch, 'now'))
      .toThrow(/unmapped patch key/);
  });
});

describe('fromStOrderTicket', () => {
  it('hydrates a canonical doc into the FE OrderTicket shape', () => {
    const t = fromStOrderTicket(CANONICAL_LIVE) as EquityOrderTicket;
    expect(t.id).toBe('liv_AAPL-BUY-261020-TUE-1200PT');
    expect(t.status).toBe(OrderTicketStatus.SUBMITTED);
    expect(t.source).toBe(OrderSource.SIGNAL_PIPELINE);
    expect(t.sourceRef).toEqual({ type: 'occurrence_decision', id: 'dec-1' });
    expect(t.instrumentType).toBe(InstrumentType.EQUITY);
    expect(t.symbol).toBe('AAPL');
    expect(t.side).toBe('buy');
    expect(t.quantity).toBe('10');
    expect(t.limitPrice).toBe('150.25');
    expect(t.stopPrice).toBe('149');
    expect(t.orderType).toBe('limit');
    expect(t.timeInForce).toBe('gfd');
    expect(t.marketHours).toBe('regular_hours');
    expect(t.accountNumber).toBe('5XB12345');
    expect(t.refId).toBe('ref-1');
    expect(t.bucketId).toBe('bucket-1');
    expect(t.result).toEqual({
      orderId: 'rh-order-9',
      state: 'confirmed', // tracking.lastSeenState — the broker's word, not the local lifecycle
      fillPrice: '150.25',
      filledQuantity: '10',
    });
    expect(t.error).toEqual({ message: 'insufficient buying power', code: 'broker_reject', retryable: false });
    expect(t.signalContext).toEqual({
      signalId: 'legacysigid-1', // legacy data.signalId round-trips (#1005 dedupe)
      signalType: 'ST_TREND_RIDER_V1_SHORT',
      barDate: '2026-10-20',
      timeframe: 'D',
      direction: 'short',
      decisionId: 'dec-1',
      decisionIds: ['dec-1', 'dec-2'],
      signalPrice: 123.45,
    });
    expect(t.role).toBe('open');
    expect(t.linkedPositionId).toBe('pos-7');
    expect(t.signalId).toBe('AAPL_2026-10-20_D_ST_TREND_RIDER_V1_SHORT');
    expect(t.lastSeenState).toBe('confirmed');
    expect(t.terminalAt).toBe('2026-10-20T17:00:00Z');
    expect(t.createdAt).toBe('2026-10-20T16:00:00Z');
    expect(t.updatedAt).toBe('2026-10-20T16:05:00Z');
  });

  it.each<[string, OrderTicketStatus]>([
    ['staged', OrderTicketStatus.STAGED],
    ['submitted', OrderTicketStatus.SUBMITTED],
    ['cancel_pending', OrderTicketStatus.CANCEL_PENDING],
    ['filled', OrderTicketStatus.FILLED],
    ['cancelled', OrderTicketStatus.CANCELLED],
    ['expired', OrderTicketStatus.EXPIRED],
    ['failed', OrderTicketStatus.FAILED],
  ])('maps state %s → status', (state, expected) => {
    const t = fromStOrderTicket({ ...CANONICAL_LIVE, state: state as StOrderTicket['state'] });
    expect(t.status).toBe(expected);
  });

  it('maps mode:paper non-terminal docs to PAPER status (legacy parity)', () => {
    const t = fromStOrderTicket({ ...CANONICAL_LIVE, mode: 'paper', state: 'submitted' });
    expect(t.status).toBe(OrderTicketStatus.PAPER);
  });

  it.each(['filled', 'cancelled', 'failed', 'expired'] as const)(
    'maps mode:paper + %s to PAPER — paper docs never enter the live queue as requeueable rows (#1015)',
    (state) => {
      const t = fromStOrderTicket({ ...CANONICAL_LIVE, mode: 'paper', state });
      expect(t.status).toBe(OrderTicketStatus.PAPER);
    },
  );

  it('reconstructs a management sourceRef from origin.positionGroupId', () => {
    const t = fromStOrderTicket({
      ...CANONICAL_LIVE,
      origin: { type: 'management', positionGroupId: 'grp-1' },
      signalContext: undefined,
    });
    expect(t.sourceRef).toEqual({ type: 'management', id: 'grp-1' });
  });

  it('prefers tracking.lastSeenState over the canonical state for result.state', () => {
    const t = fromStOrderTicket({
      ...CANONICAL_LIVE,
      tracking: { lastSeenState: 'confirmed' },
    });
    expect(t.result?.state).toBe('confirmed');
    const noSeen = fromStOrderTicket({ ...CANONICAL_LIVE, tracking: undefined });
    expect(noSeen.result?.state).toBe('submitted');
  });

  it('maps program/management origins and drops missing optional fields', () => {
    const t = fromStOrderTicket({
      ...CANONICAL_LIVE,
      origin: { type: 'program', instanceId: 'inst-1' },
      signalContext: undefined,
      tracking: undefined,
      brokerOrderId: undefined,
      fillSummary: undefined,
      lastError: undefined,
    });
    expect(t.source).toBe(OrderSource.PROGRAM);
    expect(t.signalContext).toBeUndefined();
    expect(t.result).toBeUndefined();
    expect(t.error).toBeUndefined();
    expect(t.role).toBeUndefined();
  });

  it('hydrates option tickets back with legs + price', () => {
    const t = fromStOrderTicket({
      ...CANONICAL_LIVE,
      terms: {
        symbol: 'AAPL', side: 'buy', instrument: 'option', quantity: 2,
        legs: [{ side: 'buy', occSymbol: 'OCC1', optionId: 'o1', positionEffect: 'open' }],
        limits: { limitPrice: 3.4 },
      },
    }) as OptionOrderTicket;
    expect(t.instrumentType).toBe(InstrumentType.OPTION);
    expect(t.legs).toEqual([{ side: 'buy', symbol: 'OCC1', optionId: 'o1', positionEffect: 'open' }]);
    expect(t.price).toBe('3.4');
  });
});
