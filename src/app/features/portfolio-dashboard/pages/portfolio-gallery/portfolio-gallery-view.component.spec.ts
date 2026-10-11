/**
 * Specs for PortfolioGalleryViewComponent (#926/#950) — page shell states,
 * header wiring, and the placeholder flat grid. Facade is a signal stub.
 */
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';

import { PortfolioGalleryViewComponent } from './portfolio-gallery-view.component';
import { PortfolioGalleryFacade } from './portfolio-gallery.facade';
import { GalleryCardChartStore } from '../../../savant-trader/stores/gallery-card-chart.store';
import { PositionGroupDimension, PositionCard } from './utils/position-cards.util';
import { SignalTimeframe } from '../../../savant-trader/common/constants';
import { RhSelectMenuComponent } from '../../../savant-trader/components/rh-select-menu/rh-select-menu.component';
import type { PortfolioGallerySummary } from './portfolio-gallery.facade';

function makeCard(symbol: string, overrides: Partial<PositionCard> = {}): PositionCard {
  return {
    key: `acct:${symbol}`,
    accountNumber: 'acct',
    symbol,
    side: 'long',
    quantity: 10,
    averageCost: 100,
    marketPrice: 110,
    dayChange: 2,
    dayChangePct: 1.9,
    unrealizedPnl: 100,
    unrealizedPnlPct: 10,
    marketValue: 1100,
    daysHeld: 5,
    bucketName: null,
    protected: false,
    stopPrice: null,
    stopDistancePct: null,
    openOrders: [],
    companyName: `${symbol} Co`,
    sector: 'Tech',
    industry: 'Software',
    capTier: 'mega',
    marketCap: 1e12,
    ...overrides,
  };
}

function makeSummary(overrides: Partial<PortfolioGallerySummary> = {}): PortfolioGallerySummary {
  return {
    totalValue: 100000,
    equityValue: 80000,
    cash: 20000,
    buyingPower: 40000,
    dayPnl: 250,
    unrealizedPnl: 1500,
    unprotectedCount: 2,
    ...overrides,
  };
}

function facadeStub() {
  return {
    summary: signal(makeSummary()),
    cardCount: signal(0),
    totalCardCount: signal(0),
    side: signal('all'),
    chartTimeframe: signal(SignalTimeframe.DAILY),
    listFilter: signal('ALL'),
    filterOptionGroups: signal([]),
    groupDimension: signal(PositionGroupDimension.NONE),
    refreshing: signal(false),
    flatCards: signal<PositionCard[]>([]),
    initialLoading: signal(false),
    loadError: signal<string | null>(null),
    partialErrors: signal<string[]>([]),
    noPositions: signal(false),
    allFilteredOut: signal(false),
    noAgenticAccount: signal(false),
    enterPage: jest.fn(),
    refresh: jest.fn(),
    setSide: jest.fn(),
    setListFilter: jest.fn(),
    setGroupDimension: jest.fn(),
    setChartTimeframe: jest.fn(),
  };
}

describe('PortfolioGalleryViewComponent', () => {
  let fixture: ComponentFixture<PortfolioGalleryViewComponent>;
  let stub: ReturnType<typeof facadeStub>;

  beforeEach(async () => {
    stub = facadeStub();
    await TestBed.configureTestingModule({
      imports: [PortfolioGalleryViewComponent, NoopAnimationsModule],
      providers: [
        provideZonelessChangeDetection(),
        { provide: PortfolioGalleryFacade, useValue: stub },
        { provide: GalleryCardChartStore, useValue: { prefetch: jest.fn(), clearCache: jest.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(PortfolioGalleryViewComponent);
    fixture.detectChanges();
  });

  it('calls enterPage on init', () => {
    expect(stub.enterPage).toHaveBeenCalled();
  });

  it('renders the summary strip values', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Total Value');
    expect(text).toContain('$100,000');
    expect(text).toContain('Buying Power');
    expect(text).toContain('Unprotected');
  });

  it('renders the Group dropdown with Allocation Bucket first', () => {
    fixture.detectChanges();
    const selects = fixture.debugElement.queryAll(By.css('app-rh-select-menu'));
    expect(selects.length).toBe(2);
    const group = selects[0].componentInstance as RhSelectMenuComponent<PositionGroupDimension>;
    expect(group.label()).toBe('Group');
    expect(group.options().map((o) => o.label)).toEqual([
      'Bucket', 'Sector', 'Industry', 'Market Cap', 'None',
    ]);
  });

  it('renders one stub card per flat card', () => {
    stub.flatCards.set([makeCard('AAPL'), makeCard('MSFT', { side: 'short' })]);
    stub.cardCount.set(2);
    stub.totalCardCount.set(2);
    fixture.detectChanges();
    const cards = fixture.nativeElement.querySelectorAll('.pg-card-stub');
    expect(cards.length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('AAPL');
    expect(fixture.nativeElement.textContent).toContain('SHORT');
  });

  it('shows the loading state while the first load runs', () => {
    stub.initialLoading.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Loading positions');
  });

  it('shows the load-error state with retry', () => {
    stub.loadError.set('refresh failed');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('refresh failed');
    const btn = fixture.nativeElement.querySelector('.pg-error button');
    btn.click();
    expect(stub.refresh).toHaveBeenCalled();
  });

  it('shows the no-agentic-account state', () => {
    stub.noAgenticAccount.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No agentic-enabled account');
  });

  it('shows the empty state when positions load empty', () => {
    stub.noPositions.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No live positions');
  });

  it('shows the filtered-empty state distinctly', () => {
    stub.allFilteredOut.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No positions match the current filters');
  });

  it('emits facet changes through to the facade', () => {
    const sideButtons = fixture.nativeElement.querySelectorAll('.pg-side-pills button');
    sideButtons[2].click();
    expect(stub.setSide).toHaveBeenCalledWith('short');
    const chartButtons = fixture.nativeElement.querySelectorAll('.pg-chart-pills button');
    chartButtons[1].click();
    expect(stub.setChartTimeframe).toHaveBeenCalledWith(SignalTimeframe.WEEKLY);
  });
});
