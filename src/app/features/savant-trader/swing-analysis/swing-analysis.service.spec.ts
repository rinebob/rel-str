// Mock @angular/fire/auth before any imports to avoid Node.js Response error
jest.mock('@angular/fire/auth', () => ({
  Auth: class {},
  authState: jest.fn((auth: { authState: () => unknown }) => auth.authState()),
}));

// Mock @angular/fire/firestore with controllable mock functions
const fsMock = {
  collection: jest.fn((...pathSegments: unknown[]) => {
    // First arg is the Firestore instance — skip it in the path
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
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  getDocs: jest.fn().mockResolvedValue({ docs: [] }),
  query: jest.fn((ref: unknown, ...constraints: unknown[]) => ({ ref, constraints })),
  where: jest.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
};

jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  ...fsMock,
}));


import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { of, firstValueFrom, throwError } from 'rxjs';

import { SwingAnalysisService } from './swing-analysis.service';
import { deriveParamsId } from './swing-analysis.types';

import type { ZigZagConfig } from '../../shared/components/flex-chart/indicators/st-zigzag.engine';

// =============================================================================
// Test helpers
// =============================================================================

const DEFAULT_CONFIG: ZigZagConfig = {
  devThreshold: 5,
  leftDepth: 5,
  rightDepth: 5,
  allowZigZagOnOneBar: true,
  projectionPivots: true,
  lineColor: '#1976d2',
};


// =============================================================================
// Tests
// =============================================================================

