/**
 * @topic #984 — ST Firestore Reorg (task #1004)
 *
 * Unit tests for StPositionGroupWriter: canonical `st-position-groups`
 * creation + membership. create() allocates `{SYM}-{YYMMDD}-grp-{NN}` via
 * create()+ALREADY_EXISTS retry — an id-collision on the same origin is a
 * retried accept and adopts the existing doc; a different origin takes the
 * next seq. Fail-soft like StOrderTicketWriter: failures return null/false
 * with a warn/error log, never throw into the calling accept path.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  StPositionGroupWriter,
  type StPositionGroupWriterDeps,
  type EmitPositionGroupInput,
} from '../../../functions/src/position-groups/st-position-group-writer';
import type { StPositionGroup } from '../../../shared/st-position-groups';
import { ST_POSITION_GROUPS_ROOT } from '../../../shared/st-collections';

type WriterDb = NonNullable<StPositionGroupWriterDeps['db']>;

const NOW = '2026-10-20T20:00:00.000Z';
const ID_DATE = new Date('2026-10-20T12:00:00Z'); // YYMMDD 261020

function emit(overrides: Partial<EmitPositionGroupInput> = {}): EmitPositionGroupInput {
  return {
    symbol: 'QQQM',
    idDate: ID_DATE,
    origin: { type: 'signal', signalId: 'QQQM_2026-10-20_D_ST_TREND_RIDER_V1_LONG' },
    mode: 'paper',
    userId: 'u1',
    memberTicketIds: ['pap_261020-sig-QQQM-EQ'],
    memberTradeIds: ['261020-sig-QQQM-EQ'],
    now: NOW,
    ...overrides,
  };
}

// ── Minimal fake Firestore (same seam as st-order-ticket-writer tests) ──────

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
    collection: (path: string) => ({ doc: (id: string) => makeDocRef(`${path}/${id}`) }),
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
    stored: (path: string) => store.get(path) as StPositionGroup | undefined,
  };
}

const docPath = (id: string) => `${ST_POSITION_GROUPS_ROOT}/${id}`;

// ── create() ────────────────────────────────────────────────────────────────

describe('StPositionGroupWriter.create', () => {
  it('creates {SYM}-{YYMMDD}-grp-01 with the full canonical shape', async () => {
    const f = createFakeDb();
    const w = new StPositionGroupWriter({ db: f.db, logger: f.logger });
    const id = await w.create(emit({ rollups: { openCount: 1, closedCount: 0 } }));

    assert.equal(id, 'QQQM-261020-grp-01');
    const g = f.stored(docPath(id!))!;
    assert.equal(g.id, id);
    assert.deepEqual(g.origin, {
      type: 'signal',
      signalId: 'QQQM_2026-10-20_D_ST_TREND_RIDER_V1_LONG',
    });
    assert.equal(g.mode, 'paper');
    assert.equal(g.userId, 'u1');
    assert.deepEqual(g.memberTicketIds, ['pap_261020-sig-QQQM-EQ']);
    assert.deepEqual(g.memberTradeIds, ['261020-sig-QQQM-EQ']);
    assert.deepEqual(g.brokerOrderIds, []);
    assert.equal(g.status, 'open');
    assert.deepEqual(g.rollups, { openCount: 1, closedCount: 0 });
    assert.equal(g.createdAt, NOW);
    assert.equal(g.updatedAt, NOW);
  });

  it('defaults member arrays/rollups when not supplied', async () => {
    const f = createFakeDb();
    const w = new StPositionGroupWriter({ db: f.db, logger: f.logger });
    const id = await w.create(emit({ memberTicketIds: undefined, memberTradeIds: undefined }));
    const g = f.stored(docPath(id!))!;
    assert.deepEqual(g.memberTicketIds, []);
    assert.deepEqual(g.memberTradeIds, []);
    assert.deepEqual(g.rollups, { openCount: 0, closedCount: 0 });
    assert.equal(g.status, 'open');
  });

  it('adopts an existing doc on id collision when the origin matches (retried accept)', async () => {
    const f = createFakeDb();
    const w = new StPositionGroupWriter({ db: f.db, logger: f.logger });
    const first = await w.create(emit());
    const second = await w.create(emit()); // same symbol/date/origin
    assert.equal(second, first, 'retry returns the same group id — no sibling grp-02');
    assert.ok(f.stored(docPath('QQQM-261020-grp-02')) === undefined);
  });

  it('takes the next seq on id collision with a different origin', async () => {
    const f = createFakeDb();
    const w = new StPositionGroupWriter({ db: f.db, logger: f.logger });
    await w.create(emit());
    const other = await w.create(
      emit({ origin: { type: 'signal', signalId: 'QQQM_2026-10-20_W_ST_TREND_RIDER_V2_LONG' } }),
    );
    assert.equal(other, 'QQQM-261020-grp-02');
  });

  it('adopts when the existing doc carries extra members (superset — e.g. brokerOrderIds unioned by a fill)', async () => {
    const f = createFakeDb();
    const w = new StPositionGroupWriter({ db: f.db, logger: f.logger });
    const first = await w.create(emit());
    // A fill join unions a broker order onto the live group doc.
    await w.addMembers(first!, { brokerOrderIds: ['rh-ord-9'] }, NOW);
    // The retried accept re-mints the same declared members — still the
    // same logical group even though the doc now holds more.
    const second = await w.create(emit());
    assert.equal(second, first);
    assert.ok(f.stored(docPath('QQQM-261020-grp-02')) === undefined);
  });

  it('takes the next seq when the origin matches but members differ (distinct manual accepts)', async () => {
    const f = createFakeDb();
    const w = new StPositionGroupWriter({ db: f.db, logger: f.logger });
    const manual = emit({ origin: { type: 'manual' } });
    const first = await w.create(manual);
    // A second, distinct manual accept for the same symbol+day mints
    // different member ids — identical origin must NOT adopt grp-01.
    const second = await w.create(
      emit({
        origin: { type: 'manual' },
        memberTicketIds: ['pap_261020-sig-QQQM-EQ-2'],
        memberTradeIds: ['261020-sig-QQQM-EQ-2'],
      }),
    );
    assert.equal(first, 'QQQM-261020-grp-01');
    assert.equal(second, 'QQQM-261020-grp-02');
    assert.equal(f.stored(docPath('QQQM-261020-grp-01'))?.memberTradeIds[0], '261020-sig-QQQM-EQ');
  });

  it('rejects unmintable input and returns null (fail-soft)', async () => {
    const f = createFakeDb();
    const w = new StPositionGroupWriter({ db: f.db, logger: f.logger });
    const id = await w.create(emit({ symbol: '' }));
    assert.equal(id, null);
    assert.ok(f.logs.some((l) => l.level === 'error'));
  });
});

// ── ensure() — known-id restore ──────────────────────────────────────────────

describe('StPositionGroupWriter.ensure', () => {
  const group = (): StPositionGroup => ({
    id: 'QQQM-261020-grp-01',
    origin: { type: 'signal', signalId: 'QQQM_2026-10-20_D_ST_TREND_RIDER_V1_LONG' },
    mode: 'paper',
    userId: 'u1',
    memberTicketIds: ['pap_261020-sig-QQQM-EQ'],
    memberTradeIds: ['261020-sig-QQQM-EQ'],
    brokerOrderIds: [],
    status: 'open',
    rollups: { openCount: 1, closedCount: 0 },
    createdAt: NOW,
    updatedAt: NOW,
  });

  it('writes the doc when missing and returns the id', async () => {
    const f = createFakeDb();
    const w = new StPositionGroupWriter({ db: f.db, logger: f.logger });
    assert.equal(await w.ensure(group()), 'QQQM-261020-grp-01');
    assert.equal(f.stored(docPath('QQQM-261020-grp-01'))?.memberTradeIds[0], '261020-sig-QQQM-EQ');
  });

  it('is a no-op when the doc already exists (never overwrites)', async () => {
    const existing = { ...group(), status: 'closed' as const };
    const f = createFakeDb({ [docPath(existing.id)]: existing as Record<string, unknown> });
    const w = new StPositionGroupWriter({ db: f.db, logger: f.logger });
    assert.equal(await w.ensure(group()), 'QQQM-261020-grp-01');
    assert.equal(f.stored(docPath(existing.id))?.status, 'closed', 'existing doc untouched');
  });
});

// ── addMembers() ─────────────────────────────────────────────────────────────

describe('StPositionGroupWriter.addMembers', () => {
  async function seeded() {
    const f = createFakeDb();
    const w = new StPositionGroupWriter({ db: f.db, logger: f.logger });
    const id = (await w.create(emit()))!;
    return { f, w, id };
  }

  it('unions new member ids without dropping existing ones', async () => {
    const { f, w, id } = await seeded();
    const ok = await w.addMembers(
      id,
      { ticketIds: ['pap_261020-sig-QQQM-CSP-030-45'], tradeIds: ['261020-sig-QQQM-CSP-030-45'] },
      '2026-10-20T21:00:00.000Z',
    );
    assert.equal(ok, true);
    const g = f.stored(docPath(id))!;
    assert.deepEqual(g.memberTicketIds, [
      'pap_261020-sig-QQQM-EQ',
      'pap_261020-sig-QQQM-CSP-030-45',
    ]);
    assert.deepEqual(g.memberTradeIds, [
      '261020-sig-QQQM-EQ',
      '261020-sig-QQQM-CSP-030-45',
    ]);
    assert.equal(g.updatedAt, '2026-10-20T21:00:00.000Z');
  });

  it('dedupes ids already present (idempotent re-join)', async () => {
    const { f, w, id } = await seeded();
    await w.addMembers(id, { tradeIds: ['261020-sig-QQQM-EQ', '261020-sig-QQQM-LC-050-30'] }, NOW);
    const g = f.stored(docPath(id))!;
    assert.deepEqual(g.memberTradeIds, ['261020-sig-QQQM-EQ', '261020-sig-QQQM-LC-050-30']);
  });

  it('unions brokerOrderIds for live-join attachment', async () => {
    const { f, w, id } = await seeded();
    await w.addMembers(id, { brokerOrderIds: ['rh-order-1', 'rh-order-2'] }, NOW);
    assert.deepEqual(f.stored(docPath(id))!.brokerOrderIds, ['rh-order-1', 'rh-order-2']);
  });

  it('returns false for a missing group doc (fail-soft)', async () => {
    const f = createFakeDb();
    const w = new StPositionGroupWriter({ db: f.db, logger: f.logger });
    assert.equal(await w.addMembers('NOPE-260101-grp-01', { tradeIds: ['x'] }, NOW), false);
    assert.ok(f.logs.some((l) => l.level === 'warn'));
  });
});

describe('addMembers rollups (#1005)', () => {
  async function seeded() {
    const f = createFakeDb();
    const w = new StPositionGroupWriter({ db: f.db, logger: f.logger });
    const id = (await w.create(emit()))!;
    return { f, w, id };
  }

  it('increments openCount only for trade ids actually added', async () => {
    const { f, w, id } = await seeded();
    // emit() leaves rollups at the default {openCount:0} — the seeded
    // equity member makes 1 the baseline.
    await w.addMembers(id, { tradeIds: ['QQQM-261020-sig-CSP-261120-580-01'] }, NOW);
    assert.equal(f.stored(docPath(id))!.rollups.openCount, 1);
    // re-add (retried fill-pass mint) — already a member, no recount
    await w.addMembers(id, { tradeIds: ['QQQM-261020-sig-CSP-261120-580-01'] }, NOW);
    assert.equal(f.stored(docPath(id))!.rollups.openCount, 1);
    // ticket/broker unions never count as open trades
    await w.addMembers(id, { ticketIds: ['pap_x'], brokerOrderIds: ['rh-1'] }, NOW);
    assert.equal(f.stored(docPath(id))!.rollups.openCount, 1);
    // existing realizedPnl is preserved
    assert.deepEqual(Object.keys(f.stored(docPath(id))!.rollups).sort(), ['closedCount', 'openCount']);
  });
});
