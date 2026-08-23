/**
 * Unit tests for SDS completion — per-interval completion, sequence fan-in,
 * downstream consumer dispatch, watchdog, and intraday completion.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import {
  checkSyncRunCompletion,
  fireSequenceCompletion,
  checkIntradayRunCompletion,
  type SdsCompletionDeps,
  type RunContext,
  type SequenceContext,
} from '../../functions/src/symbol-data-sync/sds-completion';
import { runWatchdog } from '../../functions/src/symbol-data-sync/sds-watchdog-logic';

// ── Mock infrastructure (shared with sds-core test pattern) ──────────

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
  // Transaction lock — serializes concurrent transactions so that the
  // conditional-write pattern (read status, then write) works correctly
  // in tests, matching real Firestore transaction semantics.
  let txInProgress = false;
  const txQueue: Array<() => void> = [];

  /** Process FieldValue sentinels (arrayUnion, serverTimestamp, increment) */
  function applyField(
    existing: Record<string, unknown>,
    key: string,
    value: unknown,
  ): unknown {
    if (value && typeof value === 'object') {
      const ctor = (value as object).constructor?.name;
      // FieldValue.arrayUnion — sentinel has `elements` array
      if (ctor === 'ArrayUnionTransform' || 'elements' in value) {
        const elements = (value as { elements: unknown[] }).elements ?? [];
        const arr = (existing[key] as unknown[]) ?? [];
        const set = new Set(arr as string[]);
        for (const el of elements) {
          if (!set.has(el as string)) set.add(el as string);
        }
        return Array.from(set);
      }
      // FieldValue.serverTimestamp
      if (ctor === 'ServerTimestampTransform' || '_methodName' in value && (value as any)._methodName === 'serverTimestamp') {
        return new Date();
      }
      // FieldValue.increment
      if (ctor === 'NumericIncrementTransform' || '_by' in value) {
        const by = (value as { _by: number })._by ?? 1;
        return ((existing[key] as number) ?? 0) + by;
      }
    }
    return value;
  }

  function mergeDoc(
    path: string,
    data: Record<string, unknown>,
  ): void {
    const existing = docs.get(path) ?? {};
    const merged: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      merged[key] = applyField(existing, key, value);
    }
    docs.set(path, { ...existing, ...merged });
  }

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
          mergeDoc(path, data);
        } else {
          docs.set(path, { ...data });
        }
      },
      async update(data: Record<string, unknown>) {
        writes.push({ path, data, merge: true });
        mergeDoc(path, data);
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
      const col = {
        doc(id: string) {
          const path = `${name}/${id}`;
          return makeDocRef(path);
        },
        async get() {
          const prefix = `${name}/`;
          const result: Array<{ id: string; data: () => Record<string, unknown> }> = [];
          for (const [path, data] of docs.entries()) {
            if (path.startsWith(prefix) && !path.slice(prefix.length).includes('/')) {
              result.push({ id: path.slice(prefix.length), data: () => data });
            }
          }
          return { docs: result } as any;
        },
        where(field: string, op: string, value: unknown) {
          return {
            async get() {
              const prefix = `${name}/`;
              const result: Array<{ id: string; data: () => Record<string, unknown> }> = [];
              for (const [path, data] of docs.entries()) {
                if (path.startsWith(prefix) && !path.slice(prefix.length).includes('/')) {
                  if (op === '==' && data[field] === value) {
                    result.push({ id: path.slice(prefix.length), data: () => data });
                  }
                }
              }
              return { docs: result } as any;
            },
          };
        },
      };
      return col;
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
              mergeDoc(op.path, op.data);
            } else {
              docs.set(op.path, { ...op.data });
            }
          }
        },
      };
    },
    async runTransaction(fn: (t: any) => Promise<void>) {
      // Wait for any in-progress transaction to complete (serializes access)
      if (txInProgress) {
        await new Promise<void>((resolve) => txQueue.push(resolve));
      }
      txInProgress = true;
      const t = {
        async get(ref: any) {
          const existing = docs.get(ref._path);
          return { data: () => existing, exists: !!existing };
        },
        set(ref: any, data: Record<string, unknown>, opts?: { merge?: boolean }) {
          const merge = opts?.merge ?? false;
          if (merge) {
            mergeDoc(ref._path, data);
          } else {
            docs.set(ref._path, { ...data });
          }
        },
      };
      try {
        await fn(t);
      } finally {
        txInProgress = false;
        const next = txQueue.shift();
        if (next) next();
      }
    },
  };
  return db;
}

