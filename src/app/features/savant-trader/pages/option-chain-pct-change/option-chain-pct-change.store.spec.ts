import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';

import { OptionChainPctChangeStore } from './option-chain-pct-change.store';
import { OptionsContractService } from '../../services/options-contract.service';
import { OptionType } from '@options-contract/contracts';
import type {
  GetHistoricalOptionsChainResponse,
  HistoricalOptionContract,
} from '@options-contract/contracts';

// =============================================================================
// Test fixtures
// =============================================================================

function makeChain(contracts: HistoricalOptionContract[]): GetHistoricalOptionsChainResponse {
  return {
    ok: true,
    symbol: 'QQQ',
    date: '2024-01-15',
    endpoint: 'historical-options',
    data: { data: contracts },
    analysis: {
      summary: {
        totalContracts: contracts.length,
        totalVolume: 0,
        totalOpenInterest: 0,
        callContracts: 0,
        putContracts: 0,
        uniqueStrikes: 0,
        avgVolumePerContract: 0,
        avgOpenInterest: 0,
      },
      expirations: [],
      strikes: [],
    },
    timestamp: '2024-01-15T00:00:00Z',
    processingTimeMs: 100,
  };
}

function makeContract(overrides: Partial<HistoricalOptionContract> = {}): HistoricalOptionContract {
  return {
    contractID: 'TEST',
    symbol: 'QQQ',
    expiration: '2024-03-15',
    strike: '100',
    type: OptionType.CALL,
    mark: '5.00',
    delta: '0.5',
    ...overrides,
  };
}

function mockService(
  startChain: HistoricalOptionContract[] = [makeContract({ contractID: 'A', mark: '10.00' })],
  targetChains: Record<string, HistoricalOptionContract[]> = {
    '2024-02-15': [makeContract({ contractID: 'A', mark: '15.00' })],
  },
): Partial<OptionsContractService> {
  return {
    getHistoricalOptionsChain$: (symbol: string, date: string) => {
      if (date === '2024-01-15') return of(makeChain(startChain));
      const chain = targetChains[date] ?? [];
      return of(makeChain(chain));
    },
  } as Partial<OptionsContractService>;
}

function setupStore(
  service: Partial<OptionsContractService> = mockService(),
): InstanceType<typeof OptionChainPctChangeStore> {
  TestBed.configureTestingModule({
    providers: [
      { provide: OptionsContractService, useValue: service },
      OptionChainPctChangeStore,
    ],
  });
  return TestBed.inject(OptionChainPctChangeStore);
}

// =============================================================================
// Tests
// =============================================================================

