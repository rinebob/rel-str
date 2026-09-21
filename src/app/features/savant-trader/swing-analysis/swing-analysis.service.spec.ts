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
  getDoc: jest.fn().mockResolvedValue({
    exists: () => false,
    data: () => undefined,
    id: '',
  }),
  getDocs: jest.fn().mockResolvedValue({ docs: [] }),
  query: jest.fn((ref: unknown, ...constraints: unknown[]) => ({ ref, constraints })),
  where: jest.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  collectionData: jest.fn(),
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
import type { SwingAnalysisInput } from './swing-analysis.types';
import type { ZigZagConfig, SwingStats } from '../../shared/components/flex-chart/indicators/st-zigzag.engine';

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

function makeStats(): SwingStats {
  return {
    up: {
      count: 1,
      magnitudePercent: { mean: 5, median: 5, stdDev: 0, min: 5, max: 5, p10: 5, p25: 5, p50: 5, p75: 5, p90: 5 },
      magnitudeAbsolute: { mean: 10, median: 10, stdDev: 0, min: 10, max: 10, p10: 10, p25: 10, p50: 10, p75: 10, p90: 10 },
      duration: { mean: 5, median: 5, stdDev: 0, min: 5, max: 5, p10: 5, p25: 5, p50: 5, p75: 5, p90: 5 },
      magnitudeHistogram: { bins: [] },
      durationHistogram: { bins: [] },
    },
    down: {
      count: 1,
      magnitudePercent: { mean: -3, median: -3, stdDev: 0, min: -3, max: -3, p10: -3, p25: -3, p50: -3, p75: -3, p90: -3 },
      magnitudeAbsolute: { mean: 6, median: 6, stdDev: 0, min: 6, max: 6, p10: 6, p25: 6, p50: 6, p75: 6, p90: 6 },
      duration: { mean: 3, median: 3, stdDev: 0, min: 3, max: 3, p10: 3, p25: 3, p50: 3, p75: 3, p90: 3 },
      magnitudeHistogram: { bins: [] },
      durationHistogram: { bins: [] },
    },
  };
}

/** Build a SwingAnalysisInput (no id, no userId — those are added by the service). */
function makeInput(overrides: Partial<SwingAnalysisInput> = {}): SwingAnalysisInput {
  return {
    symbol: 'AAPL',
    paramsId: deriveParamsId(DEFAULT_CONFIG),
    config: { ...DEFAULT_CONFIG },
    pivots: [],
    projection: null,
    swings: [],
    stats: makeStats(),
    savedAt: '2026-09-16T00:00:00.000Z',
    ...overrides,
  };
}