function createDeps(
  db: MockDb,
  consumers: string[] = [],
): SdsCompletionDeps {
  const dispatched: string[] = [];
  return {
    db: db as any,
    async enqueueConsumer(name: string, payload: Record<string, unknown>) {
      dispatched.push(name);
    },
    async runSelectionPass(marketDate: string) {},
    async runSettlementPass(marketDate: string, symbols?: string[]) {},
    async startRhAgentRun(marketDate: string, triggeredBy: string) {},
    _dispatched: dispatched,
  } as any;
}

const SDS_RUNS = 'symbol-data-sync-runs';
const SDS_SEQUENCES = 'symbol-data-sync-sequences';

function seedRunDoc(
  db: MockDb,
  runId: string,
  overrides: Partial<Record<string, unknown>> = {},
) {
  const path = `${SDS_RUNS}/${runId}`;
  db.docs.set(path, {
    runId,
    marketDate: '2026-08-22',
    interval: 'DAILY',
    sequence: 'A',
    sequenceRunId: '2026-08-22-POST-A',
    symbols: ['AAPL', 'MSFT', 'GOOG'],
    processedSymbols: [],
    status: 'processing',
    completionEnqueued: false,
    startedAt: new Date(Date.now() - 5 * 60 * 1000),
    lastActivityAt: new Date(Date.now() - 5 * 60 * 1000),
    ...overrides,
  });
}

function seedSequenceDoc(
  db: MockDb,
  sequenceRunId: string,
  overrides: Partial<Record<string, unknown>> = {},
) {
  const path = `${SDS_SEQUENCES}/${sequenceRunId}`;
  db.docs.set(path, {
    sequenceRunId,
    marketDate: '2026-08-22',
    sequence: 'A',
    intervalRunIds: {
      DAILY: '2026-08-22-SAT-POST-A-1335-DAILY',
      WEEKLY: '2026-08-22-SAT-POST-A-1335-WEEKLY',
      MONTHLY: '2026-08-22-SAT-POST-A-1335-MONTHLY',
    },
    completedIntervals: [],
    status: 'processing',
    completionEnqueued: false,
    startedAt: new Date(Date.now() - 5 * 60 * 1000),
    completedAt: null,
    ...overrides,
  });
}

// ── Tests: checkSyncRunCompletion (per-interval) ─────────────────────

