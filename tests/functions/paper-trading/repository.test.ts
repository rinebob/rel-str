/**
 * @topic #553 — Paper Trading Infra
 *
 * Unit tests for the paper-trading Firestore repository (task #561):
 * per-kind read/write under paper-trading/{anchor}/items, single-write
 * embedded mutations (appendMark/appendFill/updateVariantRun), trade-id
 * collision suffixing, and the Firestore-backed ledger deps.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TradeSide } from '../../../shared/common';
import { OptionQuoteSource } from '../../../shared/options-common';
import {
  PaperTradeSource,
  PaperTradeStatus,
  PaperTradingKind,
  type PaperAccount,
  type PaperFill,
  type PaperMark,
  type PaperTrade,
  type PaperTradingDoc,
  type VariantRun,
} from '../../../shared/paper-trading-contracts';
import {
  appendFill,
  appendMark,
  getAccount,
  ledgerDeps,
  listTrades,
  resolveTradeId,
  setTrade,
  updateVariantRun,
} from '../../../functions/src/paper-trading/repository';
import type { LedgerTxn } from '../../../functions/src/paper-trading/ledger';

type RepoDb = Parameters<typeof getAccount>[0];

// ── Fake Firestore ───────────────────────────────────────────────────────────

type UpdateCall = { path: string; fields: Record<string, unknown> };
type SetCall = { path: string; data: unknown; merge?: boolean };
type Filter = { field: string; op: string; value: unknown };

function setNested(obj: Record<string, unknown>, keys: string[], value: unknown): void {
  let node = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    node = (node[keys[i]] ??= {}) as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = value;
}

function getNested(obj: Record<string, unknown>, keys: string[]): unknown {
  let node: unknown = obj;
  for (const key of keys) {
    node = (node as Record<string, unknown>)[key];
    if (node === undefined) return undefined;
  }
  return node;
}

function matchesFilter(data: Record<string, unknown>, f: Filter): boolean {
  const actual = getNested(data, f.field.split('.'));
  if (f.op === 'array-contains') {
    return Array.isArray(actual) && actual.includes(f.value);
  }
  return actual === f.value;
}

/**
 * Minimal Firestore stand-in keyed by doc path. Supports the subset of the
 * API the repository uses: collection(path).doc(id).{get,set,update},
 * chained where('=='/array-contains).get(), doc(path), batch, runTransaction.
 */
