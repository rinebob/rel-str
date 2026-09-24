/**
 * Integration spec: real OptionChainStore + real OptionChainComponent +
 * real buildChainGrid, with only the Firebase callable and bar service
 * mocked. Reproduces the reported bug (empty grid cells, duplicate
 * request) against the real Alpha Vantage payload shape.
 */
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { OptionChainComponent } from './option-chain.component';
import { OptionChainStore } from './option-chain.store';
import { OptionsContractService } from '../../services/options-contract.service';
import { LocalBarReadService } from '../../../../core/services/local-bar-read.service';
import type {
  GetHistoricalOptionsChainResponse,
  HistoricalOptionContract,
} from '@options-contract/contracts';
import { OptionType } from '@options-contract/contracts';
import type { OhlcBar } from '../../../../core/models/market-data.types';

function avContract(over: Partial<HistoricalOptionContract> = {}): HistoricalOptionContract {
  return {
    contractID: 'QQQ260918C00205000',
    symbol: 'QQQ',
    expiration: '2026-10-16',
    strike: '205.00',
    type: OptionType.CALL,
    last: '512.30',
    mark: '512.40',
    bid: '512.10',
    ask: '512.70',
    volume: '10',
    open_interest: '5',
    implied_volatility: '9.99512',
    delta: '0.45',
    gamma: '0.00001',
    theta: '-0.01',
    vega: '0.02',
    rho: '0.01',
    ...over,
  };
}

/** Mirrors the real callable pass-through: res.data.data = contract array. */
function avResponse(contracts: HistoricalOptionContract[]): GetHistoricalOptionsChainResponse {
  return {
    ok: true,
    symbol: 'QQQ',
    date: '2026-09-22',
    source: 'alpha-vantage',
    endpoint: 'HISTORICAL_OPTIONS',
    data: {
      endpoint: 'Historical Options',
      message: 'success',
      data: contracts,
    },
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

describe('OptionChainComponent + real store (integration)', () => {
  it('renders populated data cells from a real AV-shaped payload', async () => {
    const calls: string[] = [];
    const optionsService = {
      getHistoricalOptionsChain$: jest.fn((_s: string, date: string) => {
        calls.push(date);
        return of(
          avResponse([
            avContract({ contractID: 'call-a', type: OptionType.CALL }),
            avContract({ contractID: 'put-a', type: OptionType.PUT }),
          ]),
        );
      }),
    };
    const barService = { getDailyBarsForRange$: jest.fn(() => of(bars)) };

    await TestBed.configureTestingModule({
      imports: [OptionChainComponent],
      providers: [
        provideRouter([]),
        OptionChainStore,
        { provide: OptionsContractService, useValue: optionsService },
        { provide: LocalBarReadService, useValue: barService },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OptionChainComponent);
    fixture.detectChanges(); // ngOnInit auto-loads the QQQ default

    await new Promise<void>((r) => setTimeout(r, 0));
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;

    const store = fixture.componentInstance['store'];
    expect(store.error()).toBeNull();
    expect(store.sessionContracts().length).toBe(2);
    expect(store.loading()).toBe(false);

    const dataCells = el.querySelectorAll('.data-cell');
    expect(dataCells.length).toBeGreaterThan(0);
    expect(el.querySelector('[data-cid="call-a"]')?.textContent).toContain('$512.40');
    expect(el.querySelector('[data-cid="put-a"]')?.textContent).toContain('$512.40');

    // ATM row marked from the underlying close (101.5 → strike 205 nearest).
    expect(el.querySelector('.row-header.atm')?.textContent).toContain('205');

    // Exactly two chain requests: session + prior-session, different dates.
    expect(calls.length).toBe(2);
    expect(calls[0]).not.toBe(calls[1]);
  });
});
