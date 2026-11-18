/**
 * @topic #553 — Paper Trading Infra (task #1576)
 *
 * Verification for the ledger-ops task: `deleteTradeCascade` +
 * `deletePaperTrades` + the auto-paper ingest curated-dims swap. The
 * cascade runs the REAL repository seam over an in-memory doc store;
 * the ingest check runs the REAL `runAutoPaperIngestFill` with dep
 * fakes and inspects the EntryFillInput dims it emits.
 *
 * Read-only, no env. The `st-config/autoPaper` widening itself is a
 * prod doc state — verified separately via the probe noted in the
 * companion guide.
 *
 * Run: npx tsx scripts/verify/paper-trading-ledger-ops-1576.ts
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { TradeSide } from '../../../shared/common';
import {
  CURATED_GOVERNING_POLICY,
  CURATED_VARIANT_KEYS,
  DELETE_PAPER_TRADES_MAX_ITEMS,
  PaperTradeSource,
  PaperTradeStatus,
  PaperTradingKind,
  type PaperTrade,
  type PaperTradingDoc,
} from '../../../shared/paper-trading-contracts';
import { deleteTradeCascade } from '../../src/paper-trading/repository';
import { handleDeletePaperTrades } from '../../src/paper-trading/signal-trade-callables';
import { runAutoPaperIngestFill } from '../../src/paper-trading/passes/auto-paper-ingest-pass';
import type { EntryFillInput } from '../../src/paper-trading/ledger';
import { StSignalDirection } from '../../src/st-cloud-function/signals';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
}
function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, actual === expected, `(got ${String(actual)}, want ${String(expected)})`);
}
function contains(name: string, file: string, needle: string): void {
  const src = readFileSync(resolve(__dirname, '../..', file), 'utf-8');
  check(name, src.includes(needle), `— '${needle}' not in ${file}`);
}

// ── Fake Firestore (path-keyed, with delete + txn + batch) ────────────────

type Filter = { field: string; op: string; value: unknown };

function createFakeDb(initial: Record<string, PaperTradingDoc | object> = {}) {
  const store = new Map<string, Record<string, unknown>>();
  for (const [p, d] of Object.entries(initial)) store.set(p, d as Record<string, unknown>);
  const refPaths = new WeakMap<object, string>();

  const docsIn = (path: string) => {
    const prefix = `${path}/`;
    return [...store.entries()]
      .filter(([p]) => p.startsWith(prefix))
      .map(([p, data]) => ({ id: p.slice(prefix.length), ref: makeDocRef(p), data: () => data }));
  };
  const makeDocRef = (path: string) => {
    const ref = {
      id: path.split('/').pop()!,
      get: async () => {
        const data = store.get(path);
        return { exists: data !== undefined, id: path.split('/').pop()!, data: () => data };
      },
      delete: async () => { store.delete(path); },
    };
    refPaths.set(ref, path);
    return ref;
  };
  const makeQuery = (path: string, filters: Filter[]): object => ({
    where: (field: string, op: string, value: unknown) =>
      makeQuery(path, [...filters, { field, op, value }]),
    get: async () => {
      const docs = docsIn(path).filter((d) =>
        filters.every((f) => {
          const actual = (d.data() as Record<string, unknown>)[f.field];
          return f.op === 'array-contains'
            ? Array.isArray(actual) && actual.includes(f.value)
            : actual === f.value;
        }),
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
      const ops: { path: string }[] = [];
      return {
        delete: (ref: { id: string }) => ops.push({ path: refPaths.get(ref) ?? ref.id }),
        commit: async () => { for (const op of ops) store.delete(op.path); },
      };
    },
    runTransaction: async (fn: (txn: unknown) => Promise<unknown>) => {
      const txn = {
        get: (ref: { id: string }) => makeDocRef(refPaths.get(ref) ?? ref.id).get(),
        update: (ref: { id: string }, fields: Record<string, unknown>) =>
          store.set(refPaths.get(ref) ?? ref.id, { ...store.get(refPaths.get(ref) ?? ref.id), ...fields }),
        delete: (ref: { id: string }) => store.delete(refPaths.get(ref) ?? ref.id),
      };
      return fn(txn);
    },
  };
  return { db: db as never as Parameters<typeof deleteTradeCascade>[0], store };
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const TID = '261015-sig-AMAT-EQ';
const TP = `st-paper-trading/trades/items/${TID}`;
const KP = `st-order-tickets/pap_${TID}`;
const RQP = `st-paper-trading/raw-quotes/items/rq-${TID}-2026-10-15`;

const TRADE: PaperTradingDoc = {
  kind: PaperTradingKind.TRADE,
  id: TID,
  status: PaperTradeStatus.CLOSED,
  source: PaperTradeSource.SIGNAL,
  symbol: 'AMAT',
  expression: 'EQ',
  governingVariant: 'trailing-8',
  order: { side: TradeSide.LONG, type: 'MARKET', quantity: 1 },
  fills: [],
  legs: [],
  marks: {},
} as unknown as PaperTrade;

/** An accept-flow marker fixture — cohort membership must refuse. */
const FLOW_TRADE = {
  ...TRADE,
  cohortId: 'cohort-261015-AMAT-01',
} as unknown as PaperTrade;

