/**
 * @topic #553 — Paper Trading Infra (task #1576)
 *
 * `deletePaperTrades` + `deleteTradeCascade` — hard-delete unwanted
 * signal-source trades and every artifact referencing them: the trade doc
 * (embedded marks/fills/runs die with it), `rq-*` raw-quote audit docs
 * (`where('tradeId','==',id)`), and `pap_*` order tickets (`pap_{tradeId}`
 * lifecycle tickets plus the staged `trade.ticket.ticketId` that minted
 * it). Scoped to `source=SIGNAL`: strategy/manual trades are refused and
 * never touched. Idempotent: a missing id reports `notFound`, never an
 * error — re-grooming re-runs the same ids safely.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TradeSide } from '../../../shared/common';
import {
  DELETE_PAPER_TRADES_MAX_ITEMS,
  PaperTradeSource,
  PaperTradeStatus,
  PaperTradingKind,
  type PaperTrade,
  type PaperTradingDoc,
  type RawQuoteDoc,
} from '../../../shared/paper-trading-contracts';
import { deleteTradeCascade } from '../../../functions/src/paper-trading/repository';
import {
  handleDeletePaperTrades,
  type DeletePaperTradesDeps,
} from '../../../functions/src/paper-trading/signal-trade-callables';

type RepoDb = Parameters<typeof deleteTradeCascade>[0];

// ── Fake Firestore (with delete) ────────────────────────────────────────────

type Filter = { field: string; op: string; value: unknown };

function getNested(obj: Record<string, unknown>, keys: string[]): unknown {
  let node: unknown = obj;
  for (const key of keys) {
    node = (node as Record<string, unknown>)[key];
    if (node === undefined) return undefined;
  }
  return node;
}

function matchesFilter(data: Record<string, unknown>, f: Filter): boolean {
  return getNested(data, f.field.split('.')) === f.value;
}

/** Minimal Firestore stand-in keyed by doc path — adds `delete` on
 *  refs/txns/batches and `doc.ref` on query snapshots to the subset the
 *  repository fake in repository.test.ts supports. */