describe('checkSyncRunCompletion — per-interval', () => {
  let db: MockDb;
  let deps: SdsCompletionDeps & { _dispatched: string[] };

  beforeEach(() => {
    db = createMockDb();
    deps = createDeps(db) as any;
  });

  it('marks run complete when processedSymbols.length >= symbols.length', async () => {
    seedRunDoc(db, 'run-1', { processedSymbols: ['AAPL', 'MSFT', 'GOOG'] });
    const ctx: RunContext = {
      runId: 'run-1',
      sequenceRunId: 'seq-1',
      interval: 'DAILY',
      sequence: 'A',
      marketDate: '2026-08-22',
      phase: 'post',
    };
    await checkSyncRunCompletion(ctx, deps);
    const runDoc = db.docs.get(`${SDS_RUNS}/run-1`)!;
    assert.equal(runDoc.status, 'completed');
    assert.ok(runDoc.completedAt, 'completedAt should be set');
  });

  it('does not mark complete when processedSymbols.length < symbols.length', async () => {
    seedRunDoc(db, 'run-1', { processedSymbols: ['AAPL', 'MSFT'] });
    const ctx: RunContext = {
      runId: 'run-1',
      sequenceRunId: 'seq-1',
      interval: 'DAILY',
      sequence: 'A',
      marketDate: '2026-08-22',
      phase: 'post',
    };
    await checkSyncRunCompletion(ctx, deps);
    const runDoc = db.docs.get(`${SDS_RUNS}/run-1`)!;
    assert.equal(runDoc.status, 'processing');
  });

  it('updates sequence doc completedIntervals when interval completes', async () => {
    seedRunDoc(db, 'run-1', { processedSymbols: ['AAPL', 'MSFT', 'GOOG'] });
    seedSequenceDoc(db, 'seq-1', { completedIntervals: [] });
    const ctx: RunContext = {
      runId: 'run-1',
      sequenceRunId: 'seq-1',
      interval: 'DAILY',
      sequence: 'A',
      marketDate: '2026-08-22',
      phase: 'post',
    };
    await checkSyncRunCompletion(ctx, deps);
    const seqDoc = db.docs.get(`${SDS_SEQUENCES}/seq-1`)!;
    assert.ok((seqDoc.completedIntervals as string[]).includes('DAILY'));
  });

  it('is retry-proof — duplicate processedSymbols do not inflate completion', async () => {
    // Simulate: AAPL processed twice (retry), MSFT and GOOG once each
    seedRunDoc(db, 'run-1', { processedSymbols: ['AAPL', 'AAPL', 'MSFT', 'GOOG'] });
    const ctx: RunContext = {
      runId: 'run-1',
      sequenceRunId: 'seq-1',
      interval: 'DAILY',
      sequence: 'A',
      marketDate: '2026-08-22',
      phase: 'post',
    };
    await checkSyncRunCompletion(ctx, deps);
    const runDoc = db.docs.get(`${SDS_RUNS}/run-1`)!;
    assert.equal(runDoc.status, 'completed');
  });

  it('is idempotent — does not re-complete a terminal run', async () => {
    seedRunDoc(db, 'run-1', { processedSymbols: ['AAPL', 'MSFT', 'GOOG'], status: 'completed' });
    const ctx: RunContext = {
      runId: 'run-1',
      sequenceRunId: 'seq-1',
      interval: 'DAILY',
      sequence: 'A',
      marketDate: '2026-08-22',
      phase: 'post',
    };
    await checkSyncRunCompletion(ctx, deps);
    assert.equal(deps._dispatched.length, 0);
  });

  it('handles empty symbols array — completes but does not fire sequence fan-in', async () => {
    seedRunDoc(db, 'run-empty', {
      symbols: [],
      processedSymbols: [],
    });
    const ctx: RunContext = {
      runId: 'run-empty',
      sequenceRunId: 'seq-empty',
      interval: 'DAILY',
      sequence: 'B',
      marketDate: '2026-08-22',
      phase: 'post',
    };
    await checkSyncRunCompletion(ctx, deps);
    const runDoc = db.docs.get(`${SDS_RUNS}/run-empty`)!;
    assert.equal(runDoc.status, 'completed');
    assert.equal(deps._dispatched.length, 0, 'should not dispatch consumers for empty run');
  });
});

// ── Tests: fireSequenceCompletion (fan-in) ───────────────────────────

