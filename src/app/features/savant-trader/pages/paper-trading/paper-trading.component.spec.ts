import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Component, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { ChartModule } from '@syncfusion/ej2-angular-charts';

import { PaperTradingComponent } from './paper-trading.component';
import { PaperTradingStore } from '../../stores/paper-trading.store';
import { TradeSide } from '@common';
import {
  PaperTradeStatus,
  PaperTradeSource,
  PaperTradingKind,
  type PaperAccount,
  type PaperStats,
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

function makeStats(scope: string, overrides: Partial<PaperStats> = {}): PaperStats {
  return {
    id: `stats-${scope}`,
    kind: PaperTradingKind.STATS,
    scope,
    totalRealizedPnl: 0,
    totalUnrealizedPnl: 0,
    openTradeCount: 0,
    closedTradeCount: 0,
    maxDrawdown: 0,
    equityCurve: [
      { date: '2026-09-01', cumulativePnl: 0 },
      { date: '2026-09-02', cumulativePnl: 100 },
    ],
    ...overrides,
  } as PaperStats;
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
// Syncfusion chart stubs — the real ejs-chart can't render under jsdom.
// =============================================================================

@Component({ selector: 'ejs-chart', template: '<div class="stub-chart"></div>' })
class StubEjsChart {}
@Component({ selector: 'e-series-collection', template: '' })
class StubSeriesCollection {}
@Component({ selector: 'e-series', template: '' })
class StubSeries {}

// =============================================================================

describe('PaperTradingComponent', () => {
  let fixture: ComponentFixture<PaperTradingComponent>;
  let component: PaperTradingComponent;
  let storeMock: any;

  const TRADES: PaperTrade[] = [
    makeTrade('pt-aapl-sig-x-eq', {
      cohortId: 'cohort-x', symbol: 'AAPL', expression: 'EQ',
      governingVariant: 'exit-14d', realizedPnl: 50, unrealizedPnl: 10,
      variantRuns: [
        { variantKey: 'exit-14d', governing: true, state: 'ACTIVE', workingState: {} },
        { variantKey: 'exit-7d', governing: false, state: 'EXITED', workingState: {},
          exitEvent: { date: '2026-09-05', price: 1.2, pnl: 30, daysHeld: 7 } },
      ],
    }),
    makeTrade('pt-aapl-sig-x-csp', {
      cohortId: 'cohort-x', symbol: 'AAPL', expression: 'CSP',
      governingVariant: 'exit-7d', variantKeys: ['exit-7d'],
      status: PaperTradeStatus.CLOSED, realizedPnl: 80,
    }),
    makeTrade('pt-nvda-sig-y-eq', {
      cohortId: 'cohort-y', symbol: 'NVDA', expression: 'EQ',
      status: PaperTradeStatus.PENDING, unrealizedPnl: -5,
    }),
  ];

  beforeEach(async () => {
    storeMock = {
      account: signal<PaperAccount | null>(ACCOUNT),
      trades: signal<PaperTrade[]>(TRADES),
      // Cohort stats scope is the cohortId itself (already 'cohort-' prefixed).
      statsByScope: signal<Record<string, PaperStats>>({
        all: makeStats('all'),
        'cohort-x': makeStats('cohort-x'),
      }),
      statsList: signal<PaperStats[]>([makeStats('all'), makeStats('cohort-x')]),
      exitVariants: signal([]),
      error: signal<string | null>(null),
      isLoading: signal(false),
      isLoadingAccount: signal(false),
      isLoadingTrades: signal(false),
      isLoadingStats: signal(false),
      isEmpty: signal(false),
      openTrades: signal(TRADES.filter((t) => t.status === PaperTradeStatus.OPEN)),
      closedTrades: signal(TRADES.filter((t) => t.status === PaperTradeStatus.CLOSED)),
      pendingTrades: signal(TRADES.filter((t) => t.status === PaperTradeStatus.PENDING)),
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
      loadAll: jest.fn(),
      loadAccount: jest.fn(),
      loadTrades: jest.fn(),
      loadStats: jest.fn(),
      loadExitVariants: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [PaperTradingComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: PaperTradingStore, useValue: storeMock },
      ],
    })
      .overrideComponent(PaperTradingComponent, {
        remove: { imports: [ChartModule] },
        add: { imports: [StubEjsChart, StubSeriesCollection, StubSeries] },
      })
      .compileComponents();

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

  it('cohort drill-down shows expression groups with variant outcomes', () => {
    fixture.detectChanges();
    component.groupBy.set('cohort');
    component.toggleCohort('cohort-x');
    fixture.detectChanges();

    const detail = fixture.nativeElement.querySelector('.cohort-detail');
    expect(detail).toBeTruthy();
    // Two expression blocks (EQ + CSP) for cohort-x.
    expect(detail.querySelectorAll('.expression-block').length).toBe(2);
    // Variant runs rendered: governing badge + shadow outcome.
    expect(detail.textContent).toContain('exit-14d');
    expect(detail.textContent).toContain('governing');
    expect(detail.textContent).toContain('2026-09-05');
    expect(detail.textContent).toContain('+$30.00');
  });

  it('toggling the same cohort collapses the drill-down', () => {
    fixture.detectChanges();
    component.toggleCohort('cohort-x');
    expect(component.selectedCohort()).toBe('cohort-x');
    component.toggleCohort('cohort-x');
    expect(component.selectedCohort()).toBeNull();
  });

  it('equity curve scope selector defaults to all and repivots per scope', () => {
    fixture.detectChanges();
    expect(component.effectiveScope()).toBe('all');
    expect(component.chartPoints().length).toBe(2);

    component.statsScope.set('cohort-x');
    fixture.detectChanges();
    expect(component.scopedStats()?.scope).toBe('cohort-x');
  });

  it('group-by couples to the equity curve via the scope-jump button', () => {
    fixture.detectChanges();
    component.groupBy.set('cohort');
    fixture.detectChanges();

    component.selectGroupScope('cohort-x');
    expect(component.statsScope()).toBe('cohort-x');
    expect(component.scopedStats()?.scope).toBe('cohort-x');

    // Rendering exposes the jump affordance per group section.
    const jump = fixture.nativeElement.querySelector('.scope-jump');
    expect(jump).toBeTruthy();
  });

  it('falls back to the all scope when the selected scope disappears', () => {
    fixture.detectChanges();
    component.statsScope.set('cohort-x');
    storeMock.statsByScope.set({ all: makeStats('all') });
    fixture.detectChanges();
    expect(component.effectiveScope()).toBe('all');
  });

  it('capital required counts only open/pending trades', () => {
    fixture.detectChanges();
    // TRADES[1] is CLOSED with no capitalRequired anyway — set one and assert.
    const closed = { ...TRADES[1], capitalRequired: 5000 };
    storeMock.trades.set([TRADES[0], closed, { ...TRADES[2], capitalRequired: 100 }]);
    expect(component.capitalRequired()).toBe(100);
  });

  it('cohort drill-down renders legs summary and last mark', () => {
    storeMock.trades.set([
      makeTrade('pt-legs', {
        cohortId: 'cohort-x', expression: 'CSP', status: PaperTradeStatus.OPEN,
        legs: [
          { kind: PaperTradingKind.TRADE, id: 'leg-1', side: TradeSide.SHORT, quantity: 1, multiplier: 100,
            entryMark: 0.42, lastMark: 0.55 } as never,
        ],
        marks: { '2026-09-24': { mark: 0.55 }, '2026-09-25': { mark: 0.61 } },
      }),
    ]);
    fixture.detectChanges();
    component.groupBy.set('cohort');
    component.toggleCohort('cohort-x');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('short 1×100 @0.42→0.55');
    expect(text).toContain('mark: 2026-09-25 @ $0.61');
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
