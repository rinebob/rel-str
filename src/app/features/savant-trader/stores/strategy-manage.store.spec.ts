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
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
}));

import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';

import { StrategyManageStore } from './strategy-manage.store';
import { StrategyManageService } from '../services/strategy-manage.service';
import { MANAGE_VARIANTS } from '@manage/variant-catalog';
import type { ManageInstance } from '@manage/instance-contracts';

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

describe('StrategyManageStore', () => {
  let store: InstanceType<typeof StrategyManageStore>;
  let mockService: { loadInstances$: jest.Mock };

  beforeEach(() => {
    mockService = { loadInstances$: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        StrategyManageStore,
        { provide: StrategyManageService, useValue: mockService },
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
});
