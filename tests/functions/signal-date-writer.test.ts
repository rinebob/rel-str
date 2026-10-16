/**
 * @topic #984 — ST Firestore Reorg
 *
 * Unit tests for SignalDateWriter's canonical `st-signals` dual-write
 * (task #1000): one upserted occurrence doc per {symbol, barDate,
 * signalType}, minted via stSignalOccurrenceId, alongside the legacy
 * run-ids / signal-history / gate-date writes — runIds arrayUnion on
 * re-detection, status from barStatus (already resolved upstream),
 * marketDate + sourceRunId written on create only.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SignalDateWriter, SignalDateWriterDeps } from '../../functions/src/st-cloud-function/signal-date-writer';
import { StSignalEntry, StSignalDirection } from '../../functions/src/st-cloud-function/signals';
import type { StSignal } from '../../shared/st-signals';
import { TradeSide } from '../../shared/common';

type WriterDb = NonNullable<SignalDateWriterDeps['db']>;

// ── Sentinel FieldValue + minimal fake Firestore ─────────────────────────────

const NOW = '2026-10-15T01:00:00.000Z';
const TS = '__TS__';

const FV = {
  serverTimestamp: () => TS,
  arrayUnion: (...items: unknown[]) => ({ __arrayUnion: items }),
};

function resolveSentinels(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === TS) {
      out[key] = NOW;
    } else if (
      typeof value === 'object' &&
      value !== null &&
      '__arrayUnion' in value
    ) {
      const prev = Array.isArray(out[key]) ? (out[key] as unknown[]) : [];
      const items = (value as { __arrayUnion: unknown[] }).__arrayUnion;
      out[key] = [...prev, ...items.filter((i) => !prev.includes(i))];
    } else {
      out[key] = value;
    }
  }
  return out;
}

function createFakeDb(initial: Record<string, Record<string, unknown>> = {}) {
  const store = new Map<string, Record<string, unknown>>(Object.entries(initial));
  const refPaths = new WeakMap<object, string>();
  const committedOps: { path: string; data: Record<string, unknown>; merge: boolean }[][] = [];

  const makeDocRef = (path: string) => {
    const ref = {
      id: path.split('/').pop()!,
      path,
      collection: (sub: string) => ({ doc: (id: string) => makeDocRef(`${path}/${sub}/${id}`) }),
      get: async () => {
        const data = store.get(path);
        return { exists: data !== undefined, id: path.split('/').pop()!, data: () => data };
      },
    };
    refPaths.set(ref, path);
    return ref;
  };

  const db = {
    collection: (path: string) => ({ doc: (id: string) => makeDocRef(`${path}/${id}`) }),
    doc: (path: string) => makeDocRef(path),
    batch: () => {
      const ops: { path: string; data: Record<string, unknown>; merge: boolean }[] = [];
      return {
        set: (
          ref: { id: string },
          data: Record<string, unknown>,
          opts?: { merge?: boolean },
        ) => ops.push({ path: refPaths.get(ref) ?? ref.id, data, merge: opts?.merge === true }),
        commit: async () => {
          committedOps.push(ops);
          for (const op of ops) {
            const existing = store.get(op.path) ?? {};
            store.set(op.path, op.merge ? resolveSentinels(existing, op.data) : resolveSentinels({}, op.data));
          }
        },
      };
    },
  };

  const stored = (path: string) => store.get(path);
  return { db: db as unknown as WriterDb, store, stored, committedOps };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DAILY_LONG: StSignalEntry = {
  signalType: 'D_ST_TREND_RIDER_V1_LONG',
  timeframe: 'D',
  direction: StSignalDirection.LONG,
  status: 'INTERIM',
  barDate: '2026-10-14',
  marketDate: '2026-10-14',
  indicators: { rs: 12.3 },
};

const OCC_ID = 'ADPT_2026-10-14_D_ST_TREND_RIDER_V1_LONG';
const OCC_PATH = `st-signals/${OCC_ID}`;

function writerFor(db: WriterDb, errors?: string[]) {
  return new SignalDateWriter('ADPT', {
    db,
    fieldValue: FV,
    logger: errors ? { error: (m: string) => errors.push(m) } : undefined,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('SignalDateWriter st-signals dual-write (#1000)', () => {
  it('creates the occurrence doc on first detection alongside legacy writes', async () => {
    const { db, stored, committedOps } = createFakeDb();
    await writerFor(db).persistBarDate('run-1', '2026-10-14T16:00:00Z', '2026-10-14', [DAILY_LONG]);

    const doc = stored(OCC_PATH) as StSignal & Record<string, unknown>;
    assert.ok(doc, 'st-signals occurrence doc exists');
    assert.equal(doc.symbol, 'ADPT');
    assert.equal(doc.signalType, 'D_ST_TREND_RIDER_V1_LONG');
    assert.equal(doc.barDate, '2026-10-14');
    assert.equal(doc.marketDate, '2026-10-14');
    assert.equal(doc.direction, TradeSide.LONG);
    assert.equal(doc.timeframe, 'D');
    assert.deepEqual(doc.indicators, { rs: 12.3 });
    assert.equal(doc.status, 'INTERIM');
    assert.equal(doc.sourceRunId, 'run-1');
    assert.deepEqual(doc.runIds, ['run-1']);
    assert.deepEqual(doc.ticketIds, []);
    assert.deepEqual(doc.positionGroupIds, []);
    assert.equal(doc.createdAt, NOW);
    assert.equal(doc.updatedAt, NOW);

    // Legacy writes still land in the same commit (dual-write).
    const paths = committedOps.flat().map((o) => o.path);
    assert.ok(paths.some((p) => p.includes('run-ids/run-1')), 'run-ids doc written');
    assert.ok(paths.some((p) => p === 'savant-trader/data/symbols/ADPT'), 'gate-date update written');
  });

  it('appends runIds on re-detection; marketDate/sourceRunId unchanged', async () => {
    const { db, stored } = createFakeDb();
    const w = writerFor(db);
    await w.persistBarDate('run-1', '2026-10-14T16:00:00Z', '2026-10-14', [DAILY_LONG]);
    await w.persistBarDate('run-2', '2026-10-15T16:00:00Z', '2026-10-15', [DAILY_LONG]);

    const doc = stored(OCC_PATH) as StSignal;
    assert.deepEqual(doc.runIds, ['run-1', 'run-2']);
    assert.equal(doc.sourceRunId, 'run-1', 'sourceRunId is create-only');
    assert.equal(doc.marketDate, '2026-10-14', 'marketDate is create-only');
  });

  it('arrayUnion dedupes a same-runId rewrite', async () => {
    const { db, stored } = createFakeDb();
    const w = writerFor(db);
    await w.persistBarDate('run-1', '2026-10-14T16:00:00Z', '2026-10-14', [DAILY_LONG]);
    await w.persistBarDate('run-1', '2026-10-14T16:00:00Z', '2026-10-14', [DAILY_LONG]);
    assert.deepEqual((stored(OCC_PATH) as StSignal).runIds, ['run-1']);
  });

  it('nightly CONFIRMED entry upgrades status while create-only fields hold', async () => {
    const { db, stored } = createFakeDb();
    const w = writerFor(db);
    await w.persistBarDate('run-1', '2026-10-14T16:00:00Z', '2026-10-14', [DAILY_LONG]);
    await w.persistBarDate('run-nightly', '2026-10-15T01:00:00Z', '2026-10-14', [
      { ...DAILY_LONG, status: 'CONFIRMED' },
    ], 'nightly');

    const doc = stored(OCC_PATH) as StSignal;
    assert.equal(doc.status, 'CONFIRMED', 'INTERIM → CONFIRMED on bar close');
    assert.equal(doc.sourceRunId, 'run-1');
    assert.deepEqual(doc.runIds, ['run-1', 'run-nightly']);
  });

  it('normalizes legacy LONG/SHORT direction to TradeSide', async () => {
    const { db, stored } = createFakeDb();
    await writerFor(db).persistBarDate('run-1', '2026-10-14T16:00:00Z', '2026-10-14', [
      { ...DAILY_LONG, signalType: 'D_ST_TREND_RIDER_V1_SHORT', direction: StSignalDirection.SHORT },
    ]);
    const doc = stored('st-signals/ADPT_2026-10-14_D_ST_TREND_RIDER_V1_SHORT') as StSignal;
    assert.equal(doc.direction, TradeSide.SHORT);
  });

  it('mints separate docs per signalType for one barDate', async () => {
    const { db, stored } = createFakeDb();
    await writerFor(db).persistBarDate('run-1', '2026-10-14T16:00:00Z', '2026-10-14', [
      DAILY_LONG,
      { ...DAILY_LONG, signalType: 'D_ST_TREND_RIDER_V1_SHORT', direction: StSignalDirection.SHORT },
    ]);
    assert.ok(stored(OCC_PATH));
    assert.ok(stored('st-signals/ADPT_2026-10-14_D_ST_TREND_RIDER_V1_SHORT'));
  });

  it('fail-soft: a malformed entry is logged and skipped — legacy writes still commit', async () => {
    const { db, stored, committedOps } = createFakeDb();
    const errors: string[] = [];
    // A corrupt upstream bar date reaches the id builder's validation throw.
    const bad = { ...DAILY_LONG, signalType: 'D_ST_TREND_RIDER_V1_SHORT', barDate: 'garbageXXX' };
    await writerFor(db, errors).persistBarDate('run-1', '2026-10-14T16:00:00Z', '2026-10-14', [
      DAILY_LONG,
      bad,
    ]);

    assert.ok(stored(OCC_PATH), 'good entry still wrote its occurrence doc');
    assert.ok(!stored('st-signals/ADPT_garbageXXX_D_ST_TREND_RIDER_V1_SHORT'), 'bad entry skipped');
    const paths = committedOps.flat().map((o) => o.path);
    assert.ok(paths.some((p) => p.includes('run-ids/run-1')), 'legacy run-ids write still committed');
    assert.equal(errors.length, 1, 'skip was logged');
    assert.match(errors[0], /unwritable occurrence/);
  });

  it('fail-soft: a failed existence read logs without aborting the batch', async () => {
    const { db, stored, committedOps } = createFakeDb();
    const errors: string[] = [];
    // Make every st-signals get() fail — simulates a transient Firestore error.
    const origCollection = db.collection;
    (db as any).collection = (path: string) => {
      const col = origCollection(path);
      return path === 'st-signals'
        ? { doc: (id: string) => { const ref = col.doc(id); return { ...ref, get: async () => { throw new Error('transient'); } }; } }
        : col;
    };
    await writerFor(db, errors).persistBarDate('run-1', '2026-10-14T16:00:00Z', '2026-10-14', [DAILY_LONG]);

    assert.ok(!stored(OCC_PATH), 'occurrence skipped on read failure');
    const paths = committedOps.flat().map((o) => o.path);
    assert.ok(paths.some((p) => p.includes('run-ids/run-1')), 'legacy run-ids write still committed');
    assert.equal(errors.length, 1);
  });
});
