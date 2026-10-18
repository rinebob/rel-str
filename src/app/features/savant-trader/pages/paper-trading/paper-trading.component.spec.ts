import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';

import { PaperTradingComponent } from './paper-trading.component';
import { PaperTradingStore } from '../../stores/paper-trading.store';
import { TradeSide } from '@common';
import {
  PaperTradeStatus,
  PaperTradeSource,
  PaperTradingKind,
  type PaperAccount,
  type PaperTrade,
} from '@paper-trading/contracts';

// =============================================================================
// Fixtures
// =============================================================================

function makeTrade(id: string, overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    id,
    kind: PaperTradingKind.TRADE,
    status: PaperTradeStatus.OPEN,
    source: PaperTradeSource.SIGNAL,
    symbol: 'AAPL',
    expression: 'EQ',
    governingVariant: 'exit-14d',
    order: { side: TradeSide.LONG, type: 'MARKET', quantity: 10 },
    fills: [],
    legs: [],
    marks: {},
    variantRuns: [],
    variantKeys: ['exit-14d', 'exit-7d'],
    realizedPnl: 0,
    unrealizedPnl: 0,
    createdAt: '2026-09-20T00:00:00Z',
    updatedAt: '2026-09-20T00:00:00Z',
    ...overrides,
  } as PaperTrade;
}

const ACCOUNT: PaperAccount = {
  id: 'acct-u1',
  kind: PaperTradingKind.ACCOUNT,
  userId: 'u1',
  cash: -250,
  equity: 9750,
  realizedPnl: 1200,
  openTradeCount: 3,
} as PaperAccount;

// =============================================================================