function createFakeDb(initial: Record<string, PaperTradingDoc | object> = {}) {
  const store = new Map<string, Record<string, unknown>>();
  for (const [path, data] of Object.entries(initial)) {
    store.set(path, data as Record<string, unknown>);
  }
  const deletedPaths: string[] = [];
  const refPaths = new WeakMap<object, string>();
  /** Paths whose delete() throws — exercises best-effort post-txn cleanup. */
  const failDeletes = new Set<string>();

  const docsInCollection = (path: string) => {
    const prefix = `${path}/`;
    return [...store.entries()]
      .filter(([p]) => p.startsWith(prefix))
      .map(([p, data]) => {
        const ref = makeDocRef(p);
        return { id: p.slice(prefix.length), ref, data: () => data };
      });
  };

  const makeDocRef = (path: string) => {
    const ref = {
      id: path.split('/').pop()!,
      get: async () => {
        const data = store.get(path);
        return { exists: data !== undefined, id: path.split('/').pop()!, data: () => data };
      },
      set: async (data: unknown) => {
        store.set(path, data as Record<string, unknown>);
      },
      update: async (fields: Record<string, unknown>) => {
        const existing = (store.get(path) ?? {}) as Record<string, unknown>;
        store.set(path, { ...existing, ...fields });
      },
      delete: async () => {
        deletedPaths.push(path);
        if (failDeletes.has(path)) throw new Error(`delete failed: ${path}`);
        store.delete(path);
      },
    };
    refPaths.set(ref, path);
    return ref;
  };

  const makeQuery = (path: string, filters: Filter[]) => ({
    where: (field: string, op: string, value: unknown) =>
      makeQuery(path, [...filters, { field, op, value }]),
    get: async () => {
      const docs = docsInCollection(path).filter((d) =>
        filters.every((f) => matchesFilter(d.data() as Record<string, unknown>, f)),
      );
      return { docs, empty: docs.length === 0 };
    },
  });

  const db = {
    collection: (path: string) => ({
      ...makeQuery(path, []),
      doc: (id: string) => makeDocRef(`${path}/${id}`),
    }),
    doc: (path: string) => makeDocRef(path),
    batch: () => {
      const ops: { type: 'set' | 'delete'; path: string; data?: Record<string, unknown> }[] = [];
      return {
        set: (ref: { id: string }, data: Record<string, unknown>) =>
          ops.push({ type: 'set', path: refPaths.get(ref) ?? ref.id, data }),
        delete: (ref: { id: string }) =>
          ops.push({ type: 'delete', path: refPaths.get(ref) ?? ref.id }),
        commit: async () => {
          for (const op of ops) {
            if (op.type === 'set') {
              store.set(op.path, op.data!);
            } else {
              deletedPaths.push(op.path);
              if (failDeletes.has(op.path)) throw new Error(`delete failed: ${op.path}`);
              store.delete(op.path);
            }
          }
        },
      };
    },
    runTransaction: async (fn: (txn: unknown) => Promise<unknown>) => {
      const txn = {
        get: (ref: { id: string }) =>
          makeDocRef(refPaths.get(ref) ?? ref.id).get(),
        set: (ref: { id: string }, data: Record<string, unknown>) =>
          store.set(refPaths.get(ref) ?? ref.id, data),
        update: (ref: { id: string }, fields: Record<string, unknown>) =>
          store.set(refPaths.get(ref) ?? ref.id, { ...store.get(refPaths.get(ref) ?? ref.id), ...fields }),
        delete: (ref: { id: string }) => {
          const path = refPaths.get(ref) ?? ref.id;
          deletedPaths.push(path);
          store.delete(path);
        },
      };
      return fn(txn);
    },
  };

  const stored = <T>(path: string): T | undefined => store.get(path) as T | undefined;

  return { db: db as unknown as RepoDb, store, stored, deletedPaths, failDeletes };
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const TRADE_ID = '261015-sig-AMAT-EQ';
const TRADE_PATH = `st-paper-trading/trades/items/${TRADE_ID}`;
const TICKET_PATH = `st-order-tickets/pap_${TRADE_ID}`;
const STAGED_TICKET_PATH = 'st-order-tickets/pap_seed-abc';
const RQ1_PATH = `st-paper-trading/raw-quotes/items/rq-${TRADE_ID}-2026-10-15`;
const RQ2_PATH = `st-paper-trading/raw-quotes/items/rq-${TRADE_ID}-2026-10-16`;
const FOREIGN_RQ_PATH = 'st-paper-trading/raw-quotes/items/rq-other-2026-10-15';
const ACCT_PATH = 'st-paper-trading/accounts/items/acct-auto-paper';

function signalTrade(over: Partial<PaperTrade> = {}): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: TRADE_ID,
    status: PaperTradeStatus.CLOSED,
    source: PaperTradeSource.SIGNAL,
    symbol: 'AMAT',
    expression: 'EQ',
    governingVariant: 'trailing-8',
    governingPolicy: 'deepest-stop-else-trailing-8',
    variantKeys: ['trailing-8'],
    variantRuns: [],
    order: { side: TradeSide.LONG, type: 'MARKET', quantity: 1 },
    fills: [],
    legs: [],
    marks: {},
    signalId: 'AMAT_D_ST_TREND_RIDER_V1_LONG_2026-10-15',
    createdAt: '2026-10-15T00:00:00Z',
    updatedAt: '2026-10-15T00:00:00Z',
    ...over,
  } as PaperTrade;
}

function rawQuote(tradeId: string, id: string): RawQuoteDoc {
  return {
    kind: PaperTradingKind.RAW_QUOTE,
    id,
    tradeId,
    date: '2026-10-15',
    rawResponse: { quote: 119.46 },
    createdAt: '2026-10-15T00:00:00Z',
  } as RawQuoteDoc;
}

function ticket(id: string): PaperTradingDoc {
  return { id, state: 'filled', mode: 'paper' } as unknown as PaperTradingDoc;
}

// ── deleteTradeCascade ─────────────────────────────────────────────────────