describe('fireSequenceCompletion — sequence fan-in', () => {
  let db: MockDb;
  let deps: SdsCompletionDeps & { _dispatched: string[] };

  beforeEach(() => {
    db = createMockDb();
    deps = createDeps(db) as any;
  });

  it('fires sequence completion when all 3 intervals complete', async () => {
    seedSequenceDoc(db, 'seq-1', {
      completedIntervals: ['DAILY', 'WEEKLY', 'MONTHLY'],
    });
    const ctx: SequenceContext = {
      sequenceRunId: 'seq-1',
      sequence: 'A',
      marketDate: '2026-08-22',
    };
    await fireSequenceCompletion(ctx, deps);
    const seqDoc = db.docs.get(`${SDS_SEQUENCES}/seq-1`)!;
    assert.equal(seqDoc.status, 'completed');
    assert.equal(seqDoc.completionEnqueued, true);
    assert.ok(seqDoc.completedAt);
  });

  it('does not fire when only 2 of 3 intervals complete', async () => {
    seedSequenceDoc(db, 'seq-1', {
      completedIntervals: ['DAILY', 'WEEKLY'],
    });
    const ctx: SequenceContext = {
      sequenceRunId: 'seq-1',
      sequence: 'A',
      marketDate: '2026-08-22',
    };
    await fireSequenceCompletion(ctx, deps);
    const seqDoc = db.docs.get(`${SDS_SEQUENCES}/seq-1`)!;
    assert.equal(seqDoc.status, 'processing');
    assert.equal(seqDoc.completionEnqueued, false);
  });

  it('is idempotent — does not re-fire a completed sequence', async () => {
    seedSequenceDoc(db, 'seq-1', {
      completedIntervals: ['DAILY', 'WEEKLY', 'MONTHLY'],
      status: 'completed',
      completionEnqueued: true,
    });
    const ctx: SequenceContext = {
      sequenceRunId: 'seq-1',
      sequence: 'A',
      marketDate: '2026-08-22',
    };
    await fireSequenceCompletion(ctx, deps);
    assert.equal(deps._dispatched.length, 0);
  });

  it('sets completed_but_not_dispatched if enqueue fails', async () => {
    seedSequenceDoc(db, 'seq-1', {
      completedIntervals: ['DAILY', 'WEEKLY', 'MONTHLY'],
    });
    const failingDeps: SdsCompletionDeps = {
      db: db as any,
      async enqueueConsumer() { throw new Error('enqueue failed'); },
      async runSelectionPass() {},
      async runSettlementPass() {},
      async startRhAgentRun() {},
    };
    const ctx: SequenceContext = {
      sequenceRunId: 'seq-1',
      sequence: 'A',
      marketDate: '2026-08-22',
    };
    await fireSequenceCompletion(ctx, failingDeps);
    const seqDoc = db.docs.get(`${SDS_SEQUENCES}/seq-1`)!;
    assert.equal(seqDoc.status, 'completed_but_not_dispatched');
    assert.equal(seqDoc.completionEnqueued, false);
  });
});

// ── Tests: POST A downstream consumers ───────────────────────────────

describe('fireSequenceCompletion — POST A consumers', () => {
  let db: MockDb;
  let deps: SdsCompletionDeps & { _dispatched: string[] };

  beforeEach(() => {
    db = createMockDb();
    deps = createDeps(db) as any;
  });

  it('dispatches selection, settlement, and RH Agent nightly for POST A', async () => {
    seedSequenceDoc(db, 'seq-1', {
      completedIntervals: ['DAILY', 'WEEKLY', 'MONTHLY'],
      sequence: 'A',
    });
    const ctx: SequenceContext = {
      sequenceRunId: 'seq-1',
      sequence: 'A',
      marketDate: '2026-08-22',
    };
    await fireSequenceCompletion(ctx, deps);
    assert.ok(deps._dispatched.includes('selection'));
    assert.ok(deps._dispatched.includes('settlement'));
    assert.ok(deps._dispatched.includes('rh-agent-nightly'));
  });
});

// ── Tests: POST B/C downstream consumers ─────────────────────────────

describe('fireSequenceCompletion — POST B/C consumers', () => {
  let db: MockDb;
  let deps: SdsCompletionDeps & { _dispatched: string[] };

  beforeEach(() => {
    db = createMockDb();
    deps = createDeps(db) as any;
  });

  it('dispatches scoped settlement and scoped RH Agent for POST B', async () => {
    seedSequenceDoc(db, 'seq-1', {
      completedIntervals: ['DAILY', 'WEEKLY', 'MONTHLY'],
      sequence: 'B',
    });
    const ctx: SequenceContext = {
      sequenceRunId: 'seq-1',
      sequence: 'B',
      marketDate: '2026-08-22',
    };
    await fireSequenceCompletion(ctx, deps);
    assert.ok(deps._dispatched.includes('settlement-scoped'));
    assert.ok(deps._dispatched.includes('rh-agent-nightly-scoped'));
    assert.ok(!deps._dispatched.includes('selection'));
  });

  it('dispatches scoped settlement and scoped RH Agent for POST C', async () => {
    seedSequenceDoc(db, 'seq-1', {
      completedIntervals: ['DAILY', 'WEEKLY', 'MONTHLY'],
      sequence: 'C',
    });
    const ctx: SequenceContext = {
      sequenceRunId: 'seq-1',
      sequence: 'C',
      marketDate: '2026-08-22',
    };
    await fireSequenceCompletion(ctx, deps);
    assert.ok(deps._dispatched.includes('settlement-scoped'));
    assert.ok(deps._dispatched.includes('rh-agent-nightly-scoped'));
    assert.ok(!deps._dispatched.includes('selection'));
  });
});