const RQ = {
  kind: PaperTradingKind.RAW_QUOTE,
  id: `rq-${TID}-2026-10-15`,
  tradeId: TID,
  date: '2026-10-15',
} as unknown as PaperTradingDoc;

const AUTH = { auth: { uid: 'u1' } };

async function main(): Promise<void> {
  console.log('── static seams ──');
  contains('deleteTradeCascade seam', 'src/paper-trading/repository.ts', 'export async function deleteTradeCascade');
  contains('handler exported', 'src/paper-trading/signal-trade-callables.ts', 'export async function handleDeletePaperTrades');
  contains('onCall export', 'src/paper-trading/signal-trade-callables.ts', 'export const deletePaperTrades = onCall');
  contains('callable registered', 'src/index.ts', 'deletePaperTrades');
  contains('ingest curated policy', 'src/paper-trading/passes/auto-paper-ingest-pass.ts', 'CURATED_GOVERNING_POLICY');
  contains('ingest curated keys', 'src/paper-trading/passes/auto-paper-ingest-pass.ts', 'CURATED_VARIANT_KEYS');
  contains('spec registered', 'package.json', 'delete-paper-trades.test.ts');
  eq('delete batch cap', DELETE_PAPER_TRADES_MAX_ITEMS, 50);

  console.log('── cascade: trade + rq + tickets gone, signal-scoped ──');
  {
    const { db, store } = createFakeDb({
      [TP]: TRADE,
      [KP]: { id: `pap_${TID}`, state: 'filled' },
      [RQP]: RQ,
      'st-paper-trading/raw-quotes/items/rq-other-2026-10-15':
        { ...RQ, id: 'rq-other-2026-10-15', tradeId: 'other' },
    });
    const outcome = await deleteTradeCascade(db, TID);
    eq('outcome deleted', outcome, 'deleted');
    eq('trade gone', store.has(TP), false);
    eq('lifecycle ticket gone', store.has(KP), false);
    eq('rq doc gone', store.has(RQP), false);
    eq('foreign rq survives', store.has('st-paper-trading/raw-quotes/items/rq-other-2026-10-15'), true);
    eq('re-delete → notFound', await deleteTradeCascade(db, TID), 'notFound');
  }
  {
    const { db, store } = createFakeDb({
      [TP]: FLOW_TRADE,
      [KP]: { id: `pap_${TID}` },
      [RQP]: RQ,
    });
    eq('accept-flow refused', await deleteTradeCascade(db, TID), 'accept-flow');
    eq('flow trade survives', store.has(TP), true);
    eq('flow ticket survives', store.has(KP), true);
  }
  {
    const ACCT = 'st-paper-trading/accounts/items/acct-auto-paper';
    const { db, store } = createFakeDb({
      [TP]: { ...TRADE, status: PaperTradeStatus.OPEN, userId: 'auto-paper' },
      [ACCT]: { id: 'acct-auto-paper', openTradeCount: 3 },
    });
    eq('open delete → deleted', await deleteTradeCascade(db, TID), 'deleted');
    eq('openTradeCount rewound', (store.get(ACCT) as { openTradeCount: number }).openTradeCount, 2);
  }
  {
    const { db, store } = createFakeDb({
      [TP]: { ...TRADE, source: PaperTradeSource.STRATEGY },
      [KP]: { id: `pap_${TID}` },
      [RQP]: RQ,
    });
    eq('non-signal refused', await deleteTradeCascade(db, TID), 'non-signal');
    eq('trade survives', store.has(TP), true);
    eq('ticket survives', store.has(KP), true);
    eq('rq survives', store.has(RQP), true);
  }
  {
    const { db } = createFakeDb({});
    eq('missing id → notFound', await deleteTradeCascade(db, TID), 'notFound');
  }

  console.log('── callable: auth, cap, per-item buckets ──');
  {
    const deps = { deleteTrade: async () => 'deleted' as const };
    let code = '';
    try {
      await handleDeletePaperTrades({ data: { tradeIds: ['t'] } }, deps);
    } catch (e) { code = (e as { code?: string }).code ?? ''; }
    eq('unauthenticated', code, 'unauthenticated');
    code = '';
    try {
      await handleDeletePaperTrades(
        { data: { tradeIds: Array.from({ length: DELETE_PAPER_TRADES_MAX_ITEMS + 1 }, (_, i) => `t${i}`) }, ...AUTH },
        deps,
      );
    } catch (e) { code = (e as { code?: string }).code ?? ''; }
    eq('over-cap invalid-argument', code, 'invalid-argument');
    const res = await handleDeletePaperTrades(
      {
        data: { tradeIds: ['t1', 't-gone', 't-strat'] },
        ...AUTH,
      },
      {
        deleteTrade: async (id) =>
          id === 't-gone' ? 'notFound' : id === 't-strat' ? 'non-signal' : 'deleted',
      },
    );
    eq('deleted bucket', res.deleted.join(','), 't1');
    eq('notFound bucket', res.notFound.join(','), 't-gone');
    eq('failed bucket', res.failed[0]?.tradeId, 't-strat');
  }

  console.log('── ingest fill: curated dims + SECONDARY admit ──');
  {
    const fills: EntryFillInput[] = [];
    const V1L = 'D_ST_TREND_RIDER_V1_LONG';
    const summary = await runAutoPaperIngestFill(
      { runId: 'r1', marketDate: '2026-10-08' },
      { global: false, lists: ['PRIMARY', 'SECONDARY'], signalTypes: [V1L] },
      {
        listCandidates: async () => ['AAPL', 'TSLA', 'NOPE'],
        listMembers: async (key) => (key === 'PRIMARY' ? ['AAPL'] : key === 'SECONDARY' ? ['TSLA'] : []),
        getSignals: async () => ({
          [V1L]: {
            signalType: V1L,
            direction: StSignalDirection.LONG,
            status: 'CONFIRMED',
            timeframe: 'D',
            barDate: '2026-10-08',
            marketDate: '2026-10-08',
            indicators: {},
          },
        }),
        getSymbolMeta: async () => ({}),
        getEquityQuotes: async () => ({
          results: ['AAPL', 'TSLA', 'NOPE'].map((s) => ({ quote: { symbol: s, last_trade_price: 10 } })),
        }),
        getTrade: async () => null,
        applyEntryFill: async (input) => { fills.push(input); return {} as never; },
        writeRawQuote: async () => {},
        now: () => new Date('2026-10-08T20:00:00Z'),
      },
    );
    eq('created', summary.created, 2);
    eq('unlisted filtered', summary.filtered, 1);
    const f = fills[0];
    eq('governingPolicy marker', f.dims.governingPolicy, CURATED_GOVERNING_POLICY);
    eq('governingVariant fallback seed', f.dims.governingVariant, 'trailing-8');
    check('curated variant set', JSON.stringify(f.dims.variantKeys) === JSON.stringify([...CURATED_VARIANT_KEYS]));
    eq('SECONDARY member admitted', fills[1].dims.symbol, 'TSLA');
    eq('captureList stamp', fills[1].tradeOverrides?.captureList, 'SECONDARY');
  }

  console.log(failed === 0 ? `\nAll ${passed} checks passed.` : `\n${failed} check(s) FAILED (${passed} passed).`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
