/**
 * @topic #984 — ST Firestore Reorg (task #1008)
 *
 * st-config + st-symbol-lists consolidation coverage:
 * - tradingConfigMirror copies FE-written legacy config docs → st-config
 *   (upsert + delete, wholesale set — FE owns the doc shape), and refuses
 *   the `status` id (namespace collision with the BE-owned singleton).
 * - symbolListsMirror copies FE-written legacy list docs → st-symbol-lists
 *   (upsert + delete).
 * - stStatusMirror shadows canonical `st-config/status` writes → legacy
 *   `savant-trader/data/status/current` — rules-permitted readers +
 *   rollback insurance for the soak; a literal doc-path trigger means
 *   mirrored FE config docs never reach it.
 * - addSymbolToDefaultList dual-writes the bare-name NEW doc to both
 *   roots in one batch — the FE probes bare-name list docs on legacy
 *   (#1014 re-point drops the legacy leg).
 * - Trigger-path literals pinned — a typoed path deploys and silently
 *   never fires.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MIRROR_ST_STATUS_PATH,
  MIRROR_SYMBOL_LISTS_PATH,
  MIRROR_TRADING_CONFIG_PATH,
  mirrorSymbolListDoc,
  mirrorTradingConfigDoc,
  shadowStStatusDoc,
} from '../../functions/src/st-config/config-lists-mirror';
import { addSymbolToDefaultList } from '../../functions/src/symbol-data-sync/symbol-data-symbol-added';
import { stConfigDocPath } from '../../shared/st-collections';

// ── Fake Firestore — docs keyed by path; captures writes ────────────────────

function fakeFirestore(initial: Record<string, Record<string, unknown>> = {}, opts: { failOn?: RegExp } = {}) {
  const store = new Map<string, Record<string, unknown>>(
    Object.entries(initial).map(([k, v]) => [k, { ...v }]),
  );
  const deletes: string[] = [];
  const setCalls: Array<{ path: string; merge: boolean }> = [];
  const refFor = (path: string) => ({
    set: async (doc: Record<string, unknown>, setOpts?: { merge?: boolean }) => {
      if (opts.failOn?.test(path)) throw new Error('injected write failure');
      setCalls.push({ path, merge: setOpts?.merge === true });
      store.set(path, setOpts?.merge === true ? { ...(store.get(path) ?? {}), ...doc } : { ...doc });
    },
    delete: async () => { deletes.push(path); store.delete(path); },
  });
  const db = {
    doc: (path: string) => refFor(path),
    collection: (name: string) => ({ doc: (id: string) => refFor(`${name}/${id}`) }),
    batch: () => {
      const ops: Array<() => Promise<unknown>> = [];
      return {
        set: (ref: ReturnType<typeof refFor>, doc: Record<string, unknown>, o?: { merge?: boolean }) =>
          ops.push(() => ref.set(doc, o)),
        // Atomic like a real WriteBatch — a mid-batch throw rolls back
        // every op applied so far.
        commit: async () => {
          const snapshot = new Map(store);
          try {
            for (const op of ops) await op();
          } catch (e) {
            store.clear();
            for (const [k, v] of snapshot) store.set(k, v);
            throw e;
          }
        },
      };
    },
  };
  return { db, store, deletes, setCalls };
}

function recordingLogger() {
  const warns: unknown[] = [];
  const errors: unknown[] = [];
  return { warns, errors, logger: { warn: (m: unknown) => { warns.push(m); }, error: (m: unknown) => { errors.push(m); } } };
}

const deps = (f: ReturnType<typeof fakeFirestore>, logger = { warn() {}, error() {} }) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ({ db: f.db as any, logger: logger as any });

// ── trigger paths — pinned literals ─────────────────────────────────────────

describe('mirror trigger paths', () => {
  it('trading-config mirror watches the legacy collection', () => {
    assert.equal(MIRROR_TRADING_CONFIG_PATH, 'savant-trader/data/trading-config/{docId}');
  });
  it('symbol-lists mirror watches the legacy collection', () => {
    assert.equal(MIRROR_SYMBOL_LISTS_PATH, 'savant-trader/data/symbol-lists/{docId}');
  });
  it('status shadow watches the literal status doc — not the st-config wildcard', () => {
    assert.equal(MIRROR_ST_STATUS_PATH, 'st-config/status');
  });
  it('stConfigDocPath pins the canonical status doc id', () => {
    assert.equal(stConfigDocPath('status'), 'st-config/status');
    assert.equal(stConfigDocPath('autoPaper'), 'st-config/autoPaper');
  });
});

// ── tradingConfigMirror (legacy → st-config) ────────────────────────────────

describe('mirrorTradingConfigDoc', () => {
  it('upserts a user config doc into st-config', async () => {
    const f = fakeFirestore();
    const res = await mirrorTradingConfigDoc(
      deps(f), 'uid_1', { userId: 'uid_1', accountNumber: '5SA12345' },
    );
    assert.equal(res, 'upserted');
    assert.deepEqual(f.store.get('st-config/uid_1'), { userId: 'uid_1', accountNumber: '5SA12345' });
  });

  it('upserts the autoPaper doc into st-config', async () => {
    const f = fakeFirestore();
    const res = await mirrorTradingConfigDoc(
      deps(f), 'autoPaper', { enabled: true, lists: ['PRIMARY'] },
    );
    assert.equal(res, 'upserted');
    assert.deepEqual(f.store.get('st-config/autoPaper'), { enabled: true, lists: ['PRIMARY'] });
  });

  it('wholesale set drops fields deleted on the legacy doc', async () => {
    const f = fakeFirestore({ 'st-config/uid_1': { userId: 'uid_1', stale: 'x' } });
    const res = await mirrorTradingConfigDoc(deps(f), 'uid_1', { userId: 'uid_1' });
    assert.equal(res, 'upserted');
    assert.deepEqual(f.store.get('st-config/uid_1'), { userId: 'uid_1' });
  });

  it('propagates deletes', async () => {
    const f = fakeFirestore({ 'st-config/uid_1': { userId: 'uid_1' } });
    const res = await mirrorTradingConfigDoc(deps(f), 'uid_1', null);
    assert.equal(res, 'deleted');
    assert.ok(!f.store.has('st-config/uid_1'));
    assert.deepEqual(f.deletes, ['st-config/uid_1']);
  });

  it('refuses the status id — legacy trading-config/status would clobber the singleton', async () => {
    const f = fakeFirestore({ 'st-config/status': { totalRuns: 42 } });
    const { warns, logger } = recordingLogger();
    const res = await mirrorTradingConfigDoc(deps(f, logger), 'status', { enabled: true });
    assert.equal(res, 'skipped');
    assert.equal(warns.length, 1);
    assert.deepEqual(f.store.get('st-config/status'), { totalRuns: 42 }); // untouched
  });

  it('never throws — a write failure returns skipped + logs error', async () => {
    const f = fakeFirestore({}, { failOn: /st-config/ });
    const { errors, logger } = recordingLogger();
    const res = await mirrorTradingConfigDoc(deps(f, logger), 'uid_9', { a: 1 });
    assert.equal(res, 'skipped');
    assert.equal(errors.length, 1);
  });
});

// ── symbolListsMirror (legacy → st-symbol-lists) ────────────────────────────

describe('mirrorSymbolListDoc', () => {
  it('upserts a user-scoped list doc into st-symbol-lists', async () => {
    const f = fakeFirestore();
    const res = await mirrorSymbolListDoc(
      deps(f), 'uid_1_PRIMARY', { key: 'PRIMARY', userId: 'uid_1', symbols: ['AAPL'] },
    );
    assert.equal(res, 'upserted');
    assert.deepEqual(f.store.get('st-symbol-lists/uid_1_PRIMARY'), { key: 'PRIMARY', userId: 'uid_1', symbols: ['AAPL'] });
  });

  it('upserts a bare-name system doc', async () => {
    const f = fakeFirestore();
    const res = await mirrorSymbolListDoc(deps(f), 'NEW', { name: 'NEW', symbols: ['MSFT'] });
    assert.equal(res, 'upserted');
    assert.deepEqual(f.store.get('st-symbol-lists/NEW'), { name: 'NEW', symbols: ['MSFT'] });
  });

  it('propagates deletes (list removal reaches canonical)', async () => {
    const f = fakeFirestore({ 'st-symbol-lists/uid_1_HIDE': { key: 'HIDE', symbols: [] } });
    const res = await mirrorSymbolListDoc(deps(f), 'uid_1_HIDE', null);
    assert.equal(res, 'deleted');
    assert.ok(!f.store.has('st-symbol-lists/uid_1_HIDE'));
  });

  it('never throws — a write failure returns skipped + logs error', async () => {
    const f = fakeFirestore({}, { failOn: /st-symbol-lists/ });
    const { errors, logger } = recordingLogger();
    const res = await mirrorSymbolListDoc(deps(f, logger), 'uid_9_AVOID', { a: 1 });
    assert.equal(res, 'skipped');
    assert.equal(errors.length, 1);
  });
});

// ── stStatusMirror (canonical st-config/status → legacy shadow) ─────────────

describe('shadowStStatusDoc', () => {
  it('shadows the status doc onto savant-trader/data/status/current', async () => {
    const f = fakeFirestore();
    const res = await shadowStStatusDoc(
      deps(f), { lastRunId: 'r-1', lastRunStatus: 'SUCCESS', totalRuns: 42 },
    );
    assert.equal(res, 'upserted');
    assert.deepEqual(
      f.store.get('savant-trader/data/status/current'),
      { lastRunId: 'r-1', lastRunStatus: 'SUCCESS', totalRuns: 42 },
    );
  });

  it('propagates a status delete to the legacy singleton', async () => {
    const f = fakeFirestore({ 'savant-trader/data/status/current': { totalRuns: 1 } });
    const res = await shadowStStatusDoc(deps(f), null);
    assert.equal(res, 'deleted');
    assert.ok(!f.store.has('savant-trader/data/status/current'));
  });

  it('never throws — a write failure returns skipped + logs error', async () => {
    const f = fakeFirestore({}, { failOn: /savant-trader/ });
    const { errors, logger } = recordingLogger();
    const res = await shadowStStatusDoc(deps(f, logger), { totalRuns: 1 });
    assert.equal(res, 'skipped');
    assert.equal(errors.length, 1);
  });
});

// ── symbol-added dual-write ──────────────────────────────────────────────────

describe('addSymbolToDefaultList', () => {
  it('writes the bare-name NEW doc to legacy AND st-symbol-lists', async () => {
    const f = fakeFirestore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await addSymbolToDefaultList('ZZZZ', f.db as any);
    assert.ok(f.store.has('savant-trader/data/symbol-lists/NEW'), 'legacy leg missing');
    assert.ok(f.store.has('st-symbol-lists/NEW'), 'canonical leg missing');
  });

  it('merge-writes both roots, preserving existing fields (arrayUnion applies server-side)', async () => {
    const f = fakeFirestore({
      'savant-trader/data/symbol-lists/NEW': { name: 'NEW', symbols: ['AAPL'], extra: 'kept' },
      'st-symbol-lists/NEW': { name: 'NEW', symbols: ['AAPL'], extra: 'kept' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await addSymbolToDefaultList('ZZZZ', f.db as any);
    // Both legs were merge-sets carrying the symbols payload — the
    // union itself is Firestore's contract, soaked/probe-verified in QA.
    assert.deepEqual(
      f.setCalls.map((c) => c.path).sort(),
      ['savant-trader/data/symbol-lists/NEW', 'st-symbol-lists/NEW'],
    );
    assert.ok(f.setCalls.every((c) => c.merge));
    assert.equal(f.store.get('savant-trader/data/symbol-lists/NEW')!.extra, 'kept');
    assert.equal(f.store.get('st-symbol-lists/NEW')!.extra, 'kept');
  });

  it('is all-or-nothing — a failed leg commits neither root', async () => {
    const f = fakeFirestore({}, { failOn: /st-symbol-lists/ });
    await assert.rejects(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      addSymbolToDefaultList('ZZZZ', f.db as any),
    );
    assert.ok(!f.store.has('savant-trader/data/symbol-lists/NEW'), 'legacy leg must roll back');
  });
});
