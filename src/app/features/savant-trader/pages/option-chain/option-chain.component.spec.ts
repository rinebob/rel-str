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
  /** jsdom has no layout — install fake scrollable geometry + offset
   *  storage so scroll-fraction math has real numbers to work on. */
  function stubScroller(
    el: HTMLElement,
    geo: { h: number; ch: number; w: number; cw: number },
  ): { el: HTMLElement } {
    let top = 0, left = 0;
    Object.defineProperty(el, 'scrollHeight', { get: () => geo.h, configurable: true });
    Object.defineProperty(el, 'clientHeight', { get: () => geo.ch, configurable: true });
    Object.defineProperty(el, 'scrollWidth', { get: () => geo.w, configurable: true });
    Object.defineProperty(el, 'clientWidth', { get: () => geo.cw, configurable: true });
    Object.defineProperty(el, 'scrollTop', { get: () => top, set: (v: number) => { top = v; }, configurable: true });
    Object.defineProperty(el, 'scrollLeft', { get: () => left, set: (v: number) => { left = v; }, configurable: true });
    return { el };
  }

  let mockStore: ReturnType<typeof makeMockStore>;

  beforeEach(() => localStorage.clear());

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

    // Calls default high→low, puts default low→high.
    expect(strikes('call')).toEqual(['605', '600']);
    expect(strikes('put')).toEqual(['600', '605']);

    el.querySelector<HTMLButtonElement>('[data-testid="calls-orientation"]')!.click();
    fixture.detectChanges();
    expect(strikes('call')).toEqual(['600', '605']);
    expect(strikes('put')).toEqual(['600', '605']); // puts untouched

    el.querySelector<HTMLButtonElement>('[data-testid="puts-orientation"]')!.click();
    fixture.detectChanges();
    expect(strikes('put')).toEqual(['605', '600']);
    expect(strikes('call')).toEqual(['600', '605']);
  });

  it('mirrors scroll between both panes by scroll fraction on both axes', async () => {
    const fixture = await render();
    mockStore.sessionContracts.set([
      oc({ contractID: 'call-a', type: OptionType.CALL }),
      oc({ contractID: 'put-a', type: OptionType.PUT }),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    const scrollers = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.grid-scroll');
    expect(scrollers.length).toBe(2);
    // jsdom has no layout — install fake scrollable geometry so offsets and
    // ranges are real values the fraction math can work on. calls has a
    // 900px scrollable range, puts 1800px (double).
    const calls = stubScroller(scrollers[0], { h: 1000, ch: 100, w: 1000, cw: 500 });
    const puts = stubScroller(scrollers[1], { h: 2000, ch: 200, w: 2000, cw: 1000 });

    // calls scrolled to 50% of its 900px v-range and 10% of its h-range —
    // puts must land on the same FRACTIONS of its own (2x) ranges.
    calls.el.scrollTop = 450;
    calls.el.scrollLeft = 50;
    calls.el.dispatchEvent(new Event('scroll'));
    expect(puts.el.scrollTop).toBe(900);  // 0.5 × 1800
    expect(puts.el.scrollLeft).toBe(100); // 0.1 × 1000

    puts.el.scrollTop = 90; // 5% of 1800
    puts.el.dispatchEvent(new Event('scroll'));
    expect(calls.el.scrollTop).toBe(45); // 0.05 × 900
  });

  it('re-sync suppresses mirroring while the panes re-center', async () => {
    const fixture = await render();
    mockStore.sessionContracts.set([
      oc({ contractID: 'call-a', type: OptionType.CALL }),
      oc({ contractID: 'put-a', type: OptionType.PUT }),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    const scrollers = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.grid-scroll');
    const calls = stubScroller(scrollers[0], { h: 1000, ch: 100, w: 1000, cw: 500 });
    const puts = stubScroller(scrollers[1], { h: 2000, ch: 200, w: 2000, cw: 1000 });

    // puts sits at 500 when resync runs (scrollIntoView is a jsdom no-op)
    // — its queued scroll event at that exact position is programmatic
    // and must NOT mirror.
    puts.el.scrollTop = 500;
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="resync"]')!
      .click();
    const callsBefore = calls.el.scrollTop;
    puts.el.dispatchEvent(new Event('scroll'));
    expect(calls.el.scrollTop).toBe(callsBefore);

    // A scroll to a DIFFERENT position is a real user scroll — mirrors
    // even inside the suppression window.
    calls.el.scrollTop = 450;
    calls.el.dispatchEvent(new Event('scroll'));
    expect(puts.el.scrollTop).toBe(900);
  });

  it('re-sync button centers both grids on their ATM row', async () => {
    const scrollSpy = jest.fn();
    const orig = window.HTMLElement.prototype.scrollIntoView;
    window.HTMLElement.prototype.scrollIntoView = scrollSpy;
    try {
      const fixture = await render();
      mockStore.sessionContracts.set([
        oc({ contractID: 'call-a', type: OptionType.CALL }),
        oc({ contractID: 'put-a', type: OptionType.PUT }),
      ]);
      mockStore.sessionClose.set(600);
      fixture.detectChanges();
      scrollSpy.mockClear(); // auto-center on load already called it

      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLButtonElement>('[data-testid="resync"]')!
        .click();
      expect(scrollSpy).toHaveBeenCalledTimes(2); // once per pane
      expect(scrollSpy).toHaveBeenCalledWith({ block: 'center' });
    } finally {
      // Don't leak the prototype mock to later specs in this worker.
      if (orig === undefined) {
        delete (window.HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      } else {
        window.HTMLElement.prototype.scrollIntoView = orig;
      }
    }
  });

  it('delta inputs bound the grids — unbounded by default, settable', async () => {
    const fixture = await render();
    mockStore.sessionContracts.set([
      oc({ contractID: 'near', delta: '0.50' }),
      oc({ contractID: 'far', strike: '700', delta: '0.90' }),
    ]);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    // No default filter — everything renders on load.
    const lte = el.querySelector<HTMLInputElement>('[data-testid="delta-lte"]')!;
    expect(lte.value).toBe('');
    expect(el.querySelector('[data-cid="far"]')).toBeTruthy();

    lte.value = '0.6';
    lte.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('[data-cid="near"]')).toBeTruthy();
    expect(el.querySelector('[data-cid="far"]')).toBeFalsy();

    lte.value = '';
    lte.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('[data-cid="far"]')).toBeTruthy();
  });

  it('columns picker hides expiration columns in both grids; All/None restore/empty', async () => {
    const fixture = await render();
    mockStore.sessionContracts.set([
      oc({ contractID: 'call-a', type: OptionType.CALL, expiration: '2026-10-16' }),
      oc({ contractID: 'call-b', type: OptionType.CALL, expiration: '2026-11-20', strike: '605' }),
      oc({ contractID: 'put-a', type: OptionType.PUT, expiration: '2026-10-16' }),
      oc({ contractID: 'put-b', type: OptionType.PUT, expiration: '2026-11-20', strike: '605' }),
    ]);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const headerCount = () =>
      el.querySelectorAll('.header-cell:not(.corner-cell)').length;
    expect(headerCount()).toBe(4); // 2 expirations × 2 panes

    el.querySelector<HTMLButtonElement>('[data-testid="columns-picker"]')!.click();
    fixture.detectChanges();
    const items = el.querySelectorAll<HTMLLabelElement>('.picker-item:not(.picker-band)');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('2026-10-16');
    expect(items[0].textContent).toContain('Fri');

    // Uncheck the first expiration → that column drops in BOTH grids.
    items[0].querySelector('input')!.click();
    fixture.detectChanges();
    expect(headerCount()).toBe(2);
    expect(el.querySelector('[data-cid="call-a"]')).toBeNull();
    expect(el.querySelector('[data-cid="put-a"]')).toBeNull();
    expect(el.querySelector('[data-cid="call-b"]')).toBeTruthy();

    // None → all columns hidden → grids show the empty state.
    el.querySelector<HTMLButtonElement>('[data-testid="cols-none"]')!.click();
    fixture.detectChanges();
    expect(headerCount()).toBe(0);
    expect(el.querySelectorAll('.no-data').length).toBe(2);

    el.querySelector<HTMLButtonElement>('[data-testid="cols-all"]')!.click();
    fixture.detectChanges();
    expect(headerCount()).toBe(4);
  });

  it('hidden expirations persist to localStorage per symbol and restore on load', async () => {
    const fixture = await render('QQQ');
    mockStore.sessionContracts.set([
      oc({ contractID: 'call-a', type: OptionType.CALL, expiration: '2026-10-16' }),
      oc({ contractID: 'call-b', type: OptionType.CALL, expiration: '2026-11-20', strike: '605' }),
    ]);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLButtonElement>('[data-testid="columns-picker"]')!.click();
    fixture.detectChanges();
    el.querySelectorAll<HTMLLabelElement>('.picker-item:not(.picker-band)')[0]
      .querySelector('input')!.click();
    fixture.detectChanges();

    expect(localStorage.getItem('option-chain.hidden-expirations.QQQ'))
      .toBe('["2026-10-16"]');

    // Fresh component instance from the same TestBed — the hidden column
    // restores because the constructor re-reads localStorage.
    fixture.destroy();
    const fixture2 = TestBed.createComponent(OptionChainComponent);
    fixture2.detectChanges();
    const el2: HTMLElement = fixture2.nativeElement;
    expect(el2.querySelector('[data-cid="call-a"]')).toBeNull();
    expect(el2.querySelector('[data-cid="call-b"]')).toBeTruthy();
  });

  it('DTE band checkboxes toggle whole expiration groups', async () => {
    const fixture = await render();
    mockStore.resolvedDate.set('2026-09-22');
    mockStore.sessionContracts.set([
      // 3d → <6d band; 24d → 15–30d band
      oc({ contractID: 'near-c', type: OptionType.CALL, expiration: '2026-09-25' }),
      oc({ contractID: 'far-c', type: OptionType.CALL, expiration: '2026-10-16', strike: '605' }),
      oc({ contractID: 'near-p', type: OptionType.PUT, expiration: '2026-09-25' }),
      oc({ contractID: 'far-p', type: OptionType.PUT, expiration: '2026-10-16', strike: '605' }),
    ]);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    el.querySelector<HTMLButtonElement>('[data-testid="columns-picker"]')!.click();
    fixture.detectChanges();

    const bands = Array.from(el.querySelectorAll<HTMLLabelElement>('.picker-band'));
    expect(bands.map((b) => b.querySelector('[data-band]')!.getAttribute('data-band')))
      .toEqual(['lt6', 'd15_30']); // only non-empty bands render

    // Uncheck <6d → its column drops in both panes.
    bands[0].querySelector('input')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-cid="near-c"]')).toBeNull();
    expect(el.querySelector('[data-cid="near-p"]')).toBeNull();
    expect(el.querySelector('[data-cid="far-c"]')).toBeTruthy();

    // Recheck → back. Divider sits between bands and items.
    bands[0].querySelector('input')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-cid="near-c"]')).toBeTruthy();
    const picker = el.querySelector('.column-picker')!;
    const divider = picker.querySelector('.picker-divider')!;
    expect(divider.previousElementSibling!.classList.contains('picker-band')).toBe(true);
    expect(divider.nextElementSibling!.classList.contains('picker-item')).toBe(true);
    expect(divider.nextElementSibling!.classList.contains('picker-band')).toBe(false);
  });

  it('shows per-pane strike stats and trims the long side around ATM', async () => {
    const fixture = await render();
    // spot 600 → ATM 600; 1 strike below (590), 3 above → keep 1 each side.
    mockStore.sessionContracts.set(
      ['590', '600', '610', '620', '630'].map((strike) =>
        oc({ contractID: `c${strike}`, type: OptionType.CALL, strike }),
      ),
    );
    mockStore.sessionClose.set(600);
    fixture.detectChanges();
    await fixture.whenStable();

    const stats = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLElement>('[data-testid="calls-stats"]')!;
    expect(stats.textContent).toContain('ATM 600');
    expect(stats.textContent).toContain('590–610');
    expect(stats.textContent).toContain('3 of 5 strikes');
  });

  it('up day: calls mark gainers, puts mark losers — inverted on down days', async () => {
    const fixture = await render();
    // dn cells at exp 10-16, up cells at exp 11-20 — one strike so it
    // survives the ATM window at both spot values.
    mockStore.sessionContracts.set([
      oc({ contractID: 'call-dn', type: OptionType.CALL, strike: '600', expiration: '2026-10-16', mark: '0.50' }),
      oc({ contractID: 'call-up', type: OptionType.CALL, strike: '600', expiration: '2026-11-20', mark: '4.00' }),
      oc({ contractID: 'put-dn', type: OptionType.PUT, strike: '600', expiration: '2026-10-16', mark: '0.50' }),
      oc({ contractID: 'put-up', type: OptionType.PUT, strike: '600', expiration: '2026-11-20', mark: '4.00' }),
    ]);
    mockStore.priorContracts.set([
      oc({ contractID: 'call-dn', type: OptionType.CALL, strike: '600', expiration: '2026-10-16', mark: '2.00' }),
      oc({ contractID: 'call-up', type: OptionType.CALL, strike: '600', expiration: '2026-11-20', mark: '2.00' }),
      oc({ contractID: 'put-dn', type: OptionType.PUT, strike: '600', expiration: '2026-10-16', mark: '2.00' }),
      oc({ contractID: 'put-up', type: OptionType.PUT, strike: '600', expiration: '2026-11-20', mark: '2.00' }),
    ]);
    const el: HTMLElement = fixture.nativeElement;
    // Sliced-out strikes read as unmarked.
    const marked = (cid: string) =>
      el.querySelector(`[data-cid="${cid}"]`)?.classList.contains('top-gainer') ?? false;

    // Up day — calls highlight the gainer, puts highlight the loser.
    mockStore.sessionClose.set(605);
    mockStore.priorClose.set(600);
    fixture.detectChanges();
    expect(marked('call-up')).toBe(true);
    expect(marked('call-dn')).toBe(false);
    expect(marked('put-dn')).toBe(true);
    expect(marked('put-up')).toBe(false);

    // Down day — inverts.
    mockStore.sessionClose.set(595);
    fixture.detectChanges();
    expect(marked('call-dn')).toBe(true);
    expect(marked('call-up')).toBe(false);
    expect(marked('put-up')).toBe(true);
    expect(marked('put-dn')).toBe(false);

    // Flat / missing closes — no rings at all.
    mockStore.sessionClose.set(600);
    fixture.detectChanges();
    expect(el.querySelectorAll('.top-gainer').length).toBe(0);
    mockStore.priorClose.set(null);
    fixture.detectChanges();
    expect(el.querySelectorAll('.top-gainer').length).toBe(0);
  });

  it('shows the underlying session close + prior close in the header', async () => {
    const fixture = await render();
    mockStore.sessionClose.set(601.25);
    mockStore.priorClose.set(599.8);
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const close = el.querySelector<HTMLElement>('[data-testid="underlying-close"]')!;
    expect(close.textContent).toContain('601.25');
    expect(close.textContent).toContain('+0.24%');
    expect(close.textContent).toContain('599.80');
    expect(close.classList.contains('close-up')).toBe(true);

    mockStore.priorClose.set(610);
    fixture.detectChanges();
    expect(close.classList.contains('close-down')).toBe(true);

    // Zero prior close → n/a, never a division artifact.
    mockStore.priorClose.set(0);
    fixture.detectChanges();
    expect(close.textContent).toContain('n/a');
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
