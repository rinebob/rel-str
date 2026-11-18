/// <reference types="jest" />
/**
 * Tests for StrategyManageStore. Mocks StrategyManageService so the seam is
 * the store's public interface: instances stream, paper/real computeds,
 * loading/error.
 */

jest.mock('@angular/fire/auth', () => ({
  Auth: class {},
}));

jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: jest.fn(),
  collectionData: jest.fn(),
  doc: jest.fn(),
  runTransaction: jest.fn(),
  updateDoc: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
}));

import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';

import { StrategyManageStore } from './strategy-manage.store';
import { StrategyManageService } from '../services/strategy-manage.service';
import { OptionsStrategyService } from '../services/options-strategy.service';
import { MANAGE_VARIANTS } from '@manage/variant-catalog';
import type { ManageInstance } from '@manage/instance-contracts';
import { OptionsPositionStatus, type Position } from '../services/options-strategy.types';

function makeInstance(overrides: Partial<ManageInstance> = {}): ManageInstance {
  return {
    id: 'QQQ-CDS-30-50-40-ALL',
    variantRef: 'cds-30-50-40',
    variant: MANAGE_VARIANTS[0],
    symbol: 'QQQ',
    mode: 'paper',
    trigger: 'daily',
    stopType: 'ALL',
    runState: 'UNSTARTED',
    userId: 'test-user',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'QQQ-CDS-30-50-40-ALL-2026-11-15',
    instanceId: 'QQQ-CDS-30-50-40-ALL',
    symbol: 'QQQ',
    status: OptionsPositionStatus.OPEN,
    premiumCollected: 120,
    capitalRequired: 5000,
    openDate: '2026-11-15',
    currentValue: 110,
    currentValueAsOf: '2026-11-17',
    unrealizedPnl: 10,
    ...overrides,
  };
}

