import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';

import { OptionChainStore } from './option-chain.store';
import { OptionsContractService } from '../../services/options-contract.service';
import { LocalBarReadService } from '../../../../core/services/local-bar-read.service';
import type {
  GetHistoricalOptionsChainResponse,
  HistoricalOptionContract,
} from '@options-contract/contracts';
import type { OhlcBar } from '../../../../core/models/market-data.types';

function contract(contractID: string): HistoricalOptionContract {
  return { contractID, mark: '1.00' };
}

function chainResp(
  contracts: HistoricalOptionContract[],
  source = 'gcs',
): GetHistoricalOptionsChainResponse {
  return {
    ok: true,
    symbol: 'SPY',
    date: '2026-09-22',
    source,
    endpoint: 'partnerHistoricalOptionsV2',
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
    timestamp: '2026-09-22T20:00:00Z',
    processingTimeMs: 0,
  };
}

const bars: OhlcBar[] = [
  { d: '2026-09-21', o: 100, h: 101, l: 99, c: 100.5 },
  { d: '2026-09-22', o: 101, h: 102, l: 100, c: 101.5 },
];

// Sep 2026: Mon 21, Tue 22, Wed 23, Fri 25
const POST_CLOSE_TUE = new Date(Date.UTC(2026, 8, 22, 21, 0)); // 2 PM PT

interface SetupOverrides {
  /** Map date -> contracts; default returns one contract for every date. */
  chainFor?: (date: string) => HistoricalOptionContract[];
  /** Raw mock for the chain callable (for error/pending-stream tests). */
  chain$?: jest.Mock;
  bars?: OhlcBar[];
}

