/// <reference types="jest" />
/**
 * Tests for FlexChartSandboxComponent — the dev sandbox page hosting a single
 * FlexChartComponent for log-axis work (Topic #468, task #477).
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
import { of } from 'rxjs';

import { FlexChartSandboxComponent } from './flex-chart-sandbox.component';
import { ChartStore } from '../../stores/chart.store';
import { ChartService } from '../../services/chart.service';
import { IndicatorSeriesStore } from '../../stores/indicator-series.store';
import { FlexChartComponent } from '../../../shared/components/flex-chart/flex-chart.component';
import type {
  FlexChartConfig,
  FlexChartDataset,
  PriceBar,
} from '../../../shared/components/flex-chart/flex-chart.types';
import type { ChartAxisState, ChartDebugSnapshot } from '../../../shared/components/flex-chart/services/chart-instance.types';
import { BarsInterval } from '../../../../core/models/partner.types';
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

const mockIndicatorStore = {
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
});

describe('sandbox route', () => {
  it('registers an auth-guarded flex-chart-sandbox route', () => {
    const root = CORE_ROUTES[0];
    const route = (root.children ?? []).find((r) => r.path === AppRoutes.FLEX_CHART_SANDBOX);
    expect(route).toBeTruthy();
    expect(route?.canActivate).toContain(authGuard);
    expect(AppRoutes.FLEX_CHART_SANDBOX).toBe('savant-trader/flex-chart-sandbox');
  });
});