describe('StrategyManageStore', () => {
  let store: InstanceType<typeof StrategyManageStore>;
  let mockService: {
    loadInstances$: jest.Mock;
    setRunState: jest.Mock;
    createInstances: jest.Mock;
  };
  let mockOptionsService: { listStrategyPositions$: jest.Mock };

  beforeEach(() => {
    mockService = {
      loadInstances$: jest.fn().mockReturnValue(of([])),
      setRunState: jest.fn().mockResolvedValue(undefined),
      createInstances: jest.fn().mockResolvedValue({ created: [], skipped: [] }),
    };
    mockOptionsService = {
      listStrategyPositions$: jest
        .fn()
        .mockReturnValue(of({ openPositions: [], closedPositions: [] })),
    };

    TestBed.configureTestingModule({
      providers: [
        StrategyManageStore,
        { provide: StrategyManageService, useValue: mockService },
        { provide: OptionsStrategyService, useValue: mockOptionsService },
      ],
    });
    store = TestBed.inject(StrategyManageStore);
  });

  describe('initial state', () => {
    it('has empty instances, is not loading, and has no error', () => {
      expect(store.instances()).toEqual([]);
      expect(store.isLoading()).toBe(false);
      expect(store.error()).toBeNull();
    });
  });

  describe('load', () => {
    it('populates instances from the service stream', () => {
      const instances = [makeInstance()];
      mockService.loadInstances$.mockReturnValue(of(instances));

      store.load();

      expect(store.instances()).toEqual(instances);
      expect(store.isLoading()).toBe(false);
      expect(store.error()).toBeNull();
    });

    it('keeps the stream open across multiple emissions', () => {
      const first = makeInstance({ id: 'one' });
      const second = makeInstance({ id: 'two' });
      const stream = new Subject<ManageInstance[]>();
      mockService.loadInstances$.mockReturnValue(stream.asObservable());

      store.load();
      stream.next([first]);
      expect(store.instances().map((i) => i.id)).toEqual(['one']);

      stream.next([first, second]);
      expect(store.instances().map((i) => i.id)).toEqual(['one', 'two']);
    });

    it('sets error on service failure', () => {
      mockService.loadInstances$.mockReturnValue(throwError(() => new Error('network error')));

      store.load();

      expect(store.error()).toContain('Failed to load strategy instances');
      expect(store.isLoading()).toBe(false);
    });

    it('maps unauthenticated failures to an auth message', () => {
      mockService.loadInstances$.mockReturnValue(
        throwError(() => Object.assign(new Error('denied'), { code: 'unauthenticated' })),
      );

      store.load();

      expect(store.error()).toBe('Authentication required');
    });

    it('maps the service requireUserId error (message, no code) to auth required', () => {
      mockService.loadInstances$.mockReturnValue(
        throwError(() => new Error('Authentication required')),
      );

      store.load();

      expect(store.error()).toBe('Authentication required');
    });
  });

  describe('mode computeds', () => {
    it('paperInstances and realInstances partition by mode', () => {
      mockService.loadInstances$.mockReturnValue(
        of([
          makeInstance({ id: 'p1', mode: 'paper' }),
          makeInstance({ id: 'r1', mode: 'real', stopType: 'T8' }),
          makeInstance({ id: 'p2', mode: 'paper' }),
        ]),
      );

      store.load();

      expect(store.paperInstances().map((i) => i.id)).toEqual(['p1', 'p2']);
      expect(store.realInstances().map((i) => i.id)).toEqual(['r1']);
    });
  });

  describe('open-position join', () => {
    it('indexes open positions by instanceId', () => {
      mockOptionsService.listStrategyPositions$.mockReturnValue(
        of({
          openPositions: [makePosition(), makePosition({ id: 'other', instanceId: 'OTHER-INST' })],
          closedPositions: [makePosition({ id: 'closed' })],
        }),
      );

      store.load();

      expect(store.openPositionsByInstance()['QQQ-CDS-30-50-40-ALL'].map((p) => p.id))
        .toEqual(['QQQ-CDS-30-50-40-ALL-2026-11-15']);
      expect(store.openPositionsByInstance()['OTHER-INST'].map((p) => p.id))
        .toEqual(['other']);
      expect(store.openPositionsByInstance()['closed-instance']).toBeUndefined();
    });

    it('leaves the join empty when the positions call fails', () => {
      mockOptionsService.listStrategyPositions$.mockReturnValue(
        throwError(() => new Error('callable down')),
      );

      store.load();

      expect(store.openPositionsByInstance()).toEqual({});
      expect(store.instances()).toEqual([]);
    });
  });

  describe('toggleRunState', () => {
    it('starts an UNSTARTED instance', async () => {
      await store.toggleRunState(makeInstance({ runState: 'UNSTARTED' }));
      expect(mockService.setRunState).toHaveBeenCalledWith(
        'QQQ-CDS-30-50-40-ALL',
        'ACTIVE',
      );
    });

    it('stops an ACTIVE instance', async () => {
      await store.toggleRunState(makeInstance({ runState: 'ACTIVE' }));
      expect(mockService.setRunState).toHaveBeenCalledWith(
        'QQQ-CDS-30-50-40-ALL',
        'STOPPED',
      );
    });

    it('restarts a STOPPED instance back to ACTIVE (never UNSTARTED)', async () => {
      await store.toggleRunState(makeInstance({ runState: 'STOPPED' }));
      expect(mockService.setRunState).toHaveBeenCalledWith(
        'QQQ-CDS-30-50-40-ALL',
        'ACTIVE',
      );
    });

    it('does not write for a real-mode instance (v1)', async () => {
      await store.toggleRunState(makeInstance({ mode: 'real', stopType: 'T8' }));
      expect(mockService.setRunState).not.toHaveBeenCalled();
    });

    it('sets error when the write fails', async () => {
      mockService.setRunState.mockRejectedValue(new Error('permission-denied'));
      await store.toggleRunState(makeInstance());
      expect(store.error()).toContain('Failed to update run state');
    });

    it('clears a prior error when the next toggle starts', async () => {
      mockService.setRunState.mockRejectedValueOnce(new Error('x'));
      await store.toggleRunState(makeInstance());
      expect(store.error()).not.toBeNull();

      await store.toggleRunState(makeInstance());
      expect(store.error()).toBeNull();
    });

    it('clearError dismisses the banner', async () => {
      mockService.setRunState.mockRejectedValue(new Error('x'));
      await store.toggleRunState(makeInstance());
      expect(store.error()).not.toBeNull();

      store.clearError();
      expect(store.error()).toBeNull();
    });
  });

  describe('variants', () => {
    it('exposes the catalog variants with no session variants', () => {
      expect(store.variants()).toEqual([...MANAGE_VARIANTS]);
      expect(store.sessionVariants()).toEqual([]);
    });

    it('appends session variants after the catalog (Create New Instance picker merge)', () => {
      const adHoc = {
        ...MANAGE_VARIANTS[0],
        id: 'session-cds-30-50-35',
        name: 'call debit spread 50-35 30',
        legs: MANAGE_VARIANTS[0].legs.map((l, i) =>
          l.kind === 'option' && i === 1 ? { ...l, targetDelta: 0.35 } : l),
      };

      store.addSessionVariant(adHoc);

      expect(store.sessionVariants()).toEqual([adHoc]);
      expect(store.variants()).toEqual([...MANAGE_VARIANTS, adHoc]);
    });

    it('replaces a session variant re-pushed under the same id', () => {
      const adHoc = { ...MANAGE_VARIANTS[0], id: 'session-cds', name: 'v1' };
      const revised = { ...adHoc, name: 'v2' };

      store.addSessionVariant(adHoc);
      store.addSessionVariant(revised);

      expect(store.sessionVariants()).toEqual([revised]);
      expect(store.variants().filter((v) => v.id === 'session-cds')).toEqual([revised]);
    });

    it('drops a session variant whose id collides with the catalog (catalog wins)', () => {
      const collision = { ...MANAGE_VARIANTS[0], name: 'impostor' };

      store.addSessionVariant(collision);

      expect(store.variants().filter((v) => v.id === collision.id)).toEqual([
        MANAGE_VARIANTS[0],
      ]);
      // No duplicate ids in the merged list — the picker's @for track key
      // would crash the dialog.
      const ids = store.variants().map((v) => v.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('createInstances', () => {
    const input = {
      id: 'QQQ-CDS-30-50-40-ALL',
      variant: MANAGE_VARIANTS[0],
      variantRef: MANAGE_VARIANTS[0].id,
      symbol: 'QQQ',
      mode: 'paper' as const,
      trigger: 'daily' as const,
      stopType: 'ALL',
    };

    it('delegates to the service and passes through the {created, skipped} result', async () => {
      const outcome = { created: ['QQQ-CDS-30-50-40-ALL'], skipped: [] };
      mockService.createInstances.mockResolvedValue(outcome);

      const result = await store.createInstances([input]);

      expect(mockService.createInstances).toHaveBeenCalledWith([input]);
      expect(result).toBe(outcome);
      expect(store.error()).toBeNull();
    });

    it('returns the service failure message — dialog-scoped, not the page banner', async () => {
      mockService.createInstances.mockRejectedValue(
        new Error("Instance 'QQQ-CDS-30-50-40-ALL' already exists"),
      );

      const result = await store.createInstances([input]);

      expect(result).toContain('already exists');
      expect(store.error()).toBeNull();
    });

    it('refuses real-mode inputs without writing — real create is disabled in v1', async () => {
      const result = await store.createInstances([
        { ...input, mode: 'real', stopType: 'T8' },
      ]);

      expect(mockService.createInstances).not.toHaveBeenCalled();
      expect(result).toContain('disabled in v1');
      expect(store.error()).toBeNull();
    });
  });
});
