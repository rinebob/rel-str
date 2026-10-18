/**
 * @topic #108 — Options Position Strategy Engine
 *
 * Unit tests for the Firestore-backed strategy instance repository.
 * #1006: reads re-pointed to `st-strategy-instances` (canonical) with a
 * union-read soak bridge over the legacy `paper-trading/instances/items`
 * anchor (FE Strategy Builder writes there until #1014).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  listActiveInstances,
  listManageableInstances,
  listRunnableInstances,
  getInstance,
} from '../../../functions/src/options-strategy-engine/strategy-instance-repository';
import { PaperTradingKind } from '../../../shared/paper-trading-contracts';
import { paperTradingItemsPath } from '../../../shared/paper-trading-ids';
import { ST_STRATEGY_INSTANCES_ROOT } from '../../../shared/st-collections';
import { OptionType, PositionSpreadType, StrategyFrequency } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import { ExitPolicy, LifecycleState } from '../../../shared/options-strategy-engine-contracts';
import type { StStrategyInstance } from '../../../shared/st-strategy-instances';

const CANONICAL = ST_STRATEGY_INSTANCES_ROOT;
const LEGACY = paperTradingItemsPath(PaperTradingKind.INSTANCE);

type FakeDoc = { id: string; data(): unknown };
type FakeSnapshot = { docs: FakeDoc[]; empty: boolean; size: number };
type FakeFirestore = {
  collection(name: string): {
    where(field: string, op: string, value: unknown): { get(): Promise<FakeSnapshot> };
    get(): Promise<FakeSnapshot>;
    doc(id: string): { get(): Promise<{ exists: boolean; id: string; data(): unknown | null }> };
  };
};

type RepoDb = Parameters<typeof listActiveInstances>[0];

function makeInstance(overrides: Partial<StStrategyInstance> = {}): StStrategyInstance {
  return {
    id: '250816-QQQM-CSP-020-30-D-1200',
    symbol: 'QQQM',
    optionType: OptionType.PUT,
    side: TradeSide.SHORT,
    targetDelta: 0.2,
    dteMin: 21,
    dteMax: 30,
    phases: [
      {
        spreadType: PositionSpreadType.CASH_SECURED_PUT,
        targetDelta: 0.2,
        dteMin: 21,
        dteMax: 30,
      },
    ],
    frequency: StrategyFrequency.DAILY,
    openTimePT: '12:00',
    exitPolicies: [{ policy: ExitPolicy.HOLD_TO_EXPIRATION }],
    lifecycleState: LifecycleState.ACTIVE,
    userId: 'test-user',
    mode: 'paper',
    enabled: true,
    createdAt: '2025-08-16T00:00:00Z',
    updatedAt: '2025-08-16T00:00:00Z',
    ...overrides,
  };
}

/** Legacy `paper-trading/instances/items` doc — no mode/enabled stamped. */
function makeLegacyInstance(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { mode: _mode, enabled: _enabled, ...rest } = makeInstance(overrides);
  return { ...rest, kind: PaperTradingKind.INSTANCE };
}

function createFakeDoc(id: string, data: unknown): FakeDoc {
  return { id, data: () => data };
}

function createFakeSnapshot(docs: FakeDoc[]): FakeSnapshot {
  return {
    docs,
    empty: docs.length === 0,
    size: docs.length,
  };
}

function createFakeFirestore(docsByCollection: Record<string, FakeDoc[]>): FakeFirestore {
  return {
    collection: (name: string) => {
      const allDocs = docsByCollection[name] ?? [];
      let filteredDocs = allDocs;

      return {
        where: (field: string, op: string, value: unknown) => {
          if (op === '==') {
            filteredDocs = allDocs.filter((doc) => {
              const data = doc.data() as Record<string, unknown>;
              return data[field] === value;
            });
          } else if (op === 'in' && Array.isArray(value)) {
            const allowed = new Set(value);
            filteredDocs = allDocs.filter((doc) => {
              const data = doc.data() as Record<string, unknown>;
              return allowed.has(data[field]);
            });
          }
          return {
            get: async () => createFakeSnapshot(filteredDocs),
          };
        },
        get: async () => createFakeSnapshot(allDocs),
        doc: (id: string) => {
          const doc = allDocs.find((d) => d.id === id);
          return {
            get: async () => ({
              exists: doc !== undefined,
              id: doc?.id ?? id,
              data: () => (doc ? doc.data() : null),
            }),
          };
        },
      };
    },
  };
}

