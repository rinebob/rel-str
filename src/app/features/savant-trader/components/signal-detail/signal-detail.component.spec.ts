import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal, input, output } from '@angular/core';
import { By } from '@angular/platform-browser';

import { SignalDetailComponent } from './signal-detail.component';
import { FlexChartComponent } from '../../../shared/components/flex-chart/flex-chart.component';
import { ChartToolbarComponent } from '../chart-toolbar/chart-toolbar.component';
import { SymbolListActionsComponent } from '../symbol-list-actions/symbol-list-actions.component';
import type { FlexChartConfig } from '../../../shared/components/flex-chart/flex-chart.types';
import { ChartStore } from '../../stores/chart.store';
import { SymbolHistoryStore } from '../../stores/symbol-history.store';
import { IndicatorSeriesStore } from '../../stores/indicator-series.store';
import { UiStateService, ChartLayout } from '../../../../core/services/ui-state.service';
import { BarsInterval } from '../../../../core/models/partner.types';

const bar = { x: new Date(), open: 1, high: 1, low: 1, close: 1, volume: 1 };

@Component({
  selector: 'app-flex-chart',
  standalone: true,
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
  rangeChange = output<'recent' | '6m' | '1y' | '5y' | 'all'>();
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
})
class MockSymbolListActionsComponent {
  symbol = input<string | null>(null);
  symbolLists = input<Record<string, string[]>>({});
  toggleList = output<unknown>();
  monitor = output<string>();
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
