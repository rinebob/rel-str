/**
 * @topic #984 — ST Firestore Reorg (task #1007)
 *
 * Collection-rename coverage:
 * - collections.ts routes account/trade/stats/raw-quote to st-paper-trading
 *   while instance/cohort/analysis stay on the legacy root.
 * - portfolioItemsMirror copies FE-written legacy docs → st-portfolio
 *   (upsert + delete, unknown anchors skipped, wholesale set).
 * - stBacktest*Mirror shadows canonical writes → legacy backtest-* for
 *   stranded FE readers (merge-set preserves FE-owned fields, deletes
 *   propagate).
 * - Trigger-path literals pinned — a typoed path deploys and silently
 *   never fires.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PaperTradingKind } from '../../shared/paper-trading-ids';
import {
  paperDocRef,
  paperItemsRef,
  paperTradingDocPathFor,
} from '../../functions/src/paper-trading/collections';
import {
  MIRROR_PORTFOLIO_ITEMS_PATH,
  mirrorPortfolioItem,
} from '../../functions/src/portfolio/portfolio-mirror';
import {
  MIRROR_ST_BACKTEST_PERMUTATIONS_PATH,
  MIRROR_ST_BACKTEST_RUNS_PATH,
  mirrorBacktestDoc,
  LEGACY_BACKTEST_RUNS_ROOT,
  LEGACY_BACKTEST_PERMUTATIONS_ROOT,
} from '../../functions/src/st-cloud-function/backtest/backtest-mirror';

// ── Fake Firestore — docs keyed by path; captures writes ────────────────────

type FakeDoc = { exists: boolean; data: () => Record<string, unknown> | undefined };

function fakeFirestore(initial: Record<string, Record<string, unknown>> = {}, opts: { failOn?: RegExp } = {}) {
  const store = new Map<string, Record<string, unknown>>(
    Object.entries(initial).map(([k, v]) => [k, { ...v }]),
  );
  const collectionCalls: string[] = [];
  const deletes: string[] = [];
  const refFor = (path: string) => ({
    get: async (): Promise<FakeDoc> => {
      const d = store.get(path);
      return { exists: d !== undefined, data: () => d };
    },
    set: async (doc: Record<string, unknown>, setOpts?: { merge?: boolean }) => {
      if (opts.failOn?.test(path)) throw new Error('injected write failure');
      store.set(path, setOpts?.merge === true ? { ...(store.get(path) ?? {}), ...doc } : { ...doc });
    },
    delete: async () => { deletes.push(path); store.delete(path); },
  });
  const db = {
    doc: (path: string) => refFor(path),
    collection: (name: string) => {
      collectionCalls.push(name);
      return { doc: (id: string) => refFor(`${name}/${id}`) };
    },
  };
  return { db, store, collectionCalls, deletes };
}

function recordingLogger() {
  const warns: unknown[] = [];
  const errors: unknown[] = [];
  return { warns, errors, logger: { warn: (m: unknown) => { warns.push(m); }, error: (m: unknown) => { errors.push(m); } } };
}

const deps = (f: ReturnType<typeof fakeFirestore>, logger: { warn(m: unknown): void; error(m: unknown): void } = { warn() {}, error() {} }) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ({ db: f.db as any, logger: logger as any });

// ── collections.ts routing ───────────────────────────────────────────────────

describe('path strings through the seam', () => {
  const f = fakeFirestore();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = f.db as any;

  for (const [kind, expected] of [
    [PaperTradingKind.ACCOUNT, 'st-paper-trading/accounts/items/acct-u1'],
    [PaperTradingKind.TRADE, 'st-paper-trading/trades/items/t-1'],
    [PaperTradingKind.STATS, 'st-paper-trading/stats/items/stats-all'],
    [PaperTradingKind.RAW_QUOTE, 'st-paper-trading/raw-quotes/items/rq-1'],
    [PaperTradingKind.INSTANCE, 'paper-trading/instances/items/i-1'],
    [PaperTradingKind.COHORT, 'paper-trading/cohorts/items/cohort-1'],
    [PaperTradingKind.ANALYSIS_DATASET, 'paper-trading/analysis-datasets/items/ds-1'],
    [PaperTradingKind.ANALYSIS_SLICE, 'paper-trading/analysis-slices/items/s-1'],
  ] as const) {
    it(`${kind} → ${expected}`, async () => {
      const id = expected.split('/').pop()!;
      await paperDocRef(db, kind, id).set({ probe: true });
      assert.ok(f.store.has(expected), `expected write at ${expected}`);
      assert.equal(paperTradingDocPathFor(kind, id), expected);
    });
  }
});

describe('paperItemsRef routing', () => {
  for (const [kind, expected] of [
    [PaperTradingKind.TRADE, 'st-paper-trading/trades/items'],
    [PaperTradingKind.COHORT, 'paper-trading/cohorts/items'],
  ] as const) {
    it(`${kind} → collection ${expected}`, () => {
      const f = fakeFirestore();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      paperItemsRef(f.db as any, kind);
      assert.deepEqual(f.collectionCalls, [expected]);
    });
  }
});

// ── mirror trigger paths — pinned literals (a typo deploys silently) ────────

describe('mirror trigger paths', () => {
  it('portfolio watches legacy anchored items (even segments)', () => {
    assert.equal(MIRROR_PORTFOLIO_ITEMS_PATH, 'portfolio/{anchor}/items/{docId}');
  });
  it('backtest mirrors watch the canonical roots', () => {
    assert.equal(MIRROR_ST_BACKTEST_RUNS_PATH, 'st-backtest-runs/{docId}');
    assert.equal(MIRROR_ST_BACKTEST_PERMUTATIONS_PATH, 'st-backtest-permutations/{docId}');
  });
});

// ── portfolioItemsMirror ─────────────────────────────────────────────────────

describe('mirrorPortfolioItem', () => {
  it('upserts a bucket doc into st-portfolio', async () => {
    const f = fakeFirestore();
    const res = await mirrorPortfolioItem(
      deps(f), 'buckets', 'acct_main', { userId: 'u1', name: 'Core' },
    );
    assert.equal(res, 'upserted');
    assert.deepEqual(f.store.get('st-portfolio/buckets/items/acct_main'), { userId: 'u1', name: 'Core' });
  });

  it('upserts an attribution doc into st-portfolio', async () => {
    const f = fakeFirestore();
    const res = await mirrorPortfolioItem(
      deps(f), 'attributions', 'acct_inst1', { userId: 'u1', bucket: 'b1' },
    );
    assert.equal(res, 'upserted');
    assert.deepEqual(f.store.get('st-portfolio/attributions/items/acct_inst1'), { userId: 'u1', bucket: 'b1' });
  });

  it('propagates deletes', async () => {
    const f = fakeFirestore({ 'st-portfolio/buckets/items/b1': { userId: 'u1' } });
    const res = await mirrorPortfolioItem(deps(f), 'buckets', 'b1', null);
    assert.equal(res, 'deleted');
    assert.ok(!f.store.has('st-portfolio/buckets/items/b1'));
    assert.deepEqual(f.deletes, ['st-portfolio/buckets/items/b1']);
  });

  it('skips unknown anchors without writing', async () => {
    const f = fakeFirestore();
    const { warns, logger } = recordingLogger();
    const res = await mirrorPortfolioItem(deps(f, logger), 'widgets', 'w1', { a: 1 });
    assert.equal(res, 'skipped');
    assert.equal(f.store.size, 0);
    assert.equal(warns.length, 1);
  });

  it('wholesale set drops fields deleted on the legacy doc', async () => {
    const f = fakeFirestore({ 'st-portfolio/buckets/items/b2': { userId: 'u1', stale: 'x' } });
    const res = await mirrorPortfolioItem(deps(f), 'buckets', 'b2', { userId: 'u1' });
    assert.equal(res, 'upserted');
    assert.deepEqual(f.store.get('st-portfolio/buckets/items/b2'), { userId: 'u1' });
  });

  it('never throws — a write failure returns skipped + logs error', async () => {
    const f = fakeFirestore({}, { failOn: /st-portfolio/ });
    const { errors, logger } = recordingLogger();
    const res = await mirrorPortfolioItem(deps(f, logger), 'buckets', 'b3', { a: 1 });
    assert.equal(res, 'skipped');
    assert.equal(errors.length, 1);
  });
});

// ── backtest mirrors ─────────────────────────────────────────────────────────

describe('mirrorBacktestDoc', () => {
  it('shadows a run write onto backtest-runs', async () => {
    const f = fakeFirestore();
    const res = await mirrorBacktestDoc(
      deps(f), LEGACY_BACKTEST_RUNS_ROOT, 'run-1', { status: 'running', pct: 40 },
    );
    assert.equal(res, 'upserted');
    assert.deepEqual(f.store.get('backtest-runs/run-1'), { status: 'running', pct: 40 });
  });

  it('merge-set preserves FE-owned legacy fields (archived et al.)', async () => {
    const f = fakeFirestore({ 'backtest-runs/run-1': { status: 'running', archived: true, qualityDesignation: 'gold' } });
    const res = await mirrorBacktestDoc(
      deps(f), LEGACY_BACKTEST_RUNS_ROOT, 'run-1', { status: 'completed', pct: 100 },
    );
    assert.equal(res, 'upserted');
    assert.deepEqual(f.store.get('backtest-runs/run-1'), {
      status: 'completed', pct: 100, archived: true, qualityDesignation: 'gold',
    });
  });

  it('shadows a permutation write onto backtest-permutations', async () => {
    const f = fakeFirestore();
    const res = await mirrorBacktestDoc(
      deps(f), LEGACY_BACKTEST_PERMUTATIONS_ROOT, 'perm-9', { status: 'success' },
    );
    assert.equal(res, 'upserted');
    assert.deepEqual(f.store.get('backtest-permutations/perm-9'), { status: 'success' });
  });

  it('propagates deletes', async () => {
    const f = fakeFirestore({ 'backtest-runs/run-2': { status: 'done' } });
    const res = await mirrorBacktestDoc(deps(f), LEGACY_BACKTEST_RUNS_ROOT, 'run-2', null);
    assert.equal(res, 'deleted');
    assert.ok(!f.store.has('backtest-runs/run-2'));
  });

  it('never throws — a write failure returns skipped + logs error', async () => {
    const f = fakeFirestore({}, { failOn: /backtest-runs/ });
    const { errors, logger } = recordingLogger();
    const res = await mirrorBacktestDoc(deps(f, logger), LEGACY_BACKTEST_RUNS_ROOT, 'r1', { a: 1 });
    assert.equal(res, 'skipped');
    assert.equal(errors.length, 1);
  });
});
