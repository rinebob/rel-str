/**
 * @topic #984 — ST Firestore Reorg
 *
 * Unit tests for StOrderTicketWriter (task #1002): canonical
 * `st-order-tickets` emission + lifecycle transitions. emit() is
 * create()+ALREADY_EXISTS idempotent (deterministic idSeed → re-emit
 * never regresses state); transitions are txn-guarded so a fill racing
 * a cancel wins
 * (`filled` outranks `cancel_pending`/`cancelled`) and terminal states
 * can't be re-opened.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  StOrderTicketWriter,
  type StOrderTicketWriterDeps,
} from '../../functions/src/order-tickets/st-order-ticket-writer';
import type { StOrderTicket } from '../../shared/st-order-tickets';
import type { StTicketTerms } from '../../shared/st-order-tickets';

type WriterDb = NonNullable<StOrderTicketWriterDeps['db']>;

const NOW = '2026-10-16T20:00:00.000Z';

// ── Minimal fake Firestore (doc-level set/get + runTransaction) ─────────────

function createFakeDb(initial: Record<string, Record<string, unknown>> = {}) {
  const store = new Map<string, Record<string, unknown>>(Object.entries(initial));
  const refPaths = new WeakMap<object, string>();
  const logs: { level: string; message: string }[] = [];

  const makeDocRef = (path: string) => {
    const ref = {
      id: path.split('/').pop()!,
      path,
      get: async () => {
        const data = store.get(path);
        return { exists: data !== undefined, id: ref.id, data: () => data };
      },
      create: async (data: Record<string, unknown>) => {
        if (store.has(path)) {
          const err = new Error('ALREADY_EXISTS') as Error & { code: number };
          err.code = 6;
          throw err;
        }
        store.set(path, { ...data });
      },
      set: async (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
        store.set(path, opts?.merge ? { ...store.get(path), ...data } : { ...data });
      },
      update: async (fields: Record<string, unknown>) => {
        if (!store.has(path)) throw new Error(`update on missing doc ${path}`);
        store.set(path, { ...store.get(path), ...fields });
      },
    };
    refPaths.set(ref, path);
    return ref;
  };

  const db = {
    collection: (path: string) => {
      const query = (filters: [string, unknown][]) => ({
        where: (field: string, _op: string, value: unknown) =>
          query([...filters, [field, value]]),
        get: async () => ({
          docs: [...store.entries()]
            .filter(([p]) => p.startsWith(`${path}/`))
            .filter(([, d]) => filters.every(([f, v]) => d[f] === v))
            .map(([p, d]) => ({ id: p.split('/').pop()!, data: () => d })),
        }),
      });
      return {
        doc: (id: string) => makeDocRef(`${path}/${id}`),
        where: (field: string, _op: string, value: unknown) => query([[field, value]]),
      };
    },
    doc: (path: string) => makeDocRef(path),
    runTransaction: async <T>(fn: (txn: unknown) => Promise<T>): Promise<T> => {
      const txn = {
        get: async (ref: object) => {
          const path = refPaths.get(ref)!;
          const data = store.get(path);
          return { exists: data !== undefined, id: path.split('/').pop()!, data: () => data };
        },
        update: (ref: object, fields: Record<string, unknown>) => {
          const path = refPaths.get(ref)!;
          if (!store.has(path)) throw new Error(`update on missing doc ${path}`);
          store.set(path, { ...store.get(path), ...fields });
        },
      };
      return fn(txn);
    },
  };

  const logger = {
    warn: (message: string) => logs.push({ level: 'warn', message }),
    error: (message: string) => logs.push({ level: 'error', message }),
  };

  return {
    db: db as unknown as WriterDb,
    logger,
    logs,
    stored: (path: string) => store.get(path) as unknown,
  };
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const TERMS: StTicketTerms = {
  symbol: 'AAPL',
  side: 'buy',
  instrument: 'equity',
  quantity: 1,
  orderType: 'market',
  timeInForce: 'gfd',
  marketHours: 'regular_hours',
};

const emitInput = (over: Record<string, unknown> = {}) => ({
  mode: 'paper' as const,
  idSeed: '261016-sig-AAPL-EQV1L',
  origin: { type: 'signal' as const, signalId: 'AAPL_2026-10-16_D_ST_TREND_RIDER_V1_LONG', runId: 'run-1' },
  auto: true,
  terms: TERMS,
  accountTarget: 'acct-auto-paper',
  userId: 'auto-paper',
  now: NOW,
  ...over,
});

function writerFor(db: WriterDb, logger?: { warn(m: string): void; error(m: string): void }) {
  return new StOrderTicketWriter({ db, logger });
}

const PATH = 'st-order-tickets/pap_261016-sig-AAPL-EQV1L';

// ── emit ────────────────────────────────────────────────────────────────────

describe('StOrderTicketWriter.emit (#1002)', () => {
  it('creates a staged pap_ ticket with the full canonical shape', async () => {
    const { db, stored } = createFakeDb();
    const id = await writerFor(db).emit(emitInput());

    assert.equal(id, 'pap_261016-sig-AAPL-EQV1L');
    const doc = stored(PATH) as StOrderTicket;
    assert.ok(doc, 'ticket doc exists');
    assert.equal(doc.id, id);
    assert.deepEqual(doc.origin, {
      type: 'signal',
      signalId: 'AAPL_2026-10-16_D_ST_TREND_RIDER_V1_LONG',
      runId: 'run-1',
    });
    assert.equal(doc.auto, true);
    assert.equal(doc.mode, 'paper');
    assert.equal(doc.state, 'staged');
    assert.equal(doc.refId, id, 'refId defaults to the minted ticket id');
    assert.equal(doc.accountTarget, 'acct-auto-paper');
    assert.equal(doc.userId, 'auto-paper');
    assert.deepEqual(doc.terms, TERMS);
    assert.equal(doc.createdAt, NOW);
    assert.equal(doc.updatedAt, NOW);
  });

  it('mints a liv_ prefix for live mode and keeps an explicit refId', async () => {
    const { db, stored } = createFakeDb();
    const id = await writerFor(db).emit(emitInput({ mode: 'live', refId: 'rh-ref-1' }));
    assert.equal(id, 'liv_261016-sig-AAPL-EQV1L');
    assert.equal((stored(`st-order-tickets/${id}`) as StOrderTicket).refId, 'rh-ref-1');
  });

  it('is idempotent — a re-emit never regresses state or provenance', async () => {
    const { db, stored } = createFakeDb();
    const w = writerFor(db);
    const id = (await w.emit(emitInput()))!;
    await w.markFilled(id, { averagePrice: 250, filledQty: 1, filledAt: NOW }, NOW);

    const again = await w.emit(emitInput({ origin: { type: 'signal' }, auto: false }));
    assert.equal(again, id);
    const doc = stored(PATH) as StOrderTicket;
    assert.equal(doc.state, 'filled', 're-emit does not reset state');
    assert.deepEqual(doc.fillSummary, { averagePrice: 250, filledQty: 1, filledAt: NOW });
    assert.equal(doc.auto, true, 'provenance fields are create-only');
  });

  it('fails soft on invalid terms — logged, returns null, writes nothing', async () => {
    const { db, stored, logs, logger } = createFakeDb();
    const id = await writerFor(db, logger).emit(
      emitInput({ terms: { ...TERMS, quantity: 0 } }),
    );
    assert.equal(id, null);
    assert.equal(stored(PATH), undefined);
    assert.equal(logs.some((l) => l.level === 'error'), true);
  });

  it('fails soft when the create write throws', async () => {
    const { db, stored, logs, logger } = createFakeDb();
    (db as { collection: unknown }).collection = () => ({
      doc: () => ({ create: async () => { throw new Error('transient'); } }),
    });
    const id = await writerFor(db, logger).emit(emitInput());
    assert.equal(id, null);
    assert.equal(stored(PATH), undefined);
    assert.equal(logs.some((l) => l.level === 'error'), true);
  });
});

// ── transitions ─────────────────────────────────────────────────────────────

async function seeded(db: WriterDb): Promise<string> {
  const id = await writerFor(db).emit(emitInput());
  assert.ok(id);
  return id!;
}

describe('StOrderTicketWriter transitions (#1002)', () => {
  it('staged → submitted stamps brokerOrderId, reviewSnapshot, submittedAt', async () => {
    const { db, stored } = createFakeDb();
    const w = writerFor(db);
    const id = await seeded(db);

    const res = await w.markSubmitted(id, {
      brokerOrderId: 'rh-order-1',
      reviewSnapshot: { orderChecks: { ok: true }, collateral: { 'cash.amount': '1234' } },
      now: NOW,
    });
    assert.equal(res.applied, true);
    assert.equal(res.from, 'staged');
    const doc = stored(PATH) as StOrderTicket;
    assert.equal(doc.state, 'submitted');
    assert.equal(doc.brokerOrderId, 'rh-order-1');
    assert.deepEqual(doc.reviewSnapshot, { orderChecks: { ok: true }, collateral: { 'cash.amount': '1234' } });
    assert.equal(doc.submittedAt, NOW);
    assert.equal(doc.updatedAt, NOW);
  });

  it('submitted is idempotent from submitted', async () => {
    const { db } = createFakeDb();
    const w = writerFor(db);
    const id = await seeded(db);
    await w.markSubmitted(id, { brokerOrderId: 'o1', now: NOW });
    const res = await w.markSubmitted(id, { brokerOrderId: 'o1', now: NOW });
    assert.equal(res.applied, true);
  });

  it('submitted → cancel_pending → cancelled; timestamps recorded', async () => {
    const { db, stored } = createFakeDb();
    const w = writerFor(db);
    const id = await seeded(db);
    await w.markSubmitted(id, { now: NOW });

    const pend = await w.markCancelPending(id, NOW);
    assert.equal(pend.applied, true);
    assert.equal((stored(PATH) as StOrderTicket).state, 'cancel_pending');

    const canc = await w.markCancelled(id, NOW);
    assert.equal(canc.applied, true);
    const doc = stored(PATH) as StOrderTicket;
    assert.equal(doc.state, 'cancelled');
    assert.equal(doc.cancelledAt, NOW);
    assert.equal(doc.terminalAt, NOW);
  });

  it('cancel_pending is rejected from staged (nothing to cancel)', async () => {
    const { db, stored } = createFakeDb();
    const w = writerFor(db);
    const id = await seeded(db);
    const res = await w.markCancelPending(id, NOW);
    assert.equal(res.applied, false);
    assert.equal(res.from, 'staged');
    assert.equal((stored(PATH) as StOrderTicket).state, 'staged');
  });

  it('filled wins over a racing cancel — cancel_pending → filled', async () => {
    const { db, stored } = createFakeDb();
    const w = writerFor(db);
    const id = await seeded(db);
    await w.markSubmitted(id, { now: NOW });
    await w.markCancelPending(id, NOW);

    const res = await w.markFilled(id, { averagePrice: 250.5, filledQty: 100, filledAt: NOW }, NOW);
    assert.equal(res.applied, true, 'fill races the async cancel and wins');
    const doc = stored(PATH) as StOrderTicket;
    assert.equal(doc.state, 'filled');
    assert.deepEqual(doc.fillSummary, { averagePrice: 250.5, filledQty: 100, filledAt: NOW });
    assert.equal(doc.filledAt, NOW);
  });

  it('filled wins even after cancelled landed — broker truth beats local state', async () => {
    const { db, stored } = createFakeDb();
    const w = writerFor(db);
    const id = await seeded(db);
    await w.markSubmitted(id, { now: NOW });
    await w.markCancelPending(id, NOW);
    await w.markCancelled(id, NOW);

    const res = await w.markFilled(id, { averagePrice: 250.5, filledQty: 1, filledAt: NOW }, NOW);
    assert.equal(res.applied, true);
    assert.equal((stored(PATH) as StOrderTicket).state, 'filled');
  });

  it('cancelled is rejected after filled', async () => {
    const { db, stored } = createFakeDb();
    const w = writerFor(db);
    const id = await seeded(db);
    await w.markFilled(id, { averagePrice: 1, filledQty: 1, filledAt: NOW }, NOW);
    const res = await w.markCancelled(id, NOW);
    assert.equal(res.applied, false);
    assert.equal((stored(PATH) as StOrderTicket).state, 'filled');
  });

  it('staged → filled directly (paper paths fill at emit)', async () => {
    const { db, stored } = createFakeDb();
    const w = writerFor(db);
    const id = await seeded(db);
    const res = await w.markFilled(id, { averagePrice: 250.5, filledQty: 1, filledAt: NOW }, NOW);
    assert.equal(res.applied, true);
    assert.equal((stored(PATH) as StOrderTicket).state, 'filled');
  });

  it('staged → failed stamps lastError + terminalAt', async () => {
    const { db, stored } = createFakeDb();
    const w = writerFor(db);
    const id = await seeded(db);
    const res = await w.markFailed(id, { category: 'paper-fill', message: 'ledger blew up' }, NOW);
    assert.equal(res.applied, true);
    const doc = stored(PATH) as StOrderTicket;
    assert.equal(doc.state, 'failed');
    assert.deepEqual(doc.lastError, { category: 'paper-fill', message: 'ledger blew up' });
    assert.equal(doc.terminalAt, NOW);
  });

  it('failed → filled heals a transient failure (fill is the truth)', async () => {
    const { db, stored } = createFakeDb();
    const w = writerFor(db);
    const id = await seeded(db);
    await w.markFailed(id, { category: 'paper-fill', message: 'quota' }, NOW);
    const res = await w.markFilled(id, { averagePrice: 250.5, filledQty: 1, filledAt: NOW }, NOW);
    assert.equal(res.applied, true, 'a retry fill corrects a transient failed state');
    assert.equal((stored(PATH) as StOrderTicket).state, 'filled');
  });

  it('failed is rejected from a terminal state', async () => {
    const { db, stored } = createFakeDb();
    const w = writerFor(db);
    const id = await seeded(db);
    await w.markFilled(id, { averagePrice: 1, filledQty: 1, filledAt: NOW }, NOW);
    const res = await w.markFailed(id, { category: 'x', message: 'y' }, NOW);
    assert.equal(res.applied, false);
    assert.equal((stored(PATH) as StOrderTicket).state, 'filled');
  });

  it('submitted → expired stamps terminalAt', async () => {
    const { db, stored } = createFakeDb();
    const w = writerFor(db);
    const id = await seeded(db);
    await w.markSubmitted(id, { now: NOW });
    const res = await w.markExpired(id, NOW);
    assert.equal(res.applied, true);
    assert.equal((stored(PATH) as StOrderTicket).state, 'expired');
    assert.equal((stored(PATH) as StOrderTicket).terminalAt, NOW);
  });

  it('transitions on a missing doc report applied:false without creating one', async () => {
    const { db, stored } = createFakeDb();
    const w = writerFor(db);
    const res = await w.markFilled('pap_nope', { averagePrice: 1, filledQty: 1, filledAt: NOW }, NOW);
    assert.equal(res.applied, false);
    assert.equal(res.from, undefined);
    assert.equal(stored('st-order-tickets/pap_nope'), undefined);
  });

  it('txn failure is fail-soft: applied:false, logged, doc untouched', async () => {
    const { db, stored, logs, logger } = createFakeDb();
    const w = writerFor(db, logger);
    const id = await seeded(db);
    (db as { runTransaction: unknown }).runTransaction = async () => {
      throw new Error('txn aborted');
    };
    const res = await w.markCancelled(id, NOW);
    assert.equal(res.applied, false);
    assert.equal((stored(PATH) as StOrderTicket).state, 'staged');
    assert.equal(logs.some((l) => l.level === 'warn'), true);
  });
});

// ── #1005 — ticket reads + staged-expression listing + seed resolution ──────

describe('StOrderTicketWriter reads + resolveTicketSeed (#1005)', () => {
  const doc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'pap_x',
    origin: { type: 'signal' },
    auto: false,
    mode: 'paper',
    terms: { symbol: 'QQQM', side: 'buy', quantity: 1 },
    state: 'staged',
    refId: 'ref-1',
    accountTarget: 'acct-u',
    userId: 'u',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  });

  it('get returns the doc / null when missing', async () => {
    const { db } = createFakeDb({ 'st-order-tickets/pap_x': doc() });
    const w = writerFor(db);
    assert.equal((await w.get('pap_x'))?.id, 'pap_x');
    assert.equal(await w.get('pap_missing'), null);
  });

  it('listStagedExpressionTickets filters mode=paper + staged + template', async () => {
    const { db } = createFakeDb({
      'st-order-tickets/pap_staged': doc({ id: 'pap_staged', terms: { symbol: 'Q', side: 'sell', quantity: 1, expressionTemplate: { key: 'csp-030-45' } } }),
      'st-order-tickets/pap_noTemplate': doc({ id: 'pap_noTemplate' }),
      'st-order-tickets/pap_filled': doc({ id: 'pap_filled', state: 'filled', terms: { symbol: 'Q', side: 'sell', quantity: 1, expressionTemplate: { key: 'x' } } }),
      'st-order-tickets/liv_staged': doc({ id: 'liv_staged', mode: 'live', terms: { symbol: 'Q', side: 'sell', quantity: 1, expressionTemplate: { key: 'x' } } }),
    });
    const w = writerFor(db);
    const tickets = await w.listStagedExpressionTickets();
    assert.deepEqual(tickets.map((t) => t.id), ['pap_staged']);
  });

  it('resolveTicketSeed returns the base when free or already owned by the refId', async () => {
    const { db } = createFakeDb({
      'st-order-tickets/pap_owned': doc({ id: 'pap_owned', refId: 'ref-1' }),
    });
    const w = writerFor(db);
    assert.equal(await w.resolveTicketSeed('free-seed', 'ref-1'), 'free-seed');
    assert.equal(await w.resolveTicketSeed('owned', 'ref-1'), 'owned', 're-emit idempotent');
  });

  it('resolveTicketSeed suffixes when the base is owned by another refId', async () => {
    const { db } = createFakeDb({
      'st-order-tickets/pap_taken': doc({ id: 'pap_taken', refId: 'ref-A' }),
      'st-order-tickets/pap_taken-2': doc({ id: 'pap_taken-2', refId: 'ref-B' }),
    });
    const w = writerFor(db);
    assert.equal(await w.resolveTicketSeed('taken', 'ref-1'), 'taken-3');
  });

  it('resolveTicketSeed adopts a same-signal ticket under a different refId', async () => {
    // Client retry carries a fresh refId — signalContext.signalId equality
    // is the same logical accept, so the base is owned, not foreign.
    const { db } = createFakeDb({
      'st-order-tickets/pap_reissue': doc({
        id: 'pap_reissue', refId: 'ref-A', signalContext: { signalId: 'sig-9' },
      }),
    });
    const w = writerFor(db);
    assert.equal(await w.resolveTicketSeed('reissue', 'ref-NEW', 'sig-9'), 'reissue');
    // A foreign signal under a different refId is still foreign.
    const { db: db2 } = createFakeDb({
      'st-order-tickets/pap_alien': doc({
        id: 'pap_alien', refId: 'ref-A', signalContext: { signalId: 'sig-other' },
      }),
    });
    assert.equal(await writerFor(db2).resolveTicketSeed('alien', 'ref-NEW', 'sig-9'), 'alien-2');
  });

  it('noteError stamps lastError without a state change', async () => {
    const { db } = createFakeDb({
      'st-order-tickets/pap_s1': doc({ id: 'pap_s1' }),
    });
    const w = writerFor(db);
    await w.noteError('pap_s1', { category: 'no_contract', message: 'no match' }, NOW);
    const after = (await w.get('pap_s1'))!;
    assert.equal(after.state, 'staged', 'no state transition');
    assert.equal(after.lastError?.category, 'no_contract');
    assert.equal(after.lastError?.message, 'no match');
  });

  it('noteError on a missing ticket warns — never mints a stateless zombie', async () => {
    const { db, stored, logger, logs } = createFakeDb();
    const w = writerFor(db, logger);
    await w.noteError('pap_ghost', { category: 'no_contract', message: 'gone' }, NOW);
    assert.equal(await w.get('pap_ghost'), null);
    assert.equal(stored('st-order-tickets/pap_ghost'), undefined);
    assert.ok(
      logs.some((l) => l.message.includes('noteError failed')),
      'missing-doc failure surfaced as a warn, not a write',
    );
  });
});
