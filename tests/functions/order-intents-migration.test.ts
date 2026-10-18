/**
 * @topic #984 — ST Firestore Reorg (task #1003)
 *
 * Specs for the legacy `savant-trader/data/order-intents` →
 * `st-order-tickets` mapping + mirror used by the one-shot migration and
 * the soak-period dual-write trigger.
 *
 * Contract under test (issue #1003 acceptance):
 * - 77 docs migrated preserving refId/state/lineage; status:'paper' →
 *   mode:'paper'
 * - source → origin.type per mapOrderSourceToOriginType
 * - screenshot tracking fields survive under ticket.tracking
 * - malformed docs are reported, never silently dropped or guessed
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  legacyIntentToTicket,
  paperTradeStateSettle,
} from '../../functions/src/order-tickets/legacy-order-intents';
import {
  mirrorOrderIntent,
  MIRROR_ORDER_INTENTS_PATH,
} from '../../functions/src/order-tickets/order-intents-mirror';
import {
  getTicketDoc,
  stTicketToOrderTicketDoc,
} from '../../functions/src/paper-trading/callables';
import type { StOrderTicket } from '../../shared/st-order-tickets';
import type { SignalExpressionTemplate } from '../../shared/paper-trading-contracts';

// ---------------------------------------------------------------------------
// Legacy doc fixtures — the shapes the FE OrderTicketService writes today.
// ---------------------------------------------------------------------------

function liveIntent(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    refId: 'ref-abc-123',
    source: 'signal_pipeline',
    sourceRef: { type: 'occurrence_decision', id: 'dec-9' },
    status: 'submitted',
    accountNumber: '5RH12345',
    side: 'buy',
    orderType: 'market',
    timeInForce: 'gfd',
    marketHours: 'regular_hours',
    instrumentType: 'equity',
    symbol: 'ADPT',
    quantity: '10',
    userId: 'uid-1',
    signalContext: {
      signalType: 'D_ST_TREND_RIDER_V2_LONG',
      barDate: '2026-10-14',
      timeframe: '1d',
      direction: 'long',
      decisionId: 'dec-9',
      decisionIds: ['dec-9'],
      signalPrice: 12.34,
    },
    createdAt: '2026-10-14T13:30:00.000Z',
    updatedAt: '2026-10-14T13:31:00.000Z',
    ...over,
  };
}

function paperIntent(over: Record<string, unknown> = {}): Record<string, unknown> {
  return liveIntent({ status: 'paper', ...over });
}

// ---------------------------------------------------------------------------
// Tiny Firestore fake for the mirror (doc-level get/set/delete only).
// ---------------------------------------------------------------------------

type FakeDoc = { exists: boolean; data?: Record<string, unknown> };

function fakeFirestore(initial: Record<string, Record<string, unknown>> = {}) {
  const store = new Map<string, Record<string, unknown>>(
    Object.entries(initial).map(([k, v]) => [k, { ...v }]),
  );
  const sets: Array<{ path: string; doc: Record<string, unknown>; merge: boolean }> = [];
  const deletes: string[] = [];
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => {
        const path = `${name}/${id}`;
        const ref = {
          get: async (): Promise<FakeDoc> => {
            const d = store.get(path);
            return { exists: d !== undefined, data: () => d };
          },
          set: async (doc: Record<string, unknown>, opts?: { merge?: boolean }) => {
            sets.push({ path, doc, merge: opts?.merge === true });
            store.set(path, opts?.merge === true ? { ...(store.get(path) ?? {}), ...doc } : { ...doc });
          },
          delete: async () => { deletes.push(path); store.delete(path); },
        };
        return ref;
      },
    }),
    // Fake txn delegates to the same store — reads/writes apply inside the
    // callback (mirrors runTransaction's contract for this code's usage).
    // Also pins the real contract: reads must precede writes.
    runTransaction: async <T>(work: (txn: {
      get: (r: { get: () => Promise<FakeDoc> }) => Promise<FakeDoc>;
      set: (r: { set: (d: Record<string, unknown>, o?: { merge?: boolean }) => Promise<void> }, d: Record<string, unknown>, o?: { merge?: boolean }) => void;
      delete: (r: { delete: () => Promise<void> }) => void;
    }) => Promise<T>): Promise<T> => {
      let writesBegun = false;
      return work({
        get: (r) => {
          assert.ok(!writesBegun, 'txn.get called after a write — violates reads-before-writes');
          return r.get();
        },
        set: (r, d, o) => { writesBegun = true; void r.set(d, o); },
        delete: (r) => { writesBegun = true; void r.delete(); },
      });
    },
    batch: () => {
      const ops: Array<() => Promise<unknown>> = [];
      return {
        delete: (r: { delete: () => Promise<void> }) => { ops.push(() => r.delete()); },
        set: (r: { set: (d: Record<string, unknown>, o?: { merge?: boolean }) => Promise<void> }, d: Record<string, unknown>, o?: { merge?: boolean }) => { ops.push(() => r.set(d, o)); },
        commit: async () => { for (const op of ops) await op(); },
      };
    },
  };
  return { db, store, sets, deletes };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeDeps = (f: ReturnType<typeof fakeFirestore>) => ({ db: f.db as any, logger: { warn() {}, error() {} } });

describe('legacyIntentToTicket', () => {
  it('maps a live signal-pipeline intent → liv_ ticket with signal origin', () => {
    const r = legacyIntentToTicket('intent-1', liveIntent());
    assert.equal(r.malformed, undefined);
    const t = r.ticket!;
    assert.equal(t.id, 'liv_intent-1');
    assert.equal(t.mode, 'live');
    assert.equal(t.state, 'submitted');
    assert.deepEqual(t.origin, {
      type: 'signal',
      signalId: 'ADPT_2026-10-14_D_ST_TREND_RIDER_V2_LONG',
    });
    assert.equal(t.auto, true);
    assert.equal(t.refId, 'ref-abc-123');
    assert.equal(t.accountTarget, '5RH12345');
    assert.equal(t.userId, 'uid-1');
    assert.equal(t.terms.symbol, 'ADPT');
    assert.equal(t.terms.side, 'buy');
    assert.equal(t.terms.instrument, 'equity');
    assert.equal(t.terms.quantity, 10);
    assert.equal(t.terms.orderType, 'market');
    assert.equal(t.createdAt, '2026-10-14T13:30:00.000Z');
    assert.equal(t.updatedAt, '2026-10-14T13:31:00.000Z');
  });

  it("maps status:'paper' → {mode:'paper'} + pap_ id (the AC mapping)", () => {
    const t = legacyIntentToTicket('intent-2', paperIntent()).ticket!;
    assert.equal(t.id, 'pap_intent-2');
    assert.equal(t.mode, 'paper');
    assert.equal(t.state, 'submitted');
  });

  const statusCases: Array<[string, string]> = [
    ['staged', 'staged'],
    ['submitting', 'submitted'],
    ['queued', 'submitted'],
    ['resting', 'submitted'],
    ['filled', 'filled'],
    ['failed', 'failed'],
    ['cancelled', 'cancelled'],
    ['expired', 'expired'],
  ];
  for (const [status, state] of statusCases) {
    it(`maps live status ${status} → state ${state}`, () => {
      const t = legacyIntentToTicket('i', liveIntent({ status })).ticket!;
      assert.equal(t.mode, 'live');
      assert.equal(t.state, state);
    });
  }

  it('maps source → origin.type and auto flag', () => {
    const manual = legacyIntentToTicket('i', liveIntent({ source: 'manual' })).ticket!;
    assert.equal(manual.origin.type, 'manual');
    assert.equal(manual.auto, false);
    const mgmt = legacyIntentToTicket('i', liveIntent({ source: 'position_management' })).ticket!;
    assert.equal(mgmt.origin.type, 'management');
    assert.equal(mgmt.auto, false);
  });

  it('links management origin to sourceRef.id as positionGroupId', () => {
    const t = legacyIntentToTicket('i', liveIntent({
      source: 'position_management',
      sourceRef: { type: 'position', id: 'STX-251001-grp-01' },
    })).ticket!;
    assert.deepEqual(t.origin, { type: 'management', positionGroupId: 'STX-251001-grp-01' });
  });

  it('parses string terms to numbers; carries limits + taxLots', () => {
    const t = legacyIntentToTicket('i', liveIntent({
      side: 'sell',
      orderType: 'limit',
      quantity: undefined,
      dollarAmount: '250.50',
      limitPrice: '25.05',
      stopPrice: '24.00',
      taxLots: [{ lotId: 'lot-1', quantity: '5' }],
    })).ticket!;
    assert.equal(t.terms.dollarAmount, 250.5);
    assert.equal(t.terms.quantity, undefined);
    assert.deepEqual(t.terms.limits, { limitPrice: 25.05, stopPrice: 24 });
    assert.deepEqual(t.terms.taxLots, [{ lotId: 'lot-1', quantity: '5' }]);
  });

  it('maps an option intent → option instrument + legs', () => {
    const t = legacyIntentToTicket('i', liveIntent({
      instrumentType: 'option',
      symbol: 'SPY',
      quantity: '1',
      price: '1.25',
      legs: [{
        side: 'buy',
        symbol: 'SPY 251219C00500000',
        optionId: 'opt-uuid-1',
        positionEffect: 'open',
      }],
    })).ticket!;
    assert.equal(t.terms.instrument, 'option');
    assert.equal(t.terms.symbol, 'SPY');
    assert.deepEqual(t.terms.legs, [{
      side: 'buy',
      occSymbol: 'SPY 251219C00500000',
      optionId: 'opt-uuid-1',
      positionEffect: 'open',
    }]);
    assert.deepEqual(t.terms.limits, { limitPrice: 1.25 });
  });

  it('carries signalContext lineage through (decisionIds, signalPrice)', () => {
    const t = legacyIntentToTicket('i', liveIntent()).ticket!;
    assert.deepEqual(t.signalContext, {
      signalType: 'D_ST_TREND_RIDER_V2_LONG',
      barDate: '2026-10-14',
      timeframe: '1d',
      direction: 'long',
      decisionId: 'dec-9',
      decisionIds: ['dec-9'],
      signalPrice: 12.34,
    });
  });

  it('nests screenshot tracking fields under ticket.tracking', () => {
    const t = legacyIntentToTicket('i', liveIntent({
      role: 'close',
      linkedPositionId: 'pos-7',
      signalId: 'sig-3',
      lastSeenState: 'filled',
      capturedEvents: { 'order-filled': { at: '2026-10-15T00:00:00Z' } },
    })).ticket!;
    assert.deepEqual(t.tracking, {
      role: 'close',
      linkedPositionId: 'pos-7',
      signalId: 'sig-3',
      lastSeenState: 'filled',
      capturedEvents: { 'order-filled': { at: '2026-10-15T00:00:00Z' } },
    });
  });

  it('omits tracking when the legacy doc carries none', () => {
    const t = legacyIntentToTicket('i', liveIntent()).ticket!;
    assert.equal(t.tracking, undefined);
  });

  it('stamps state-adjacent timestamps from the best available proxy', () => {
    const filled = legacyIntentToTicket('i', liveIntent({
      status: 'filled',
      terminalAt: '2026-10-15T14:00:00.000Z',
      result: {
        orderId: 'rh-order-9',
        fillPrice: '12.50',
        filledQuantity: '10',
        brokerOrder: { id: 'rh-order-9', lastTransactionAt: '2026-10-15T14:00:01.000Z' },
      },
    })).ticket!;
    assert.equal(filled.state, 'filled');
    assert.equal(filled.submittedAt, '2026-10-14T13:30:00.000Z'); // createdAt proxy
    assert.equal(filled.filledAt, '2026-10-15T14:00:01.000Z');
    assert.equal(filled.terminalAt, '2026-10-15T14:00:00.000Z');
    assert.equal(filled.brokerOrderId, 'rh-order-9');
    assert.deepEqual(filled.fillSummary, {
      averagePrice: 12.5,
      filledQty: 10,
      filledAt: '2026-10-15T14:00:01.000Z',
    });
    assert.deepEqual(filled.reviewSnapshot, {
      orderChecks: { id: 'rh-order-9', lastTransactionAt: '2026-10-15T14:00:01.000Z' },
    });
  });

  it('maps error → lastError on failed tickets', () => {
    const t = legacyIntentToTicket('i', liveIntent({
      status: 'failed',
      error: { message: 'insufficient buying power', code: 'BP_REJECT', retryable: false },
    })).ticket!;
    assert.deepEqual(t.lastError, { category: 'BP_REJECT', message: 'insufficient buying power' });
  });

  it('falls back to refId = doc id when legacy refId is absent (warning, not malformed)', () => {
    const r = legacyIntentToTicket('intent-noref', liveIntent({ refId: undefined }));
    assert.equal(r.ticket!.refId, 'intent-noref');
    assert.ok(r.warnings!.some((w) => w.includes('refId')));
  });

  const malformedCases: Array<[string, Record<string, unknown>]> = [
    ['unknown status', { status: 'weird' }],
    ['unknown source', { source: 'from_mars' }],
    ['missing accountNumber', { accountNumber: undefined }],
    ['missing userId', { userId: undefined }],
    ['missing symbol', { symbol: undefined }],
    ['missing createdAt', { createdAt: undefined }],
    ['no sizing (neither quantity nor dollarAmount)', { quantity: undefined }],
    ['option ticket without legs', { instrumentType: 'option', legs: undefined }],
  ];
  for (const [label, over] of malformedCases) {
    it(`reports malformed: ${label}`, () => {
      const r = legacyIntentToTicket('i', liveIntent(over));
      assert.equal(r.ticket, undefined);
      assert.ok(r.malformed!.length > 0, `expected malformed for ${label}`);
    });
  }

  it('prefers quantity when a legacy doc carries both sizings (prod case: SCHB-BUY)', () => {
    const r = legacyIntentToTicket('i', liveIntent({ dollarAmount: '10' }));
    assert.equal(r.ticket!.terms.quantity, 10);
    assert.equal(r.ticket!.terms.dollarAmount, undefined);
    assert.ok(r.warnings!.some((w) => w.includes('dollarAmount')));
  });

  it('carries fractional share quantity (prod case: KMEM fractional close)', () => {
    const t = legacyIntentToTicket('i', liveIntent({ quantity: '0.5048', side: 'sell' })).ticket!;
    assert.equal(t.terms.quantity, 0.5048);
  });

  it('marks migrated docs with migratedFrom provenance', () => {
    assert.equal(legacyIntentToTicket('i', liveIntent()).ticket!.migratedFrom, 'order-intents');
  });

  it('applies settledState override (paper settle pass)', () => {
    const t = legacyIntentToTicket('i', paperIntent(), { settledState: 'filled' }).ticket!;
    assert.equal(t.mode, 'paper');
    assert.equal(t.state, 'filled');
    assert.ok(t.filledAt);
  });

  it('carries settledFill → fillSummary on a trade-settled filled ticket', () => {
    const t = legacyIntentToTicket('i', paperIntent(), {
      settledState: 'filled',
      settledFill: { averagePrice: 12.5, filledQty: 10, filledAt: '2026-10-15' },
    }).ticket!;
    assert.deepEqual(t.fillSummary, { averagePrice: 12.5, filledQty: 10, filledAt: '2026-10-15' });
    assert.equal(t.filledAt, '2026-10-15');
  });

  it('warns (not malforms) when a filled ticket has no fill data anywhere', () => {
    const r = legacyIntentToTicket('i', liveIntent({ status: 'filled' }));
    assert.equal(r.ticket!.state, 'filled');
    assert.equal(r.ticket!.fillSummary, undefined);
    assert.ok(r.warnings!.some((w) => w.includes('fillSummary')));
  });

  it('falls back terminalAt ← updatedAt on terminal states missing terminalAt', () => {
    const t = legacyIntentToTicket('i', liveIntent({ status: 'cancelled' })).ticket!;
    assert.equal(t.terminalAt, '2026-10-14T13:31:00.000Z');
    assert.equal(t.cancelledAt, '2026-10-14T13:31:00.000Z');
  });

  it('emits a legacy-missing lastError marker on failed docs without an error payload', () => {
    const t = legacyIntentToTicket('i', liveIntent({ status: 'failed' })).ticket!;
    assert.equal(t.lastError!.category, 'legacy-missing');
  });

  it('does not mint origin.signalId when signalContext is incomplete', () => {
    const t = legacyIntentToTicket('i', liveIntent({
      signalContext: { direction: 'long' },
    })).ticket!;
    assert.deepEqual(t.origin, { type: 'signal' });
  });
});

describe('paperTradeStateSettle', () => {
  const cases: Array<[string, string]> = [
    ['OPEN', 'submitted'],
    ['PENDING', 'submitted'],
    ['ASSIGNED', 'submitted'],
    ['CLOSED', 'filled'],
    ['CANCELLED', 'cancelled'],
    ['EXPIRED', 'expired'],
  ];
  for (const [tradeStatus, state] of cases) {
    it(`maps trade status ${tradeStatus} → ticket state ${state}`, () => {
      assert.equal(paperTradeStateSettle(tradeStatus), state);
    });
  }

  it('returns undefined for unknown trade statuses', () => {
    assert.equal(paperTradeStateSettle('NOPE'), undefined);
  });
});

describe('mirrorOrderIntent', () => {
  it('upserts the canonical doc on a legacy create/update', async () => {
    const f = fakeFirestore();
    const res = await mirrorOrderIntent(fakeDeps(f), 'intent-1', liveIntent());
    assert.equal(res, 'upserted');
    assert.equal(f.sets.length, 1);
    assert.equal(f.sets[0].path, 'st-order-tickets/liv_intent-1');
    assert.equal(f.sets[0].merge, true);
    assert.equal(f.sets[0].doc.refId, 'ref-abc-123');
    assert.equal(f.sets[0].doc.state, 'submitted');
  });

  it('deletes both liv_/pap_ candidates on a legacy delete', async () => {
    const f = fakeFirestore({ 'st-order-tickets/pap_i2': { state: 'submitted' } });
    const res = await mirrorOrderIntent(fakeDeps(f), 'i2', null);
    assert.equal(res, 'deleted');
    assert.deepEqual(f.deletes.sort(), [
      'st-order-tickets/liv_i2', 'st-order-tickets/pap_i2',
    ]);
    assert.equal(f.store.has('st-order-tickets/pap_i2'), false);
  });

  it('skips malformed docs without writing', async () => {
    const f = fakeFirestore();
    const res = await mirrorOrderIntent(fakeDeps(f), 'bad', liveIntent({ status: 'bogus' }));
    assert.equal(res, 'skipped');
    assert.equal(f.sets.length, 0);
  });

  it('never regresses a terminal canonical state on a non-terminal rewrite', async () => {
    const f = fakeFirestore({
      'st-order-tickets/liv_i3': { state: 'filled', filledAt: '2026-10-15T00:00:00Z', refId: 'r1' },
    });
    // Legacy doc rewritten back to 'submitted' (e.g. an out-of-order field edit)
    const res = await mirrorOrderIntent(fakeDeps(f), 'i3', liveIntent({ status: 'submitted' }));
    assert.equal(res, 'upserted');
    const merged = f.store.get('st-order-tickets/liv_i3')!;
    assert.equal(merged.state, 'filled');           // terminal preserved
    assert.equal(merged.filledAt, '2026-10-15T00:00:00Z');
    assert.equal(merged.symbol ?? merged.terms?.symbol, 'ADPT');
  });

  it('fill beats cancel — existing filled survives a legacy cancelled rewrite', async () => {
    const f = fakeFirestore({
      'st-order-tickets/liv_i4': { state: 'filled', filledAt: '2026-10-15T00:00:00Z', refId: 'r1' },
    });
    const res = await mirrorOrderIntent(fakeDeps(f), 'i4', liveIntent({ status: 'cancelled' }));
    assert.equal(res, 'upserted');
    const merged = f.store.get('st-order-tickets/liv_i4')!;
    assert.equal(merged.state, 'filled');
  });

  it('keeps the newer canonical updatedAt when the legacy rewrite is older', async () => {
    const f = fakeFirestore({
      'st-order-tickets/liv_i4b': { state: 'submitted', updatedAt: '2026-10-20T00:00:00Z', refId: 'r1' },
    });
    // legacyIntent carries updatedAt 2026-10-14 — older than canonical's
    const res = await mirrorOrderIntent(fakeDeps(f), 'i4b', liveIntent({ status: 'submitted' }));
    assert.equal(res, 'upserted');
    assert.equal(f.store.get('st-order-tickets/liv_i4b')!.updatedAt, '2026-10-20T00:00:00Z');
  });

  it('drops an opposite-prefix orphan when the legacy mode flips', async () => {
    const f = fakeFirestore({
      'st-order-tickets/pap_i5': { state: 'submitted', refId: 'r5' },
    });
    // Legacy doc's status changed paper → submitted (mode flips to live)
    const res = await mirrorOrderIntent(fakeDeps(f), 'i5', liveIntent({ status: 'submitted' }));
    assert.equal(res, 'upserted');
    assert.equal(f.store.has('st-order-tickets/liv_i5'), true);
    assert.equal(f.store.has('st-order-tickets/pap_i5'), false);
    assert.ok(f.deletes.includes('st-order-tickets/pap_i5'));
  });

  it('carries origin.positionGroupId forward — merge:true replaces the origin map (#1004)', async () => {
    const f = fakeFirestore({
      'st-order-tickets/liv_i4c': {
        state: 'submitted',
        refId: 'r1',
        origin: { type: 'signal', signalId: 'ADPT_2026-10-14_D_ST_TREND_RIDER_V2_LONG', positionGroupId: 'ADPT-261014-grp-01' },
      },
    });
    const res = await mirrorOrderIntent(fakeDeps(f), 'i4c', liveIntent({ status: 'submitted' }));
    assert.equal(res, 'upserted');
    const stored = f.store.get('st-order-tickets/liv_i4c')!;
    assert.equal(
      (stored.origin as { positionGroupId?: string }).positionGroupId,
      'ADPT-261014-grp-01',
      'soak rewrite must not wipe the group stamp',
    );
  });

  it('is fail-soft on Firestore errors', async () => {
    const db = {
      collection: () => ({ doc: () => ({ get: async () => { throw new Error('down'); } }) }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await mirrorOrderIntent({ db: db as any, logger: { warn() {}, error() {} } }, 'x', liveIntent());
    assert.equal(res, 'skipped');
  });
});

describe('MIRROR_ORDER_INTENTS_PATH', () => {
  it('targets the legacy anchored collection', () => {
    assert.equal(MIRROR_ORDER_INTENTS_PATH, 'savant-trader/data/order-intents/{intentId}');
  });
});

// ---------------------------------------------------------------------------
// Reader cutover — getTicketDoc canonical-first, legacy fallback (#1003).
// ---------------------------------------------------------------------------

function canonicalTicket(over: Partial<StOrderTicket> = {}): StOrderTicket {
  return {
    id: 'liv_t1',
    origin: { type: 'signal' },
    auto: true,
    mode: 'live',
    terms: { symbol: 'ADPT', side: 'buy', quantity: 10 },
    state: 'submitted',
    refId: 'ref-canonical',
    accountTarget: '5RH1',
    userId: 'u1',
    signalContext: {
      signalType: 'SIG', barDate: '2026-10-14', direction: 'long', decisionId: 'dec-1',
    },
    createdAt: '2026-10-14T13:30:00.000Z',
    updatedAt: '2026-10-14T13:30:00.000Z',
    ...over,
  };
}

/** Fake firestore honoring the exact query surface getTicketDoc uses. */
function readerFake(opts: { canon?: StOrderTicket[]; legacyByRef?: Record<string, unknown>[]; legacyById?: Record<string, unknown> | null }) {
  const calls: string[] = [];
  const mkQuery = (label: string, rows: Record<string, unknown>[]) => ({
    where: (field: string, _op: string, value: unknown) => {
      const exec = async () => {
        calls.push(label);
        const hits = rows.filter((r) => r[field] === value);
        return { empty: hits.length === 0, docs: hits.map((d) => ({ data: () => d })) };
      };
      return { get: exec, limit: () => ({ get: exec }) };
    },
  });
  const db = {
    collection: (name: string) => {
      if (name === 'st-order-tickets') return mkQuery('canonical', opts.canon ?? []);
      if (name === 'savant-trader/data/order-intents') return mkQuery('legacy', opts.legacyByRef ?? []);
      throw new Error(`unexpected collection ${name}`);
    },
    doc: (path: string) => ({
      get: async () => {
        calls.push(`doc:${path}`);
        const d = opts.legacyById ?? null;
        return { exists: d !== null, data: () => d };
      },
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, calls };
}

describe('getTicketDoc reader cutover (#1003)', () => {
  it('returns the canonical doc as an OrderTicketDoc view when present', async () => {
    const f = readerFake({ canon: [canonicalTicket()] });
    const t = await getTicketDoc(f.db, 'ref-canonical');
    assert.deepEqual(f.calls, ['canonical']); // short-circuits — no legacy read
    assert.equal(t!.refId, 'ref-canonical');
    assert.equal(t!.symbol, 'ADPT');
    assert.equal(t!.side, 'buy');
    assert.equal(t!.quantity, '10');
    assert.equal(t!.signalContext!.decisionId, 'dec-1');
  });

  it('falls back to legacy by-refId when canonical misses', async () => {
    const legacy = { refId: 'r2', symbol: 'XYZ', side: 'buy', quantity: '3' };
    const f = readerFake({ canon: [], legacyByRef: [legacy] });
    const t = await getTicketDoc(f.db, 'r2');
    assert.deepEqual(f.calls, ['canonical', 'legacy']);
    assert.equal(t!.symbol, 'XYZ');
  });

  it('falls back to legacy doc-id lookup as last resort', async () => {
    const f = readerFake({ canon: [], legacyByRef: [], legacyById: { refId: 'r3', symbol: 'QQQ' } });
    const t = await getTicketDoc(f.db, 'r3');
    assert.deepEqual(f.calls, ['canonical', 'legacy', 'doc:savant-trader/data/order-intents/r3']);
    assert.equal(t!.symbol, 'QQQ');
  });

  it('prefers the order doc over an emitted sibling sharing the refId', async () => {
    // Soak collision: the emitted pap_{tradeId} expression ticket can sort
    // before the intent mirror but carries the template's side/qty —
    // the order doc must win or the retry's side check throws.
    const sibling = canonicalTicket({
      id: 'pap_ADPT-260925-sig-CSP-01',
      terms: {
        symbol: 'ADPT', side: 'sell', quantity: 1,
        expressionTemplate: { key: 'csp-1' } as SignalExpressionTemplate,
      },
    });
    // post-cutover shape: neither doc carries migratedFrom — the
    // non-expressionTemplate discriminator picks the order doc.
    const intent = canonicalTicket();
    const f = readerFake({ canon: [sibling, intent] });
    const t = await getTicketDoc(f.db, 'ref-canonical');
    assert.equal(t!.side, 'buy');           // intent's side, not the template's
    assert.equal(t!.quantity, '10');
  });

  it('prefers a migrated intent doc over an emitted sibling (soak shape)', async () => {
    const sibling = canonicalTicket({
      id: 'pap_ADPT-260925-sig-CSP-01',
      terms: { symbol: 'ADPT', side: 'sell', quantity: 1 },
    });
    const intent = canonicalTicket({ migratedFrom: 'order-intents' });
    const f = readerFake({ canon: [sibling, intent] });
    const t = await getTicketDoc(f.db, 'ref-canonical');
    assert.equal(t!.side, 'buy');
  });

  it('falls through to legacy when every canonical hit is a lifecycle ticket', async () => {
    // Emit is fail-soft: the equity ticket can be absent while expression
    // tickets succeeded — none of them is the order doc, so the legacy
    // intent (which does carry the order terms) must still be consulted.
    const lifecycle = canonicalTicket({
      id: 'pap_ADPT-260925-sig-EQ',
      migratedFrom: undefined,
      terms: { symbol: 'ADPT', side: 'buy', quantity: 10, expression: 'EQ' },
    });
    const legacy = { refId: 'ref-canonical', symbol: 'ADPT', side: 'buy', quantity: '7' };
    const f = readerFake({ canon: [lifecycle], legacyByRef: [legacy] });
    const t = await getTicketDoc(f.db, 'ref-canonical');
    assert.deepEqual(f.calls, ['canonical', 'legacy']);
    assert.equal(t!.quantity, '7');           // the legacy order doc, not the ticket
  });

  it('returns null when neither collection has the refId', async () => {
    const f = readerFake({ canon: [], legacyByRef: [], legacyById: null });
    assert.equal(await getTicketDoc(f.db, 'nope'), null);
  });
});

describe('stTicketToOrderTicketDoc', () => {
  it('projects canonical fields into the legacy view', () => {
    const v = stTicketToOrderTicketDoc(canonicalTicket());
    assert.deepEqual(v, {
      id: 'liv_t1',
      refId: 'ref-canonical',
      symbol: 'ADPT',
      side: 'buy',
      quantity: '10',
      signalContext: { signalType: 'SIG', barDate: '2026-10-14', direction: 'long', decisionId: 'dec-1' },
    });
  });

  it('omits quantity for dollarAmount-sized tickets and tolerates absent signalContext', () => {
    const v = stTicketToOrderTicketDoc(canonicalTicket({
      terms: { symbol: 'ADPT', side: 'buy', dollarAmount: 200 },
      signalContext: undefined,
    }));
    assert.equal(v.quantity, undefined);
    assert.equal(v.signalContext, undefined);
  });
});
