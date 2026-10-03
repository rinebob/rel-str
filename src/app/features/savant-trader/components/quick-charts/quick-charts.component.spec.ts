import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal, input, output } from '@angular/core';
import { By } from '@angular/platform-browser';

import { QuickChartsComponent } from './quick-charts.component';
import { FlexChartComponent } from '../../../shared/components/flex-chart/flex-chart.component';
import type { FlexChartDataset, FlexChartConfig } from '../../../shared/components/flex-chart/flex-chart.types';
import { ChartStore } from '../../stores/chart.store';
import { IndicatorSeriesStore } from '../../stores/indicator-series.store';

const bar = { x: new Date(), open: 1, high: 1, low: 1, close: 1, volume: 1 };

@Component({
  selector: 'app-flex-chart',
  standalone: true,
  template: '',
})
class MockFlexChartComponent {
  chartData = input.required<FlexChartDataset | null>();
  config = input<FlexChartConfig>({ indicators: [] });
  syncCrosshairDate = input<Date | null>(null);
  syncCrosshairPrice = input<number | null>(null);
  crosshairDateChange = output<Date | null>();
  crosshairPriceChange = output<number | null>();
}

describe('QuickChartsComponent', () => {
  let fixture: ComponentFixture<QuickChartsComponent>;
  let component: QuickChartsComponent;

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

  const mockIndicatorStore = {
    responseFor: () => () => undefined,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QuickChartsComponent],
      providers: [
        { provide: ChartStore, useValue: mockChartStore },
        { provide: IndicatorSeriesStore, useValue: mockIndicatorStore },
      ],
    })
      .overrideComponent(QuickChartsComponent, {
        remove: { imports: [FlexChartComponent] },
        add: { imports: [MockFlexChartComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(QuickChartsComponent);
    component = fixture.componentRef.instance;
    fixture.componentRef.setInput('symbol', 'AAPL');
    fixture.detectChanges();
  });

  function chartConfigs(): FlexChartConfig[] {
    return fixture.debugElement
      .queryAll(By.directive(MockFlexChartComponent))
      .map((el) => el.componentInstance.config());
  }

  it('defaults each chart config to logScale: true', () => {
    expect(chartConfigs().map((c) => c.logScale)).toEqual([true, true, true]);
  });

  it('updates every chart config when the page-level input flips to linear', () => {
    fixture.componentRef.setInput('logScale', false);
    fixture.detectChanges();

    expect(chartConfigs().map((c) => c.logScale)).toEqual([false, false, false]);
  });

  // ── #736: visibleBars windows + cellHeight ─────────────────────────────

  it('sets per-interval visibleBars — daily 30, weekly 30, monthly 100', () => {
    // Template order is Daily, Weekly, Monthly.
    expect(chartConfigs().map((c) => c.visibleBars)).toEqual([30, 30, 100]);
  });

  it('sizes chart cells to the 560px default cellHeight', () => {
    const cells = fixture.debugElement.queryAll(By.css('.qc-chart-cell'));
    expect(cells.map((el) => (el.nativeElement as HTMLElement).style.flexBasis))
      .toEqual(['560px', '560px', '560px']);
  });

  it('honors a cellHeight override', () => {
    fixture.componentRef.setInput('cellHeight', 700);
    fixture.detectChanges();

    const cells = fixture.debugElement.queryAll(By.css('.qc-chart-cell'));
    expect((cells[0].nativeElement as HTMLElement).style.flexBasis).toBe('700px');
  });
});