describe('strategy-instance-repository', () => {
  it('listActiveInstances returns only ACTIVE instances', async () => {
    const docs = [
      createFakeDoc('active-1', makeInstance({ id: 'active-1', lifecycleState: LifecycleState.ACTIVE })),
      createFakeDoc('paused-1', makeInstance({ id: 'paused-1', lifecycleState: LifecycleState.PAUSED })),
      createFakeDoc('stopped-1', makeInstance({ id: 'stopped-1', lifecycleState: LifecycleState.STOPPED })),
    ];
    const fakeDb = createFakeFirestore({ [CANONICAL]: docs }) as unknown as RepoDb;

    const result = await listActiveInstances(fakeDb);

    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'active-1');
  });

  it('listActiveInstances returns empty array when collection is empty', async () => {
    const fakeDb = createFakeFirestore({ [CANONICAL]: [] }) as unknown as RepoDb;

    const result = await listActiveInstances(fakeDb);

    assert.deepEqual(result, []);
  });

  it('listManageableInstances returns ACTIVE, PAUSED, and STOPPED instances', async () => {
    const docs = [
      createFakeDoc('active-1', makeInstance({ id: 'active-1', lifecycleState: LifecycleState.ACTIVE })),
      createFakeDoc('paused-1', makeInstance({ id: 'paused-1', lifecycleState: LifecycleState.PAUSED })),
      createFakeDoc('stopped-1', makeInstance({ id: 'stopped-1', lifecycleState: LifecycleState.STOPPED })),
    ];
    const fakeDb = createFakeFirestore({ [CANONICAL]: docs }) as unknown as RepoDb;

    const result = await listManageableInstances(fakeDb);

    assert.equal(result.length, 3);
    assert.deepEqual(result.map((i) => i.id).sort(), ['active-1', 'paused-1', 'stopped-1']);
  });

  it('skips malformed documents instead of crashing', async () => {
    const docs = [
      createFakeDoc('valid-1', makeInstance({ id: 'valid-1', lifecycleState: LifecycleState.ACTIVE })),
      createFakeDoc('invalid-1', { symbol: 'QQQM', lifecycleState: LifecycleState.ACTIVE }),
    ];
    const fakeDb = createFakeFirestore({ [CANONICAL]: docs }) as unknown as RepoDb;

    const result = await listActiveInstances(fakeDb);

    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'valid-1');
  });

  it('listRunnableInstances returns runnable instances regardless of lifecycle state', async () => {
    const docs = [
      createFakeDoc('active-1', makeInstance({ id: 'active-1', lifecycleState: LifecycleState.ACTIVE })),
      createFakeDoc('paused-1', makeInstance({ id: 'paused-1', lifecycleState: LifecycleState.PAUSED })),
    ];
    const fakeDb = createFakeFirestore({ [CANONICAL]: docs }) as unknown as RepoDb;

    const result = await listRunnableInstances(fakeDb);

    assert.equal(result.length, 2);
  });

  it('getInstance returns the requested instance', async () => {
    const docs = [
      createFakeDoc('active-1', makeInstance({ id: 'active-1', lifecycleState: LifecycleState.ACTIVE })),
    ];
    const fakeDb = createFakeFirestore({ [CANONICAL]: docs }) as unknown as RepoDb;

    const result = await getInstance('active-1', fakeDb);

    assert.ok(result);
    assert.equal(result!.id, 'active-1');
    assert.equal(result!.symbol, 'QQQM');
  });

  it('getInstance returns null for unknown id', async () => {
    const fakeDb = createFakeFirestore({ [CANONICAL]: [] }) as unknown as RepoDb;

    const result = await getInstance('missing', fakeDb);

    assert.equal(result, null);
  });

  it('normalizes Firestore timestamps to ISO strings', async () => {
    const timestamp = {
      toDate: () => new Date('2025-08-17T00:00:00Z'),
    };
    const docs = [
      createFakeDoc('ts-1', makeInstance({
        id: 'ts-1',
        createdAt: timestamp as unknown as string,
        updatedAt: timestamp as unknown as string,
      })),
    ];
    const fakeDb = createFakeFirestore({ [CANONICAL]: docs }) as unknown as RepoDb;

    const result = await getInstance('ts-1', fakeDb);

    assert.ok(result);
    assert.equal(result!.createdAt, '2025-08-17T00:00:00.000Z');
    assert.equal(result!.updatedAt, '2025-08-17T00:00:00.000Z');
  });

  // ── #1006: canonical re-point + union-read soak bridge ─────────────────────

  it('unions legacy paper-trading/instances docs into list reads', async () => {
    const fakeDb = createFakeFirestore({
      [CANONICAL]: [
        createFakeDoc('canon-1', makeInstance({ id: 'canon-1' })),
      ],
      [LEGACY]: [
        createFakeDoc('legacy-1', makeLegacyInstance({ id: 'legacy-1' })),
      ],
    }) as unknown as RepoDb;

    const result = await listRunnableInstances(fakeDb);

    assert.deepEqual(result.map((i) => i.id).sort(), ['canon-1', 'legacy-1']);
  });

  it('equal updatedAt on an id collision — canonical wins the tie', async () => {
    const fakeDb = createFakeFirestore({
      [CANONICAL]: [
        createFakeDoc('dup-1', makeInstance({ id: 'dup-1', openTimePT: '13:00' })),
      ],
      [LEGACY]: [
        createFakeDoc('dup-1', makeLegacyInstance({ id: 'dup-1', openTimePT: '09:30' })),
      ],
    }) as unknown as RepoDb;

    const result = await listRunnableInstances(fakeDb);

    assert.equal(result.length, 1);
    assert.equal(result[0].openTimePT, '13:00');
  });

  it('newer legacy doc wins — a post-migration UI edit on the anchor must not be shadowed', async () => {
    const fakeDb = createFakeFirestore({
      [CANONICAL]: [
        createFakeDoc('dup-1', makeInstance({ id: 'dup-1', openTimePT: '13:00' })),
      ],
      [LEGACY]: [
        createFakeDoc('dup-1', makeLegacyInstance({
          id: 'dup-1',
          openTimePT: '09:30',
          lifecycleState: LifecycleState.STOPPED,
          updatedAt: '2025-08-20T00:00:00Z',
        })),
      ],
    }) as unknown as RepoDb;

    const result = await listRunnableInstances(fakeDb);

    assert.equal(result.length, 1);
    assert.equal(result[0].openTimePT, '09:30');
    assert.equal(result[0].lifecycleState, LifecycleState.STOPPED);
  });

  it('newer canonical doc wins over a stale anchor copy', async () => {
    const fakeDb = createFakeFirestore({
      [CANONICAL]: [
        createFakeDoc('dup-1', makeInstance({
          id: 'dup-1',
          openTimePT: '13:00',
          updatedAt: '2025-08-20T00:00:00Z',
        })),
      ],
      [LEGACY]: [
        createFakeDoc('dup-1', makeLegacyInstance({ id: 'dup-1', openTimePT: '09:30' })),
      ],
    }) as unknown as RepoDb;

    const result = await listRunnableInstances(fakeDb);

    assert.equal(result.length, 1);
    assert.equal(result[0].openTimePT, '13:00');
  });

  it('listActiveInstances drops an instance paused via the anchor — lifecycle filter applies post-merge', async () => {
    // Soak window: user pauses in the UI → anchor doc is PAUSED+newer, the
    // canonical copy stays ACTIVE+stale. A per-collection `where` would
    // exclude the PAUSED anchor doc and return the stale ACTIVE copy — the
    // engine would keep opening positions on a stopped instance.
    const fakeDb = createFakeFirestore({
      [CANONICAL]: [
        createFakeDoc('dup-1', makeInstance({
          id: 'dup-1',
          lifecycleState: LifecycleState.ACTIVE,
        })),
      ],
      [LEGACY]: [
        createFakeDoc('dup-1', makeLegacyInstance({
          id: 'dup-1',
          lifecycleState: LifecycleState.PAUSED,
          updatedAt: '2025-08-20T00:00:00Z',
        })),
      ],
    }) as unknown as RepoDb;

    assert.deepEqual((await listActiveInstances(fakeDb)).map((i) => i.id), []);
    // The PAUSED twin is still manageable — existing positions keep settling.
    assert.deepEqual(
      (await listManageableInstances(fakeDb)).map((i) => i.id),
      ['dup-1'],
    );
  });

  it('getInstance honors newest-wins and falls back past a malformed canonical doc', async () => {
    const shadowed = createFakeFirestore({
      [CANONICAL]: [
        createFakeDoc('dup-1', makeInstance({ id: 'dup-1', openTimePT: '13:00' })),
      ],
      [LEGACY]: [
        createFakeDoc('dup-1', makeLegacyInstance({
          id: 'dup-1',
          openTimePT: '09:30',
          updatedAt: '2025-08-20T00:00:00Z',
        })),
      ],
    }) as unknown as RepoDb;

    const newer = await getInstance('dup-1', shadowed);
    assert.ok(newer);
    assert.equal(newer!.openTimePT, '09:30');

    const malformed = createFakeFirestore({
      [CANONICAL]: [createFakeDoc('bad-1', { symbol: 'QQQM' })],
      [LEGACY]: [createFakeDoc('bad-1', makeLegacyInstance({ id: 'bad-1' }))],
    }) as unknown as RepoDb;

    const fellBack = await getInstance('bad-1', malformed);
    assert.ok(fellBack);
    assert.equal(fellBack!.id, 'bad-1');
  });

  it('normalizes missing mode/enabled on legacy docs to paper/true', async () => {
    const fakeDb = createFakeFirestore({
      [LEGACY]: [createFakeDoc('legacy-1', makeLegacyInstance({ id: 'legacy-1' }))],
    }) as unknown as RepoDb;

    const result = await getInstance('legacy-1', fakeDb);

    assert.ok(result);
    assert.equal(result!.mode, 'paper');
    assert.equal(result!.enabled, true);
  });

  it('getInstance falls back to the legacy collection for an unmigrated id', async () => {
    const fakeDb = createFakeFirestore({
      [CANONICAL]: [],
      [LEGACY]: [createFakeDoc('legacy-1', makeLegacyInstance({ id: 'legacy-1' }))],
    }) as unknown as RepoDb;

    const result = await getInstance('legacy-1', fakeDb);

    assert.ok(result);
    assert.equal(result!.id, 'legacy-1');
  });

  it('enabled=false instances are excluded from every list read', async () => {
    const fakeDb = createFakeFirestore({
      [CANONICAL]: [
        createFakeDoc('off-1', makeInstance({ id: 'off-1', enabled: false })),
        createFakeDoc('on-1', makeInstance({ id: 'on-1' })),
      ],
    }) as unknown as RepoDb;

    assert.deepEqual((await listRunnableInstances(fakeDb)).map((i) => i.id), ['on-1']);
    assert.deepEqual((await listActiveInstances(fakeDb)).map((i) => i.id), ['on-1']);
    assert.deepEqual((await listManageableInstances(fakeDb)).map((i) => i.id), ['on-1']);
  });

  it('mode=live instances are excluded — the engine consumes paper only', async () => {
    const fakeDb = createFakeFirestore({
      [CANONICAL]: [
        createFakeDoc('live-1', makeInstance({ id: 'live-1', mode: 'live' })),
        createFakeDoc('paper-1', makeInstance({ id: 'paper-1' })),
      ],
    }) as unknown as RepoDb;

    assert.deepEqual((await listRunnableInstances(fakeDb)).map((i) => i.id), ['paper-1']);
    assert.deepEqual((await listActiveInstances(fakeDb)).map((i) => i.id), ['paper-1']);
  });

  it('getInstance returns a doc regardless of enabled/mode — it is a config read, not a firing surface', async () => {
    const fakeDb = createFakeFirestore({
      [CANONICAL]: [
        createFakeDoc('off-1', makeInstance({ id: 'off-1', enabled: false })),
      ],
    }) as unknown as RepoDb;

    const result = await getInstance('off-1', fakeDb);

    assert.ok(result);
    assert.equal(result!.enabled, false);
  });
});
