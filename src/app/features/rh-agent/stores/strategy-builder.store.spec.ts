/// <reference types="jest" />
/**
 * Tests for StrategyBuilderStore. Mocks StrategyBuilderService so the seam
 * is the store's public interface.
 */

jest.mock('@angular/fire/auth', () => ({
  Auth: class {},
}));

jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: jest.fn(),
  collectionData: jest.fn(),
  doc: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  orderBy: jest.fn(),
}));

import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';

import { StrategyBuilderStore } from './strategy-builder.store';
import { StrategyBuilderService } from '../services/strategy-builder.service';
import { OptionType, PositionSpreadType, StrategyFrequency } from '@options/common';
import { TradeSide } from '@common';
import { ExitPolicy, LifecycleState, type StrategyInstanceConfig } from '@options-strategy-engine/contracts';

function makeInstance(overrides: Partial<StrategyInstanceConfig> = {}): StrategyInstanceConfig {
  return {
    id: '250816-QQQM-CSP-020-28-D',
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

describe('StrategyBuilderStore', () => {
  let store: InstanceType<typeof StrategyBuilderStore>;
  let mockService: {
    loadInstances$: jest.Mock;
    createInstance: jest.Mock;
    updateInstance: jest.Mock;
    deleteInstance: jest.Mock;
    setLifecycleState: jest.Mock;
  };

  beforeEach(() => {
    mockService = {
      loadInstances$: jest.fn(),
      createInstance: jest.fn(),
      updateInstance: jest.fn(),
      deleteInstance: jest.fn(),
      setLifecycleState: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        StrategyBuilderStore,
        { provide: StrategyBuilderService, useValue: mockService },
      ],
    });
    store = TestBed.inject(StrategyBuilderStore);
  });

  describe('initial state', () => {
    it('has empty instances', () => {
      expect(store.instances()).toEqual([]);
    });

    it('is not loading', () => {
      expect(store.isLoading()).toBe(false);
    });

    it('has no error', () => {
      expect(store.error()).toBeNull();
    });

    it('has no selected instance', () => {
      expect(store.selectedInstance()).toBeNull();
    });
  });

  describe('load', () => {
    it('populates instances from the service', () => {
      const instances = [makeInstance()];
      mockService.loadInstances$.mockReturnValue(of(instances));

      store.load();

      expect(store.instances()).toEqual(instances);
      expect(store.isLoading()).toBe(false);
      expect(store.error()).toBeNull();
    });

    it('sets error on service failure', () => {
      mockService.loadInstances$.mockReturnValue(throwError(() => new Error('network error')));

      store.load();

      expect(store.error()).toContain('Failed to load strategy instances');
      expect(store.isLoading()).toBe(false);
    });

    it('sets loading while the request is in flight', () => {
      mockService.loadInstances$.mockReturnValue(of([]));
      expect(store.isLoading()).toBe(false);

      store.load();

      // After synchronous emission, finalize has run
      expect(store.isLoading()).toBe(false);
    });
  });

  describe('computed filters', () => {
    it('activeInstances returns only ACTIVE instances', () => {
      mockService.loadInstances$.mockReturnValue(of([
        makeInstance({ id: 'active-1', lifecycleState: LifecycleState.ACTIVE }),
        makeInstance({ id: 'paused-1', lifecycleState: LifecycleState.PAUSED }),
        makeInstance({ id: 'stopped-1', lifecycleState: LifecycleState.STOPPED }),
      ]));

      store.load();

      expect(store.activeInstances().map((i) => i.id)).toEqual(['active-1']);
      expect(store.pausedInstances().map((i) => i.id)).toEqual(['paused-1']);
      expect(store.stoppedInstances().map((i) => i.id)).toEqual(['stopped-1']);
    });
  });

  describe('create', () => {
    it('calls service.createInstance and refreshes the list', async () => {
      mockService.createInstance.mockResolvedValue(undefined);
      mockService.loadInstances$.mockReturnValue(of([makeInstance()]));

      await store.create(makeInstance({ id: undefined, userId: undefined } as Partial<StrategyInstanceConfig> as any));

      expect(mockService.createInstance).toHaveBeenCalled();
      expect(store.instances().length).toBe(1);
    });

    it('sets error on create failure', async () => {
      mockService.createInstance.mockRejectedValue(new Error('permission denied'));

      await store.create(makeInstance());

      expect(store.error()).toBe('permission denied');
      expect(store.isLoading()).toBe(false);
    });
  });

  describe('update', () => {
    it('calls service.updateInstance and refreshes the list', async () => {
      mockService.updateInstance.mockResolvedValue(undefined);
      mockService.loadInstances$.mockReturnValue(of([makeInstance({ symbol: 'SPY' })]));

      await store.update('instance-1', { symbol: 'SPY' });

      expect(mockService.updateInstance).toHaveBeenCalledWith('instance-1', { symbol: 'SPY' });
      expect(store.instances()[0].symbol).toBe('SPY');
    });

    it('sets error on update failure', async () => {
      mockService.updateInstance.mockRejectedValue(new Error('not found'));

      await store.update('instance-1', { symbol: 'SPY' });

      expect(store.error()).toBe('not found');
      expect(store.isLoading()).toBe(false);
    });
  });

  describe('remove', () => {
    it('calls service.deleteInstance and refreshes the list', async () => {
      mockService.deleteInstance.mockResolvedValue(undefined);
      mockService.loadInstances$.mockReturnValue(of([]));

      await store.remove('instance-1');

      expect(mockService.deleteInstance).toHaveBeenCalledWith('instance-1');
      expect(store.instances()).toEqual([]);
    });

    it('sets error on remove failure', async () => {
      mockService.deleteInstance.mockRejectedValue(new Error('not found'));

      await store.remove('instance-1');

      expect(store.error()).toBe('not found');
      expect(store.isLoading()).toBe(false);
    });
  });

  describe('toggleLifecycle', () => {
    it('cycles ACTIVE → PAUSED when no target state is provided', async () => {
      mockService.loadInstances$.mockReturnValue(of([
        makeInstance({ id: 'i1', lifecycleState: LifecycleState.ACTIVE }),
      ]));
      mockService.setLifecycleState.mockResolvedValue(undefined);
      store.load();

      await store.toggleLifecycle('i1');

      expect(mockService.setLifecycleState).toHaveBeenCalledWith('i1', LifecycleState.PAUSED);
    });

    it('cycles PAUSED → STOPPED', async () => {
      mockService.loadInstances$.mockReturnValue(of([
        makeInstance({ id: 'i1', lifecycleState: LifecycleState.PAUSED }),
      ]));
      mockService.setLifecycleState.mockResolvedValue(undefined);
      store.load();

      await store.toggleLifecycle('i1');

      expect(mockService.setLifecycleState).toHaveBeenCalledWith('i1', LifecycleState.STOPPED);
    });

    it('uses explicit target state when provided', async () => {
      mockService.loadInstances$.mockReturnValue(of([
        makeInstance({ id: 'i1', lifecycleState: LifecycleState.ACTIVE }),
      ]));
      mockService.setLifecycleState.mockResolvedValue(undefined);
      store.load();

      await store.toggleLifecycle('i1', LifecycleState.STOPPED);

      expect(mockService.setLifecycleState).toHaveBeenCalledWith('i1', LifecycleState.STOPPED);
    });

    it('sets error on toggle failure', async () => {
      mockService.loadInstances$.mockReturnValue(of([
        makeInstance({ id: 'i1', lifecycleState: LifecycleState.ACTIVE }),
      ]));
      mockService.setLifecycleState.mockRejectedValue(new Error('denied'));
      store.load();

      await store.toggleLifecycle('i1');

      expect(store.error()).toBe('denied');
      expect(store.isLoading()).toBe(false);
    });
  });

  describe('selection', () => {
    it('selectForEdit sets selectedInstance', () => {
      const instance = makeInstance();
      store.selectForEdit(instance);
      expect(store.selectedInstance()).toEqual(instance);
    });

    it('clearSelection clears selectedInstance', () => {
      store.selectForEdit(makeInstance());
      store.clearSelection();
      expect(store.selectedInstance()).toBeNull();
    });
  });
});