// ── Tests: Intraday completion ───────────────────────────────────────

describe('checkIntradayRunCompletion', () => {
  let db: MockDb;
  let deps: SdsCompletionDeps & { _dispatched: string[] };

  beforeEach(() => {
    db = createMockDb();
    deps = createDeps(db) as any;
  });

  it('marks intraday run complete and dispatches RH Agent intraday', async () => {
    seedRunDoc(db, 'intraday-run-1', {
      symbols: ['AAPL', 'MSFT', 'GOOG', 'TSLA', 'NVDA'],
      processedSymbols: ['AAPL', 'MSFT', 'GOOG', 'TSLA', 'NVDA'],
      phase: 'pre',
      interval: 'INTRADAY',
      sequenceRunId: null,
    });
    const ctx: RunContext = {
      runId: 'intraday-run-1',
      sequenceRunId: undefined,
      interval: 'INTRADAY',
      sequence: undefined,
      marketDate: '2026-08-22',
      phase: 'pre',
    };
    await checkIntradayRunCompletion(ctx, deps);
    const runDoc = db.docs.get(`${SDS_RUNS}/intraday-run-1`)!;
    assert.equal(runDoc.status, 'completed');
    assert.ok(deps._dispatched.includes('rh-agent-intraday'));
  });

  it('does not dispatch if intraday run not yet complete', async () => {
    seedRunDoc(db, 'intraday-run-1', {
      symbols: ['AAPL', 'MSFT', 'GOOG', 'TSLA', 'NVDA'],
      processedSymbols: ['AAPL', 'MSFT', 'GOOG'],
      phase: 'pre',
      interval: 'INTRADAY',
      sequenceRunId: null,
    });
    const ctx: RunContext = {
      runId: 'intraday-run-1',
      sequenceRunId: undefined,
      interval: 'INTRADAY',
      sequence: undefined,
      marketDate: '2026-08-22',
      phase: 'pre',
    };
    await checkIntradayRunCompletion(ctx, deps);
    assert.equal(deps._dispatched.length, 0);
  });
});

// ── Tests: Watchdog ──────────────────────────────────────────────────

