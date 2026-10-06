/**
 * GalleryCardChartComponent spec (#756) — the 'card chart' config:
 * quick-charts daily stack (base panes + callable series + extras) plus
 * the card's own occurrence dots on the price pane. FlexChartComponent is
 * stubbed — the config/dataset wiring is the unit under test.
 */
import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';

import { GalleryCardChartComponent, CARD_CHART_VISIBLE_BARS, CARD_SIGNAL_DOTS_ID } from './gallery-card-chart.component';
import { GalleryCardChartStore } from '../../stores/gallery-card-chart.store';
import { IndicatorSeriesStore } from '../../stores/indicator-series.store';
import { GalleryCard } from '../../utils/gallery-cards.util';
import { SignalDirection, SignalStatus, SignalTimeframe } from '../../common/constants';

import { ST_SIGNAL_DOT_COLORS } from '@flex-chart/indicator-visuals';
import type { FlexChartConfig, FlexChartDataset } from '../../../shared/components/flex-chart/flex-chart.types';
import { ChartIntervalKey } from '../../../shared/components/flex-chart/flex-chart.types';
import type { PriceBar } from '../../../shared/components/flex-chart/flex-chart.types';
import { FlexChartComponent } from '../../../shared/components/flex-chart/flex-chart.component';

@Component({ selector: 'app-flex-chart', standalone: true, template: '' })
class FlexChartStub {
  chartData = input<FlexChartDataset | null>();
  config = input<FlexChartConfig>();
  height = input<string>();
}

const BARS: PriceBar[] = [
  { date: '2026-08-24', x: new Date(2026, 7, 24), open: 200, high: 205, low: 198, close: 203 },
  { date: '2026-08-25', x: new Date(2026, 7, 25), open: 203, high: 215, low: 202, close: 213.44 },
];

function card(): GalleryCard {
  return {
    key: 'AAPL:buy',
    symbol: 'AAPL',
    side: 'buy',
    direction: SignalDirection.LONG,
    profile: { symbol: 'AAPL', enabled: true, createdAt: '2026-01-01', name: 'Apple Inc' },
    occurrences: [
      {
        id: '2026-08-25',
        symbol: 'AAPL',
        barDate: '2026-08-25',
        marketDate: '2026-08-25',
        runId: 'run-1',
        timeframe: SignalTimeframe.DAILY,
        direction: SignalDirection.LONG,
        signalType: 'D_ST_TREND_RIDER_V1_LONG',
        status: SignalStatus.CONFIRMED,
        indicators: {},
        closePrice: 213.44,
      },
    ],
    allRejected: false,
    status: 'pending',
    actionedAt: '',
  } as GalleryCard;
}

describe('GalleryCardChartComponent', () => {
  let fixture: ComponentFixture<GalleryCardChartComponent>;
  let storeMock: {
    ensureBars: jest.Mock;
    barsFor: () => (s: string) => PriceBar[] | undefined;
    versionFor: () => (s: string) => string;
    errorFor: () => (s: string) => string | null;
  };
  const bars = signal<PriceBar[] | undefined>(undefined);
  const version = signal('');
  const error = signal<string | null>(null);

  function mount(): GalleryCardChartComponent {
    fixture = TestBed.createComponent(GalleryCardChartComponent);
    fixture.componentRef.setInput('card', card());
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  function stub(): FlexChartStub {
    return fixture.debugElement.query(By.directive(FlexChartStub))!.componentInstance;
  }

  beforeEach(async () => {
    bars.set(undefined);
    error.set(null);
    storeMock = {
      ensureBars: jest.fn(),
      barsFor: () => (s: string) => (s === 'AAPL' ? bars() : undefined),
      versionFor: () => () => version(),
      errorFor: () => () => error(),
    };

    await TestBed.configureTestingModule({
      imports: [GalleryCardChartComponent],
      providers: [
        { provide: GalleryCardChartStore, useValue: storeMock },
        { provide: IndicatorSeriesStore, useValue: { responseFor: () => () => undefined } },
      ],
    })
      .overrideComponent(GalleryCardChartComponent, {
        remove: { imports: [FlexChartComponent] },
        add: { imports: [FlexChartStub] },
      })
      .compileComponents();
  });

  it('kicks off a per-symbol bars load on mount', () => {
    mount();
    expect(storeMock.ensureBars).toHaveBeenCalledWith('AAPL');
  });

  it('shows a loading state before bars arrive', () => {
    mount();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cc-loading')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-flex-chart')).toBeFalsy();
  });

  it('shows an unavailable placeholder when bars load empty', () => {
    mount();
    bars.set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cc-error')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-flex-chart')).toBeFalsy();
  });

  it('shows the unavailable placeholder on a fetch error', () => {
    mount();
    bars.set(undefined);
    error.set('boom');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cc-error')).toBeTruthy();
  });

  it('renders the quick-charts daily stack — base panes, no chrome', () => {
    mount();
    bars.set(BARS);
    fixture.detectChanges();

    const cfg = stub().config()!;
    expect(cfg.interval).toBe(ChartIntervalKey.DAILY);
    expect(cfg.visibleBars).toBe(CARD_CHART_VISIBLE_BARS);
    expect(cfg.showCrosshair).toBe(false);
    expect(cfg.showZoomToolbar).toBe(false);
    expect(cfg.enableScrollbar).toBe(false);
    expect(stub().chartData()!.bars).toEqual(BARS);
    // Base indicators: trend bands + trend strength + zone V1 + zone V2
    expect(cfg.indicators.length).toBeGreaterThanOrEqual(4);
  });

  it('places a signal dot on each occurrence bar on the price pane, colored by direction', () => {
    mount();
    bars.set(BARS);
    fixture.detectChanges();

    const cardDots = stub()
      .config()!
      .indicators.find((i) => i.id === CARD_SIGNAL_DOTS_ID);
    expect(cardDots).toBeTruthy();
    expect(cardDots!.pane).toBe('overlay');
    expect(cardDots!.data).toHaveLength(1);
    expect(cardDots!.data![0].y).toBe(213.44);
    expect(cardDots!.data![0].color).toBe(ST_SIGNAL_DOT_COLORS.long);
  });

  it('falls back to the bar close when the occurrence is unpriced', () => {
    mount();
    const c = card();
    c.occurrences = [{ ...c.occurrences[0], closePrice: undefined }];
    fixture.componentRef.setInput('card', c);
    bars.set(BARS);
    fixture.detectChanges();

    const cardDots = stub()
      .config()!
      .indicators.find((i) => i.id === CARD_SIGNAL_DOTS_ID);
    expect(cardDots!.data![0].y).toBe(213.44); // close of the 2026-08-25 bar
  });
});
