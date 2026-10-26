import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal, input, output } from '@angular/core';
import { By } from '@angular/platform-browser';

import { SignalDetailComponent } from './signal-detail.component';
import { FlexChartComponent } from '../../../shared/components/flex-chart/flex-chart.component';
import { ChartToolbarComponent } from '../chart-toolbar/chart-toolbar.component';
import { SymbolListActionsComponent } from '../symbol-list-actions/symbol-list-actions.component';
import type { FlexChartConfig, ChartRange } from '../../../shared/components/flex-chart/flex-chart.types';
import { ChartStore } from '../../stores/chart.store';
import { SymbolHistoryStore } from '../../stores/symbol-history.store';
import { IndicatorSeriesStore } from '../../stores/indicator-series.store';
import { UiStateService, ChartLayout } from '../../../../core/services/ui-state.service';
import { ChartToolbarStateService } from '../../services/chart-toolbar-state.service';
import { BarsInterval } from '../../../../core/models/partner.types';
import type { SymbolListDef } from '../../common/symbol-list-defs';
import { StIndicator } from '../../../shared/components/flex-chart/flex-chart.types';
import {
  ST_TRIGGER_BANDS_DOTS_INDICATOR,
  ST_TRIGGER_BANDS_INDICATOR,
} from '../../../shared/components/flex-chart/indicators/st-trigger-bands.indicator';
import {
  TRIGGER_BANDS_CHART_INDICATORS,
  TRIGGER_BANDS_CHART_INTERVALS,
  TRIGGER_BANDS_CHART_STRATEGIES,
} from '../../stores/chart.store';
import {
  IndicatorFamily,
  type SymbolIndicatorSeriesResponse,
} from '../../common/indicator.types';
import { TRIGGER_BANDS_SIGNAL_TYPES } from '@flex-chart/indicator-visuals';

const bar = { x: new Date(), open: 1, high: 1, low: 1, close: 1, volume: 1 };

@Component({
  selector: 'app-flex-chart',
  standalone: true,
  template: '',
})
class MockFlexChartComponent {
  chartData = input<unknown>(null);
  config = input<FlexChartConfig>({ indicators: [] });
  syncCrosshairDate = input<Date | null>(null);
  syncCrosshairPrice = input<number | null>(null);
  crosshairDateChange = output<Date | null>();
  crosshairPriceChange = output<number | null>();
  height = input<string>('400px');
}

@Component({
  selector: 'app-chart-toolbar',
  standalone: true,
  template: `<ng-content />`,
})
class MockChartToolbarComponent {
  selectedInterval = input<BarsInterval>(BarsInterval.DAILY);
  selectedRange = input<string>('recent');
  showZoomToolbar = input<boolean>(false);
  activeChartInterval = input<BarsInterval>(BarsInterval.DAILY);
  layout = input<ChartLayout>(ChartLayout.TRIPLE);
  fullscreen = input<boolean>(false);
  logScale = input<boolean>(false);
  indicatorOptions = input<unknown[]>([]);
  selectedIndicatorIds = input<Set<string>>(new Set());
  symbolIndex = input<number>(-1);
  symbolCount = input<number>(0);
  intervalChange = output<BarsInterval>();
  rangeChange = output<ChartRange>();
  zoomToggle = output<void>();
  layoutToggle = output<void>();
  fullscreenToggle = output<void>();
  logScaleToggle = output<void>();
  indicatorToggle = output<string[]>();
  prevSymbol = output<void>();
  nextSymbol = output<void>();
}

@Component({
  selector: 'app-symbol-list-actions',
  standalone: true,
  template: '',
})
class MockSymbolListActionsComponent {
  symbol = input<string | null>(null);
  listCatalog = input<SymbolListDef[]>([]);
  toggleList = output<unknown>();
}

