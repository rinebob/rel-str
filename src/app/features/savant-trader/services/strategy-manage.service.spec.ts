/// <reference types="jest" />
/**
 * Unit tests for StrategyManageService — verifies the ManageInstance stream:
 * userId scoping, manage-shape discrimination on the shared
 * `st-strategy-instances` root (legacy docs carry no `runState`), soft-delete
 * filtering, and sort order.
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
  updateDoc,
  query,
  where,
} from '@angular/fire/firestore';
import { firstValueFrom, of } from 'rxjs';

import { StrategyManageService } from './strategy-manage.service';
import { ST_STRATEGY_INSTANCES_ROOT } from '@st/collections';
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

describe('StrategyManageService', () => {
  let service: StrategyManageService;
  const currentUser = { uid: 'test-user' };

  const mockCollection = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    (collection as jest.Mock).mockReturnValue(mockCollection);
    (collectionData as jest.Mock).mockImplementation(
      () => (collectionData as any).mockData ?? of([]),
    );
    (query as jest.Mock).mockImplementation((ref, ...constraints) => ({ ref, constraints }));
    (where as jest.Mock).mockImplementation((field, op, value) => ({ field, op, value }));

    TestBed.configureTestingModule({
      providers: [
        StrategyManageService,
        { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: { currentUser } },
      ],
    });
    service = TestBed.inject(StrategyManageService);
  });

  it('queries the shared instances root scoped to the current user', async () => {
    await firstValueFrom(service.loadInstances$());

    expect(collection).toHaveBeenCalledWith(expect.anything(), ST_STRATEGY_INSTANCES_ROOT);
    expect(where).toHaveBeenCalledWith('userId', '==', 'test-user');
    expect(query).toHaveBeenCalled();
  });

  it('streams manage-shaped docs as ManageInstance', async () => {
    const doc = makeInstance();
    (collectionData as any).mockData = of([doc]);

    const instances = await firstValueFrom(service.loadInstances$());

    expect(instances).toEqual([doc]);
  });

  it('drops legacy docs that carry no runState', async () => {
    const legacy = { id: 'legacy-1', symbol: 'SPY', userId: 'test-user' };
    (collectionData as any).mockData = of([legacy, makeInstance()]);

    const instances = await firstValueFrom(service.loadInstances$());

    expect(instances.map((i) => i.id)).toEqual(['QQQ-CDS-30-50-40-ALL']);
  });

  it('drops docs with a runState outside the manage vocabulary', async () => {
    const corrupt = { ...makeInstance({ id: 'bad' }), runState: 'PAUSED' };
    (collectionData as any).mockData = of([corrupt, makeInstance()]);

    const instances = await firstValueFrom(service.loadInstances$());

    expect(instances.map((i) => i.id)).toEqual(['QQQ-CDS-30-50-40-ALL']);
  });

  it('drops manage-shaped docs missing the embedded variant', async () => {
    const { variant: _variant, ...malformed } = makeInstance({ id: 'broken' });
    (collectionData as any).mockData = of([malformed, makeInstance()]);

    const instances = await firstValueFrom(service.loadInstances$());

    expect(instances.map((i) => i.id)).toEqual(['QQQ-CDS-30-50-40-ALL']);
  });

  it('drops soft-deleted docs', async () => {
    const deleted = makeInstance({ id: 'gone', deletedAt: '2026-11-10T00:00:00Z' });
    (collectionData as any).mockData = of([deleted, makeInstance()]);

    const instances = await firstValueFrom(service.loadInstances$());

    expect(instances.map((i) => i.id)).toEqual(['QQQ-CDS-30-50-40-ALL']);
  });

  it('sorts newest first by createdAt', async () => {
    const older = makeInstance({ id: 'old', createdAt: '2026-10-01T00:00:00Z' });
    const newer = makeInstance({ id: 'new', createdAt: '2026-11-15T00:00:00Z' });
    (collectionData as any).mockData = of([older, newer]);

    const instances = await firstValueFrom(service.loadInstances$());

    expect(instances.map((i) => i.id)).toEqual(['new', 'old']);
  });

  it('errors when there is no authenticated user', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        StrategyManageService,
        { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: { currentUser: null } },
      ],
    });
    service = TestBed.inject(StrategyManageService);

    await expect(firstValueFrom(service.loadInstances$())).rejects.toThrow(
      'Authentication required',
    );
  });

  describe('setRunState', () => {
    it('writes runState + updatedAt to the instance doc', async () => {
      const mockDoc = {};
      (doc as jest.Mock).mockReturnValue(mockDoc);
      (updateDoc as jest.Mock).mockResolvedValue(undefined);

      await service.setRunState('QQQ-CDS-30-50-40-ALL', 'ACTIVE');

      expect(doc).toHaveBeenCalledWith(
        expect.anything(),
        `${ST_STRATEGY_INSTANCES_ROOT}/QQQ-CDS-30-50-40-ALL`,
      );
      const payload = (updateDoc as jest.Mock).mock.calls[0][1];
      expect(payload.runState).toBe('ACTIVE');
      expect(typeof payload.updatedAt).toBe('string');
    });

    it('throws when there is no authenticated user', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          StrategyManageService,
          { provide: Firestore, useValue: {} },
          { provide: Auth, useValue: { currentUser: null } },
        ],
      });
      service = TestBed.inject(StrategyManageService);

      await expect(service.setRunState('id', 'ACTIVE')).rejects.toThrow(
        'Authentication required',
      );
      expect(updateDoc).not.toHaveBeenCalled();
    });
  });
});