function createFakeDb(initial: Record<string, PaperTradingDoc> = {}) {
  const store = new Map<string, Record<string, unknown>>();
  for (const [path, data] of Object.entries(initial)) {
    // boundary cast: Firestore returns untyped data, the fake mirrors that
    store.set(path, data as unknown as Record<string, unknown>);
  }
  const updateCalls: UpdateCall[] = [];
  const setCalls: SetCall[] = [];
  const committedBatches: { type: 'set' | 'update'; path: string; data: unknown }[][] = [];
  const refPaths = new WeakMap<object, string>();

  const docsInCollection = (path: string) => {
    const prefix = `${path}/`;
    return [...store.entries()]
      .filter(([p]) => p.startsWith(prefix))
      .map(([p, data]) => ({ id: p.slice(prefix.length), data: () => data }));
  };

  const applyFields = (path: string, fields: Record<string, unknown>) => {
    const existing = (store.get(path) ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(fields)) {
      setNested(existing, key.split('.'), value);
    }
    store.set(path, existing);
  };

  const makeDocRef = (path: string) => {
    const ref = {
      id: path.split('/').pop()!,
      get: async () => {
        const data = store.get(path);
        return { exists: data !== undefined, id: path.split('/').pop()!, data: () => data };
      },
      set: async (data: unknown, opts?: { merge?: boolean }) => {
        setCalls.push({ path, data, merge: opts?.merge });
        if (opts?.merge) {
          const existing = (store.get(path) ?? {}) as Record<string, unknown>;
          store.set(path, { ...existing, ...(data as Record<string, unknown>) });
        } else {
          store.set(path, data as Record<string, unknown>);
        }
      },
      update: async (fields: Record<string, unknown>) => {
        updateCalls.push({ path, fields });
        applyFields(path, fields);
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
      const ops: { type: 'set' | 'update'; path: string; data: Record<string, unknown> }[] = [];
      return {
        set: (ref: { id: string }, data: Record<string, unknown>) =>
          ops.push({ type: 'set', path: refPaths.get(ref) ?? ref.id, data }),
        update: (ref: { id: string }, data: Record<string, unknown>) =>
          ops.push({ type: 'update', path: refPaths.get(ref) ?? ref.id, data }),
        commit: async () => {
          committedBatches.push(ops);
          for (const op of ops) {
            if (op.type === 'set') {
              store.set(op.path, op.data);
            } else {
              applyFields(op.path, op.data);
            }
          }
        },
      };
    },
    runTransaction: async (fn: (txn: unknown) => Promise<void>) => {
      const txn = {
        get: (ref: { id: string }) =>
          makeDocRef(refPaths.get(ref) ?? ref.id).get(),
        set: (ref: { id: string }, data: Record<string, unknown>) =>
          store.set(refPaths.get(ref) ?? ref.id, data),
        update: (ref: { id: string }, fields: Record<string, unknown>) =>
          applyFields(refPaths.get(ref) ?? ref.id, fields),
      };
      return fn(txn);
    },
  };

  const stored = <T>(path: string): T => store.get(path) as T;

  return { db: db as unknown as RepoDb, store, stored, updateCalls, setCalls, committedBatches };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = '2026-09-24T19:00:00.000Z';
const TRADE_ID = '260924-st-QQQM-CSP-020-30';
const TRADE_PATH = `paper-trading/trades/items/${TRADE_ID}`;
const ACCOUNT_PATH = 'paper-trading/accounts/items/acct-user1';

function makeTrade(): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: TRADE_ID,
    status: PaperTradeStatus.OPEN,
    source: PaperTradeSource.STRATEGY,
    symbol: 'QQQM',
    expression: 'CSP',
    governingVariant: 'trailing-20',
    order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
    fills: [],
    legs: [],
    marks: {},
    variantRuns: [
      { variantKey: 'trailing-20', governing: true, state: 'ACTIVE', workingState: {} },
    ],
    variantKeys: ['trailing-20'],
    realizedPnl: 0,
    unrealizedPnl: 0,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeAccount(): PaperAccount {
  return {
    kind: PaperTradingKind.ACCOUNT,
    id: 'acct-user1',
    userId: 'user1',
    cash: 100,
    equity: 100,
    realizedPnl: 0,
    openTradeCount: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const FILL: PaperFill = {
  fillId: 'f1', role: 'entry', date: '2026-09-24', price: 2.1, quantity: 1,
  quoteSource: OptionQuoteSource.RH_MCP,
};
const MARK: PaperMark = { mark: 1.9, underlyingClose: 605 };

// ── Reads ────────────────────────────────────────────────────────────────────

describe('repository reads', () => {
  it('reads an account from the accounts/items anchor path', async () => {
    const { db, store } = createFakeDb({ [ACCOUNT_PATH]: makeAccount() });
    const account = await getAccount(db, 'acct-user1');
    assert.equal(account?.cash, 100);
    assert.ok(store.has(ACCOUNT_PATH));
  });

  it('returns null for a missing account', async () => {
    const { db } = createFakeDb();
    assert.equal(await getAccount(db, 'acct-nobody'), null);
  });

  it('listTrades applies AND-combined filters against trades/items docs', async () => {
    const open = makeTrade();
    const closed = makeTrade();
    closed.id = 'other';
    closed.status = PaperTradeStatus.CLOSED;
    const { db } = createFakeDb({
      [TRADE_PATH]: open,
      'paper-trading/trades/items/other': closed,
    });
    const result = await listTrades(db, { status: PaperTradeStatus.OPEN });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, TRADE_ID);
  });
});

// ── Writes ───────────────────────────────────────────────────────────────────

describe('repository writes', () => {
  it('setTrade writes the whole doc at the anchor/items path', async () => {
    const { db, setCalls, stored } = createFakeDb();
    await setTrade(db, makeTrade());
    assert.equal(setCalls[0].path, TRADE_PATH);
    assert.equal(stored<PaperTrade>(TRADE_PATH).symbol, 'QQQM');
  });

  it('appendMark writes only the marks.{date} entry + updatedAt in one update', async () => {
    const { db, updateCalls } = createFakeDb({ [TRADE_PATH]: makeTrade() });
    await appendMark(db, TRADE_ID, '2026-09-25', MARK, NOW);
    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0].path, TRADE_PATH);
    assert.deepEqual(updateCalls[0].fields['marks.2026-09-25'], MARK);
    assert.equal(updateCalls[0].fields['updatedAt'], NOW);
  });

  it('appendFill adds the fill via transactional read-modify-write', async () => {
    const { db, stored } = createFakeDb({ [TRADE_PATH]: makeTrade() });
    await appendFill(db, TRADE_ID, FILL, NOW);
    const saved = stored<PaperTrade>(TRADE_PATH);
    assert.equal(saved.fills.length, 1);
    assert.equal(saved.fills[0].fillId, 'f1');
  });

  it('updateVariantRun patches the matching run inside the array', async () => {
    const trade = makeTrade();
    const { db, stored } = createFakeDb({ [TRADE_PATH]: trade });
    const run: VariantRun = {
      variantKey: 'trailing-20', governing: true, state: 'EXITED',
      workingState: { highWaterMark: 2.5 },
      exitEvent: { date: '2026-09-25', price: 0.4, pnl: 170, daysHeld: 1 },
    };
    await updateVariantRun(db, TRADE_ID, run, NOW);
    const updated = stored<PaperTrade>(TRADE_PATH);
    const saved = updated.variantRuns[0];
    assert.equal(saved.state, 'EXITED');
    assert.equal(saved.exitEvent?.pnl, 170);
    // denormalized query field stays in sync with the runs array
    assert.deepEqual(updated.variantKeys, ['trailing-20']);
  });
});

// ── Trade id collisions ──────────────────────────────────────────────────────

describe('resolveTradeId', () => {
  it('returns the base id when the doc is free', async () => {
    const { db } = createFakeDb();
    assert.equal(await resolveTradeId(db, TRADE_ID, '0935'), TRADE_ID);
  });

  it('appends the -HHMM suffix when the base id is taken', async () => {
    const { db } = createFakeDb({ [TRADE_PATH]: makeTrade() });
    assert.equal(await resolveTradeId(db, TRADE_ID, '0935'), `${TRADE_ID}-0935`);
  });

  it('tries the next time suffix when the suffixed id is also taken', async () => {
    const { db } = createFakeDb({
      [TRADE_PATH]: makeTrade(),
      [`${TRADE_PATH}-0935`]: makeTrade(),
    });
    assert.equal(await resolveTradeId(db, TRADE_ID, '0935', '0936'), `${TRADE_ID}-0936`);
  });
});

// ── Ledger deps over Firestore ───────────────────────────────────────────────

describe('ledgerDeps', () => {
  it('transact runs reads + account/trade writes inside one transaction', async () => {
    const { db, stored } = createFakeDb({
      [ACCOUNT_PATH]: makeAccount(),
      [TRADE_PATH]: makeTrade(),
    });
    const deps = ledgerDeps(db);

    const result = await deps.transact(async (txn: LedgerTxn) => {
      const account = await txn.getAccount('user1');
      const trade = await txn.getTrade(TRADE_ID);
      assert.equal(account?.cash, 100);
      assert.equal(trade?.symbol, 'QQQM');
      txn.write({
        accountId: 'acct-user1',
        account: { ...account!, cash: 310 },
        tradeId: TRADE_ID,
        trade: { ...trade!, status: 'CLOSED' as PaperTradeStatus },
        cashDelta: 210,
      });
      return 'done';
    });

    assert.equal(result, 'done');
    assert.equal(stored<PaperAccount>(ACCOUNT_PATH).cash, 310);
    assert.equal(stored<PaperTrade>(TRADE_PATH).status, 'CLOSED');
  });

  it('txn.getTrade returns null for a missing doc', async () => {
    const { db } = createFakeDb();
    const deps = ledgerDeps(db);
    const found = await deps.transact((txn: LedgerTxn) => txn.getTrade('nope'));
    assert.equal(found, null);
  });
});
