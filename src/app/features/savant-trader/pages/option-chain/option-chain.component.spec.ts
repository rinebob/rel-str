import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { MatDatepicker, MatDatepickerInput } from '@angular/material/datepicker';

import { OptionChainComponent } from './option-chain.component';
import { OptionChainStore } from './option-chain.store';
import { SymbolListStore } from '../../stores/symbol-list.store';
import type { StSymbolProfile } from '../../services/types';
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
   *  storage so scroll math has real numbers to work on. */
  function stubScroller(
    el: HTMLElement,
    geo: { h: number; ch: number; w: number; cw: number },
  ): { el: HTMLElement } {
    let top = 0, left = 0;
    Object.defineProperty(el, 'scrollHeight', { get: () => geo.h, configurable: true });
    Object.defineProperty(el, 'clientHeight', { get: () => geo.ch, configurable: true });
    Object.defineProperty(el, 'scrollWidth', { get: () => geo.w, configurable: true });
    Object.defineProperty(el, 'clientWidth', { get: () => geo.cw, configurable: true });
    // Clamp like the real DOM — boundary behavior is part of the sync contract.
    Object.defineProperty(el, 'scrollTop', { get: () => top, set: (v: number) => { top = Math.max(0, Math.min(v, geo.h - geo.ch)); }, configurable: true });
    Object.defineProperty(el, 'scrollLeft', { get: () => left, set: (v: number) => { left = Math.max(0, Math.min(v, geo.w - geo.cw)); }, configurable: true });
    return { el };
  }

  /** Fake the row geometry scrollToStrike reads: every [data-strike]
   *  row's rect is contentOffset = headerH + idx*rowH, slid by scrollTop;
   *  the scroller's own rect tops at 0. */
  function stubRows(scroller: HTMLElement, headerH: number, rowH: number): void {
    scroller.getBoundingClientRect = () =>
      ({ top: 0, height: scroller.clientHeight }) as DOMRect;
    scroller
      .querySelectorAll<HTMLElement>('[data-strike]')
      .forEach((row, idx) => {
        row.getBoundingClientRect = () =>
          ({
            top: headerH + idx * rowH - scroller.scrollTop,
            height: rowH,
          }) as DOMRect;
      });
  }

  let mockStore: ReturnType<typeof makeMockStore>;
  let mockLists: {
    loadProfiles: jest.Mock;
    profilesBySymbol: ReturnType<typeof signal<Map<string, StSymbolProfile>>>;
  };

  beforeEach(() => localStorage.clear());

  async function render(initialSymbol = '') {
    mockStore = makeMockStore();
    mockStore.symbol.set(initialSymbol);
    mockLists = {
      loadProfiles: jest.fn(),
      profilesBySymbol: signal(new Map<string, StSymbolProfile>()),
    };
    await TestBed.configureTestingModule({
      imports: [OptionChainComponent],
      providers: [
        provideRouter([]),
        { provide: OptionChainStore, useValue: mockStore },
        { provide: SymbolListStore, useValue: mockLists },
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

  it('syncs panes from the aligned baseline — same direction both axes', async () => {
    const fixture = await render();
    mockStore.sessionContracts.set([
      oc({ contractID: 'call-a', type: OptionType.CALL }),
      oc({ contractID: 'put-a', type: OptionType.PUT }),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    const scrollers = (fixture.nativeElement as HTMLElement)
      .querySelectorAll<HTMLElement>('.grid-scroll');
    expect(scrollers.length).toBe(2);
    const calls = stubScroller(scrollers[0], { h: 1000, ch: 60, w: 1000, cw: 500 });
    const puts = stubScroller(scrollers[1], { h: 1000, ch: 60, w: 2000, cw: 1000 });

    // First event seeds the baseline — panes are auto-centered/aligned,
    // so seeding at current positions is correct.
    calls.el.dispatchEvent(new Event('scroll'));
    expect(puts.el.scrollTop).toBe(0);

    // calls +60 down / +50 right → puts lands at baseline + same offsets.
    calls.el.scrollTop = 60;
    calls.el.scrollLeft = 50;
    calls.el.dispatchEvent(new Event('scroll'));
    expect(puts.el.scrollTop).toBe(60);
    expect(puts.el.scrollLeft).toBe(50);

    // Reverse direction: puts (baseline seeded at 0 during calls' first
    // event) at 80 → calls lands at its baseline + 80.
    puts.el.scrollTop = 80;
    puts.el.dispatchEvent(new Event('scroll'));
    expect(calls.el.scrollTop).toBe(80);
  });

  it('boundary clamps self-heal — no persistent offset after overscroll', async () => {
    const fixture = await render();
    mockStore.sessionContracts.set([
      oc({ contractID: 'call-700', type: OptionType.CALL, strike: '700' }),
      oc({ contractID: 'call-600', type: OptionType.CALL, strike: '600' }),
      oc({ contractID: 'call-590', type: OptionType.CALL, strike: '590' }),
      oc({ contractID: 'put-560', type: OptionType.PUT, strike: '560' }),
      oc({ contractID: 'put-580', type: OptionType.PUT, strike: '580' }),
      oc({ contractID: 'put-600', type: OptionType.PUT, strike: '600' }),
      oc({ contractID: 'put-620', type: OptionType.PUT, strike: '620' }),
      oc({ contractID: 'put-640', type: OptionType.PUT, strike: '640' }),
    ]);
    mockStore.sessionClose.set(600);
    fixture.detectChanges();
    await fixture.whenStable();
    const scrollers = (fixture.nativeElement as HTMLElement)
      .querySelectorAll<HTMLElement>('.grid-scroll');
    const calls = stubScroller(scrollers[0], { h: 1000, ch: 60, w: 1000, cw: 500 });
    const puts = stubScroller(scrollers[1], { h: 1000, ch: 60, w: 2000, cw: 1000 });
    stubRows(scrollers[0], 30, 30);
    stubRows(scrollers[1], 30, 30);

    // Resync seeds aligned baselines: calls 45, puts 75.
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="resync"]')!
      .click();
    expect(calls.el.scrollTop).toBe(45);
    expect(puts.el.scrollTop).toBe(75);

    // calls to the top (offset −45) → puts = 75 − 45 = 30.
    calls.el.scrollTop = 0;
    calls.el.dispatchEvent(new Event('scroll'));
    expect(puts.el.scrollTop).toBe(30);

    // puts to the top (offset −75 vs its baseline) → calls = 45 − 75 →
    // clamps at 0. The overscroll is "virtual" — recomputed every event.
    puts.el.scrollTop = 0;
    puts.el.dispatchEvent(new Event('scroll'));
    expect(calls.el.scrollTop).toBe(0);

    // calls back to its baseline → puts recomputes to EXACTLY its own
    // baseline 75 — clamped overscroll can't accumulate into a gap.
    calls.el.scrollTop = 45;
    calls.el.dispatchEvent(new Event('scroll'));
    expect(puts.el.scrollTop).toBe(75);
  });

  it('programmatic writes echo back as a no-op write — no feedback', async () => {
    const fixture = await render();
    mockStore.sessionContracts.set([
      oc({ contractID: 'call-a', type: OptionType.CALL }),
      oc({ contractID: 'put-a', type: OptionType.PUT }),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    const scrollers = (fixture.nativeElement as HTMLElement)
      .querySelectorAll<HTMLElement>('.grid-scroll');
    const calls = stubScroller(scrollers[0], { h: 1000, ch: 60, w: 1000, cw: 500 });
    const puts = stubScroller(scrollers[1], { h: 1000, ch: 60, w: 2000, cw: 1000 });
    calls.el.dispatchEvent(new Event('scroll'));

    // calls +60 → puts moves to 60. puts' queued scroll event then maps
    // puts→calls and writes calls to its own current position — a no-op
    // that produces no further event.
    calls.el.scrollTop = 60;
    calls.el.dispatchEvent(new Event('scroll'));
    expect(puts.el.scrollTop).toBe(60);
    puts.el.dispatchEvent(new Event('scroll')); // the echo
    expect(calls.el.scrollTop).toBe(60);        // unchanged
  });

  it('re-sync re-centers each pane and re-anchors the baselines', async () => {
    const fixture = await render();
    mockStore.sessionContracts.set([
      oc({ contractID: 'call-700', type: OptionType.CALL, strike: '700' }),
      oc({ contractID: 'call-600', type: OptionType.CALL, strike: '600' }),
      oc({ contractID: 'call-590', type: OptionType.CALL, strike: '590' }),
      oc({ contractID: 'put-560', type: OptionType.PUT, strike: '560' }),
      oc({ contractID: 'put-580', type: OptionType.PUT, strike: '580' }),
      oc({ contractID: 'put-600', type: OptionType.PUT, strike: '600' }),
      oc({ contractID: 'put-620', type: OptionType.PUT, strike: '620' }),
      oc({ contractID: 'put-640', type: OptionType.PUT, strike: '640' }),
    ]);
    mockStore.sessionClose.set(600);
    fixture.detectChanges();
    await fixture.whenStable();
    const scrollers = (fixture.nativeElement as HTMLElement)
      .querySelectorAll<HTMLElement>('.grid-scroll');
    const calls = stubScroller(scrollers[0], { h: 1000, ch: 60, w: 1000, cw: 500 });
    const puts = stubScroller(scrollers[1], { h: 1000, ch: 60, w: 2000, cw: 1000 });
    stubRows(scrollers[0], 30, 30);
    stubRows(scrollers[1], 30, 30);

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="resync"]')!
      .click();
    // calls: ATM 600 at index 1 (desc) → 30 + 30 + 15 − 30 = 45.
    expect(calls.el.scrollTop).toBe(45);
    // puts: own ATM 600 at index 2 (asc) → 30 + 60 + 15 − 30 = 75.
    expect(puts.el.scrollTop).toBe(75);

    // The resync writes' queued events map back onto the same positions.
    calls.el.dispatchEvent(new Event('scroll'));
    puts.el.dispatchEvent(new Event('scroll'));
    expect(calls.el.scrollTop).toBe(45);
    expect(puts.el.scrollTop).toBe(75);

    // First scroll after resync: calls +30 → puts 75 + 30 — alignment
    // preserved row-for-row from the re-anchored baseline.
    calls.el.scrollTop = 75;
    calls.el.dispatchEvent(new Event('scroll'));
    expect(puts.el.scrollTop).toBe(105);
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
      .toBe('{"bands":[],"hidden":["2026-10-16"],"shown":[]}');

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

  it('deselected bands re-derive against the session date — not frozen dates', async () => {
    const fixture = await render();
    mockStore.resolvedDate.set('2026-09-22');
    mockStore.sessionContracts.set([
      // 3d → <6d; 18d → 15–30d
      oc({ contractID: 'near-c', type: OptionType.CALL, expiration: '2026-09-25' }),
      oc({ contractID: 'mid-c', type: OptionType.CALL, expiration: '2026-10-10', strike: '605' }),
    ]);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    el.querySelector<HTMLButtonElement>('[data-testid="columns-picker"]')!.click();
    fixture.detectChanges();
    const band = (id: string) =>
      el.querySelector<HTMLInputElement>(`.picker-band [data-band="${id}"]`)!;

    // Deselect 15–30d → the 18d expiration hides.
    band('d15_30').click();
    fixture.detectChanges();
    expect(el.querySelector('[data-cid="mid-c"]')).toBeNull();
    expect(el.querySelector('[data-cid="near-c"]')).toBeTruthy();

    // Session moves forward: 2026-10-10 is now 15d out → falls into the
    // 6–15d band → VISIBLE again (the band selection tracks the window,
    // not the date it was toggled against).
    mockStore.resolvedDate.set('2026-09-25');
    fixture.detectChanges();
    expect(el.querySelector('[data-cid="mid-c"]')).toBeTruthy();

    // And a date now inside 15–30d hides without ever being touched:
    // 2026-10-12 is 17d from the new session → hidden by the same band.
    mockStore.sessionContracts.set([
      oc({ contractID: 'near-c', type: OptionType.CALL, expiration: '2026-09-25' }),
      oc({ contractID: 'new-c', type: OptionType.CALL, expiration: '2026-10-12', strike: '605' }),
    ]);
    fixture.detectChanges();
    expect(el.querySelector('[data-cid="new-c"]')).toBeNull();
  });

  it('per-expiration override resurrects a date inside a deselected band', async () => {
    const fixture = await render();
    mockStore.resolvedDate.set('2026-09-22');
    mockStore.sessionContracts.set([
      oc({ contractID: 'a', type: OptionType.CALL, expiration: '2026-10-10' }),
      oc({ contractID: 'b', type: OptionType.CALL, expiration: '2026-10-16', strike: '605' }),
    ]);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLButtonElement>('[data-testid="columns-picker"]')!.click();
    fixture.detectChanges();

    // Deselect the band covering both (both are 15–30d) → both hidden.
    el.querySelector<HTMLInputElement>('.picker-band [data-band="d15_30"]')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-cid="a"]')).toBeNull();

    // Explicitly re-check one expiration → it returns (expShown override).
    const item = Array.from(
      el.querySelectorAll<HTMLLabelElement>('.picker-item:not(.picker-band)'),
    ).find((i) => i.textContent!.includes('2026-10-10'))!;
    item.querySelector('input')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-cid="a"]')).toBeTruthy();
    expect(el.querySelector('[data-cid="b"]')).toBeNull();
  });

  it('legacy array-shaped column state migrates to per-expiration hides', async () => {
    localStorage.setItem(
      'option-chain.hidden-expirations.QQQ',
      '["2026-10-16"]',
    );
    const fixture = await render('QQQ');
    mockStore.sessionContracts.set([
      oc({ contractID: 'call-a', type: OptionType.CALL, expiration: '2026-10-16' }),
      oc({ contractID: 'call-b', type: OptionType.CALL, expiration: '2026-11-20', strike: '605' }),
    ]);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-cid="call-a"]')).toBeNull();
    expect(el.querySelector('[data-cid="call-b"]')).toBeTruthy();
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

  it('date input commits on Enter — setDateInput + loadChain', async () => {
    const fixture = await render();
    const el: HTMLElement = fixture.nativeElement;
    const input = el.querySelector<HTMLInputElement>('[data-testid="date-input"]')!;

    input.value = '2026-09-20';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();

    expect(mockStore.setDateInput).toHaveBeenCalledWith('2026-09-20');
    expect(mockStore.loadChain).toHaveBeenCalled();
    expect(el.querySelector('[data-testid="date-error"]')).toBeFalsy();
  });

  it('invalid manual date shows inline validation and does not fetch', async () => {
    const fixture = await render();
    const el: HTMLElement = fixture.nativeElement;
    mockStore.loadChain.mockClear();
    const input = el.querySelector<HTMLInputElement>('[data-testid="date-input"]')!;

    input.value = '09/20/2026';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();

    expect(mockStore.loadChain).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="date-error"]')?.textContent)
      .toContain('YYYY-MM-DD');
  });

  it('clearing the date + Enter re-resolves the latest session', async () => {
    const fixture = await render();
    const input = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLInputElement>('[data-testid="date-input"]')!;

    input.value = '';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(mockStore.loadToday).toHaveBeenCalled();
  });

  it('impossible calendar dates (Feb 31) are rejected — no fetch', async () => {
    const fixture = await render();
    const el: HTMLElement = fixture.nativeElement;
    mockStore.loadChain.mockClear();
    const input = el.querySelector<HTMLInputElement>('[data-testid="date-input"]')!;

    // Date.parse normalizes '2026-02-31' to Mar 3 — must round-trip check.
    input.value = '2026-02-31';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();

    expect(mockStore.loadChain).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="date-error"]')).toBeTruthy();
  });

  it('Today button re-resolves the latest session', async () => {
    const fixture = await render();
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="today-btn"]')!
      .click();
    expect(mockStore.loadToday).toHaveBeenCalled();
  });

  it('datepicker selection commits the picked date as YYYY-MM-DD', async () => {
    const fixture = await render();
    mockStore.loadChain.mockClear();
    // NativeDateAdapter produces local-midnight Dates — the handler must
    // format local Y/M/D, not toISOString (which shifts back a day in PT).
    fixture.componentInstance.onPickedDate(new Date(2026, 8, 20));
    expect(mockStore.setDateInput).toHaveBeenCalledWith('2026-09-20');
    expect(mockStore.loadChain).toHaveBeenCalled();
  });

  it('anchor input carries MatDatepickerInput bound to the session picker', async () => {
    const fixture = await render();
    // The picker refuses to open without an associated input — if the
    // association breaks, the calendar silently stops working and no
    // method-level spec would notice.
    const dir = fixture.debugElement.query(By.directive(MatDatepickerInput));
    expect(dir).toBeTruthy();
    expect(dir.nativeElement.classList.contains('date-anchor')).toBe(true);
    const picker = fixture.debugElement.query(By.directive(MatDatepicker));
    expect(dir.injector.get(MatDatepickerInput)._datepicker)
      .toBe(picker.componentInstance);
  });

  it('date input displays the store-pinned resolved session date', async () => {
    const fixture = await render();
    mockStore.dateInput.set('2026-09-22');
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLInputElement>('[data-testid="date-input"]')!;
    expect(input.value).toBe('2026-09-22');
  });

  it('shows the company name in the header when a profile exists', async () => {
    const fixture = await render('QQQ');
    mockLists.profilesBySymbol.set(new Map([
      ['QQQ', { symbol: 'QQQ', name: 'Invesco QQQ Trust' } as StSymbolProfile],
    ]));
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="company-name"]')?.textContent)
      .toContain('Invesco QQQ Trust');
  });

  it('omits the company-name span for untracked symbols', async () => {
    const fixture = await render('ZZZZ');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="company-name"]')).toBeFalsy();
  });

  it('renders the snapshot source label', async () => {
    const fixture = await render();
    mockStore.source.set('av');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.source-label')?.textContent).toContain('av');
  });

  it('no-data state names the picked date when a manual session is empty', async () => {
    const fixture = await render();
    mockStore.resolvedNoData.set(true);
    mockStore.resolvedDate.set('2026-09-18');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent)
      .toContain('No chain data found for 2026-09-18');
  });

  it('no-data state names the 7-day window in auto mode', async () => {
    const fixture = await render();
    mockStore.resolvedNoData.set(true);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent)
      .toContain('No chain data found in the last 7 days');
  });

  it('strike range filter hides out-of-band strikes', async () => {
    const fixture = await render();
    mockStore.sessionContracts.set([
      oc({ contractID: 'call-near', strike: '600' }),
      oc({ contractID: 'call-far', strike: '700' }),
    ]);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-cid="call-far"]')).toBeTruthy();

    fixture.componentInstance.strikeLte.set(650);
    fixture.detectChanges();
    expect(el.querySelector('[data-cid="call-far"]')).toBeFalsy();
    expect(el.querySelector('[data-cid="call-near"]')).toBeTruthy();
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