/** Build a full Firestore doc shape (what fromFirestore returns). */
function makeFirestoreDoc(overrides: Partial<SwingAnalysisInput & { id: string; userId: string }> = {}) {
  return {
    id: deriveParamsId(DEFAULT_CONFIG),
    userId: 'user-123',
    symbol: 'AAPL',
    paramsId: deriveParamsId(DEFAULT_CONFIG),
    config: { ...DEFAULT_CONFIG },
    pivots: [],
    projection: null,
    swings: [],
    stats: makeStats(),
    savedAt: '2026-09-16T00:00:00.000Z',
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('SwingAnalysisService', () => {
  let service: SwingAnalysisService;

  beforeEach(() => {
    fsMock.collection.mockClear();
    fsMock.doc.mockClear();
    fsMock.setDoc.mockClear();
    fsMock.getDoc.mockClear();
    fsMock.getDocs.mockClear();
    fsMock.collectionData.mockClear();
    fsMock.setDoc.mockResolvedValue(undefined);
    fsMock.getDoc.mockResolvedValue({
      exists: () => false,
      data: () => undefined,
      id: '',
    });
    fsMock.getDocs.mockResolvedValue({ docs: [] });
    fsMock.collectionData.mockReturnValue(of([]));

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
  // saveAnalysis — path construction + payload + userId stamping
  // -------------------------------------------------------------------------

  describe('saveAnalysis', () => {
    it('constructs doc path st-swing-sets/{symbol}_{paramsId}', async () => {
      await firstValueFrom(service.saveAnalysis(makeInput()));
      expect(fsMock.doc).toHaveBeenCalledTimes(1);
      const args = fsMock.doc.mock.calls[0];
      expect(args.slice(1)).toEqual([
        'st-swing-sets', `AAPL_${deriveParamsId(DEFAULT_CONFIG)}`,
      ]);
    });

    it('calls setDoc with the doc reference and stamped payload (no id field)', async () => {
      const input = makeInput();
      await firstValueFrom(service.saveAnalysis(input));
      expect(fsMock.setDoc).toHaveBeenCalledTimes(1);
      const [ref, payload] = fsMock.setDoc.mock.calls[0];
      expect(ref.path).toBe(`st-swing-sets/AAPL_${deriveParamsId(DEFAULT_CONFIG)}`);
      expect(payload.userId).toBe('user-123');
      expect(payload.symbol).toBe('AAPL');
      expect(payload.paramsId).toBe(deriveParamsId(DEFAULT_CONFIG));
      expect(payload.id).toBeUndefined();
    });

    it('does not persist bars in the saved document', async () => {
      await firstValueFrom(service.saveAnalysis(makeInput()));
      const payload = fsMock.setDoc.mock.calls[0][1];
      expect(payload.bars).toBeUndefined();
    });

    it('stamps userId from the authenticated user', async () => {
      await firstValueFrom(service.saveAnalysis(makeInput()));
      const payload = fsMock.setDoc.mock.calls[0][1];
      expect(payload.userId).toBe('user-123');
    });

    it('normalizes symbol to uppercase in the doc path', async () => {
      await firstValueFrom(service.saveAnalysis(makeInput({ symbol: 'msft' })));
      const args = fsMock.doc.mock.calls[0];
      expect(args.slice(1)).toEqual([
        'st-swing-sets', `MSFT_${deriveParamsId(DEFAULT_CONFIG)}`,
      ]);
    });

    it('completes without error on success', async () => {
      const result = await firstValueFrom(service.saveAnalysis(makeInput()));
      expect(result).toBeUndefined();
    });

    it('propagates Firestore errors (does not swallow)', async () => {
      fsMock.setDoc.mockRejectedValue(new Error('permission denied'));
      await expect(firstValueFrom(service.saveAnalysis(makeInput()))).rejects.toThrow('permission denied');
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
      const unauthService = TestBed.inject(SwingAnalysisService);
      await expect(firstValueFrom(unauthService.saveAnalysis(makeInput()))).rejects.toThrow('Authentication required');
      expect(fsMock.setDoc).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // loadAnalysis — path construction + single-doc read
  // -------------------------------------------------------------------------

  describe('loadAnalysis', () => {
    it('constructs doc path st-swing-sets/{symbol}_{docId}', async () => {
      await firstValueFrom(service.loadAnalysis('AAPL', 'dev5_L5_R5_1barY_projY'));
      expect(fsMock.doc).toHaveBeenCalledTimes(1);
      const args = fsMock.doc.mock.calls[0];
      expect(args.slice(1)).toEqual([
        'st-swing-sets', 'AAPL_dev5_L5_R5_1barY_projY',
      ]);
    });

    it('normalizes symbol to uppercase', async () => {
      await firstValueFrom(service.loadAnalysis('aapl', 'dev5_L5_R5_1barY_projY'));
      const args = fsMock.doc.mock.calls[0];
      expect(args.slice(1)).toEqual([
        'st-swing-sets', 'AAPL_dev5_L5_R5_1barY_projY',
      ]);
    });

    it('returns null for empty symbol', async () => {
      const result = await firstValueFrom(service.loadAnalysis('', 'dev5_L5_R5_1barY_projY'));
      expect(result).toBeNull();
      expect(fsMock.doc).not.toHaveBeenCalled();
    });

    it('returns null for empty docId', async () => {
      const result = await firstValueFrom(service.loadAnalysis('AAPL', ''));
      expect(result).toBeNull();
      expect(fsMock.doc).not.toHaveBeenCalled();
    });

    it('returns null when doc does not exist', async () => {
      fsMock.getDoc.mockResolvedValue({
        exists: () => false,
        data: () => undefined,
        id: 'dev5_L5_R5_1barY_projY',
      });
      const result = await firstValueFrom(service.loadAnalysis('AAPL', 'dev5_L5_R5_1barY_projY'));
      expect(result).toBeNull();
    });

    it('returns the doc with id when it exists', async () => {
      const docData = makeFirestoreDoc();
      fsMock.getDoc.mockResolvedValue({
        exists: () => true,
        data: () => {
          const { id, ...rest } = docData;
          return rest;
        },
        id: docData.id,
      });
      const result = await firstValueFrom(service.loadAnalysis('AAPL', docData.id));
      expect(result).not.toBeNull();
      expect(result!.id).toBe(docData.id);
      expect(result!.symbol).toBe(docData.symbol);
      expect(result!.paramsId).toBe(docData.paramsId);
      expect(result!.userId).toBe('user-123');
    });

    it('propagates Firestore errors (does not swallow)', async () => {
      fsMock.getDoc.mockRejectedValue(new Error('network error'));
      await expect(firstValueFrom(service.loadAnalysis('AAPL', 'dev5_L5_R5_1barY_projY'))).rejects.toThrow('network error');
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

    it('doc() in saveAnalysis receives exactly 2 path segments (even = valid DocumentReference)', async () => {
      await firstValueFrom(service.saveAnalysis(makeInput()));
      const pathArgs = fsMock.doc.mock.calls[0].slice(1);
      expect(pathArgs.length).toBe(2);
    });

    it('doc() in loadAnalysis receives exactly 2 path segments (even = valid DocumentReference)', async () => {
      await firstValueFrom(service.loadAnalysis('AAPL', 'dev5_L5_R5_1barY_projY'));
      const pathArgs = fsMock.doc.mock.calls[0].slice(1);
      expect(pathArgs.length).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // loadAllSwingSets — flat collection enumeration for the saved-sets browser
  // -------------------------------------------------------------------------

  describe('loadAllSwingSets', () => {
    it('reads the flat st-swing-sets collection scoped to the current user', async () => {
      await firstValueFrom(service.loadAllSwingSets());
      const args = fsMock.collection.mock.calls[0];
      expect(args.slice(1)).toEqual(['st-swing-sets']);
      expect(fsMock.getDocs).toHaveBeenCalledTimes(1);
      expect(fsMock.where).toHaveBeenCalledWith('userId', '==', 'user-123');
    });

    it('maps docs to SwingAnalysisDoc with id', async () => {
      fsMock.getDocs.mockResolvedValue({
        docs: [
          { data: () => makeFirestoreDoc(), id: 'AAPL_dev5_L5_R5_1barY_projY' },
        ],
      });
      const result = await firstValueFrom(service.loadAllSwingSets());
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('AAPL_dev5_L5_R5_1barY_projY');
      expect(result[0].symbol).toBe('AAPL');
    });
  });
});
