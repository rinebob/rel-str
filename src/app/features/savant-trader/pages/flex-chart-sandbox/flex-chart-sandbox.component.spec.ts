/// <reference types="jest" />
/**
 * Tests for FlexChartSandboxComponent — the dev sandbox page hosting a single
 * FlexChartComponent. Log-axis coverage: Topic #468, task #477. Persisted
 * sandbox settings: Topic #213, task #934.
 *
 * FlexChartComponent is mocked so the page's own wiring is the unit under test.
 * The real ChartStore is provided with a mocked ChartService; IndicatorSeriesStore
 * is stubbed so no callable fires.
 */
jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: jest.fn(),
  collectionData: jest.fn(),
  doc: jest.fn(),
  setDoc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
}));
jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(),
}));
jest.mock('@angular/fire/auth', () => ({
  Auth: class {},
  authState: jest.fn(() => of({ uid: 'user-123' })),
}));

import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatDatepicker, MatDatepickerInput } from '@angular/material/datepicker';
import { of } from 'rxjs';

import { FlexChartSandboxComponent } from './flex-chart-sandbox.component';
import { ChartStore } from '../../stores/chart.store';
import { ChartService } from '../../services/chart.service';
import { IndicatorSeriesStore } from '../../stores/indicator-series.store';
import { FlexChartComponent } from '../../../shared/components/flex-chart/flex-chart.component';
import {
  ChartIntervalKey,
  StIndicator,
  type FlexChartConfig,
  type FlexChartDataset,
  type PriceBar,
} from '../../../shared/components/flex-chart/flex-chart.types';
import type { ChartAxisState, ChartDebugSnapshot } from '../../../shared/components/flex-chart/services/chart-instance.types';
import { BarsInterval } from '../../../../core/models/partner.types';
import { ChartInterval, IndicatorFamily, StrategyFamily } from '../../common/indicator.types';
import type { SymbolIndicatorSeriesResponse } from '../../common/indicator.types';
import {
  TRIGGER_BANDS_CHART_INTERVALS,
  TRIGGER_BANDS_CHART_INDICATORS,
  TRIGGER_BANDS_CHART_STRATEGIES,
} from '../../stores/chart.store';
import { ST_TRIGGER_BANDS_INDICATOR } from '../../../shared/components/flex-chart/indicators/st-trigger-bands.indicator';
import { SANDBOX_SETTINGS_KEY, SANDBOX_SETTINGS_VERSION } from './sandbox-settings';
import { SYNTHETIC_BAR_COUNT } from './synthetic-data';
import CORE_ROUTES from '../../../../core/core-routes';
import { AppRoutes } from '../../../../core/common/interfaces';
import { authGuard } from '../../../../core/auth/auth.guard';

// =============================================================================
// Mock child component
// =============================================================================

@Component({
  selector: 'app-flex-chart',
  standalone: true,
  template: `<div data-testid="mock-chart"></div>`,
})
class MockFlexChartComponent {
  @Input() chartData: FlexChartDataset | null = null;
  @Input() config: FlexChartConfig | undefined;
  @Input() height = '400px';
  @Input() syncCrosshairDate: Date | null = null;
  @Input() syncCrosshairPrice: number | null = null;
  @Output() crosshairDateChange = new EventEmitter<Date | null>();
  @Output() crosshairPriceChange = new EventEmitter<number | null>();
  @Output() debugStateChange = new EventEmitter<ChartDebugSnapshot>();
}

// =============================================================================
// Fixtures
// =============================================================================

/** Ten bars: high = 100 + i, low = 90 + i, so full-range hi/lo = 109/90. */
function makeBars(n = 10): PriceBar[] {
  const bars: PriceBar[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(2026, 0, i + 1);
    bars.push({
      date: d.toISOString().slice(0, 10),
      x: d,
      open: 95 + i,
      high: 100 + i,
      low: 90 + i,
      close: 95 + i,
      volume: 1000,
    });
  }
  return bars;
}

function makeDataset(interval: BarsInterval, bars: PriceBar[]) {
  return {
    baseline: 'SPY',
    symbol: 'QQQ',
    interval,
    bars,
    dateRange: { from: bars[0]?.date ?? '', to: bars[bars.length - 1]?.date ?? '' },
  };
}

function mockChartService(bars: PriceBar[]): Partial<ChartService> {
  return {
    loadBars$: jest.fn(() =>
      of({
        daily: makeDataset(BarsInterval.DAILY, bars),
        weekly: makeDataset(BarsInterval.WEEKLY, bars),
        monthly: makeDataset(BarsInterval.MONTHLY, bars),
        version: 'v1',
      }),
    ),
  };
}

