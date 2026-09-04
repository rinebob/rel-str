/**
 * Unit tests for SDS task worker — per-interval fetch and Firestore write paths.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import { processSymbolInterval, type SdsWorkerDeps } from '../../functions/src/symbol-data-sync/sds-worker-core';
import type { OhlcBar } from '../../functions/src/common/market-data-types';

// ── Mock infrastructure ──────────────────────────────────────────────

interface MockDb {
  docs: Map<string, Record<string, unknown>>;
  collection(name: string): { doc(id: string): any };
  batch(): any;
}

function createMockDb(): MockDb {
  const docs = new Map<string, Record<string, unknown>>();
  function makeDocRef(path: string): any {
    return {
      _path: path,
      async get() {
        const existing = docs.get(path);
        return { data: () => existing, exists: !!existing };
      },
      async set(data: Record<string, unknown>, opts?: { merge?: boolean }) {
        const merge = opts?.merge ?? false;
        if (merge) {
          docs.set(path, { ...docs.get(path) ?? {}, ...data });
        } else {
          docs.set(path, { ...data });
        }
      },
      collection(sub: string) {
        return { doc(id: string) { return makeDocRef(`${path}/${sub}/${id}`); } };
      },
    };
  }
  return {
    docs,
    collection(name: string) { return { doc(id: string) { return makeDocRef(`${name}/${id}`); } }; },
    batch() {
      const ops: Array<any> = [];
      return {
        set(ref: any, data: any, opts?: any) { ops.push({ ref, data, merge: opts?.merge ?? false }); },
        async commit() {
          for (const op of ops) {
            const path = op.ref._path;
            if (op.merge) {
              docs.set(path, { ...docs.get(path) ?? {}, ...op.data });
            } else {
              docs.set(path, { ...op.data });
            }
          }
        },
      };
    },
  };
}

const SAMPLE_BARS: OhlcBar[] = [
  { d: '2026-01-20', o: 100, h: 105, l: 99, c: 103, v: 1000 },
  { d: '2026-01-21', o: 103, h: 108, l: 102, c: 107, v: 1200 },
  { d: '2026-01-22', o: 107, h: 110, l: 106, c: 109, v: 900 },
  { d: '2026-01-23', o: 109, h: 112, l: 108, c: 111, v: 1100 },
  { d: '2026-01-24', o: 111, h: 115, l: 110, c: 114, v: 800 },
];

function createWorkerDeps(db: MockDb, barsByInterval: Record<string, OhlcBar[]>): SdsWorkerDeps {
  return {
    db: db as any,
    async fetchBars(symbol: string, interval: string) {
      return barsByInterval[interval] ?? [];
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('processSymbolInterval — POST DAILY', () => {
  let db: MockDb;
  let deps: SdsWorkerDeps;

  beforeEach(() => {
    db = createMockDb();
    deps = createWorkerDeps(db, { DAILY: SAMPLE_BARS });
  });

  it('writes daily year shard and currentPrice', async () => {
    const result = await processSymbolInterval({
      symbol: 'AAPL',
      interval: 'DAILY',
      runId: '2026-01-24-FRI-A-DAILY-LIVE-POST-1335',
      sequenceRunId: '2026-01-24-POST-A',
      sequence: 'A',
      marketDate: '2026-01-24',
    }, deps);

    assert.equal(result.status, 'ok');

    // Daily shard should exist for 2026
    const shard = db.docs.get('symbol-data/AAPL/daily/2026') as { interval: string; bars: OhlcBar[] } | undefined;
    assert.ok(shard);
    assert.equal(shard.interval, 'daily');
    assert.equal(shard.bars.length, 5);

    // currentPrice should be written from latest bar close
    const root = db.docs.get('symbol-data/AAPL') as { currentPrice?: { price: number; date: string } } | undefined;
    assert.ok(root?.currentPrice);
    assert.equal(root.currentPrice.price, 114);
    assert.equal(root.currentPrice.date, '2026-01-24');
  });

  it('does NOT write weekly or monthly docs', async () => {
    await processSymbolInterval({
      symbol: 'AAPL',
      interval: 'DAILY',
      runId: '2026-01-24-FRI-A-DAILY-LIVE-POST-1335',
      sequenceRunId: '2026-01-24-POST-A',
      sequence: 'A',
      marketDate: '2026-01-24',
    }, deps);

    assert.ok(!db.docs.has('symbol-data/AAPL/weekly/all'));
    assert.ok(!db.docs.has('symbol-data/AAPL/monthly/all'));
  });
});

describe('processSymbolInterval — POST WEEKLY', () => {
  it('writes weekly doc only, no currentPrice', async () => {
    const db = createMockDb();
    const deps = createWorkerDeps(db, { WEEKLY: SAMPLE_BARS });

    const result = await processSymbolInterval({
      symbol: 'AAPL',
      interval: 'WEEKLY',
      runId: '2026-01-24-FRI-A-WEEKLY-LIVE-POST-1335',
      sequenceRunId: '2026-01-24-POST-A',
      sequence: 'A',
      marketDate: '2026-01-24',
    }, deps);

    assert.equal(result.status, 'ok');

    const weekly = db.docs.get('symbol-data/AAPL/weekly/all') as { interval: string; bars: OhlcBar[] } | undefined;
    assert.ok(weekly);
    assert.equal(weekly.interval, 'weekly');
    assert.equal(weekly.bars.length, 5);

    // No currentPrice
    const root = db.docs.get('symbol-data/AAPL');
    assert.ok(!root?.currentPrice);

    // No daily shard
    assert.ok(!db.docs.has('symbol-data/AAPL/daily/2026'));
  });
});

describe('processSymbolInterval — POST MONTHLY', () => {
  it('writes monthly doc only, no currentPrice', async () => {
    const db = createMockDb();
    const deps = createWorkerDeps(db, { MONTHLY: SAMPLE_BARS });

    const result = await processSymbolInterval({
      symbol: 'AAPL',
      interval: 'MONTHLY',
      runId: '2026-01-24-FRI-A-MONTHLY-LIVE-POST-1335',
      sequenceRunId: '2026-01-24-POST-A',
      sequence: 'A',
      marketDate: '2026-01-24',
    }, deps);

    assert.equal(result.status, 'ok');

    const monthly = db.docs.get('symbol-data/AAPL/monthly/all') as { interval: string; bars: OhlcBar[] } | undefined;
    assert.ok(monthly);
    assert.equal(monthly.interval, 'monthly');
    assert.equal(monthly.bars.length, 5);

    // No currentPrice
    const root = db.docs.get('symbol-data/AAPL');
    assert.ok(!root?.currentPrice);
  });
});

describe('processSymbolInterval — edge cases', () => {
  it('returns skipped when no bars fetched', async () => {
    const db = createMockDb();
    const deps = createWorkerDeps(db, {});

    const result = await processSymbolInterval({
      symbol: 'AAPL',
      interval: 'DAILY',
      runId: '2026-01-24-FRI-A-DAILY-LIVE-POST-1335',
      sequenceRunId: '2026-01-24-POST-A',
      sequence: 'A',
      marketDate: '2026-01-24',
    }, deps);

    assert.equal(result.status, 'skipped');
  });

  it('writes to multiple year shards when bars span year boundary', async () => {
    const db = createMockDb();
    const bars: OhlcBar[] = [
      { d: '2025-12-30', o: 100, h: 105, l: 99, c: 103, v: 1000 },
      { d: '2026-01-02', o: 103, h: 108, l: 102, c: 107, v: 1200 },
    ];
    const deps = createWorkerDeps(db, { DAILY: bars });

    await processSymbolInterval({
      symbol: 'AAPL',
      interval: 'DAILY',
      runId: '2026-01-02-FRI-A-DAILY-LIVE-POST-1335',
      sequenceRunId: '2026-01-02-POST-A',
      sequence: 'A',
      marketDate: '2026-01-02',
    }, deps);

    assert.ok(db.docs.has('symbol-data/AAPL/daily/2025'));
    assert.ok(db.docs.has('symbol-data/AAPL/daily/2026'));
  });
});

