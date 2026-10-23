/**
 * ScannerService specs (#1098/#1139) — Firestore and Auth mocked at the
 * @angular/fire boundary (same pattern as allocation-bucket.service.spec);
 * RobinhoodMcpClient is the injected seam for scan calls.
 */

const mockDocs = { docs: [] as { id: string; data: () => unknown }[] };
const mockGetDoc = { exists: () => false, id: '', data: () => ({}) };

jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  addDoc: jest.fn(() => Promise.resolve({ id: 'prop-1' })),
  collection: jest.fn((_fs: unknown, path: string) => ({ path })),
  doc: jest.fn((_fs: unknown, path: string) => ({ path })),
  getDoc: jest.fn(() => Promise.resolve(mockGetDoc)),
  getDocs: jest.fn(() => Promise.resolve(mockDocs)),
  orderBy: jest.fn((field: string, dir: string) => ({ orderBy: [field, dir] })),
  query: jest.fn((ref: unknown, ...constraints: unknown[]) => ({ ref, constraints })),
}));

jest.mock('@angular/fire/auth', () => ({
  Auth: class {},
  authState: jest.fn(() => of({ uid: 'user-1' })),
}));

import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { addDoc, collection, Firestore, orderBy, query } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';

import { authState } from '@angular/fire/auth';

import { ScannerService } from './scanner.service';
import { RobinhoodMcpClient } from '../../../core/robinhood-mcp/robinhood-mcp-client.service';
import type { CurationProposal, ScanRecipe } from '@st/scanner';
import { stScannerProposalsPath } from '@st/collections';

const recipe = (over: Partial<ScanRecipe> = {}): ScanRecipe => ({
  id: 'quality-mid',
  title: 'Quality — Mid Cap',
  blurb: '',
  filters: [{ expression: 'fundamental.roe >= 0.15', predicate: '=', values: ['True'] }],
  columns: [{ display_name: 'ROE' }],
  ...over,
});

const proposal = (): CurationProposal => ({
  recipeId: 'quality-mid',
  ranAt: '2026-10-21T00:00:00Z',
  universeSize: 3,
  matchedCount: 1,
  truncated: false,
  addCandidates: [],
  dropCandidates: ['DROP'],
  deadSymbols: ['DEAD'],
  noDataSymbols: [],
  dropDetail: { DROP: { ROE: '-0.1' } },
});

describe('ScannerService (#1139)', () => {
  let service: ScannerService;
  let client: {
    previewScan: jest.Mock;
    previewScanRaw: jest.Mock;
    evaluateUniverse: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDocs.docs = [];
    mockGetDoc.exists = () => false;
    mockGetDoc.id = '';
    mockGetDoc.data = () => ({});
    client = {
      previewScan: jest.fn(),
      previewScanRaw: jest.fn(),
      evaluateUniverse: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        ScannerService,
        { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: {} },
        { provide: RobinhoodMcpClient, useValue: client },
      ],
    });
    service = TestBed.inject(ScannerService);
  });

  it('runScan delegates to previewScan — the only tool that crosses the boundary', async () => {
    const scan = { totalItems: 2, rows: [], filtersApplied: [] };
    client.previewScan.mockResolvedValue(scan);
    expect(await service.runScan(recipe())).toBe(scan);
    expect(client.previewScan).toHaveBeenCalledWith(recipe());
  });

  it('previewScanRaw delegates to the raw-shape client call (#1198)', async () => {
    const wire = { total_items: 1, results: [], filters_applied: [] };
    client.previewScanRaw.mockResolvedValue(wire);
    expect(await service.previewScanRaw(recipe())).toBe(wire);
    expect(client.previewScanRaw).toHaveBeenCalledWith(recipe());
  });

  it('evaluateTracked runs coverage (filters: []) then the filtered eval', async () => {
    const cov = { rows: [{ ticker: 'A' }], unevaluated: [], filtersApplied: [] };
    const mat = { rows: [], unevaluated: [], filtersApplied: [] };
    client.evaluateUniverse
      .mockResolvedValueOnce(cov)
      .mockResolvedValueOnce(mat);
    const r = recipe();
    const out = await service.evaluateTracked(r, ['A', 'B']);
    const coverageRecipe = client.evaluateUniverse.mock.calls[0][0];
    const matchedRecipe = client.evaluateUniverse.mock.calls[1][0];
    expect(coverageRecipe.filters).toEqual([]);
    expect(matchedRecipe).toBe(r); // recipe passed through unmodified
    expect(matchedRecipe.filters.length).toBeGreaterThan(0); // …filters intact
    expect(out.coverage).toBe(cov);
    expect(out.matched).toBe(mat);
  });

  it('evaluateTracked reports combined progress across both evals', async () => {
    client.evaluateUniverse.mockImplementation(
      (_r: unknown, _s: string[], cb?: (d: number, t: number) => void) => {
        cb?.(7, 7);
        return Promise.resolve({ rows: [], unevaluated: [], filtersApplied: [] });
      },
    );
    const seen: [number, number][] = [];
    await service.evaluateTracked(recipe(), ['A'], (d, t) => seen.push([d, t]));
    expect(seen).toEqual([[7, 14], [14, 14]]);
  });

  it('saveProposal writes the serialized shape to st-scanner/proposals/items', async () => {
    const id = await service.saveProposal(proposal());
    expect(id).toBe('prop-1');
    expect(collection).toHaveBeenCalledWith(
      expect.anything(),
      stScannerProposalsPath(),
    );
    const written = (addDoc as jest.Mock).mock.calls[0][1];
    expect(written['recipeId']).toBe('quality-mid');
    expect(written['dropDetail']).toEqual({ DROP: { ROE: '-0.1' } });
  });

  it('listProposals orders ranAt desc and parses each doc', async () => {
    mockDocs.docs = [
      { id: 'p2', data: () => proposal() },
      { id: 'p1', data: () => ({ ...proposal(), ranAt: '2026-10-20T00:00:00Z' }) },
    ];
    const list = await service.listProposals();
    expect(orderBy).toHaveBeenCalledWith('ranAt', 'desc');
    expect(query).toHaveBeenCalled();
    expect(list.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(list[0].proposal.recipeId).toBe('quality-mid');
  });

  it('listProposals skips shape-drifted docs instead of failing the list', async () => {
    mockDocs.docs = [
      { id: 'p2', data: () => proposal() },
      { id: 'bad', data: () => ({ nope: true }) },
      { id: 'p1', data: () => ({ ...proposal(), ranAt: '2026-10-20T00:00:00Z' }) },
    ];
    const list = await service.listProposals();
    expect(list.map((p) => p.id)).toEqual(['p2', 'p1']);
  });

  it('rejects without touching Firestore when unauthenticated', async () => {
    (authState as jest.Mock).mockReturnValueOnce(of(null));
    await expect(service.saveProposal(proposal())).rejects.toThrow('Authentication required');
    expect(addDoc).not.toHaveBeenCalled();
  });

  it('getProposal returns null for absent and shape-drifted docs', async () => {
    mockGetDoc.exists = () => false;
    expect(await service.getProposal('gone')).toBeNull();

    mockGetDoc.exists = () => true;
    mockGetDoc.id = 'bad';
    mockGetDoc.data = () => ({ nope: true });
    expect(await service.getProposal('bad')).toBeNull();

    mockGetDoc.data = () => proposal();
    const found = await service.getProposal('good');
    expect(found?.proposal.dropCandidates).toEqual(['DROP']);
  });
});
