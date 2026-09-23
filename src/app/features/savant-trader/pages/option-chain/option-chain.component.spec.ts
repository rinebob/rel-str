import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';

import { OptionChainComponent } from './option-chain.component';
import { OptionChainStore } from './option-chain.store';
import { AppRoutes } from '../../../../core/common/interfaces';
import { NAV_MENU_ITEMS } from '../../../../core/common/constants';
import type { HistoricalOptionContract } from '@options-contract/contracts';
import { OptionType } from '@options-contract/contracts';

function oc(over: Partial<HistoricalOptionContract> = {}): HistoricalOptionContract {
  return {
    contractID: 'SPY_2026-10-16_600C',
    symbol: 'SPY',
    expiration: '2026-10-16',
    strike: '600',
    type: OptionType.CALL,
    mark: '2.50',
    implied_volatility: '0.32',
    delta: '0.55',
    ...over,
  };
}

function makeMockStore() {
  return {
    symbol: signal(''),
    dateInput: signal(''),
    resolvedDate: signal<string | null>(null),
    priorDate: signal<string | null>(null),
    source: signal<string | null>(null),
    sessionContracts: signal<HistoricalOptionContract[]>([]),
    priorContracts: signal<HistoricalOptionContract[]>([]),
    loading: signal(false),
    error: signal<string | null>(null),
    priorError: signal<string | null>(null),
    resolvedNoData: signal(false),
    sessionClose: signal<number | null>(null),
    priorClose: signal<number | null>(null),
    setSymbol: jest.fn(),
    setDateInput: jest.fn(),
    loadChain: jest.fn(),
    loadToday: jest.fn(),
  };
}

describe('OptionChainComponent', () => {
  let mockStore: ReturnType<typeof makeMockStore>;

  async function render(initialSymbol = '') {
    mockStore = makeMockStore();
    mockStore.symbol.set(initialSymbol);
    await TestBed.configureTestingModule({
      imports: [OptionChainComponent],
      providers: [
        provideRouter([]),
        { provide: OptionChainStore, useValue: mockStore },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(OptionChainComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('creates and renders the page shell with header', async () => {
    const fixture = await render();
    expect(fixture.componentInstance).toBeTruthy();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.option-chain-page')).toBeTruthy();
    expect(el.querySelector('.page-header')?.textContent).toContain('Option Chain');
  });

  it('renders calls and puts grids from store contracts', async () => {
    const fixture = await render();
    mockStore.sessionContracts.set([
      oc({ contractID: 'call-a', type: OptionType.CALL }),
      oc({ contractID: 'put-a', type: OptionType.PUT }),
    ]);
    mockStore.resolvedDate.set('2026-09-22');
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-cid="call-a"]')).toBeTruthy();
    expect(el.querySelector('[data-cid="put-a"]')).toBeTruthy();
    expect(el.textContent).toContain('2026-09-22');
  });

  it('shows loading, error, and no-data states', async () => {
    const fixture = await render();
    const el: HTMLElement = fixture.nativeElement;

    mockStore.loading.set(true);
    fixture.detectChanges();
    expect(el.textContent).toContain('Loading chain');

    mockStore.loading.set(false);
    mockStore.error.set('2026-09-22: Network error');
    fixture.detectChanges();
    expect(el.textContent).toContain('Network error');

    mockStore.error.set(null);
    mockStore.resolvedNoData.set(true);
    fixture.detectChanges();
    expect(el.textContent).toContain('No chain data found in the last 7 days');
  });

  it('symbol input and Load button drive the store', async () => {
    const fixture = await render();
    const el: HTMLElement = fixture.nativeElement;

    const input = el.querySelector<HTMLInputElement>('[data-testid="symbol-input"]')!;
    input.value = 'spy';
    input.dispatchEvent(new Event('input'));
    expect(mockStore.setSymbol).toHaveBeenCalledWith('spy');

    el.querySelector<HTMLButtonElement>('[data-testid="load-btn"]')!.click();
    expect(mockStore.loadChain).toHaveBeenCalled();
  });

  it('side toggle switches between calls/puts/both panes', async () => {
    const fixture = await render();
    mockStore.sessionContracts.set([
      oc({ contractID: 'call-a', type: OptionType.CALL }),
      oc({ contractID: 'put-a', type: OptionType.PUT }),
    ]);
    const el: HTMLElement = fixture.nativeElement;

    const sides = () =>
      Array.from(el.querySelectorAll<HTMLElement>('.chain-grid')).map(
        (g) => g.dataset['side'],
      );

    fixture.detectChanges();
    expect(sides()).toEqual(['call', 'put']); // both by default

    el.querySelector<HTMLButtonElement>('[data-testid="side-calls"]')!.click();
    fixture.detectChanges();
    expect(sides()).toEqual(['call']);

    el.querySelector<HTMLButtonElement>('[data-testid="side-puts"]')!.click();
    fixture.detectChanges();
    expect(sides()).toEqual(['put']);

    el.querySelector<HTMLButtonElement>('[data-testid="side-both"]')!.click();
    fixture.detectChanges();
    expect(sides()).toEqual(['call', 'put']);
  });

  it('orientation buttons flip each side independently', async () => {
    const fixture = await render();
    mockStore.sessionContracts.set([
      oc({ contractID: 'call-lo', type: OptionType.CALL, strike: '600' }),
      oc({ contractID: 'call-hi', type: OptionType.CALL, strike: '605' }),
      oc({ contractID: 'put-lo', type: OptionType.PUT, strike: '600' }),
      oc({ contractID: 'put-hi', type: OptionType.PUT, strike: '605' }),
    ]);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    const strikes = (side: string) =>
      Array.from(
        el.querySelectorAll<HTMLElement>(`.chain-grid[data-side="${side}"] .row-header .strike-value`),
      ).map((h) => h.textContent!.trim());

    expect(strikes('call')).toEqual(['605', '600']);
    expect(strikes('put')).toEqual(['605', '600']);

    el.querySelector<HTMLButtonElement>('[data-testid="calls-orientation"]')!.click();
    fixture.detectChanges();
    expect(strikes('call')).toEqual(['600', '605']);
    expect(strikes('put')).toEqual(['605', '600']); // puts untouched

    el.querySelector<HTMLButtonElement>('[data-testid="puts-orientation"]')!.click();
    fixture.detectChanges();
    expect(strikes('put')).toEqual(['600', '605']);
    expect(strikes('call')).toEqual(['600', '605']);
  });

  it('auto-loads on init when a symbol is already set, skips it when empty', async () => {
    await render('QQQ');
    expect(mockStore.loadChain).toHaveBeenCalledTimes(1);

    TestBed.resetTestingModule();
    await render('');
    expect(mockStore.loadChain).not.toHaveBeenCalled();
  });
});

describe('option chain routing', () => {
  it('registers the savant-trader/option-chain path', () => {
    expect(AppRoutes.OPTION_CHAIN).toBe('savant-trader/option-chain');
  });

  it('exposes a sidenav entry routing to the page', () => {
    const item = NAV_MENU_ITEMS.find((i) => i.text === 'Option Chain');
    expect(item).toBeTruthy();
    expect(item?.href).toBe('savant-trader/option-chain');
  });
});