describe('deleteTradeCascade', () => {
  it('deletes the trade doc, its rq-* quotes, and its pap_* tickets', async () => {
    const { db, stored, deletedPaths } = createFakeDb({
      [TRADE_PATH]: signalTrade(),
      [TICKET_PATH]: ticket(`pap_${TRADE_ID}`),
      [RQ1_PATH]: rawQuote(TRADE_ID, `rq-${TRADE_ID}-2026-10-15`),
      [RQ2_PATH]: rawQuote(TRADE_ID, `rq-${TRADE_ID}-2026-10-16`),
      [FOREIGN_RQ_PATH]: rawQuote('other-trade', 'rq-other-2026-10-15'),
    });

    const outcome = await deleteTradeCascade(db, TRADE_ID);

    assert.equal(outcome, 'deleted');
    assert.equal(stored(TRADE_PATH), undefined);
    assert.equal(stored(TICKET_PATH), undefined);
    assert.equal(stored(RQ1_PATH), undefined);
    assert.equal(stored(RQ2_PATH), undefined);
    // Foreign raw quotes survive — the cascade is scoped to this tradeId.
    assert.notEqual(stored(FOREIGN_RQ_PATH), undefined);
    assert.ok(!deletedPaths.includes(FOREIGN_RQ_PATH));
  });

  // Accept-flow trades carry cohort/group/member-ticket lineage on OTHER
  // docs — deleting one here would orphan staged tickets that still mint
  // into the dangling cohort. All three markers refuse.
  for (const [label, over] of [
    ['cohortId', { cohortId: 'cohort-261015-AMAT-01' }],
    ['positionGroupId', { positionGroupId: 'ADPT-261015-grp-01' }],
    [
      'ticket.ticketId',
      { ticket: { refId: 'rs-1', acceptedAt: '2026-10-15T00:00:00Z', ticketId: 'pap_seed-abc' } },
    ],
  ] as const) {
    it(`refuses an accept-flow trade (${label}) and touches nothing`, async () => {
      const { db, stored, deletedPaths } = createFakeDb({
        [TRADE_PATH]: signalTrade(over as Partial<PaperTrade>),
        [TICKET_PATH]: ticket(`pap_${TRADE_ID}`),
        [STAGED_TICKET_PATH]: ticket('pap_seed-abc'),
        [RQ1_PATH]: rawQuote(TRADE_ID, `rq-${TRADE_ID}-2026-10-15`),
      });

      const outcome = await deleteTradeCascade(db, TRADE_ID);

      assert.equal(outcome, 'accept-flow');
      assert.notEqual(stored(TRADE_PATH), undefined);
      assert.equal(deletedPaths.length, 0);
    });
  }

  it('rewinds acct openTradeCount for a lifecycle-open delete', async () => {
    const { db, stored } = createFakeDb({
      [TRADE_PATH]: signalTrade({
        status: PaperTradeStatus.OPEN,
        userId: 'auto-paper',
      }),
      [ACCT_PATH]: { kind: 'account', id: 'acct-auto-paper', openTradeCount: 3, cash: 500 },
    });

    const outcome = await deleteTradeCascade(db, TRADE_ID);

    assert.equal(outcome, 'deleted');
    const acct = stored(ACCT_PATH) as { openTradeCount: number; cash: number };
    assert.equal(acct.openTradeCount, 2);
    // Cash/equity are NOT unwound — documented groom drift.
    assert.equal(acct.cash, 500);
  });

  it('leaves the account untouched for a CLOSED delete and tolerates a missing account doc', async () => {
    const closed = createFakeDb({
      [TRADE_PATH]: signalTrade({ userId: 'auto-paper' }), // CLOSED fixture
      [ACCT_PATH]: { kind: 'account', id: 'acct-auto-paper', openTradeCount: 3 },
    });
    assert.equal(await deleteTradeCascade(closed.db, TRADE_ID), 'deleted');
    assert.equal((closed.stored(ACCT_PATH) as { openTradeCount: number }).openTradeCount, 3);

    const noAcct = createFakeDb({
      [TRADE_PATH]: signalTrade({ status: PaperTradeStatus.OPEN, userId: 'auto-paper' }),
    });
    assert.equal(await deleteTradeCascade(noAcct.db, TRADE_ID), 'deleted');
    assert.equal(noAcct.stored(TRADE_PATH), undefined);
  });

  it('returns notFound for a missing trade id', async () => {
    const { db, deletedPaths } = createFakeDb({});

    const outcome = await deleteTradeCascade(db, TRADE_ID);

    assert.equal(outcome, 'notFound');
    assert.equal(deletedPaths.length, 0);
  });

  it('is idempotent — a re-delete of the same id reports notFound', async () => {
    const { db } = createFakeDb({ [TRADE_PATH]: signalTrade() });

    assert.equal(await deleteTradeCascade(db, TRADE_ID), 'deleted');
    assert.equal(await deleteTradeCascade(db, TRADE_ID), 'notFound');
  });

  it('refuses a non-signal trade and touches nothing', async () => {
    const strategy = signalTrade({ source: PaperTradeSource.STRATEGY });
    const { db, stored, deletedPaths } = createFakeDb({
      [TRADE_PATH]: strategy,
      [TICKET_PATH]: ticket(`pap_${TRADE_ID}`),
      [RQ1_PATH]: rawQuote(TRADE_ID, `rq-${TRADE_ID}-2026-10-15`),
    });

    const outcome = await deleteTradeCascade(db, TRADE_ID);

    assert.equal(outcome, 'non-signal');
    assert.notEqual(stored(TRADE_PATH), undefined);
    assert.equal(deletedPaths.length, 0);
  });

  it('best-effort: post-txn cleanup failure still reports the committed delete', async () => {
    const { db, stored, failDeletes } = createFakeDb({
      [TRADE_PATH]: signalTrade(),
      [TICKET_PATH]: ticket(`pap_${TRADE_ID}`),
    });
    failDeletes.add(TICKET_PATH);

    const outcome = await deleteTradeCascade(db, TRADE_ID);

    assert.equal(outcome, 'deleted');
    assert.equal(stored(TRADE_PATH), undefined);
  });
});

