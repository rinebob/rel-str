/// <reference types="jest" />
/**
 * Unit tests for StrategyBuilderService — verifies Firestore CRUD operations,
 * userId scoping, and error handling.
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
}));



import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  setDoc,
  updateDoc,
  query,
  where,
} from '@angular/fire/firestore';
import { of } from 'rxjs';

import { StrategyBuilderService } from './strategy-builder.service';
import { Collection } from '../../../core/common/constants';
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

describe('StrategyBuilderService', () => {
  let service: StrategyBuilderService;
  const currentUser = { uid: 'test-user' };

  const mockCollection = jest.fn();
  const mockDoc = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    (collection as jest.Mock).mockReturnValue(mockCollection);
    (doc as jest.Mock).mockReturnValue(mockDoc);
    (collectionData as jest.Mock).mockImplementation((q) => (collectionData as any).mockData ?? of([]));
    (query as jest.Mock).mockImplementation((ref, ...constraints) => ({ ref, constraints }));
    (where as jest.Mock).mockImplementation((field, op, value) => ({ field, op, value }));

    TestBed.configureTestingModule({
      providers: [
        StrategyBuilderService,
        { provide: Auth, useValue: { currentUser } },
        { provide: Firestore, useValue: {} },
      ],
    });
    service = TestBed.inject(StrategyBuilderService);
  });

  describe('loadInstances$', () => {
    it('queries instances scoped to the current user and sorts active first', (done) => {
      (collectionData as any).mockData = of([
        makeInstance({ id: 'paused-1', lifecycleState: LifecycleState.PAUSED, createdAt: '2025-08-17T00:00:00Z' }),
        makeInstance({ id: 'active-1', lifecycleState: LifecycleState.ACTIVE, createdAt: '2025-08-16T00:00:00Z' }),
        makeInstance({ id: 'stopped-1', lifecycleState: LifecycleState.STOPPED, createdAt: '2025-08-18T00:00:00Z' }),
      ]);

      service.loadInstances$().subscribe({
        next: (result) => {
          expect(where).toHaveBeenCalledWith('userId', '==', 'test-user');
          expect(result.map((i) => i.id)).toEqual(['active-1', 'paused-1', 'stopped-1']);
          done();
        },
        error: done.fail,
      });
    });

    it('returns sorted by createdAt descending within the same lifecycle state', (done) => {
      (collectionData as any).mockData = of([
        makeInstance({ id: 'active-1', lifecycleState: LifecycleState.ACTIVE, createdAt: '2025-08-15T00:00:00Z' }),
        makeInstance({ id: 'active-2', lifecycleState: LifecycleState.ACTIVE, createdAt: '2025-08-17T00:00:00Z' }),
      ]);

      service.loadInstances$().subscribe({
        next: (result) => {
          expect(result.map((i) => i.id)).toEqual(['active-2', 'active-1']);
          done();
        },
        error: done.fail,
      });
    });

    it('throws authentication error when no user is logged in', (done) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          StrategyBuilderService,
          { provide: Auth, useValue: { currentUser: null } },
          { provide: Firestore, useValue: {} },
        ],
      });
      const noAuthService = TestBed.inject(StrategyBuilderService);

      noAuthService.loadInstances$().subscribe({
        next: () => done.fail('expected error'),
        error: (err: Error) => {
          expect(err.message).toBe('Authentication required');
          done();
        },
      });
    });
  });

  describe('createInstance', () => {
    it('writes a doc with a naming-convention ID, userId, and timestamps', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      jest.setSystemTime(new Date('2025-08-16T00:00:00Z'));
      (doc as jest.Mock).mockReturnValue({ id: 'unused' });
      (setDoc as jest.Mock).mockResolvedValue(undefined);

      const input = makeInstance();
      await service.createInstance(input);

      expect(doc).toHaveBeenCalledWith(
        expect.anything(),
        `${Collection.OPTIONS_STRATEGY_INSTANCES}/250816-QQQM-CSP-020-30-D-1200`,
      );
      expect(setDoc).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'unused' }),
        expect.objectContaining({
          userId: 'test-user',
          symbol: 'QQQM',
          lifecycleState: LifecycleState.ACTIVE,
          createdAt: '2025-08-16T00:00:00.000Z',
          updatedAt: '2025-08-16T00:00:00.000Z',
        }),
      );

      jest.useRealTimers();
    });
  });

  describe('updateInstance', () => {
    it('merges changes and sets updatedAt', async () => {
      (updateDoc as jest.Mock).mockResolvedValue(undefined);

      await service.updateInstance('instance-1', { symbol: 'SPY' });

      expect(doc).toHaveBeenCalledWith(expect.anything(), `${Collection.OPTIONS_STRATEGY_INSTANCES}/instance-1`);
      expect(updateDoc).toHaveBeenCalledWith(
        mockDoc,
        expect.objectContaining({
          symbol: 'SPY',
          updatedAt: expect.any(String),
        }),
      );
    });
  });

  describe('deleteInstance', () => {
    it('soft-deletes by setting STOPPED and deletedAt', async () => {
      (updateDoc as jest.Mock).mockResolvedValue(undefined);

      await service.deleteInstance('instance-1');

      expect(updateDoc).toHaveBeenCalledWith(
        mockDoc,
        expect.objectContaining({
          lifecycleState: LifecycleState.STOPPED,
          deletedAt: expect.any(String),
          updatedAt: expect.any(String),
        }),
      );
    });
  });

  describe('setLifecycleState', () => {
    it('updates only the lifecycle state and updatedAt', async () => {
      (updateDoc as jest.Mock).mockResolvedValue(undefined);

      await service.setLifecycleState('instance-1', LifecycleState.PAUSED);

      expect(updateDoc).toHaveBeenCalledWith(
        mockDoc,
        expect.objectContaining({
          lifecycleState: LifecycleState.PAUSED,
          updatedAt: expect.any(String),
        }),
      );
    });
  });
});
