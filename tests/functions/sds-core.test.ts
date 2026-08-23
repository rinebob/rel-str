/**
 * Unit tests for SDS core — PDR message handling, idempotency, task enqueue.
 *
 * Tests the core logic with injected mock dependencies (Firestore, task queue,
 * tracked symbols) — no real GCP calls.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import { handlePdrMessage, type SdsDeps, type SdsTaskPayload } from '../../functions/src/symbol-data-sync/sds-core';
import type { PdrContext } from '../../functions/src/symbol-data-sync/sds-pdr-parser';

// ── Mock infrastructure ──────────────────────────────────────────────

interface MockDoc {
  data(): Record<string, unknown> | undefined;
  exists: boolean;
}

interface MockDb {
  docs: Map<string, Record<string, unknown>>;
  writes: Array<{ path: string; data: Record<string, unknown>; merge: boolean }>;
  collection(name: string): { doc(id: string): any };
  batch(): { set(ref: { _path: string }, data: Record<string, unknown>, opts?: { merge?: boolean }): void; commit(): Promise<void> };
  runTransaction(fn: (t: any) => Promise<void>): Promise<void>;
}

function createMockDb(): MockDb {
  const docs = new Map<string, Record<string, unknown>>();
  const writes: Array<{ path: string; data: Record<string, unknown>; merge: boolean }> = [];

  function makeDocRef(path: string) {
    return {
      _path: path,
      async get() {
        const existing = docs.get(path);
        return { data: () => existing, exists: !!existing } as MockDoc;
      },
      async set(data: Record<string, unknown>, opts?: { merge?: boolean }) {
        const merge = opts?.merge ?? false;
        writes.push({ path, data, merge });
        if (merge) {
          const existing = docs.get(path) ?? {};
          docs.set(path, { ...existing, ...data });
        } else {
          docs.set(path, { ...data });
        }
      },
      collection(sub: string) {
        return {
          doc(subId: string) {
            const subPath = `${path}/${sub}/${subId}`;
            return makeDocRef(subPath);
          },
        };
      },
    };
  }

  const db: MockDb = {
    docs,
    writes,
    collection(name: string) {
      return {
        doc(id: string) {
          const path = `${name}/${id}`;
          return makeDocRef(path);
        },
      };
    },
    batch() {
      const ops: Array<{ path: string; data: Record<string, unknown>; merge: boolean }> = [];
      return {
        set(ref: any, data: Record<string, unknown>, opts?: { merge?: boolean }) {
          ops.push({ path: ref._path, data, merge: opts?.merge ?? false });
        },
        async commit() {
          for (const op of ops) {
            if (op.merge) {
              const existing = docs.get(op.path) ?? {};
              docs.set(op.path, { ...existing, ...op.data });
            } else {
              docs.set(op.path, { ...op.data });
            }
          }
        },
      };
    },
    async runTransaction(fn: (t: any) => Promise<void>) {
      const t = {
        async get(ref: any) {
          const existing = docs.get(ref._path);
          return { data: () => existing, exists: !!existing };
        },
        set(ref: any, data: Record<string, unknown>, opts?: { merge?: boolean }) {
          const merge = opts?.merge ?? false;
          if (merge) {
            docs.set(ref._path, { ...docs.get(ref._path) ?? {}, ...data });
          } else {
            docs.set(ref._path, { ...data });
          }
        },
      };
      await fn(t);
    },
  };
  return db;
}

function createDeps(db: MockDb, trackedSymbols: string[], intradaySnapshots: Array<{ symbol: string; ip: number; ipc: number; io: number; it: string; ic: number }> = []): SdsDeps {
  const enqueued: SdsTaskPayload[] = [];
  return {
    db: db as any,
    async enqueueTask(payload: SdsTaskPayload) {
      enqueued.push(payload);
    },
    async getTrackedSymbols() {
      return trackedSymbols;
    },
    async fetchIntradaySnapshot(symbols: string[]) {
      return intradaySnapshots.filter((s) => symbols.includes(s.symbol));
    },
    _enqueued: enqueued,
  } as any;
}

const TRACKED = ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'NVDA'];

// ── Tests ────────────────────────────────────────────────────────────

describe('handlePdrMessage — POST A DAILY', () => {
  let db: MockDb;
  let deps: SdsDeps & { _enqueued: SdsTaskPayload[] };

  beforeEach(() => {
    db = createMockDb();
    deps = createDeps(db, TRACKED) as any;
  });

  it('creates run doc and enqueues tasks for all tracked minus excludeSymbols', async () => {
    const result = await handlePdrMessage(
      {
        runId: '2026-01-24-FRI-POST-A-1335-DAILY',
        phase: 'post',
        marketDate: '2026-01-24',
        runType: 'ts-post-all-intervals',
        interval: 'daily',
      },
      { excludeSymbols: ['AAPL', 'MSFT'] },
      deps,
    );

    assert.equal(result.skipped, false);
    assert.equal(result.enqueued, 3); // GOOGL, TSLA, NVDA
    assert.equal(deps._enqueued.length, 3);

    // Each task payload should have the interval and runId
    const payloads = deps._enqueued.map((p: SdsTaskPayload) => p.symbol).sort();
    assert.deepEqual(payloads, ['GOOGL', 'NVDA', 'TSLA']);
    assert.equal(deps._enqueued[0].interval, 'DAILY');
    assert.equal(deps._enqueued[0].runId, '2026-01-24-FRI-POST-A-1335-DAILY');
    assert.equal(deps._enqueued[0].sequenceRunId, '2026-01-24-POST-A');
  });

  it('creates sequence doc for POST run', async () => {
    await handlePdrMessage(
      {
        runId: '2026-01-24-FRI-POST-A-1335-DAILY',
        phase: 'post',
        marketDate: '2026-01-24',
        runType: 'ts-post-all-intervals',
        interval: 'daily',
      },
      { excludeSymbols: ['AAPL'] },
      deps,
    );

    const seqDoc = db.docs.get('symbol-data-sync-sequences/2026-01-24-POST-A');
    assert.ok(seqDoc, 'sequence doc should exist');
    assert.equal(seqDoc?.sequence, 'A');
    assert.equal(seqDoc?.marketDate, '2026-01-24');
  });
});

describe('handlePdrMessage — idempotency', () => {
  it('skips if run doc already exists with terminal status', async () => {
    const db = createMockDb();
    // Pre-populate a completed run doc
    db.docs.set('symbol-data-sync-runs/2026-01-24-FRI-POST-A-1335-DAILY', {
      status: 'completed',
    });
    const deps = createDeps(db, TRACKED) as any;

    const result = await handlePdrMessage(
      {
        runId: '2026-01-24-FRI-POST-A-1335-DAILY',
        phase: 'post',
        marketDate: '2026-01-24',
        runType: 'ts-post-all-intervals',
        interval: 'daily',
      },
      { excludeSymbols: [] },
      deps,
    );

    assert.equal(result.skipped, true);
    assert.equal(result.enqueued, 0);
  });
});

describe('handlePdrMessage — POST B with empty includeSymbols', () => {
  it('records run but enqueues 0 tasks', async () => {
    const db = createMockDb();
    const deps = createDeps(db, TRACKED) as any;

    const result = await handlePdrMessage(
      {
        runId: '2026-01-24-FRI-POST-B-1800-DAILY',
        phase: 'post',
        marketDate: '2026-01-24',
        runType: 'ts-post-all-intervals',
        interval: 'daily',
      },
      { includeSymbols: [] },
      deps,
    );

    assert.equal(result.skipped, false);
    assert.equal(result.enqueued, 0);
    // Run doc should still be created
    const runDoc = db.docs.get('symbol-data-sync-runs/2026-01-24-FRI-POST-B-1800-DAILY');
    assert.ok(runDoc);
  });
});

describe('handlePdrMessage — intraday PRE', () => {
  it('bulk fetches intraday snapshot, writes intraday docs + currentPrice, no tasks enqueued', async () => {
    const db = createMockDb();
    const intradaySnaps = TRACKED.map((s, i) => ({
      symbol: s,
      ip: 100 + i,
      ipc: 0.5 + i * 0.1,
      io: 1737720000000 + i * 1000,
      it: '08:00',
      ic: 0.5,
    }));
    const deps = createDeps(db, TRACKED, intradaySnaps) as any;

    const result = await handlePdrMessage(
      {
        runId: '2026-01-24-FRI-LIVE-0800',
        phase: 'pre',
        marketDate: '2026-01-24',
        runType: 'intraday-snapshot',
        clockPt: '0800',
      },
      {},
      deps,
    );

    assert.equal(result.skipped, false);
    assert.equal(result.enqueued, 5); // 5 successful intraday writes
    assert.equal(deps._enqueued.length, 0); // no per-symbol tasks

    // No sequence doc for intraday
    const seqDocs = Array.from(db.docs.keys()).filter((k) => k.startsWith('symbol-data-sync-sequences/'));
    assert.equal(seqDocs.length, 0);

    // Run doc should be marked completed
    const runDoc = db.docs.get('symbol-data-sync-runs/2026-01-24-FRI-LIVE-0800');
    assert.equal(runDoc?.status, 'completed');
    assert.equal((runDoc?.processedSymbols as string[])?.length, 5);
  });
});