describe('PaperTradingComponent', () => {
  let fixture: ComponentFixture<PaperTradingComponent>;
  let component: PaperTradingComponent;
  let storeMock: any;

  const TRADES: PaperTrade[] = [
    makeTrade('pt-aapl-sig-x-eq', {
      cohortId: 'cohort-x', symbol: 'AAPL', expression: 'EQ',
      governingVariant: 'exit-14d', realizedPnl: 50, unrealizedPnl: 10,
      signalType: 'D_ST_TREND_RIDER_V1_LONG',
    }),
    makeTrade('pt-aapl-sig-x-csp', {
      cohortId: 'cohort-x', symbol: 'AAPL', expression: 'CSP',
      governingVariant: 'exit-7d', variantKeys: ['exit-7d'],
      status: PaperTradeStatus.CLOSED, realizedPnl: 80,
    }),
    makeTrade('pt-nvda-sig-y-eq', {
      cohortId: 'cohort-y', symbol: 'NVDA', expression: 'EQ',
      status: PaperTradeStatus.PENDING, unrealizedPnl: -5,
      // Stamped short signal — the real direction grouper puts stamped
      // trades under order.side, unstamped under '—'.
      signalType: 'D_ST_TREND_RIDER_V1_SHORT',
      order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 10 },
    }),
  ];

  beforeEach(async () => {
    storeMock = {
      account: signal<PaperAccount | null>(ACCOUNT),
      trades: signal<PaperTrade[]>(TRADES),
      error: signal<string | null>(null),
      isLoading: signal(false),
      isEmpty: signal(false),
      openTrades: signal(TRADES.filter((t) => t.status === PaperTradeStatus.OPEN)),
      // Real Maps — the store's tradesBy* computeds return Map, not Record.
      tradesByInstance: signal(new Map([['none', TRADES]])),
      tradesByCohort: signal(new Map<string, PaperTrade[]>([
        ['cohort-x', [TRADES[0], TRADES[1]]],
        ['cohort-y', [TRADES[2]]],
      ])),
      tradesByVariant: signal(new Map<string, PaperTrade[]>([
        ['exit-14d', [TRADES[0]]],
        ['exit-7d', [TRADES[0], TRADES[1]]],
      ])),
      tradesBySymbol: signal(new Map<string, PaperTrade[]>([
        ['AAPL', [TRADES[0], TRADES[1]]],
        ['NVDA', [TRADES[2]]],
      ])),
      tradesByExpression: signal(new Map<string, PaperTrade[]>([
        ['EQ', [TRADES[0], TRADES[2]]],
        ['CSP', [TRADES[1]]],
      ])),
      tradesBySignalType: signal(new Map<string, PaperTrade[]>([
        ['D_ST_TREND_RIDER_V1_LONG', [TRADES[0]]],
        ['D_ST_TREND_RIDER_V1_SHORT', [TRADES[2]]],
        ['—', [TRADES[1]]],
      ])),
      tradesByDirection: signal(new Map<string, PaperTrade[]>([
        ['long', [TRADES[0]]],
        ['short', [TRADES[2]]],
        ['—', [TRADES[1]]], // non-signal trades bucket here — real grouper semantics
      ])),
      tradesBySector: signal(new Map<string, PaperTrade[]>([
        ['TECHNOLOGY', [TRADES[0], TRADES[1]]],
        ['—', [TRADES[2]]],
      ])),
      tradesByIndustry: signal(new Map<string, PaperTrade[]>([
        ['Software - Application', [TRADES[0]]],
        ['—', [TRADES[1], TRADES[2]]],
      ])),
      tradesByCapTier: signal(new Map<string, PaperTrade[]>([
        ['mega', [TRADES[0]]],
        ['—', [TRADES[1], TRADES[2]]],
      ])),
      tradesBySignalStatus: signal(new Map<string, PaperTrade[]>([
        ['CONFIRMED', [TRADES[0], TRADES[1]]],
        ['—', [TRADES[2]]],
      ])),
      loadAll: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [PaperTradingComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: PaperTradingStore, useValue: storeMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PaperTradingComponent);
    component = fixture.componentInstance;
  });

  it('loads everything via loadAll on init', () => {
    fixture.detectChanges();
    expect(storeMock.loadAll).toHaveBeenCalled();
  });

  it('account header shows cash/equity/P&L — negative cash rendered in red', () => {
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('- $250.00'.replace(' ', '')); // Intl formats -250 as -$250.00
    const cashCard = [...fixture.nativeElement.querySelectorAll('.stat-card')]
      .find((el: Element) => el.textContent!.includes('Cash'));
    expect(cashCard?.querySelector('.stat-value')?.classList.contains('negative')).toBe(true);
  });

  it('default group-by renders one all-trades group', () => {
    fixture.detectChanges();
    const groups = fixture.nativeElement.querySelectorAll('.table-section');
    expect(groups.length).toBe(1);
    expect(groups[0].getAttribute('data-group-key')).toBe('all');
  });

  it('group-by cohort repivots the table into per-cohort sections', () => {
    fixture.detectChanges();
    component.groupBy.set('cohort');
    fixture.detectChanges();

    const groups = [...fixture.nativeElement.querySelectorAll('.table-section')];
    const keys = groups.map((g) => g.getAttribute('data-group-key'));
    expect(keys).toContain('cohort-x');
    expect(keys).toContain('cohort-y');
    expect(keys.length).toBe(2);
  });

  it('group-by symbol repivots per symbol', () => {
    fixture.detectChanges();
    component.groupBy.set('symbol');
    fixture.detectChanges();

    const keys = [...fixture.nativeElement.querySelectorAll('.table-section')]
      .map((g) => g.getAttribute('data-group-key'));
    expect(keys).toContain('AAPL');
    expect(keys).toContain('NVDA');
  });

  it('toggling the same cohort collapses the drill-down', () => {
    fixture.detectChanges();
    component.toggleCohort('cohort-x');
    expect(component.selectedCohort()).toBe('cohort-x');
    component.toggleCohort('cohort-x');
    expect(component.selectedCohort()).toBeNull();
  });

  it('clicking a column header sorts rows within the group; re-click flips direction', () => {
    fixture.detectChanges();
    component.groupBy.set('all');
    component.toggleSort('symbol');
    fixture.detectChanges();

    const rows = () =>
      [...fixture.nativeElement.querySelectorAll('.table-section tbody tr')].map(
        (r: Element) => r.textContent,
      );
    let text = rows().join('|');
    expect(text.indexOf('AAPL')).toBeLessThan(text.indexOf('NVDA')); // asc

    component.toggleSort('symbol');
    fixture.detectChanges();
    text = rows().join('|');
    expect(text.indexOf('NVDA')).toBeLessThan(text.indexOf('AAPL')); // desc
  });

  it('numeric columns sort numerically, not lexically', () => {
    fixture.detectChanges();
    component.groupBy.set('all');
    component.toggleSort('realized');
    fixture.detectChanges();

    const ids = [...fixture.nativeElement.querySelectorAll('.table-section tbody tr')].map(
      (r: Element) => r.querySelector('.mono')!.textContent,
    );
    // realizedPnl: pt-nvda 0 < pt-aapl-sig-x-eq 50 < pt-aapl-sig-x-csp 80
    expect(ids).toEqual(['pt-nvda-sig-y-eq', 'pt-aapl-sig-x-eq', 'pt-aapl-sig-x-csp']);
  });

  it('shift-adds a secondary sort key applied within primary ties', () => {
    fixture.detectChanges();
    component.groupBy.set('all');
    component.toggleSort('symbol'); // primary: AAPL trades before NVDA
    component.toggleSort('realized', true); // secondary asc — flips to desc below
    component.toggleSort('realized', true);
    fixture.detectChanges();

    expect(component.sorts()).toEqual([
      { key: 'symbol', dir: 'asc' },
      { key: 'realized', dir: 'desc' },
    ]);
    const ids = [...fixture.nativeElement.querySelectorAll('.table-section tbody tr')].map(
      (r: Element) => r.querySelector('.mono')!.textContent,
    );
    // AAPL pair ordered by secondary realized desc: csp(80) then eq(50)
    expect(ids).toEqual(['pt-aapl-sig-x-csp', 'pt-aapl-sig-x-eq', 'pt-nvda-sig-y-eq']);
  });

  it('a sorted column cycles asc → desc → removed', () => {
    fixture.detectChanges();
    component.toggleSort('symbol');
    component.toggleSort('symbol');
    expect(component.sortAria('symbol')).toBe('descending');
    component.toggleSort('symbol');
    expect(component.sortAria('symbol')).toBe('none');
    expect(component.sorts()).toEqual([]);
  });

  it('sort applies per-group when grouped by a dimension', () => {
    fixture.detectChanges();
    component.groupBy.set('cohort');
    component.toggleCohort('cohort-x'); // cohort sections render collapsed
    component.toggleSort('realized');
    component.toggleSort('realized'); // desc
    fixture.detectChanges();

    const cohortX = [...fixture.nativeElement.querySelectorAll('.table-section')]
      .find((g) => g.getAttribute('data-group-key') === 'cohort-x');
    const ids = [...cohortX!.querySelectorAll('tbody tr')].map(
      (r: Element) => r.querySelector('.mono')!.textContent,
    );
    // desc within cohort-x: csp (80) before eq (50)
    expect(ids).toEqual(['pt-aapl-sig-x-csp', 'pt-aapl-sig-x-eq']);
  });

  it('clicking a rendered column header drives the sort (wiring, not internals)', () => {
    fixture.detectChanges();
    const headers = [...fixture.nativeElement.querySelectorAll('th.sortable')] as HTMLElement[];
    const symbolTh = headers.find((h) => h.textContent!.includes('Symbol'))!;

    symbolTh.click();
    fixture.detectChanges();
    let ids = [...fixture.nativeElement.querySelectorAll('.table-section tbody tr')].map(
      (r: Element) => r.querySelector('.mono')!.textContent,
    );
    expect(ids).toEqual(['pt-aapl-sig-x-eq', 'pt-aapl-sig-x-csp', 'pt-nvda-sig-y-eq']); // asc
    expect(symbolTh.getAttribute('aria-sort')).toBe('ascending');

    symbolTh.click();
    fixture.detectChanges();
    ids = [...fixture.nativeElement.querySelectorAll('.table-section tbody tr')].map(
      (r: Element) => r.querySelector('.mono')!.textContent,
    );
    expect(ids).toEqual(['pt-nvda-sig-y-eq', 'pt-aapl-sig-x-eq', 'pt-aapl-sig-x-csp']); // desc
    expect(symbolTh.getAttribute('aria-sort')).toBe('descending');
  });

  it('cohort sections render collapsed — table hidden until the expando opens', () => {
    fixture.detectChanges();
    component.groupBy.set('cohort');
    fixture.detectChanges();

    const section = (key: string) =>
      [...fixture.nativeElement.querySelectorAll('.table-section')]
        .find((g) => g.getAttribute('data-group-key') === key) as HTMLElement;

    expect(section('cohort-x').querySelector('.trades-table')).toBeNull();

    component.toggleCohort('cohort-x');
    fixture.detectChanges();
    expect(section('cohort-x').querySelector('.trades-table')).toBeTruthy();
    expect(section('cohort-y').querySelector('.trades-table')).toBeNull(); // accordion

    component.toggleCohort('cohort-x');
    fixture.detectChanges();
    expect(section('cohort-x').querySelector('.trades-table')).toBeNull(); // closes
  });

  it.each([
    ['signalType', 'D_ST_TREND_RIDER_V1_LONG'],
    ['sector', 'TECHNOLOGY'],
    ['industry', 'Software - Application'],
    ['capTier', 'mega'],
    ['signalStatus', 'CONFIRMED'],
  ] as const)('group-by %s repivots the table with a "—" unstamped bucket', (dim, stampedKey) => {
    fixture.detectChanges();
    component.groupBy.set(dim);
    fixture.detectChanges();

    const keys = [...fixture.nativeElement.querySelectorAll('.table-section')]
      .map((g) => g.getAttribute('data-group-key'));
    expect(keys).toContain(stampedKey);
    expect(keys).toContain('—');
  });

  it('group-by direction repivots by order side', () => {
    fixture.detectChanges();
    component.groupBy.set('direction');
    fixture.detectChanges();
    const keys = [...fixture.nativeElement.querySelectorAll('.table-section')]
      .map((g) => g.getAttribute('data-group-key'));
    expect(keys).toContain('long');
    expect(keys).toContain('short');
  });

  it('the equity curve panel and scope plumbing are gone (#1067)', () => {
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.chart-panel')).toBeNull();
    expect(el.querySelector('ejs-chart')).toBeNull();
    expect(el.querySelector('.scope-jump')).toBeNull();
  });

  it('capital required counts only open/pending trades', () => {
    fixture.detectChanges();
    // TRADES[1] is CLOSED with no capitalRequired anyway — set one and assert.
    const closed = { ...TRADES[1], capitalRequired: 5000 };
    storeMock.trades.set([TRADES[0], closed, { ...TRADES[2], capitalRequired: 100 }]);
    expect(component.capitalRequired()).toBe(100);
  });

  it('empty state when no trades and no account', () => {
    storeMock.trades.set([]);
    storeMock.account.set(null);
    storeMock.isEmpty.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No paper trades yet');
  });

  it('error banner surfaces store error', () => {
    storeMock.error.set('load failed');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.error-banner')?.textContent).toContain('load failed');
  });
});