type ResponseLookup = (
  symbol: string,
  version: string,
  intervals: ChartInterval[],
  indicators: IndicatorFamily[],
  strategies: StrategyFamily[],
) => SymbolIndicatorSeriesResponse | undefined;

const mockIndicatorStore: {
  responseFor: () => ResponseLookup;
  loadIfNeeded: jest.Mock;
  loadingFor: () => () => boolean;
  errorFor: () => () => null;
} = {
  responseFor: () => () => undefined,
  loadIfNeeded: jest.fn(),
  loadingFor: () => () => false,
  errorFor: () => () => null,
};

function mockAxisState(xMax: number, yMin: number, yMax: number): ChartAxisState {
  const rect = { x: 0, y: 0, width: 800, height: 400 };
  return {
    xAxis: { visibleRange: { min: 0, max: xMax, delta: xMax }, rect },
    yAxis: { visibleRange: { min: yMin, max: yMax, delta: yMax - yMin }, rect, valueType: 'Double' },
  };
}

interface Setup {
  fixture: ComponentFixture<FlexChartSandboxComponent>;
  chartService: Partial<ChartService>;
  chart: MockFlexChartComponent;
}

async function setup(bars: PriceBar[] = makeBars()): Promise<Setup> {
  const chartService = mockChartService(bars);
  TestBed.configureTestingModule({
    providers: [
      { provide: ChartService, useValue: chartService },
      { provide: IndicatorSeriesStore, useValue: mockIndicatorStore },
      ChartStore,
    ],
  });
  TestBed.overrideComponent(FlexChartSandboxComponent, {
    remove: { imports: [FlexChartComponent] },
    add: { imports: [MockFlexChartComponent] },
  });
  await TestBed.compileComponents();
  const fixture = TestBed.createComponent(FlexChartSandboxComponent);
  fixture.detectChanges();
  const chart = fixture.debugElement.query(By.directive(MockFlexChartComponent)).componentInstance;
  return { fixture, chartService, chart };
}

// =============================================================================
// Tests
// =============================================================================

// The auto-save effect writes settings on every component — clear between
// tests so persisted state can't leak across specs.
afterEach(() => localStorage.clear());

