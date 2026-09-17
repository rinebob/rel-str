// Mock @angular/fire/firestore with controllable mock functions
const fsMock = {
  collection: jest.fn((...pathSegments: unknown[]) => {
    const segments = pathSegments.slice(1);
    return {
      path: segments.join('/'),
      withConverter: () => ({ path: segments.join('/') }),
    };
  }),
  doc: jest.fn((...pathSegments: unknown[]) => {
    const segments = pathSegments.slice(1);
    return { path: segments.join('/') };
  }),
  setDoc: jest.fn().mockResolvedValue(undefined),
  getDocs: jest.fn().mockResolvedValue({ docs: [] }),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  ...fsMock,
}));

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';

import { PctChangeConfigService } from './pct-change-config.service';
import { OptionType } from '@options-contract/contracts';
import type { PctChangeConfigDoc } from '@shared/pct-change-config-contracts';

// =============================================================================
// Test helpers
// =============================================================================

function makeConfig(overrides: Partial<PctChangeConfigDoc> = {}): PctChangeConfigDoc {
  return {
    symbol: 'QQQ',
    startDate: '2025-04-07',
    type: OptionType.CALL,
    targetType: 'pct-change',
    targetDates: ['2025-04-10', '2025-04-15'],
    pctMode: 'list',
    pctValues: [-3, 5, 10],
    filter: { type: OptionType.CALL },
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('PctChangeConfigService', () => {
  let service: PctChangeConfigService;

  beforeEach(() => {
    fsMock.collection.mockClear();
    fsMock.doc.mockClear();
    fsMock.setDoc.mockClear();
    fsMock.getDocs.mockClear();
    fsMock.deleteDoc.mockClear();
    fsMock.setDoc.mockResolvedValue(undefined);
    fsMock.deleteDoc.mockResolvedValue(undefined);
    fsMock.getDocs.mockResolvedValue({ docs: [] });

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: Firestore, useValue: {} },
        PctChangeConfigService,
      ],
    });
    service = TestBed.inject(PctChangeConfigService);
  });

  // -------------------------------------------------------------------------
  // loadConfigs — path construction
  // -------------------------------------------------------------------------

  describe('loadConfigs', () => {
    it('constructs collection path configs/option-chain-pct-change/configs', async () => {
      await firstValueFrom(service.loadConfigs());
      expect(fsMock.collection).toHaveBeenCalledTimes(1);
      const args = fsMock.collection.mock.calls[0];
      expect(args.slice(1)).toEqual(['configs', 'option-chain-pct-change', 'configs']);
    });

    it('returns empty array when no configs exist', async () => {
      fsMock.getDocs.mockResolvedValue({ docs: [] });
      const result = await firstValueFrom(service.loadConfigs());
      expect(result).toEqual([]);
    });

    it('returns configs with ids from snapshot', async () => {
      const cfg = makeConfig();
      fsMock.getDocs.mockResolvedValue({
        docs: [
          {
            id: 'QQQ-2025-04-07-3-pct-change-abc123',
            data: () => {
              const { ...data } = cfg;
              return data;
            },
          },
        ],
      });
      const result = await firstValueFrom(service.loadConfigs());
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('QQQ-2025-04-07-3-pct-change-abc123');
      expect(result[0].symbol).toBe('QQQ');
    });

    it('propagates Firestore errors (does not swallow)', async () => {
      fsMock.getDocs.mockRejectedValue(new Error('firestore down'));
      await expect(firstValueFrom(service.loadConfigs())).rejects.toThrow('firestore down');
    });
  });

  // -------------------------------------------------------------------------
  // saveConfig — path construction + payload
  // -------------------------------------------------------------------------

  describe('saveConfig', () => {
    it('constructs doc path configs/option-chain-pct-change/configs/{configId}', async () => {
      const cfg = { ...makeConfig(), id: 'test-id-123' };
      await firstValueFrom(service.saveConfig(cfg));
      expect(fsMock.doc).toHaveBeenCalledTimes(1);
      const args = fsMock.doc.mock.calls[0];
      expect(args.slice(1)).toEqual([
        'configs', 'option-chain-pct-change', 'configs', 'test-id-123',
      ]);
    });

    it('calls setDoc with the doc reference and payload (id stripped)', async () => {
      const cfg = { ...makeConfig(), id: 'test-id-123' };
      await firstValueFrom(service.saveConfig(cfg));
      expect(fsMock.setDoc).toHaveBeenCalledTimes(1);
      const [ref, payload] = fsMock.setDoc.mock.calls[0];
      expect(ref.path).toBe('configs/option-chain-pct-change/configs/test-id-123');
      expect(payload.symbol).toBe('QQQ');
      expect(payload.targetType).toBe('pct-change');
      expect(payload.id).toBeUndefined();
    });

    it('completes without error on success', async () => {
      const result = await firstValueFrom(service.saveConfig({ ...makeConfig(), id: 'test-id-123' }));
      expect(result).toBeUndefined();
    });

    it('propagates Firestore errors (does not swallow)', async () => {
      fsMock.setDoc.mockRejectedValue(new Error('permission denied'));
      await expect(firstValueFrom(service.saveConfig({ ...makeConfig(), id: 'test-id-123' }))).rejects.toThrow('permission denied');
    });
  });

  // -------------------------------------------------------------------------
  // deleteConfig — path construction
  // -------------------------------------------------------------------------

  describe('deleteConfig', () => {
    it('constructs doc path configs/option-chain-pct-change/configs/{configId}', async () => {
      await firstValueFrom(service.deleteConfig('test-id-456'));
      expect(fsMock.doc).toHaveBeenCalledTimes(1);
      const args = fsMock.doc.mock.calls[0];
      expect(args.slice(1)).toEqual([
        'configs', 'option-chain-pct-change', 'configs', 'test-id-456',
      ]);
    });

    it('calls deleteDoc with the doc reference', async () => {
      await firstValueFrom(service.deleteConfig('test-id-456'));
      expect(fsMock.deleteDoc).toHaveBeenCalledTimes(1);
      const [ref] = fsMock.deleteDoc.mock.calls[0];
      expect(ref.path).toBe('configs/option-chain-pct-change/configs/test-id-456');
    });

    it('completes without error on success', async () => {
      const result = await firstValueFrom(service.deleteConfig('test-id-456'));
      expect(result).toBeUndefined();
    });

    it('propagates Firestore errors (does not swallow)', async () => {
      fsMock.deleteDoc.mockRejectedValue(new Error('permission denied'));
      await expect(firstValueFrom(service.deleteConfig('test-id-456'))).rejects.toThrow('permission denied');
    });
  });

  // -------------------------------------------------------------------------
  // Path segment count validation (the mock-blindness lesson)
  // -------------------------------------------------------------------------

  describe('path segment counts', () => {
    it('collection() receives exactly 3 path segments (odd = valid CollectionReference)', async () => {
      await firstValueFrom(service.loadConfigs());
      const pathArgs = fsMock.collection.mock.calls[0].slice(1);
      expect(pathArgs.length).toBe(3);
    });

    it('doc() in saveConfig receives exactly 4 path segments (even = valid DocumentReference)', async () => {
      await firstValueFrom(service.saveConfig({ ...makeConfig(), id: 'test-id-123' }));
      const pathArgs = fsMock.doc.mock.calls[0].slice(1);
      expect(pathArgs.length).toBe(4);
    });

    it('doc() in deleteConfig receives exactly 4 path segments (even = valid DocumentReference)', async () => {
      await firstValueFrom(service.deleteConfig('test-id-456'));
      const pathArgs = fsMock.doc.mock.calls[0].slice(1);
      expect(pathArgs.length).toBe(4);
    });
  });
});