describe('OptionChainStore', () => {
  let store: InstanceType<typeof OptionChainStore>;
  let chainCalls: string[];
  let optionsService: { getHistoricalOptionsChain$: jest.Mock };
  let barService: { getDailyBarsForRange$: jest.Mock };

  function setup(overrides: SetupOverrides = {}) {
    chainCalls = [];
    optionsService = {
      getHistoricalOptionsChain$:
        overrides.chain$ ??
        jest.fn((_s: string, date: string) => {
          chainCalls.push(date);
          const chainFor = overrides.chainFor ?? (() => [contract('C1')]);
          return of(chainResp(chainFor(date)));
        }),
    };
    barService = {
      getDailyBarsForRange$: jest.fn(() => of(overrides.bars ?? bars)),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        OptionChainStore,
        { provide: OptionsContractService, useValue: optionsService },
        { provide: LocalBarReadService, useValue: barService },
      ],
    });
    store = TestBed.inject(OptionChainStore);
  }

  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  it('auto-resolves the session post-close and loads session + prior snapshots', async () => {
    setup();
    store.setSymbol('spy');
    store.loadChain(POST_CLOSE_TUE);
    await flush();

    expect(store.loading()).toBe(false);
    expect(store.resolvedDate()).toBe('2026-09-22');
    expect(store.source()).toBe('gcs');
    expect(store.sessionContracts()).toEqual([contract('C1')]);
    expect(store.priorDate()).toBe('2026-09-21');
    expect(store.priorContracts()).toEqual([contract('C1')]);
    expect(chainCalls).toEqual(['2026-09-22', '2026-09-21']);
  });

  it('pins dateInput to the resolved session after an auto-resolve (Today semantics)', async () => {
    setup();
    store.setSymbol('SPY');
    store.loadChain(POST_CLOSE_TUE);
    await flush();

    expect(store.dateInput()).toBe('2026-09-22');
  });

  it('walks back when today has no snapshot, and still finds the prior session', async () => {
    // Tue empty (holiday), Mon has data; prior resolves to Fri
    setup({ chainFor: (date) => (date === '2026-09-21' || date === '2026-09-18' ? [contract('C1')] : []) });
    store.setSymbol('SPY');
    store.loadChain(POST_CLOSE_TUE);
    await flush();

    expect(store.resolvedDate()).toBe('2026-09-21');
    expect(store.priorDate()).toBe('2026-09-18');
    expect(chainCalls).toEqual(['2026-09-22', '2026-09-21', '2026-09-18']);
  });

  it('manual date entry fetches exactly that date and still walks back for the prior session', async () => {
    // Picked date empty; Mon Sep 7 (holiday) also empty; Fri Sep 4 has data
    setup({ chainFor: (date) => (date === '2026-09-04' ? [contract('C1')] : []) });
    store.setSymbol('SPY');
    store.setDateInput('2026-09-08'); // Tue after holiday Monday Sep 7
    store.loadChain();
    await flush();

    expect(store.resolvedDate()).toBe('2026-09-08');
    expect(store.sessionContracts()).toEqual([]);
    expect(store.resolvedNoData()).toBe(true);
    expect(store.priorDate()).toBe('2026-09-04'); // walks past holiday Mon Sep 7
    expect(store.priorContracts()).toEqual([contract('C1')]);
    expect(chainCalls).toEqual(['2026-09-08', '2026-09-07', '2026-09-04']);
  });

  it('sets resolvedNoData when the walk exhausts its cap', async () => {
    setup({ chainFor: () => [] });
    store.setSymbol('SPY');
    store.loadChain(POST_CLOSE_TUE);
    await flush();

    expect(store.resolvedNoData()).toBe(true);
    expect(store.resolvedDate()).toBeNull();
    expect(store.sessionContracts()).toEqual([]);
    expect(store.loading()).toBe(false);
  });

  it('survives a missing prior snapshot: session data still lands', async () => {
    setup({ chainFor: (date) => (date === '2026-09-22' ? [contract('C1')] : []) });
    store.setSymbol('SPY');
    store.loadChain(POST_CLOSE_TUE);
    await flush();

    expect(store.resolvedDate()).toBe('2026-09-22');
    expect(store.sessionContracts()).toEqual([contract('C1')]);
    expect(store.priorDate()).toBeNull();
    expect(store.priorContracts()).toEqual([]);
    expect(store.error()).toBeNull();
  });

  it('a prior-session fetch error lands in priorError — session data and error stay clean', async () => {
    setup({
      chain$: jest.fn((_s: string, date: string) =>
        date === '2026-09-22'
          ? of(chainResp([contract('C1')]))
          : throwError(() => new Error('upstream timeout')),
      ),
    });
    store.setSymbol('SPY');
    store.loadChain(POST_CLOSE_TUE);
    await flush();

    expect(store.resolvedDate()).toBe('2026-09-22');
    expect(store.sessionContracts()).toEqual([contract('C1')]);
    expect(store.error()).toBeNull();
    expect(store.priorError()).toContain('upstream timeout');
    expect(store.priorContracts()).toEqual([]);
  });

  it('records the fetch error with the failed date and clears loading', async () => {
    setup({
      chain$: jest.fn(() => throwError(() => new Error('Network error'))),
    });
    store.setSymbol('SPY');
    store.loadChain(POST_CLOSE_TUE);
    await flush();

    expect(store.loading()).toBe(false);
    expect(store.error()).toContain('2026-09-22');
    expect(store.error()).toContain('Network error');
  });

  it('rejects an invalid manual date without fetching', () => {
    setup();
    store.setSymbol('SPY');
    store.setDateInput('09/22/2026');
    store.loadChain();

    expect(optionsService.getHistoricalOptionsChain$).not.toHaveBeenCalled();
    expect(store.error()).toContain('YYYY-MM-DD');
  });

  it('requires a symbol', () => {
    setup();
    store.loadChain(POST_CLOSE_TUE);

    expect(optionsService.getHistoricalOptionsChain$).not.toHaveBeenCalled();
    expect(store.error()).toContain('Symbol is required');
  });

  it('changing the symbol clears the loaded snapshots', async () => {
    setup();
    store.setSymbol('SPY');
    store.loadChain(POST_CLOSE_TUE);
    await flush();
    expect(store.sessionContracts().length).toBe(1);

    store.setSymbol('QQQ');
    expect(store.sessionContracts()).toEqual([]);
    expect(store.priorContracts()).toEqual([]);
    expect(store.resolvedDate()).toBeNull();
    expect(store.resolvedNoData()).toBe(false);
    expect(store.underlyingBars()).toEqual([]);
    expect(store.underlyingLoading()).toBe(false);
  });

  it('a second load supersedes the in-flight one', async () => {
    const subs: Subject<GetHistoricalOptionsChainResponse>[] = [];
    setup({
      chain$: jest.fn(() => {
        const s = new Subject<GetHistoricalOptionsChainResponse>();
        subs.push(s);
        return s.asObservable();
      }),
    });

    store.setSymbol('SPY');
    store.loadChain(POST_CLOSE_TUE);
    store.setSymbol('QQQ');
    store.loadChain(POST_CLOSE_TUE);

    // Late emission on the first (cancelled) load's stream must not clobber.
    subs[0].next(chainResp([contract('STALE')]));
    subs[0].complete();
    expect(store.symbol()).toBe('QQQ');
    expect(store.sessionContracts()).toEqual([]);

    // The second load's stream resolves normally.
    subs[1].next(chainResp([contract('FRESH')]));
    subs[1].complete();
    await flush();
    expect(store.resolvedDate()).toBe('2026-09-22');
    expect(store.sessionContracts()).toEqual([contract('FRESH')]);
  });

  it('fetches underlying bars covering the resolved window and clears underlyingLoading', async () => {
    setup();
    store.setSymbol('SPY');
    store.loadChain(POST_CLOSE_TUE);
    await flush();

    expect(barService.getDailyBarsForRange$).toHaveBeenCalledWith(
      'SPY',
      expect.any(String),
      '2026-09-22',
    );
    expect(store.underlyingBars()).toEqual(bars);
    expect(store.underlyingLoading()).toBe(false);
    expect(store.sessionClose()).toBe(101.5);
    expect(store.priorClose()).toBe(100.5);
  });

  it('exposes source from the snapshot response', async () => {
    setup({
      chain$: jest.fn((_s: string, date: string) => {
        chainCalls.push(date);
        return of({ ...chainResp([contract('C1')]), source: 'upstream' });
      }),
    });
    store.setSymbol('SPY');
    store.loadChain(POST_CLOSE_TUE);
    await flush();
    expect(store.source()).toBe('upstream');
  });
});