describe('FlexChartSandboxComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('creates and auto-loads the default symbol', async () => {
    const { fixture, chartService } = await setup();
    expect(fixture.componentInstance).toBeTruthy();
    expect(chartService.loadBars$).toHaveBeenCalledWith('QQQ');
  });

  it('symbol input change loads that symbol', async () => {
    const { fixture, chartService } = await setup();
    const input = fixture.nativeElement.querySelector('[data-testid="symbol-input"]') as HTMLInputElement;
    input.value = 'MSFT';
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(chartService.loadBars$).toHaveBeenCalledWith('MSFT');
  });

  it('passes the daily dataset to the chart by default', async () => {
    const { chart } = await setup();
    expect(chart.chartData?.interval).toBe(BarsInterval.DAILY);
    expect(chart.chartData?.bars.length).toBe(10);
  });

  it('interval buttons switch the chart dataset', async () => {
    const { fixture, chart } = await setup();
    const weeklyBtn = fixture.nativeElement.querySelector('[data-testid="interval-weekly"]') as HTMLButtonElement;
    weeklyBtn.click();
    fixture.detectChanges();
    expect(chart.chartData?.interval).toBe(BarsInterval.WEEKLY);
  });

  it('log toggle flips config.logScale on the chart (log is the default)', async () => {
    const { fixture, chart } = await setup();
    expect(chart.config?.logScale).toBe(true);
    const toggle = fixture.nativeElement.querySelector('[data-testid="log-toggle"]') as HTMLInputElement;
    toggle.click();
    fixture.detectChanges();
    expect(chart.config?.logScale).toBe(false);
    toggle.click();
    fixture.detectChanges();
    expect(chart.config?.logScale).toBe(true);
  });

  it('feeds backend dotMarkers into the signal-dot and Trend Rider indicators', async () => {
    const dot = (d: string, index: number) => ({
      d, index, direction: 'long' as const, y: 1, version: 'TS' as const, signalType: 'X',
    });
    const response: SymbolIndicatorSeriesResponse = {
      symbol: 'QQQ',
      marketDate: '2026-01-10',
      computedAt: '',
      intervals: {
        daily: {
          indicators: {},
          signals: {},
          dotMarkers: {
            trendStrength: [dot('2026-01-03', 2)],
            zoneV1: [dot('2026-01-04', 3)],
            zoneV2: [dot('2026-01-05', 4)],
          },
        },
      },
    };
    const original = mockIndicatorStore.responseFor;
    mockIndicatorStore.responseFor = () => () => response;
    try {
      const { chart } = await setup();
      const byId = (id: string) => chart.config?.indicators.find((i) => i.id === `${id}-default`);
      expect((byId('st-signal-dots')?.data as unknown[])?.length).toBe(1);
      expect((byId('st-zone-v1-uptick-dots')?.data as unknown[])?.length).toBe(1);
      expect((byId('st-zone-v2-uptick-dots')?.data as unknown[])?.length).toBe(1);
    } finally {
      mockIndicatorStore.responseFor = original;
    }
  });

  it('debug readout shows viewport, axis range, and visible data hi/lo', async () => {
    const { fixture, chart } = await setup();
    chart.debugStateChange.emit({
      viewport: { min: 94.5, max: 105.5 },
      axis: mockAxisState(9, 89, 110),
      logTicks: [],
    });
    fixture.detectChanges();

    const vp = fixture.nativeElement.querySelector('[data-testid="dbg-viewport"]').textContent;
    expect(vp).toContain('94.50');
    expect(vp).toContain('105.50');

    const axis = fixture.nativeElement.querySelector('[data-testid="dbg-axis"]').textContent;
    expect(axis).toContain('89.00');
    expect(axis).toContain('110.00');

    // Full 10-bar range visible: high 109, low 90.
    const vis = fixture.nativeElement.querySelector('[data-testid="dbg-visible"]').textContent;
    expect(vis).toContain('90.00');
    expect(vis).toContain('109.00');
  });

  it('debug readout updates when the chart reports a new axis state', async () => {
    const { fixture, chart } = await setup();
    chart.debugStateChange.emit({
      viewport: { min: 94.5, max: 105.5 },
      axis: mockAxisState(9, 89, 110),
      logTicks: [],
    });
    fixture.detectChanges();
    chart.debugStateChange.emit({
      viewport: { min: 100, max: 102 },
      axis: mockAxisState(4, 99, 103),
      logTicks: [],
    });
    fixture.detectChanges();
    const axis = fixture.nativeElement.querySelector('[data-testid="dbg-axis"]').textContent;
    expect(axis).toContain('99.00');
    expect(axis).toContain('103.00');
    // Visible window is now bars 0-4: low 90, high 104.
    const vis = fixture.nativeElement.querySelector('[data-testid="dbg-visible"]').textContent;
    expect(vis).toContain('104.00');
  });

  it('synthetic mode feeds generated bars through the same chart input — no backend call', async () => {
    const { fixture, chart, chartService } = await setup();
    (chartService.loadBars$ as jest.Mock).mockClear();

    fixture.nativeElement.querySelector('[data-testid="mode-synthetic"]').click();
    fixture.detectChanges();

    expect(chartService.loadBars$).not.toHaveBeenCalled();
    expect(chart.chartData?.symbol).toBe('SYN-WIDE-RATIO');
    expect(chart.chartData?.bars.length).toBe(SYNTHETIC_BAR_COUNT);

    const src = fixture.nativeElement.querySelector('[data-testid="dbg-source"]').textContent;
    expect(src).toContain('synthetic:wide-ratio');
  });

  it('preset select swaps the synthetic dataset', async () => {
    const { fixture, chart } = await setup();
    fixture.nativeElement.querySelector('[data-testid="mode-synthetic"]').click();
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('[data-testid="preset-select"]') as HTMLSelectElement;
    select.value = 'penny';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(chart.chartData?.symbol).toBe('SYN-PENNY');
  });

  it('switching back to real restores the store dataset', async () => {
    const { fixture, chart } = await setup();
    fixture.nativeElement.querySelector('[data-testid="mode-synthetic"]').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="mode-real"]').click();
    fixture.detectChanges();

    expect(chart.chartData?.symbol).toBe('QQQ');
    expect(chart.chartData?.bars.length).toBe(10);
  });

  it('indicator picker closes on outside click and Escape', async () => {
    const { fixture } = await setup();
    const details = fixture.nativeElement.querySelector('details.indicator-picker') as HTMLDetailsElement;
    details.open = true;

    // Click inside the open picker does not close it.
    details.open = true;
    details.querySelector('.indicator-list')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(details.open).toBe(true);

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(details.open).toBe(false);

    details.open = true;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(details.open).toBe(false);
  });

  it('indicator checkboxes add default-config ST indicators to the chart config', async () => {
    const { fixture, chart } = await setup();
    // Sandbox now defaults to the core ST suite plus signal dots and trend riders.
    const defaultIds = [
      'st-trend-bands-default',
      'st-trend-strength-default',
      'st-zone-default',
      'st-zone-v2-default',
      'st-signal-dots-default',
      'st-zone-v1-uptick-dots-default',
      'st-zone-v2-uptick-dots-default',
    ];
    expect(chart.config?.indicators.map((i) => i.id)).toEqual(defaultIds);

    const box = fixture.nativeElement.querySelector('[data-testid="ind-st-zigzag"]') as HTMLInputElement;
    box.click();
    fixture.detectChanges();
    expect(chart.config?.indicators).toHaveLength(8);
    expect(chart.config?.indicators[chart.config!.indicators.length - 1].type).toBe(StIndicator.ST_ZIGZAG);

    box.click();
    fixture.detectChanges();
    expect(chart.config?.indicators.map((i) => i.id)).toEqual(defaultIds);
  });
});