describe('runWatchdog', () => {
  let db: MockDb;
  let deps: SdsCompletionDeps & { _dispatched: string[] };

  beforeEach(() => {
    db = createMockDb();
    deps = createDeps(db) as any;
  });

  it('forces completion for stale runs (>5 min since last activity)', async () => {
    const stale = new Date(Date.now() - 7 * 60 * 1000);
    seedRunDoc(db, 'stale-run-1', {
      symbols: ['AAPL', 'MSFT', 'GOOG', 'TSLA', 'NVDA'],
      processedSymbols: ['AAPL', 'MSFT'],
      startedAt: stale,
      lastActivityAt: stale,
      status: 'processing',
    });
    seedSequenceDoc(db, 'seq-1', {
      completedIntervals: [],
      intervalRunIds: { DAILY: 'stale-run-1' },
    });
    await runWatchdog(deps);
    const runDoc = db.docs.get(`${SDS_RUNS}/stale-run-1`)!;
    assert.equal(runDoc.status, 'forced_complete');
  });

  it('force-completes a run and triggers sequence completion when all intervals done', async () => {
    const stale = new Date(Date.now() - 7 * 60 * 1000);
    seedRunDoc(db, 'stale-run-1', {
      symbols: ['AAPL', 'MSFT', 'GOOG'],
      processedSymbols: ['AAPL', 'MSFT'],
      startedAt: stale,
      lastActivityAt: stale,
      status: 'processing',
      interval: 'MONTHLY',
      sequenceRunId: 'seq-1',
    });
    seedSequenceDoc(db, 'seq-1', {
      completedIntervals: ['DAILY', 'WEEKLY'],
      intervalRunIds: { DAILY: 'run-daily', WEEKLY: 'run-weekly', MONTHLY: 'stale-run-1' },
    });
    await runWatchdog(deps);
    const seqDoc = db.docs.get(`${SDS_SEQUENCES}/seq-1`)!;
    assert.ok((seqDoc.completedIntervals as string[]).includes('MONTHLY'));
    assert.equal(seqDoc.status, 'completed');
    assert.ok(deps._dispatched.length > 0, 'consumers should be dispatched');
  });

  it('does not force-complete fresh runs (<5 min since last activity)', async () => {
    const fresh = new Date(Date.now() - 2 * 60 * 1000);
    seedRunDoc(db, 'fresh-run-1', {
      symbols: ['AAPL', 'MSFT', 'GOOG', 'TSLA', 'NVDA'],
      processedSymbols: ['AAPL', 'MSFT'],
      startedAt: fresh,
      lastActivityAt: fresh,
      status: 'processing',
    });
    await runWatchdog(deps);
    const runDoc = db.docs.get(`${SDS_RUNS}/fresh-run-1`)!;
    assert.equal(runDoc.status, 'processing');
  });

  it('does not force-complete a run with old startedAt but recent lastActivityAt', async () => {
    seedRunDoc(db, 'active-run-1', {
      symbols: Array.from({ length: 100 }, (_, i) => `SYM${i}`),
      processedSymbols: ['SYM0', 'SYM1'],
      startedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
      lastActivityAt: new Date(Date.now() - 30 * 1000), // 30 sec ago — still active
      status: 'processing',
    });
    await runWatchdog(deps);
    const runDoc = db.docs.get(`${SDS_RUNS}/active-run-1`)!;
    assert.equal(runDoc.status, 'processing');
  });

  it('forces completion for stale sequences (>8 min)', async () => {
    const stale = new Date(Date.now() - 10 * 60 * 1000);
    seedSequenceDoc(db, 'stale-seq-1', {
      completedIntervals: ['DAILY', 'WEEKLY', 'MONTHLY'],
      startedAt: stale,
      status: 'processing',
    });
    await runWatchdog(deps);
    const seqDoc = db.docs.get(`${SDS_SEQUENCES}/stale-seq-1`)!;
    assert.equal(seqDoc.status, 'completed');
    assert.equal(seqDoc.completionEnqueued, true);
    assert.ok(deps._dispatched.length > 0, 'consumers should be dispatched');
  });

  it('retries completed_but_not_dispatched sequences and succeeds', async () => {
    seedSequenceDoc(db, 'seq-1', {
      completedIntervals: ['DAILY', 'WEEKLY', 'MONTHLY'],
      status: 'completed_but_not_dispatched',
      completionEnqueued: false,
    });
    await runWatchdog(deps);
    const seqDoc = db.docs.get(`${SDS_SEQUENCES}/seq-1`)!;
    assert.equal(seqDoc.status, 'completed');
    assert.equal(seqDoc.completionEnqueued, true);
    assert.ok(deps._dispatched.length > 0, 'consumers should be dispatched on retry');
  });

  it('retries completed_but_not_dispatched runs (intraday)', async () => {
    seedRunDoc(db, 'intraday-stuck', {
      symbols: ['AAPL', 'MSFT', 'GOOG', 'TSLA', 'NVDA'],
      processedSymbols: ['AAPL', 'MSFT', 'GOOG', 'TSLA', 'NVDA'],
      phase: 'pre',
      interval: 'INTRADAY',
      sequenceRunId: null,
      status: 'completed_but_not_dispatched',
      completionEnqueued: false,
    });
    await runWatchdog(deps);
    const runDoc = db.docs.get(`${SDS_RUNS}/intraday-stuck`)!;
    assert.ok(deps._dispatched.includes('rh-agent-intraday'), 'intraday consumer should be retried');
  });
});