// ── handleDeletePaperTrades ────────────────────────────────────────────────

const AUTH = { auth: { uid: 'u1' } };

function deleteDeps(over: Partial<DeletePaperTradesDeps> = {}): {
  deps: DeletePaperTradesDeps;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      deleteTrade: async (id) => {
        calls.push(id);
        return 'deleted';
      },
      ...over,
    },
  };
}

describe('handleDeletePaperTrades', () => {
  it('requires authentication', async () => {
    const { deps } = deleteDeps();
    await assert.rejects(
      handleDeletePaperTrades({ data: { tradeIds: ['t1'] } }, deps),
      (e: { code?: string }) => e.code === 'unauthenticated',
    );
  });

  for (const tradeIds of [undefined, [], 'x', 5]) {
    it(`rejects malformed tradeIds ${JSON.stringify(tradeIds)}`, async () => {
      const { deps } = deleteDeps();
      await assert.rejects(
        handleDeletePaperTrades({ data: { tradeIds }, ...AUTH } as never, deps),
        (e: { code?: string }) => e.code === 'invalid-argument',
      );
    });
  }

  it('rejects batches over the max', async () => {
    const { deps } = deleteDeps();
    await assert.rejects(
      handleDeletePaperTrades(
        { data: { tradeIds: Array.from({ length: DELETE_PAPER_TRADES_MAX_ITEMS + 1 }, (_, i) => `t${i}`) }, ...AUTH },
        deps,
      ),
      (e: { code?: string }) => e.code === 'invalid-argument',
    );
  });

  it('rejects blank-string ids', async () => {
    const { deps } = deleteDeps();
    await assert.rejects(
      handleDeletePaperTrades({ data: { tradeIds: ['t1', '  '] }, ...AUTH }, deps),
      (e: { code?: string }) => e.code === 'invalid-argument',
    );
  });

  it('buckets deleted / notFound / non-signal+accept-flow failed per item', async () => {
    const { deps } = deleteDeps({
      deleteTrade: async (id) =>
        id === 't-gone'
          ? 'notFound'
          : id === 't-strat'
            ? 'non-signal'
            : id === 't-flow'
              ? 'accept-flow'
              : 'deleted',
    });

    const res = await handleDeletePaperTrades(
      { data: { tradeIds: ['t1', 't-gone', 't-strat', 't-flow', 't2'] }, ...AUTH },
      deps,
    );

    assert.deepEqual(res.deleted, ['t1', 't2']);
    assert.deepEqual(res.notFound, ['t-gone']);
    assert.equal(res.failed.length, 2);
    assert.deepEqual(res.failed[0], { tradeId: 't-strat', error: 'not a signal-source trade' });
    assert.equal(res.failed[1].tradeId, 't-flow');
    assert.match(res.failed[1].error, /accept-flow/);
  });

  it('isolates per-item errors — a throwing delete never fails the call', async () => {
    const { deps } = deleteDeps({
      deleteTrade: async (id) => {
        if (id === 't-boom') throw new Error('firestore exploded');
        return 'deleted';
      },
    });

    const res = await handleDeletePaperTrades(
      { data: { tradeIds: ['t-boom', 't1'] }, ...AUTH },
      deps,
    );

    assert.deepEqual(res.deleted, ['t1']);
    assert.equal(res.failed.length, 1);
    assert.equal(res.failed[0].tradeId, 't-boom');
    assert.match(res.failed[0].error, /firestore exploded/);
  });

  it('trims ids and dedupes repeats', async () => {
    const { deps, calls } = deleteDeps();

    const res = await handleDeletePaperTrades(
      { data: { tradeIds: [' t1 ', 't1', 't2'] }, ...AUTH },
      deps,
    );

    assert.deepEqual(calls, ['t1', 't2']);
    assert.deepEqual(res.deleted, ['t1', 't2']);
  });
});