// =============================================================================
// Trigger Bands wiring — Topic #261 / Tasks #880, #932
//
// TB promoted to prod in #932 — the picker entry now comes through
// ST_INDICATOR_OPTIONS — but the sandbox still exercises the same wiring:
// enabling the toggle issues the lean bands+dots callable request under its
// own cache key, bands inject onto the config, and the sandbox-only "TB dots"
// sub-toggle stays off by default.
// =============================================================================

describe('Trigger Bands sandbox wiring (#880/#932)', () => {
  afterEach(() => TestBed.resetTestingModule());

  const TB_ID = ST_TRIGGER_BANDS_INDICATOR.id; // 'st-trigger-bands'
  const tbPoint = (d: string) => ({
    d, upper: 10, lower: 8,
    longPullback: false, longPullbackState: false, longBreakout: false,
    shortPullback: false, shortPullbackState: false, shortBreakout: false,
  });
  const tbDot = (d: string, index: number, signalType: string) => ({
    d, index, direction: 'long' as const, y: 7, version: 'TB' as const, signalType,
  });
  const tbResponse: SymbolIndicatorSeriesResponse = {
    symbol: 'QQQ',
    marketDate: '2026-01-10',
    computedAt: '',
    intervals: {
      daily: {
        indicators: { triggerBands: [tbPoint('2026-01-01'), tbPoint('2026-01-02')] },
        signals: {},
        dotMarkers: {
          triggerBands: [tbDot('2026-01-01', 0, 'TRIGGER_BANDS_LONG_BREAKOUT')],
        },
      },
    },
  };

  /** responseFor serves tbResponse only for the lean Trigger Bands filter set. */
  function withLeanResponse(): typeof mockIndicatorStore.responseFor {
    const original = mockIndicatorStore.responseFor;
    mockIndicatorStore.responseFor = () => (
      _symbol,
      _version,
      _intervals,
      indicators,
    ) => (indicators.includes(IndicatorFamily.TRIGGER_BANDS) ? tbResponse : undefined);
    return original;
  }

  function enableTriggerBands(fixture: ComponentFixture<FlexChartSandboxComponent>): void {
    const box = fixture.nativeElement.querySelector(`[data-testid="ind-${TB_ID}"]`) as HTMLInputElement;
    box.click();
    fixture.detectChanges();
  }

  it('keeps the chart config dev:true — the sandbox is where the next dev indicator lands', async () => {
    const { chart } = await setup();
    expect(chart.config?.dev).toBe(true);
  });

  it('offers Trigger Bands in the picker and issues the lean request only when enabled', async () => {
    const { fixture } = await setup();
    mockIndicatorStore.loadIfNeeded.mockClear();

    const box = fixture.nativeElement.querySelector(`[data-testid="ind-${TB_ID}"]`) as HTMLInputElement;
    expect(box).toBeTruthy();
    expect(mockIndicatorStore.loadIfNeeded).not.toHaveBeenCalledWith(
      'QQQ', 'v1',
      TRIGGER_BANDS_CHART_INTERVALS,
      TRIGGER_BANDS_CHART_INDICATORS,
      TRIGGER_BANDS_CHART_STRATEGIES,
    );

    box.click();
    fixture.detectChanges();

    expect(mockIndicatorStore.loadIfNeeded).toHaveBeenCalledWith(
      'QQQ', 'v1',
      [ChartInterval.DAILY, ChartInterval.WEEKLY],
      [IndicatorFamily.TRIGGER_BANDS],
      [StrategyFamily.TRIGGER_BANDS],
    );
  });

  it('merges bands onto the indicator config; dots ride a separate dev toggle (off by default)', async () => {
    const original = withLeanResponse();
    try {
      const { fixture, chart } = await setup();
      enableTriggerBands(fixture);

      const bands = chart.config?.indicators.find((i) => i.id === `${TB_ID}-default`);
      expect(bands).toBeTruthy();
      expect(bands?.triggerBandData).toHaveLength(2);

      // Dots are gated behind the "TB dots" dev toggle — off by default.
      expect(chart.config?.indicators.find((i) => i.id === 'st-trigger-bands-dots-default')).toBeUndefined();

      fixture.nativeElement.querySelector('[data-testid="tb-dots-toggle"]').click();
      fixture.detectChanges();

      const dots = chart.config?.indicators.find((i) => i.id === 'st-trigger-bands-dots-default');
      expect(dots).toBeTruthy();
      expect(dots?.data).toHaveLength(1);
    } finally {
      mockIndicatorStore.responseFor = original;
    }
  });

  it('draws nothing for an older backend that returns no triggerBands', async () => {
    const { fixture, chart } = await setup();
    enableTriggerBands(fixture);

    const bands = chart.config?.indicators.find((i) => i.id === `${TB_ID}-default`);
    expect(bands?.triggerBandData).toEqual([]);
    expect(chart.config?.indicators.find((i) => i.id === 'st-trigger-bands-dots-default')).toBeUndefined();
  });

  it('disables the dev checkbox and issues no request in synthetic mode', async () => {
    const { fixture } = await setup();
    fixture.nativeElement.querySelector('[data-testid="mode-synthetic"]').click();
    fixture.detectChanges();
    mockIndicatorStore.loadIfNeeded.mockClear();

    const box = fixture.nativeElement.querySelector(`[data-testid="ind-${TB_ID}"]`) as HTMLInputElement;
    expect(box.disabled).toBe(true);

    // Even a programmatic enable cannot fire the request — the effect guards on dataMode.
    fixture.componentInstance.toggleIndicator(TB_ID, { target: { checked: true } } as unknown as Event);
    fixture.detectChanges();
    expect(mockIndicatorStore.loadIfNeeded).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Anchored VWAP params — Topic #261 / Task #872
//
// Sandbox-only params editor: rendered only while ST Anchored VWAP is enabled;
// overrides merge onto the indicator's declared defaults in the config handed
// to the mock chart. `historyStart` is an ISO 'YYYY-MM-DD' string fed by a
// mat-datepicker whose adapter produces local-midnight Dates — the handler
// formats local Y/M/D, not toISOString (same off-by-one trap as option-chain).
// =============================================================================

describe('Anchored VWAP param controls (#872)', () => {
  afterEach(() => TestBed.resetTestingModule());

  const AVWAP_ID = 'st-anchored-vwap';

  function enableAvwap(fixture: ComponentFixture<FlexChartSandboxComponent>): void {
    (fixture.nativeElement.querySelector(`[data-testid="ind-${AVWAP_ID}"]`) as HTMLInputElement).click();
    fixture.detectChanges();
  }

  const avwapConfig = (chart: MockFlexChartComponent) =>
    chart.config!.indicators.find((i) => i.type === StIndicator.ST_ANCHORED_VWAP);

  function setInput(fixture: ComponentFixture<FlexChartSandboxComponent>, testid: string, value: string): void {
    const input = fixture.nativeElement.querySelector(`[data-testid="${testid}"]`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  it('shows the params panel only while the indicator is enabled', async () => {
    const { fixture, chart } = await setup();
    expect(fixture.nativeElement.querySelector('[data-testid="avwap-params"]')).toBeNull();
    expect(avwapConfig(chart)).toBeUndefined();

    enableAvwap(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="avwap-params"]')).toBeTruthy();
    expect(avwapConfig(chart)).toBeTruthy();

    enableAvwap(fixture); // uncheck
    expect(fixture.nativeElement.querySelector('[data-testid="avwap-params"]')).toBeNull();
    expect(avwapConfig(chart)).toBeUndefined();
  });

  it('exposes a control per editable param', async () => {
    const { fixture } = await setup();
    enableAvwap(fixture);
    for (const key of [
      'line1RetracementPct', 'line2RetracementPct',
      'line1LeftDepth', 'line1RightDepth', 'line2LeftDepth', 'line2RightDepth',
      'line1HighColor', 'line1LowColor', 'line2HighColor', 'line2LowColor',
      'showLine1', 'showLine2', 'showZigZag', 'maxHistory', 'historyStart',
    ]) {
      expect(fixture.nativeElement.querySelector(`[data-testid="avwap-${key}"]`)).toBeTruthy();
    }
  });

  it('merges numeric overrides onto the defaults; untouched params stay at theirs', async () => {
    const { fixture, chart } = await setup();
    enableAvwap(fixture);
    expect(avwapConfig(chart)!.params['line1RetracementPct']).toBe(2);

    setInput(fixture, 'avwap-line1RetracementPct', '3.5');
    const params = avwapConfig(chart)!.params;
    expect(params['line1RetracementPct']).toBe(3.5);
    expect(params['line2RetracementPct']).toBe(5);
    expect(params['maxHistory']).toBe(100);
  });

  it('the showZigZag checkbox writes a boolean override and re-checking clears it', async () => {
    const { fixture, chart } = await setup();
    enableAvwap(fixture);
    const box = fixture.nativeElement.querySelector('[data-testid="avwap-showZigZag"]') as HTMLInputElement;
    expect(box.type).toBe('checkbox');
    expect(box.checked).toBe(true); // declared default
    expect(avwapConfig(chart)!.params['showZigZag']).toBe(true);

    box.click();
    fixture.detectChanges();
    expect(avwapConfig(chart)!.params['showZigZag']).toBe(false);

    box.click();
    fixture.detectChanges();
    expect(avwapConfig(chart)!.params['showZigZag']).toBe(true);
  });

  it('emptying a control reverts that param to its default', async () => {
    const { fixture, chart } = await setup();
    enableAvwap(fixture);
    setInput(fixture, 'avwap-maxHistory', '20');
    expect(avwapConfig(chart)!.params['maxHistory']).toBe(20);

    setInput(fixture, 'avwap-maxHistory', '');
    expect(avwapConfig(chart)!.params['maxHistory']).toBe(100);
  });

  it('a colour override lands as its hex string', async () => {
    const { fixture, chart } = await setup();
    enableAvwap(fixture);
    setInput(fixture, 'avwap-line1HighColor', '#123456');
    expect(avwapConfig(chart)!.params['line1HighColor']).toBe('#123456');
  });

  it('each control change produces a fresh config so the chart recomputes', async () => {
    const { fixture, chart } = await setup();
    enableAvwap(fixture);
    const before = chart.config;
    setInput(fixture, 'avwap-line1RetracementPct', '4');
    expect(chart.config).not.toBe(before);
  });

  it('the datepicker commits historyStart as a local YYYY-MM-DD string', async () => {
    const { fixture, chart } = await setup();
    enableAvwap(fixture);
    // NativeDateAdapter produces local-midnight Dates — format local Y/M/D,
    // not toISOString (which shifts back a day in western timezones).
    fixture.componentInstance.onAvwapHistoryDate(new Date(2026, 8, 20));
    fixture.detectChanges();
    expect(avwapConfig(chart)!.params['historyStart']).toBe('2026-09-20');
  });

  it('typing an ISO date into the text input sets historyStart; the clear button unsets it', async () => {
    const { fixture, chart } = await setup();
    enableAvwap(fixture);
    setInput(fixture, 'avwap-historyStart', '2025-06-15');
    expect(avwapConfig(chart)!.params['historyStart']).toBe('2025-06-15');
    // The picker's anchor tracks the typed date — reopening shows it, not a stale day.
    const anchorInput = fixture.debugElement.query(By.directive(MatDatepickerInput)).injector.get(MatDatepickerInput);
    expect(anchorInput.value).toEqual(new Date(2025, 5, 15));

    fixture.nativeElement.querySelector('[data-testid="avwap-history-clear"]').click();
    fixture.detectChanges();
    expect(avwapConfig(chart)!.params['historyStart']).toBe('');
    expect(anchorInput.value).toBeNull();
  });

  it('the hidden anchor input is bound to the mat-datepicker', async () => {
    const { fixture } = await setup();
    enableAvwap(fixture);
    // The picker refuses to open without an associated input — if the
    // association breaks, the calendar silently stops working.
    const dir = fixture.debugElement.query(By.directive(MatDatepickerInput));
    expect(dir).toBeTruthy();
    const picker = fixture.debugElement.query(By.directive(MatDatepicker));
    expect(dir.injector.get(MatDatepickerInput)._datepicker).toBe(picker.componentInstance);
  });

  it('overrides survive an enable→disable→enable round-trip and never leak into other indicators', async () => {
    const { fixture, chart } = await setup();
    enableAvwap(fixture);
    setInput(fixture, 'avwap-maxHistory', '7');

    enableAvwap(fixture); // off
    expect(avwapConfig(chart)).toBeUndefined();
    for (const i of chart.config!.indicators) {
      expect(Object.keys(i.params)).not.toContain('line1RetracementPct');
    }

    enableAvwap(fixture); // on again — tuning preserved
    expect(avwapConfig(chart)!.params['maxHistory']).toBe(7);
  });
});

// =============================================================================
// ZigZag bespoke params — Topic #213 / Task #935
//
// Same strip as AVWAP minus the appearance/date concerns: number fields for
// the math params, checkboxes for the toggles. `lineColor` is deliberately
// not exposed. Commits flow through the shared paramOverrides map.
// =============================================================================

describe('ZigZag bespoke params (#935)', () => {
  afterEach(() => TestBed.resetTestingModule());

  const ZZ_ID = 'st-zigzag';

  function enableZigzag(fixture: ComponentFixture<FlexChartSandboxComponent>): void {
    (fixture.nativeElement.querySelector(`[data-testid="ind-${ZZ_ID}"]`) as HTMLInputElement).click();
    fixture.detectChanges();
  }

  const zigzagConfig = (chart: MockFlexChartComponent) =>
    chart.config!.indicators.find((i) => i.type === StIndicator.ST_ZIGZAG);

  function setInput(fixture: ComponentFixture<FlexChartSandboxComponent>, testid: string, value: string): void {
    const input = fixture.nativeElement.querySelector(`[data-testid="${testid}"]`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  it('shows the params strip only while the indicator is enabled', async () => {
    const { fixture, chart } = await setup();
    expect(fixture.nativeElement.querySelector('[data-testid="zigzag-params"]')).toBeNull();
    expect(zigzagConfig(chart)).toBeUndefined();

    enableZigzag(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="zigzag-params"]')).toBeTruthy();
    expect(zigzagConfig(chart)).toBeTruthy();

    enableZigzag(fixture); // uncheck
    expect(fixture.nativeElement.querySelector('[data-testid="zigzag-params"]')).toBeNull();
    expect(zigzagConfig(chart)).toBeUndefined();
  });

  it('exposes a control per editable param — math and toggles, but no lineColor', async () => {
    const { fixture } = await setup();
    enableZigzag(fixture);
    for (const key of [
      'devThreshold', 'leftDepth', 'rightDepth',
      'allowZigZagOnOneBar', 'projectionPivots', 'showTriggerDots',
    ]) {
      expect(fixture.nativeElement.querySelector(`[data-testid="zigzag-${key}"]`)).toBeTruthy();
    }
    expect(fixture.nativeElement.querySelector('[data-testid="zigzag-lineColor"]')).toBeNull();
  });

  it('merges numeric overrides onto the defaults; untouched params stay at theirs', async () => {
    const { fixture, chart } = await setup();
    enableZigzag(fixture);
    expect(zigzagConfig(chart)!.params['devThreshold']).toBe(5);

    setInput(fixture, 'zigzag-devThreshold', '9');
    const params = zigzagConfig(chart)!.params;
    expect(params['devThreshold']).toBe(9);
    expect(params['leftDepth']).toBe(5);
    expect(params['rightDepth']).toBe(5);
  });

  it('the depth fields clamp to their declared min on commit', async () => {
    const { fixture, chart } = await setup();
    enableZigzag(fixture);
    setInput(fixture, 'zigzag-leftDepth', '0');
    expect(zigzagConfig(chart)!.params['leftDepth']).toBe(2);
  });

  it('a boolean toggle writes an override and re-checking clears it', async () => {
    const { fixture, chart } = await setup();
    enableZigzag(fixture);
    const box = fixture.nativeElement.querySelector('[data-testid="zigzag-showTriggerDots"]') as HTMLInputElement;
    expect(box.type).toBe('checkbox');
    expect(box.checked).toBe(true); // declared default

    box.click();
    fixture.detectChanges();
    expect(zigzagConfig(chart)!.params['showTriggerDots']).toBe(false);

    box.click();
    fixture.detectChanges();
    expect(zigzagConfig(chart)!.params['showTriggerDots']).toBe(true);
  });

  it('emptying a control reverts that param to its default', async () => {
    const { fixture, chart } = await setup();
    enableZigzag(fixture);
    setInput(fixture, 'zigzag-rightDepth', '8');
    expect(zigzagConfig(chart)!.params['rightDepth']).toBe(8);

    setInput(fixture, 'zigzag-rightDepth', '');
    expect(zigzagConfig(chart)!.params['rightDepth']).toBe(5);
  });
});

// =============================================================================
// Persisted sandbox settings — Topic #213 / Task #934
//
// Every control state lives in a versioned localStorage blob: it seeds the
// signals at construction (restore-on-load) and an auto-save effect rewrites
// it on every change. Reset to defaults clears it.
// =============================================================================

describe('Sandbox settings persistence (#934)', () => {
  afterEach(() => TestBed.resetTestingModule());

  const seed = (partial: Record<string, unknown>) =>
    localStorage.setItem(SANDBOX_SETTINGS_KEY, JSON.stringify({
      version: SANDBOX_SETTINGS_VERSION,
      ...partial,
    }));
  const stored = () => JSON.parse(localStorage.getItem(SANDBOX_SETTINGS_KEY) ?? 'null');

  /** Angular effects flush on change detection; a macrotask drains any stragglers. */
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  it('restores persisted controls on load', async () => {
    seed({
      symbol: 'MSFT',
      interval: 'weekly',
      logScale: false,
      dataMode: 'synthetic',
      preset: 'penny',
      triggerBandsDots: true,
      enabledIndicators: ['st-zigzag', 'st-anchored-vwap'],
      paramOverrides: { 'st-anchored-vwap': { maxHistory: 7 } },
    });
    const { fixture, chart } = await setup();
    const c = fixture.componentInstance;
    expect(c.symbol()).toBe('MSFT');
    expect(c.interval()).toBe(ChartIntervalKey.WEEKLY);
    expect(c.logScale()).toBe(false);
    expect(c.dataMode()).toBe('synthetic');
    expect(c.preset()).toBe('penny');
    expect(c.triggerBandsDots()).toBe(true);
    expect(c.enabledIndicators().has('st-zigzag')).toBe(true);

    const avwap = chart.config!.indicators.find((i) => i.type === StIndicator.ST_ANCHORED_VWAP);
    expect(avwap!.params['maxHistory']).toBe(7);
    expect(avwap!.params['line1RetracementPct']).toBe(2); // unset params keep defaults
  });

  it('a persisted override reaches any indicator\'s config params — not just AVWAP', async () => {
    // The generic merge path the ZigZag params strip (#935) will write through.
    seed({
      enabledIndicators: ['st-zigzag'],
      paramOverrides: { 'st-zigzag': { devThreshold: 9 } },
    });
    const { chart } = await setup();
    const zz = chart.config!.indicators.find((i) => i.type === StIndicator.ST_ZIGZAG);
    expect(zz!.params['devThreshold']).toBe(9);
    expect(zz!.params['showTriggerDots']).toBe(true); // untouched params keep declared defaults
  });

  it('still renders with factory defaults when localStorage is unavailable', async () => {
    const getSpy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const setSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { fixture } = await setup();
    expect(fixture.componentInstance.symbol()).toBe('QQQ');
    expect(fixture.componentInstance.enabledIndicators().size).toBeGreaterThan(0);
    getSpy.mockRestore();
    setSpy.mockRestore();
  });

  it('ignores a stale blob — unknown ids and wrong version fall back', async () => {
    localStorage.setItem(SANDBOX_SETTINGS_KEY, JSON.stringify({
      version: 999,
      symbol: 'MSFT',
      enabledIndicators: ['ghost-indicator'],
    }));
    const { fixture } = await setup();
    const c = fixture.componentInstance;
    expect(c.symbol()).toBe('QQQ');
    expect(c.enabledIndicators().has('st-trend-bands')).toBe(true);
  });

  it('auto-saves every control change to the blob', async () => {
    const { fixture } = await setup();
    fixture.nativeElement.querySelector('[data-testid="interval-weekly"]').click();
    fixture.detectChanges();
    await flush();
    expect(stored().interval).toBe('weekly');

    fixture.nativeElement.querySelector('[data-testid="ind-st-zigzag"]').click();
    fixture.detectChanges();
    await flush();
    expect(stored().enabledIndicators).toContain('st-zigzag');
  });

  it('persists param overrides committed through the AVWAP form', async () => {
    const { fixture } = await setup();
    (fixture.nativeElement.querySelector('[data-testid="ind-st-anchored-vwap"]') as HTMLInputElement).click();
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('[data-testid="avwap-maxHistory"]') as HTMLInputElement;
    input.value = '42';
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await flush();
    expect(stored().paramOverrides['st-anchored-vwap'].maxHistory).toBe(42);
  });

  it('reset-to-defaults restores factory state and clears the blob', async () => {
    seed({ symbol: 'MSFT', enabledIndicators: ['st-zigzag'], logScale: false });
    const { fixture } = await setup();
    expect(fixture.componentInstance.symbol()).toBe('MSFT');

    fixture.nativeElement.querySelector('[data-testid="reset-settings"]').click();
    fixture.detectChanges();
    await flush();

    const c = fixture.componentInstance;
    expect(c.symbol()).toBe('QQQ');
    expect(c.logScale()).toBe(true);
    expect(c.enabledIndicators().has('st-zigzag')).toBe(false);
    // The auto-save effect rewrote defaults — next reload sees factory state.
    expect(stored().symbol).toBe('QQQ');
    expect(stored().enabledIndicators).not.toContain('st-zigzag');
  });
});

describe('sandbox route', () => {
  it('registers an auth-guarded flex-chart-sandbox route', () => {
    const root = CORE_ROUTES[0];
    const route = (root.children ?? []).find((r) => r.path === AppRoutes.FLEX_CHART_SANDBOX);
    expect(route).toBeTruthy();
    expect(route?.canActivate).toContain(authGuard);
    expect(AppRoutes.FLEX_CHART_SANDBOX).toBe('dev/flex-chart');
  });
});