describe('SignalDetailComponent — log scale toggle', () => {
  let fixture: ComponentFixture<SignalDetailComponent>;
  let component: SignalDetailComponent;

  const mockChartStore = {
    symbolDataVersion: signal('v1'),
    dailyData: signal({ bars: [bar] }),
    weeklyData: signal({ bars: [bar] }),
    monthlyData: signal({ bars: [bar] }),
    loading: signal(false),
    error: signal(null),
    clearCharts: jest.fn(),
    loadCharts: jest.fn(),
  };

  const mockHistoryStore = {
    loadSignalHistory: jest.fn(),
  };

  const mockIndicatorStore = {
    responseFor: () => () => undefined,
  };

  const mockUiState = {
    chartLayout: signal(ChartLayout.TRIPLE),
    fullscreen: signal(false),
    toggleChartLayout: jest.fn(),
    toggleFullscreen: jest.fn(),
  };

  beforeEach(async () => {
    // Module-level mock signals are shared across tests — reset the ones
    // tests mutate so later tests never inherit a layout/data state.
    mockUiState.chartLayout.set(ChartLayout.TRIPLE);
    await TestBed.configureTestingModule({
      imports: [SignalDetailComponent],
      providers: [
        ChartToolbarStateService,
        { provide: ChartStore, useValue: mockChartStore },
        { provide: SymbolHistoryStore, useValue: mockHistoryStore },
        { provide: IndicatorSeriesStore, useValue: mockIndicatorStore },
        { provide: UiStateService, useValue: mockUiState },
      ],
    })
      .overrideComponent(SignalDetailComponent, {
        remove: { imports: [FlexChartComponent, ChartToolbarComponent, SymbolListActionsComponent] },
        add: { imports: [MockFlexChartComponent, MockChartToolbarComponent, MockSymbolListActionsComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(SignalDetailComponent);
    component = fixture.componentRef.instance;
    fixture.componentRef.setInput('manualSymbol', 'QQQ');
    fixture.componentRef.setInput('listCatalog', []);
    fixture.detectChanges();
  });

  function chartConfigs(): FlexChartConfig[] {
    return fixture.debugElement
      .queryAll(By.directive(MockFlexChartComponent))
      .map((el) => el.componentInstance.config());
  }

  function toolbar(): MockChartToolbarComponent {
    return fixture.debugElement.query(By.directive(MockChartToolbarComponent)).componentInstance;
  }

  it('defaults all three triple-mode charts to logScale: true', () => {
    expect(chartConfigs().map((c) => c.logScale)).toEqual([true, true, true]);
  });

  it('binds the toolbar pill to the page-level logScale signal', () => {
    expect(toolbar().logScale()).toBe(true);
  });

  it('emitting logScaleToggle from the toolbar flips every chart config', () => {
    toolbar().logScaleToggle.emit();
    fixture.detectChanges();

    expect(chartConfigs().map((c) => c.logScale)).toEqual([false, false, false]);
    expect(toolbar().logScale()).toBe(false);

    toolbar().logScaleToggle.emit();
    fixture.detectChanges();

    expect(chartConfigs().map((c) => c.logScale)).toEqual([true, true, true]);
    expect(toolbar().logScale()).toBe(true);
  });

  it('single-mode chart config follows the same signal', () => {
    mockUiState.chartLayout.set(ChartLayout.SINGLE);
    fixture.detectChanges();

    expect(chartConfigs().map((c) => c.logScale)).toEqual([true]);

    toolbar().logScaleToggle.emit();
    fixture.detectChanges();
    expect(chartConfigs().map((c) => c.logScale)).toEqual([false]);
  });
});

// =============================================================================
// Trigger Bands prod promotion — Task #932
// The bands and dots are opt-in menu entries; enabling either fires the lean
// TRIGGER_BANDS callable under its own IndicatorSeriesStore cache key (the
// default response is never refetched or invalidated). Daily + weekly only —
// monthly never carries the series.
// =============================================================================

const tbPoint = (d: string) => ({
  d,
  upper: 110,
  lower: 90,
  longPullback: false,
  longPullbackState: false,
  longBreakout: false,
  shortPullback: false,
  shortPullbackState: false,
  shortBreakout: false,
});

const tbDot = (d: string) => ({
  d,
  index: 0,
  direction: 'long' as const,
  y: 88,
  version: 'TB' as const,
  signalType: TRIGGER_BANDS_SIGNAL_TYPES.LONG_PULLBACK,
});

const TB_RESPONSE: SymbolIndicatorSeriesResponse = {
  symbol: 'QQQ',
  marketDate: '2026-01-10',
  computedAt: '2026-01-10T00:00:00Z',
  intervals: {
    daily: {
      indicators: { triggerBands: [tbPoint('2026-01-02'), tbPoint('2026-01-05')] },
      signals: {},
      dotMarkers: { triggerBands: [tbDot('2026-01-05')] },
    },
    weekly: {
      indicators: { triggerBands: [tbPoint('2026-01-05')] },
      signals: {},
      dotMarkers: { triggerBands: [tbDot('2026-01-05')] },
    },
  },
};

describe('SignalDetailComponent — Trigger Bands promotion (#932)', () => {
  let fixture: ComponentFixture<SignalDetailComponent>;
  let component: SignalDetailComponent;
  let toolbarState: ChartToolbarStateService;
  let loadIfNeeded: jest.Mock;

  const mockChartStore = {
    symbolDataVersion: signal('v1'),
    dailyData: signal({ bars: [bar] }),
    weeklyData: signal({ bars: [bar] }),
    monthlyData: signal({ bars: [bar] }),
    loading: signal(false),
    error: signal(null),
    clearCharts: jest.fn(),
    loadCharts: jest.fn(),
  };

  const mockUiState = {
    chartLayout: signal(ChartLayout.TRIPLE),
    fullscreen: signal(false),
    toggleChartLayout: jest.fn(),
    toggleFullscreen: jest.fn(),
  };

  beforeEach(async () => {
    mockUiState.chartLayout.set(ChartLayout.TRIPLE);
    loadIfNeeded = jest.fn();
    // The lean lookup is keyed by the request's indicator families — only the
    // TRIGGER_BANDS filter set returns the fixture response.
    const mockIndicatorStore = {
      loadIfNeeded,
      responseFor: () => (
        _symbol: string,
        _version: string,
        _intervals: unknown,
        indicators: IndicatorFamily[] | undefined,
      ) => (indicators?.includes(IndicatorFamily.TRIGGER_BANDS) ? TB_RESPONSE : undefined),
    };
    await TestBed.configureTestingModule({
      imports: [SignalDetailComponent],
      providers: [
        ChartToolbarStateService,
        { provide: ChartStore, useValue: mockChartStore },
        { provide: SymbolHistoryStore, useValue: { loadSignalHistory: jest.fn() } },
        { provide: IndicatorSeriesStore, useValue: mockIndicatorStore },
        { provide: UiStateService, useValue: mockUiState },
      ],
    })
      .overrideComponent(SignalDetailComponent, {
        remove: { imports: [FlexChartComponent, ChartToolbarComponent, SymbolListActionsComponent] },
        add: { imports: [MockFlexChartComponent, MockChartToolbarComponent, MockSymbolListActionsComponent] },
      })
      .compileComponents();

    toolbarState = TestBed.inject(ChartToolbarStateService);
    fixture = TestBed.createComponent(SignalDetailComponent);
    component = fixture.componentRef.instance;
    fixture.componentRef.setInput('manualSymbol', 'QQQ');
    fixture.componentRef.setInput('listCatalog', []);
    fixture.detectChanges();
  });

  function chartConfigs(): FlexChartConfig[] {
    return fixture.debugElement
      .queryAll(By.directive(MockFlexChartComponent))
      .map((el) => el.componentInstance.config());
  }

  // Template order in triple mode: weekly, monthly, daily.
  const weeklyConfig = () => chartConfigs()[0];
  const monthlyConfig = () => chartConfigs()[1];
  const dailyConfig = () => chartConfigs()[2];

  it('offers the bands and dots options in the D/W-scoped menu, unchecked by default', () => {
    const optionIds = component.activeChartIndicatorOptions().map((o) => o.id);
    expect(optionIds).toContain(ST_TRIGGER_BANDS_INDICATOR.id);
    expect(optionIds).toContain(ST_TRIGGER_BANDS_DOTS_INDICATOR.id);
    // Opt-in: not enabled until the user picks them — the lean request must
    // not fire before then.
    expect(component.activeSelectedIndicatorIds().has(ST_TRIGGER_BANDS_INDICATOR.id)).toBe(false);
    expect(component.activeSelectedIndicatorIds().has(ST_TRIGGER_BANDS_DOTS_INDICATOR.id)).toBe(false);
    expect(loadIfNeeded).not.toHaveBeenCalled();
  });

  it('fires the lean callable under its own filter args when the bands option is enabled', () => {
    toolbarState.applyIndicatorToggle([ST_TRIGGER_BANDS_INDICATOR.id]);
    fixture.detectChanges();
    expect(loadIfNeeded).toHaveBeenCalledWith(
      'QQQ',
      'v1',
      TRIGGER_BANDS_CHART_INTERVALS,
      TRIGGER_BANDS_CHART_INDICATORS,
      TRIGGER_BANDS_CHART_STRATEGIES,
    );
  });

  it('injects band data onto daily and weekly configs; monthly carries no TB config', () => {
    toolbarState.applyIndicatorToggle([ST_TRIGGER_BANDS_INDICATOR.id]);
    fixture.detectChanges();

    const dailyTb = dailyConfig().indicators.find((i) => i.type === StIndicator.ST_TRIGGER_BANDS);
    expect(dailyTb?.triggerBandData).toHaveLength(2);
    const weeklyTb = weeklyConfig().indicators.find((i) => i.type === StIndicator.ST_TRIGGER_BANDS);
    expect(weeklyTb?.triggerBandData).toHaveLength(1);
    expect(monthlyConfig().indicators.some((i) => i.type === StIndicator.ST_TRIGGER_BANDS)).toBe(false);
  });

  it('attaches dot markers only when the dots option is enabled — bands not required', () => {
    toolbarState.applyIndicatorToggle([ST_TRIGGER_BANDS_DOTS_INDICATOR.id]);
    fixture.detectChanges();

    // Dots alone still fire the lean request (they ride the same response).
    expect(loadIfNeeded).toHaveBeenCalled();
    const daily = dailyConfig();
    expect(daily.indicators.some((i) => i.type === StIndicator.ST_TRIGGER_BANDS)).toBe(false);
    const dots = daily.indicators.find((i) => i.type === StIndicator.ST_TRIGGER_BANDS_DOTS);
    expect(dots?.data).toHaveLength(1);
  });

  it('hides both TB options when only monthly is in scope', () => {
    mockUiState.chartLayout.set(ChartLayout.SINGLE);
    toolbarState.setInterval(BarsInterval.MONTHLY);
    fixture.detectChanges();
    const optionIds = component.activeChartIndicatorOptions().map((o) => o.id);
    expect(optionIds).not.toContain(ST_TRIGGER_BANDS_INDICATOR.id);
    expect(optionIds).not.toContain(ST_TRIGGER_BANDS_DOTS_INDICATOR.id);
  });
});

// =============================================================================
// Hoisted toolbar state (#1232/#1255) — the merged page toolbar and the
// detail component share the page-scoped ChartToolbarStateService; the
// in-template toolbar is suppressible via the showToolbar input.
// =============================================================================

describe('SignalDetailComponent — hoisted toolbar state (#1255)', () => {
  let fixture: ComponentFixture<SignalDetailComponent>;
  let component: SignalDetailComponent;
  let toolbarState: ChartToolbarStateService;

  const mockChartStore = {
    symbolDataVersion: signal('v1'),
    dailyData: signal({ bars: [bar] }),
    weeklyData: signal({ bars: [bar] }),
    monthlyData: signal({ bars: [bar] }),
    loading: signal(false),
    error: signal(null),
    clearCharts: jest.fn(),
    loadCharts: jest.fn(),
  };

  const mockUiState = {
    chartLayout: signal(ChartLayout.TRIPLE),
    fullscreen: signal(false),
    toggleChartLayout: jest.fn(),
    toggleFullscreen: jest.fn(),
  };

  beforeEach(async () => {
    mockUiState.chartLayout.set(ChartLayout.TRIPLE);
    await TestBed.configureTestingModule({
      imports: [SignalDetailComponent],
      providers: [
        ChartToolbarStateService,
        { provide: ChartStore, useValue: mockChartStore },
        { provide: SymbolHistoryStore, useValue: { loadSignalHistory: jest.fn() } },
        { provide: IndicatorSeriesStore, useValue: { responseFor: () => () => undefined, loadIfNeeded: jest.fn() } },
        { provide: UiStateService, useValue: mockUiState },
      ],
    })
      .overrideComponent(SignalDetailComponent, {
        remove: { imports: [FlexChartComponent, ChartToolbarComponent, SymbolListActionsComponent] },
        add: { imports: [MockFlexChartComponent, MockChartToolbarComponent, MockSymbolListActionsComponent] },
      })
      .compileComponents();

    toolbarState = TestBed.inject(ChartToolbarStateService);
    fixture = TestBed.createComponent(SignalDetailComponent);
    component = fixture.componentRef.instance;
    fixture.componentRef.setInput('manualSymbol', 'QQQ');
    fixture.componentRef.setInput('listCatalog', []);
    fixture.detectChanges();
  });

  it('renders its toolbar by default', () => {
    expect(fixture.debugElement.query(By.directive(MockChartToolbarComponent))).not.toBeNull();
  });

  it('suppresses the in-template toolbar when showToolbar is false — charts still render', () => {
    fixture.componentRef.setInput('showToolbar', false);
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.directive(MockChartToolbarComponent))).toBeNull();
    expect(fixture.debugElement.queryAll(By.directive(MockFlexChartComponent))).toHaveLength(3);
  });

  it('drives single-mode chart data from the shared service, not local state', () => {
    mockUiState.chartLayout.set(ChartLayout.SINGLE);
    toolbarState.setInterval(BarsInterval.WEEKLY);
    fixture.detectChanges();

    const configs = fixture.debugElement
      .queryAll(By.directive(MockFlexChartComponent))
      .map((el) => el.componentInstance.config());
    // Single mode renders the active interval's chart — weekly dataset bound.
    expect(component.activeChartData()).toBe(mockChartStore.weeklyData());
    expect(configs).toHaveLength(1);
  });

  it('toolbar outputs mutate the shared service', () => {
    const toolbar = fixture.debugElement.query(By.directive(MockChartToolbarComponent)).componentInstance as MockChartToolbarComponent;
    toolbar.intervalChange.emit(BarsInterval.MONTHLY);
    expect(toolbarState.selectedInterval()).toBe(BarsInterval.MONTHLY);
    expect(toolbarState.activeChartInterval()).toBe(BarsInterval.MONTHLY);
  });
});
