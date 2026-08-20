/**
 * @topic #108 — Options Position Strategy Engine
 *
 * Unit tests for the Firestore-backed strategy instance repository.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  listActiveInstances,
  listManageableInstances,
  listAllInstances,
  getInstance,
} from '../../../functions/src/options-strategy-engine/strategy-instance-repository';
import {
  OPTIONS_STRATEGY_INSTANCES_COLLECTION,
} from '../../../functions/src/options-strategy-engine/collections';
import { OptionType, PositionSpreadType, StrategyFrequency } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import { ExitPolicy, LifecycleState, type StrategyInstanceConfig } from '../../../shared/options-strategy-engine-contracts';

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

function makeInstance(overrides: Partial<StrategyInstanceConfig> = {}): StrategyInstanceConfig {
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
    createdAt: '2025-08-16T00:00:00Z',
    updatedAt: '2025-08-16T00:00:00Z',
    ...overrides,
  };
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
    const fakeDb = createFakeFirestore({ [OPTIONS_STRATEGY_INSTANCES_COLLECTION]: docs }) as unknown as RepoDb;

    const result = await listActiveInstances(fakeDb);

    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'active-1');
  });

  it('listActiveInstances returns empty array when collection is empty', async () => {
    const fakeDb = createFakeFirestore({ [OPTIONS_STRATEGY_INSTANCES_COLLECTION]: [] }) as unknown as RepoDb;

    const result = await listActiveInstances(fakeDb);

    assert.deepEqual(result, []);
  });

  it('listManageableInstances returns ACTIVE, PAUSED, and STOPPED instances', async () => {
    const docs = [
      createFakeDoc('active-1', makeInstance({ id: 'active-1', lifecycleState: LifecycleState.ACTIVE })),
      createFakeDoc('paused-1', makeInstance({ id: 'paused-1', lifecycleState: LifecycleState.PAUSED })),
      createFakeDoc('stopped-1', makeInstance({ id: 'stopped-1', lifecycleState: LifecycleState.STOPPED })),
    ];
    const fakeDb = createFakeFirestore({ [OPTIONS_STRATEGY_INSTANCES_COLLECTION]: docs }) as unknown as RepoDb;

    const result = await listManageableInstances(fakeDb);

    assert.equal(result.length, 3);
    assert.deepEqual(result.map((i) => i.id).sort(), ['active-1', 'paused-1', 'stopped-1']);
  });

  it('skips malformed documents instead of crashing', async () => {
    const docs = [
      createFakeDoc('valid-1', makeInstance({ id: 'valid-1', lifecycleState: LifecycleState.ACTIVE })),
      createFakeDoc('invalid-1', { symbol: 'QQQM', lifecycleState: LifecycleState.ACTIVE }),
    ];
    const fakeDb = createFakeFirestore({ [OPTIONS_STRATEGY_INSTANCES_COLLECTION]: docs }) as unknown as RepoDb;

    const result = await listActiveInstances(fakeDb);

    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'valid-1');
  });

  it('listAllInstances returns all instances regardless of state', async () => {
    const docs = [
      createFakeDoc('active-1', makeInstance({ id: 'active-1', lifecycleState: LifecycleState.ACTIVE })),
      createFakeDoc('paused-1', makeInstance({ id: 'paused-1', lifecycleState: LifecycleState.PAUSED })),
    ];
    const fakeDb = createFakeFirestore({ [OPTIONS_STRATEGY_INSTANCES_COLLECTION]: docs }) as unknown as RepoDb;

    const result = await listAllInstances(fakeDb);

    assert.equal(result.length, 2);
  });

  it('getInstance returns the requested instance', async () => {
    const docs = [
      createFakeDoc('active-1', makeInstance({ id: 'active-1', lifecycleState: LifecycleState.ACTIVE })),
    ];
    const fakeDb = createFakeFirestore({ [OPTIONS_STRATEGY_INSTANCES_COLLECTION]: docs }) as unknown as RepoDb;

    const result = await getInstance('active-1', fakeDb);

    assert.ok(result);
    assert.equal(result!.id, 'active-1');
    assert.equal(result!.symbol, 'QQQM');
  });

  it('getInstance returns null for unknown id', async () => {
    const fakeDb = createFakeFirestore({ [OPTIONS_STRATEGY_INSTANCES_COLLECTION]: [] }) as unknown as RepoDb;

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
    const fakeDb = createFakeFirestore({ [OPTIONS_STRATEGY_INSTANCES_COLLECTION]: docs }) as unknown as RepoDb;

    const result = await getInstance('ts-1', fakeDb);

    assert.ok(result);
    assert.equal(result!.createdAt, '2025-08-17T00:00:00.000Z');
    assert.equal(result!.updatedAt, '2025-08-17T00:00:00.000Z');
  });
});