// ── Tests: Firestore Timestamp format ────────────────────────────────

describe('runWatchdog — Firestore Timestamp format', () => {
  let db: MockDb;
  let deps: SdsCompletionDeps & { _dispatched: string[] };

  beforeEach(() => {
    db = createMockDb();
    deps = createDeps(db) as any;
  });

  it('handles Firestore Timestamp objects for startedAt', async () => {
    const staleSeconds = Math.floor((Date.now() - 7 * 60 * 1000) / 1000);
    seedRunDoc(db, 'ts-run-1', {
      symbols: ['AAPL', 'MSFT', 'GOOG', 'TSLA', 'NVDA'],
      processedSymbols: ['AAPL', 'MSFT'],
      startedAt: { _seconds: staleSeconds, _nanoseconds: 0 },
      lastActivityAt: { _seconds: staleSeconds, _nanoseconds: 0 },
      status: 'processing',
    });
    seedSequenceDoc(db, 'seq-1', {
      completedIntervals: [],
      intervalRunIds: { DAILY: 'ts-run-1' },
    });
    await runWatchdog(deps);
    const runDoc = db.docs.get(`${SDS_RUNS}/ts-run-1`)!;
    assert.equal(runDoc.status, 'forced_complete');
  });
});

// ── Tests: Concurrent completion ─────────────────────────────────────

describe('concurrent completion — no duplicate dispatch', () => {
  let db: MockDb;
  let deps: SdsCompletionDeps & { _dispatched: string[] };

  beforeEach(() => {
    db = createMockDb();
    deps = createDeps(db) as any;
  });

  it('only one caller wins when two intervals complete simultaneously', async () => {
    // Seed a sequence with DAILY already complete, WEEKLY and MONTHLY
    // about to complete simultaneously
    seedSequenceDoc(db, 'seq-1', {
      completedIntervals: ['DAILY'],
    });

    // Seed two runs that are both complete
    seedRunDoc(db, 'run-weekly', {
      symbols: ['AAPL', 'MSFT', 'GOOG'],
      processedSymbols: ['AAPL', 'MSFT', 'GOOG'],
      interval: 'WEEKLY',
    });
    seedRunDoc(db, 'run-monthly', {
      symbols: ['AAPL', 'MSFT', 'GOOG'],
      processedSymbols: ['AAPL', 'MSFT', 'GOOG'],
      interval: 'MONTHLY',
    });

    // Both intervals complete simultaneously
    const ctxWeekly: RunContext = {
      runId: 'run-weekly',
      sequenceRunId: 'seq-1',
      interval: 'WEEKLY',
      sequence: 'A',
      marketDate: '2026-08-22',
      phase: 'post',
    };
    const ctxMonthly: RunContext = {
      runId: 'run-monthly',
      sequenceRunId: 'seq-1',
      interval: 'MONTHLY',
      sequence: 'A',
      marketDate: '2026-08-22',
      phase: 'post',
    };

    await Promise.all([
      checkSyncRunCompletion(ctxWeekly, deps),
      checkSyncRunCompletion(ctxMonthly, deps),
    ]);

    // The sequence should be completed, and consumers should be dispatched
    // exactly once (3 consumers for POST A: selection, settlement, rh-agent-nightly)
    const seqDoc = db.docs.get(`${SDS_SEQUENCES}/seq-1`)!;
    assert.equal(seqDoc.status, 'completed');
    // Count consumer dispatches — should be exactly 1 each, not 2
    const selectionCount = deps._dispatched.filter((c: string) => c === 'selection').length;
    const settlementCount = deps._dispatched.filter((c: string) => c === 'settlement').length;
    const rhAgentCount = deps._dispatched.filter((c: string) => c === 'rh-agent-nightly').length;
    assert.equal(selectionCount, 1, 'selection should be dispatched exactly once');
    assert.equal(settlementCount, 1, 'settlement should be dispatched exactly once');
    assert.equal(rhAgentCount, 1, 'rh-agent-nightly should be dispatched exactly once');
  });
});