describe('SwingAnalysisService', () => {
  let service: SwingAnalysisService;

  beforeEach(() => {
    fsMock.collection.mockClear();
    fsMock.doc.mockClear();
    fsMock.setDoc.mockClear();
    fsMock.getDocs.mockClear();
    fsMock.query.mockClear();
    fsMock.where.mockClear();
    fsMock.setDoc.mockResolvedValue(undefined);
    fsMock.getDocs.mockResolvedValue({ docs: [] });
    fsMock.deleteDoc.mockClear();
    fsMock.deleteDoc.mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: Auth, useValue: { authState: () => of({ uid: 'user-123' }) } },
        { provide: Firestore, useValue: {} },
        SwingAnalysisService,
      ],
    });
    service = TestBed.inject(SwingAnalysisService);
  });

  // -------------------------------------------------------------------------
  // loadSavedAnalyses — path construction
  // -------------------------------------------------------------------------

  describe('loadSavedAnalyses', () => {
    it('queries the flat st-swing-sets collection filtered by symbol and userId', async () => {
      await firstValueFrom(service.loadSavedAnalyses('AAPL'));
      expect(fsMock.collection).toHaveBeenCalledTimes(1);
      const args = fsMock.collection.mock.calls[0];
      expect(args.slice(1)).toEqual(['st-swing-sets']);
      expect(fsMock.where).toHaveBeenCalledWith('symbol', '==', 'AAPL');
      // Required for the deployed rules — list queries must constrain
      // userId so the rules engine can prove ownership on every result.
      expect(fsMock.where).toHaveBeenCalledWith('userId', '==', 'user-123');
    });

    it('normalizes symbol to uppercase', async () => {
      await firstValueFrom(service.loadSavedAnalyses('aapl'));
      expect(fsMock.where).toHaveBeenCalledWith('symbol', '==', 'AAPL');
    });

    it('trims whitespace from symbol', async () => {
      await firstValueFrom(service.loadSavedAnalyses('  AAPL  '));
      expect(fsMock.where).toHaveBeenCalledWith('symbol', '==', 'AAPL');
    });

    it('returns empty array for empty symbol', async () => {
      const result = await firstValueFrom(service.loadSavedAnalyses(''));
      expect(result).toEqual([]);
      expect(fsMock.collection).not.toHaveBeenCalled();
    });

    it('returns empty array for whitespace-only symbol', async () => {
      const result = await firstValueFrom(service.loadSavedAnalyses('   '));
      expect(result).toEqual([]);
      expect(fsMock.collection).not.toHaveBeenCalled();
    });

    it('propagates Firestore errors (does not swallow)', async () => {
      fsMock.getDocs.mockRejectedValue(new Error('firestore down'));
      await expect(firstValueFrom(service.loadSavedAnalyses('AAPL'))).rejects.toThrow('firestore down');
    });
  });

  // -------------------------------------------------------------------------
  // Path segment count validation (the mock-blindness lesson)
  // -------------------------------------------------------------------------

  describe('path segment counts', () => {
    it('collection() receives exactly 1 path segment (odd = valid CollectionReference)', async () => {
      await firstValueFrom(service.loadSavedAnalyses('AAPL'));
      const pathArgs = fsMock.collection.mock.calls[0].slice(1);
      expect(pathArgs.length).toBe(1);
    });
  });

  describe('config library (st-swing-configs)', () => {
    const paramsId = deriveParamsId(DEFAULT_CONFIG);

    describe('deriveParamsId', () => {
      it('pins the id format', () => {
        expect(deriveParamsId(DEFAULT_CONFIG)).toBe('dev5_L5_R5_1barY_projY_trigY');
      });

      it('hashes showTriggerDots — differing only in it produces different ids', () => {
        const withDots = deriveParamsId({ ...DEFAULT_CONFIG, showTriggerDots: true });
        const withoutDots = deriveParamsId({ ...DEFAULT_CONFIG, showTriggerDots: false });
        expect(withDots).not.toBe(withoutDots);
        expect(withDots).toBe(deriveParamsId(DEFAULT_CONFIG)); // unset normalizes to true
      });

      it('ignores lineColor — visual-only field dedupes', () => {
        expect(deriveParamsId({ ...DEFAULT_CONFIG, lineColor: '#ff0000' })).toBe(paramsId);
      });
    });

    describe('loadConfigs', () => {
      it('enumerates st-swing-configs scoped to the current user', async () => {
        await firstValueFrom(service.loadConfigs());
        const args = fsMock.collection.mock.calls[0];
        expect(args.slice(1)).toEqual(['st-swing-configs']);
        expect(fsMock.where).toHaveBeenCalledWith('userId', '==', 'user-123');
      });

      it('maps docs to SwingConfigDoc with id = paramsId', async () => {
        fsMock.getDocs.mockResolvedValue({
          docs: [
            {
              data: () => ({
                name: 'Tight swings',
                config: { ...DEFAULT_CONFIG },
                paramsId,
                savedAt: '2026-09-26T00:00:00.000Z',
                userId: 'user-123',
              }),
              id: paramsId,
            },
          ],
        });
        const result = await firstValueFrom(service.loadConfigs());
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(paramsId);
        expect(result[0].paramsId).toBe(paramsId);
        expect(result[0].name).toBe('Tight swings');
        expect(result[0].config!.devThreshold).toBe(5);
      });

      it('propagates Firestore errors', async () => {
        fsMock.getDocs.mockRejectedValue(new Error('firestore down'));
        await expect(firstValueFrom(service.loadConfigs())).rejects.toThrow('firestore down');
      });

      it('requires auth', async () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
          providers: [
            provideZonelessChangeDetection(),
            { provide: Auth, useValue: { authState: () => of(null) } },
            { provide: Firestore, useValue: {} },
            SwingAnalysisService,
          ],
        });
        const unauth = TestBed.inject(SwingAnalysisService);
        await expect(firstValueFrom(unauth.loadConfigs())).rejects.toThrow('Authentication required');
        expect(fsMock.getDocs).not.toHaveBeenCalled();
      });
    });

    describe('saveConfig', () => {
      it('writes st-swing-configs/{paramsId} with slim shape — no snapshot fields', async () => {
        await firstValueFrom(
          service.saveConfig({ name: 'Tight', config: { ...DEFAULT_CONFIG }, savedAt: '2026-09-26T00:00:00.000Z' }),
        );
        const [ref, payload] = fsMock.setDoc.mock.calls[0];
        expect(ref.path).toBe(`st-swing-configs/${paramsId}`);
        expect(payload.userId).toBe('user-123');
        expect(payload.paramsId).toBe(paramsId);
        expect(payload.name).toBe('Tight');
        expect(payload.config!.devThreshold).toBe(5);
        expect(payload.savedAt).toBe('2026-09-26T00:00:00.000Z');
        // slim shape — none of the heavyweight snapshot fields
        expect(payload.symbol).toBeUndefined();
        expect(payload.pivots).toBeUndefined();
        expect(payload.swings).toBeUndefined();
        expect(payload.stats).toBeUndefined();
        expect(payload.id).toBeUndefined();
      });

      it('rejects an input with neither config nor configs — no silent no-write', async () => {
        await expect(
          firstValueFrom(service.saveConfig({ savedAt: 't' })),
        ).rejects.toThrow('requires config or non-empty configs');
        expect(fsMock.setDoc).not.toHaveBeenCalled();
        await expect(
          firstValueFrom(service.saveConfig({ configs: [], savedAt: 't' })),
        ).rejects.toThrow('requires config or non-empty configs');
      });

      it('writes a set doc keyed by the joined member paramsIds', async () => {
        const configs = [
          { ...DEFAULT_CONFIG },
          { ...DEFAULT_CONFIG, devThreshold: 3, leftDepth: 3, rightDepth: 3 },
        ];
        await firstValueFrom(service.saveConfig({ configs, savedAt: 't' }));
        const [ref, payload] = fsMock.setDoc.mock.calls[0];
        expect(ref.path.startsWith('st-swing-configs/set_')).toBe(true);
        expect(ref.path).toContain('+');
        expect(payload.configs).toHaveLength(2);
        expect(payload.config).toBeUndefined();
      });

      it('saves without a name (optional field omitted)', async () => {
        await firstValueFrom(
          service.saveConfig({ config: { ...DEFAULT_CONFIG }, savedAt: '2026-09-26T00:00:00.000Z' }),
        );
        const payload = fsMock.setDoc.mock.calls[0][1];
        expect('name' in payload).toBe(false);
      });

      it('trims and treats whitespace-only name as absent', async () => {
        await firstValueFrom(
          service.saveConfig({ name: '   ', config: { ...DEFAULT_CONFIG }, savedAt: 't' }),
        );
        expect('name' in fsMock.setDoc.mock.calls[0][1]).toBe(false);
        await firstValueFrom(
          service.saveConfig({ name: '  Tight  ', config: { ...DEFAULT_CONFIG }, savedAt: 't' }),
        );
        expect(fsMock.setDoc.mock.calls[1][1].name).toBe('Tight');
      });

      it('is idempotent — identical params overwrite the same doc id', async () => {
        await firstValueFrom(service.saveConfig({ config: { ...DEFAULT_CONFIG }, savedAt: 't1' }));
        await firstValueFrom(service.saveConfig({ config: { ...DEFAULT_CONFIG }, savedAt: 't2' }));
        const paths = fsMock.setDoc.mock.calls.map((c) => c[0].path);
        expect(new Set(paths).size).toBe(1);
      });

      it('propagates Firestore errors', async () => {
        fsMock.setDoc.mockRejectedValue(new Error('permission denied'));
        await expect(
          firstValueFrom(service.saveConfig({ config: { ...DEFAULT_CONFIG }, savedAt: 't' })),
        ).rejects.toThrow('permission denied');
      });

      it('throws when not authenticated', async () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
          providers: [
            provideZonelessChangeDetection(),
            { provide: Auth, useValue: { authState: () => of(null) } },
            { provide: Firestore, useValue: {} },
            SwingAnalysisService,
          ],
        });
        const unauth = TestBed.inject(SwingAnalysisService);
        await expect(
          firstValueFrom(unauth.saveConfig({ config: { ...DEFAULT_CONFIG }, savedAt: 't' })),
        ).rejects.toThrow('Authentication required');
        expect(fsMock.setDoc).not.toHaveBeenCalled();
      });
    });

    describe('deleteConfig', () => {
      it('deletes st-swing-configs/{paramsId}', async () => {
        await firstValueFrom(service.deleteConfig(paramsId));
        expect(fsMock.deleteDoc).toHaveBeenCalledTimes(1);
        const ref = fsMock.deleteDoc.mock.calls[0][0];
        expect(ref.path).toBe(`st-swing-configs/${paramsId}`);
      });

      it('no-ops on empty paramsId', async () => {
        await firstValueFrom(service.deleteConfig(''));
        expect(fsMock.deleteDoc).not.toHaveBeenCalled();
      });

      it('propagates Firestore errors', async () => {
        fsMock.deleteDoc.mockRejectedValue(new Error('not found'));
        await expect(firstValueFrom(service.deleteConfig(paramsId))).rejects.toThrow('not found');
      });

      it('requires auth', async () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
          providers: [
            provideZonelessChangeDetection(),
            { provide: Auth, useValue: { authState: () => of(null) } },
            { provide: Firestore, useValue: {} },
            SwingAnalysisService,
          ],
        });
        const unauth = TestBed.inject(SwingAnalysisService);
        await expect(firstValueFrom(unauth.deleteConfig(paramsId))).rejects.toThrow('Authentication required');
        expect(fsMock.deleteDoc).not.toHaveBeenCalled();
      });
    });

    describe('path segment counts', () => {
      it('collection() receives exactly 1 path segment in loadConfigs', async () => {
        await firstValueFrom(service.loadConfigs());
        expect(fsMock.collection.mock.calls[0].slice(1).length).toBe(1);
      });

      it('doc() receives exactly 2 path segments in saveConfig', async () => {
        await firstValueFrom(service.saveConfig({ config: { ...DEFAULT_CONFIG }, savedAt: 't' }));
        expect(fsMock.doc.mock.calls[0].slice(1).length).toBe(2);
      });

      it('doc() receives exactly 2 path segments in deleteConfig', async () => {
        await firstValueFrom(service.deleteConfig(paramsId));
        expect(fsMock.doc.mock.calls[0].slice(1).length).toBe(2);
      });
    });
  });
});
