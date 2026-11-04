/**
 * ContractListService specs (#1361).
 *
 * Firestore is module-mocked — the seam under test is the service's own
 * behavior: single-doc read → converted UI doc (null when missing) and
 * recent-lists query → success-status docs only.
 */
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';

jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: jest.fn(() => ({ path: 'mocked' })),
  collectionData: jest.fn(),
  doc: jest.fn(() => ({ path: 'mocked-doc' })),
  docData: jest.fn(),
  orderBy: jest.fn((f: string, d: string) => ({ orderBy: [f, d] })),
  limit: jest.fn((n: number) => ({ limit: n })),
  query: jest.fn((...args: unknown[]) => ({ query: args })),
}));

import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
  orderBy,
  limit,
  query,
} from '@angular/fire/firestore';
import { ContractListService } from './contract-list.service';
import { TradeSide } from '@common';
import type { ContractListPickRow } from '@options-replay/contracts';

const pickRow: ContractListPickRow = {
  kind: 'pick',
  entryDate: '2026-06-10',
  contractId: 'QQQ260619C00500000',
  side: TradeSide.LONG,
  repeatsPrevious: false,
  underlyingClose: 500,
  expiration: '2026-06-19',
  dte: 9,
  strike: 500,
  delta: 0.5,
  iv: 0.2,
  mark: 5,
  bid: 4.9,
  ask: 5.1,
  volume: 100,
  openInterest: 1000,
};

const listDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  runId: 'run-1',
  symbol: 'QQQ',
  templateId: 'csp-45-20',
  status: 'success',
  rows: [pickRow],
  pickDocMeta: {
    coordinate: { templateId: 'csp-45-20', gridId: 'g1' },
    gridVersion: 1,
    pickCount: 1,
    missCount: 0,
    firstDate: '2026-06-10',
    lastDate: '2026-06-10',
  },
  generatedAt: '2026-06-10T15:00:00Z',
  ...over,
});

describe('ContractListService', () => {
  let service: ContractListService;
  let mockDocData: jest.Mock;
  let mockCollectionData: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [ContractListService, { provide: Firestore, useValue: {} }],
    });
    service = TestBed.inject(ContractListService);
    mockDocData = docData as unknown as jest.Mock;
    mockCollectionData = collectionData as unknown as jest.Mock;
  });

  describe('getList$', () => {
    it('emits the converted list doc for an existing docId', async () => {
      mockDocData.mockReturnValue(of(listDoc()));

      const ui = await firstValueFrom(service.getList$('run-1_QQQ'));

      // The contract with the SDK: a point read on the lists collection.
      expect(doc).toHaveBeenCalledWith(expect.anything(), 'st-options-contract-lists', 'run-1_QQQ');
      expect(ui).not.toBeNull();
      expect(ui!.listId).toBe('run-1_QQQ');
      expect(ui!.symbol).toBe('QQQ');
      expect(ui!.status).toBe('success');
      expect(ui!.rows).toHaveLength(1);
    });

    it('emits null when the doc does not exist', async () => {
      mockDocData.mockReturnValue(of(undefined));

      const ui = await firstValueFrom(service.getList$('missing'));

      expect(ui).toBeNull();
    });
  });

  describe('recentLists$', () => {
    it('queries generatedAt desc with a limit and keeps success docs only', async () => {
      mockCollectionData.mockReturnValue(
        of([
          { ...listDoc(), listId: 'a' },
          { ...listDoc({ status: 'failed' }), listId: 'b' },
          { ...listDoc({ status: 'running' }), listId: 'c' },
          { ...listDoc(), listId: 'd' },
        ]),
      );

      const lists = await firstValueFrom(service.recentLists$(25));

      expect(collection).toHaveBeenCalledWith(expect.anything(), 'st-options-contract-lists');
      expect(orderBy).toHaveBeenCalledWith('generatedAt', 'desc');
      expect(limit).toHaveBeenCalledWith(25);
      expect(lists.map((l) => l.listId)).toEqual(['a', 'd']);
    });

    it('excludes success docs that carry no pickDocMeta (not a usable list)', async () => {
      mockCollectionData.mockReturnValue(
        of([
          { ...listDoc(), listId: 'ok' },
          { ...listDoc(), listId: 'no-meta', pickDocMeta: undefined },
        ]),
      );

      const lists = await firstValueFrom(service.recentLists$());

      expect(lists.map((l) => l.listId)).toEqual(['ok']);
    });
  });
});