describe('OptionChainPctChangeStore', () => {
  it('initializes with empty state', () => {
    const store = setupStore();
    expect(store.symbol()).toBe('');
    expect(store.startDate()).toBe('');
    expect(store.targetDates()).toEqual([]);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
    expect(store.grids()).toEqual([]);
    expect(store.startSnapshot()).toBeNull();
    expect(store.hasResults()).toBe(false);
    expect(store.canRun()).toBe(false);
  });

  describe('input setters', () => {
    it('setSymbol trims and uppercases', () => {
      const store = setupStore();
      store.setSymbol('  qqq  ');
      expect(store.symbol()).toBe('QQQ');
    });

    it('setSymbol invalidates cached snapshots', () => {
      const store = setupStore();
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');
      store.runAnalysis();
      // After fetch, startSnapshot is populated. Changing symbol should clear it.
      store.setSymbol('SPY');
      expect(store.startSnapshot()).toBeNull();
      expect(Object.keys(store.targetSnapshots()).length).toBe(0);
    });

    it('setStartDate trims and invalidates start snapshot', () => {
      const store = setupStore();
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');
      store.runAnalysis();
      store.setStartDate('2024-01-16');
      expect(store.startSnapshot()).toBeNull();
    });

    it('addTargetDate adds a new date', () => {
      const store = setupStore();
      store.addTargetDate('2024-02-15');
      expect(store.targetDates()).toEqual(['2024-02-15']);
    });

    it('addTargetDate does not add duplicates', () => {
      const store = setupStore();
      store.addTargetDate('2024-02-15');
      store.addTargetDate('2024-02-15');
      expect(store.targetDates()).toEqual(['2024-02-15']);
    });

    it('removeTargetDate removes an existing date', () => {
      const store = setupStore();
      store.addTargetDate('2024-02-15');
      store.addTargetDate('2024-03-15');
      store.removeTargetDate('2024-02-15');
      expect(store.targetDates()).toEqual(['2024-03-15']);
    });

    it('setType updates both type and filter.type', () => {
      const store = setupStore();
      store.setType(OptionType.PUT);
      expect(store.type()).toBe(OptionType.PUT);
      expect(store.filter().type).toBe(OptionType.PUT);
    });

    it('setFilter merges partial filter fields', () => {
      const store = setupStore();
      store.setFilter({ strikeGte: 100, strikeLte: 200 });
      expect(store.filter().strikeGte).toBe(100);
      expect(store.filter().strikeLte).toBe(200);
    });
  });

  describe('canRun computed', () => {
    it('returns false when symbol is empty', () => {
      const store = setupStore();
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');
      expect(store.canRun()).toBe(false);
    });

    it('returns false when startDate is empty', () => {
      const store = setupStore();
      store.setSymbol('QQQ');
      store.addTargetDate('2024-02-15');
      expect(store.canRun()).toBe(false);
    });

    it('returns false when targetDates is empty', () => {
      const store = setupStore();
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      expect(store.canRun()).toBe(false);
    });

    it('returns true when all inputs are set', () => {
      const store = setupStore();
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');
      expect(store.canRun()).toBe(true);
    });
  });

  describe('grids computed', () => {
    it('returns empty when no snapshots are cached', () => {
      const store = setupStore();
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');
      expect(store.grids()).toEqual([]);
    });

    it('auto-recomputes when filter changes after fetch', (done) => {
      const store = setupStore();
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');
      store.runAnalysis();

      setTimeout(() => {
        expect(store.grids().length).toBe(1);
        // Change filter — grids should auto-recompute without re-fetching.
        store.setFilter({ strikeGte: 50 });
        expect(store.grids().length).toBe(1);
        done();
      }, 50);
    });
  });

  describe('runAnalysis', () => {
    it('fetches, caches snapshots, and computes grids', (done) => {
      const store = setupStore();
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');

      store.runAnalysis();

      setTimeout(() => {
        expect(store.loading()).toBe(false);
        expect(store.error()).toBeNull();
        expect(store.grids().length).toBe(1);
        expect(store.hasResults()).toBe(true);
        expect(store.startSnapshot()).not.toBeNull();
        done();
      }, 50);
    });

    it('sets error message on fetch failure', (done) => {
      const failingService: Partial<OptionsContractService> = {
        getHistoricalOptionsChain$: () => throwError(() => new Error('Network error')),
      } as Partial<OptionsContractService>;
      const store = setupStore(failingService);
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');

      store.runAnalysis();

      setTimeout(() => {
        expect(store.loading()).toBe(false);
        expect(store.error()).toContain('Network error');
        expect(store.grids()).toEqual([]);
        done();
      }, 50);
    });

    it('sets error and clears stale results when inputs are incomplete', () => {
      const store = setupStore();
      store.runAnalysis();
      expect(store.error()).toContain('required');
      expect(store.loading()).toBe(false);
      expect(store.startSnapshot()).toBeNull();
      expect(store.grids()).toEqual([]);
    });

    it('cancels stale in-flight request when called twice rapidly', (done) => {
      // Use Subjects so the first request stays pending while the second fires.
      const firstSubject = new Subject<GetHistoricalOptionsChainResponse>();
      const secondSubject = new Subject<GetHistoricalOptionsChainResponse>();
      let callCount = 0;
      const service: Partial<OptionsContractService> = {
        getHistoricalOptionsChain$: () => {
          callCount++;
          // First call returns firstSubject, subsequent calls return secondSubject.
          return callCount === 1 ? firstSubject.asObservable() : secondSubject.asObservable();
        },
      } as Partial<OptionsContractService>;
      const store = setupStore(service);
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');

      store.runAnalysis();
      // Immediately fire a second run — should cancel the first.
      store.runAnalysis();

      // Complete the first subject (simulating a late response).
      firstSubject.next(makeChain([makeContract({ contractID: 'STALE', mark: '999.00' })]));
      firstSubject.complete();

      // Now complete the second subject.
      secondSubject.next(makeChain([makeContract({ contractID: 'FRESH', mark: '10.00' })]));
      secondSubject.next(makeChain([makeContract({ contractID: 'FRESH', mark: '10.00' })]));
      secondSubject.complete();

      setTimeout(() => {
        // The stale first response should not have overwritten the fresh one.
        expect(store.loading()).toBe(false);
        expect(store.startSnapshot()).not.toBeNull();
        // The fresh snapshot should contain FRESH, not STALE.
        const snapshot = store.startSnapshot()!;
        expect(snapshot.some((c) => c.contractID === 'FRESH')).toBe(true);
        expect(snapshot.some((c) => c.contractID === 'STALE')).toBe(false);
        done();
      }, 50);
    });
  });

  describe('reset', () => {
    it('clears all state and cancels in-flight fetch', (done) => {
      const subject = new Subject<GetHistoricalOptionsChainResponse>();
      const service: Partial<OptionsContractService> = {
        getHistoricalOptionsChain$: () => subject.asObservable(),
      } as Partial<OptionsContractService>;
      const store = setupStore(service);
      store.setSymbol('QQQ');
      store.setStartDate('2024-01-15');
      store.addTargetDate('2024-02-15');
      store.runAnalysis();

      // Reset while in-flight.
      store.reset();

      expect(store.symbol()).toBe('');
      expect(store.startDate()).toBe('');
      expect(store.targetDates()).toEqual([]);
      expect(store.grids()).toEqual([]);
      expect(store.startSnapshot()).toBeNull();
      expect(store.loading()).toBe(false);
      expect(store.error()).toBeNull();

      // Emit a late response — should not repopulate the store.
      subject.next(makeChain([makeContract({ contractID: 'LATE', mark: '999.00' })]));
      subject.complete();

      setTimeout(() => {
        expect(store.startSnapshot()).toBeNull();
        expect(store.grids()).toEqual([]);
        done();
      }, 50);
    });
  });
});
