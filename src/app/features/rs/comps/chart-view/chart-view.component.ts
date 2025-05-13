import { signal } from '@angular/core';
import { Component, ChangeDetectionStrategy, ViewChild, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ChartModule, ChartComponent as SfChartComponent, DateTimeService, LegendService } from '@syncfusion/ej2-angular-charts';
import { Chart, CandleSeries, Tooltip, DateTime, Legend } from '@syncfusion/ej2-charts';

// Register required modules for the chart
Chart.Inject(CandleSeries, Tooltip, DateTime, Legend);
import { RsPaneComponent } from './rs-pane/rs-pane.component';
import { ChartToolbarComponent } from './chart-toolbar/chart-toolbar.component';
import type { CandleWithRSColor } from './chart-two/chart-two.component';
import type { ChartAxisConfig } from '../../common/interfaces-rs';
import { parseOhlcCsv } from './utils/csv-parse.util';
import { addColorToRank, generatePercentChangeData } from '../../utils/rs-calc-utils';
import { generateColorArray } from '../../utils/color-utils';
import { compareRsDatasets } from '../../utils/rs-calc-utils-compare';

/**
 * ChartViewComponent is the container for the chart route. It orchestrates state, data loading,
 * and layout for chart, RS pane, and controls.
 */
@Component({
  selector: 'rs-chart-view',
  standalone: true,
  imports: [
    CommonModule,
    ChartModule,
    RsPaneComponent,
    ChartToolbarComponent
  ],
  providers: [DateTimeService, LegendService],
  templateUrl: './chart-view.component.html',
  styleUrl: './chart-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class ChartViewComponent {
  /**
   * Whether tooltips are enabled for the Syncfusion chart.
   */
  public tooltipEnabled = true;

  /**
   * HttpClient for data loading (injected).
   */
  private readonly http = inject(HttpClient);

  /**
   * Signal for the main candle data array (MSFT, colored).
   */
  public candleData = signal<CandleWithRSColor[]>([]);
  /**
   * Signal for MSFT data (raw, colored).
   */
  public msftData = signal<CandleWithRSColor[]>([]);
  /**
   * Signal for QQQ data.
   */
  public qqqData = signal<CandleWithRSColor[]>([]);
  /**
   * Signal for RS comparison summary string.
   */
  public rsComparisonSummary = signal<string>('');
  /**
   * Signal for whether to use a subset of data for charting.
   */
  public useDataSubset = signal<boolean>(false);
  /**
   * Signal for visible X axis ticks (indices).
   */
  public visibleXAxisTicks = signal<number[]>([]);
  /**
   * Current zoom factor (fraction of chart shown, 0 < zoomFactor <= 1)
   */
  public zoomFactor = 1;
  /**
   * Current zoom position (start of zoom window, 0 <= zoomPosition <= 1-zoomFactor)
   */
  public zoomPosition = 0;
  /**
   * Plot area left offset in px (for RS pane alignment)
   */
  public plotAreaLeft = 0;
  /**
   * Plot area width in px (for RS pane alignment)
   */
  public plotAreaWidth = 0;
  /**
   * Internal retry counter for plot area measurement
   */
  private _plotAreaRetryCount = 0;
  /**
   * Reference to the Syncfusion chart component instance (set via ViewChild)
   */
  @ViewChild('msftChart', { static: false }) chartComponent?: SfChartComponent;

  /**
   * Getter for the current value of candleData signal.
   */
  public candleDataFn(): CandleWithRSColor[] {
    return this.candleData();
  }

  /**
   * Returns true if candleData is a non-empty array.
   * Used for safe chart rendering in the template.
   */
  public get hasCandleData(): boolean {
    const data = this.candleData();
    return Array.isArray(data) && data.length > 0;
  }

  /**
   * User-supplied or dynamic x-axis config (merged with default in getter).
   */
  public primaryXAxis?: Partial<ChartAxisConfig>;

  /**
   * Always-defined, reactive x-axis config for Syncfusion chart.
   */
  public get chartPrimaryXAxis(): ChartAxisConfig {
    const defaultConfig: ChartAxisConfig = {
      valueType: 'DateTime',
      title: 'Date',
      zoomFactor: 1,
      zoomPosition: 0,
      plotOffset: 0,
      labelFormat: 'MM-dd',
      intervalType: 'Days',
      edgeLabelPlacement: 'Shift',
      majorGridLines: { width: 0 }
    };
    const axis = this.primaryXAxis ? { ...defaultConfig, ...this.primaryXAxis } : defaultConfig;
    // eslint-disable-next-line no-console
    console.debug('[ChartView] Providing chartPrimaryXAxis:', axis);
    return axis;
  }

  constructor() {
    this.loadBothCSVsAndCompare();
  }

  // Toolbar actions
  public zoomIn(): void {
    let factor = this.zoomFactor;
    if (factor > 0.05) {
      factor = Math.max(0.05, factor / 2);
      this.setZoom(factor, this.zoomPosition);
    }
  }
  public zoomOut(): void {
    let factor = this.zoomFactor;
    factor = Math.min(1, factor * 2);
    this.setZoom(factor, this.zoomPosition);
  }
  public resetZoom(): void {
    this.setZoom(1, 0);
  }
  public useSubset(): void {
    // Implement subset toggle if needed
  }

  public setZoom(factor: number, position: number): void {
    this.zoomFactor = factor;
    this.zoomPosition = Math.max(0, Math.min(position, 1 - factor));
    // Always update primaryXAxis config reactively
    if (this.primaryXAxis) {
      this.primaryXAxis.zoomFactor = this.zoomFactor;
      this.primaryXAxis.zoomPosition = this.zoomPosition;
    }
    if (this.chartComponent) {
      this.autoscaleYAxis();
      this.chartComponent.dataBind();
    }
  }

  public autoscaleYAxis(factor?: number, position?: number): void {
    const data = this.candleData();
    if (!data.length) return;
    const total = data.length;
    factor = factor ?? this.zoomFactor;
    position = position ?? this.zoomPosition;
    const startIdx = Math.floor(position * total);
    const endIdx = Math.min(total, Math.ceil(startIdx + factor * total));
    const visible = data.slice(startIdx, endIdx);
    const min = Math.min(...visible.map(d => d.low));
    const max = Math.max(...visible.map(d => d.high));
    if (this.chartComponent && this.chartComponent.primaryYAxis) {
      this.chartComponent.primaryYAxis.minimum = min;
      this.chartComponent.primaryYAxis.maximum = max;
    }
  }

  public autoscaleYAxisForRange(minX: number | Date, maxX: number | Date): void {
    const data = this.candleData();
    if (!data.length) return;
    let minVal = typeof minX === 'number' ? minX : minX.getTime();
    let maxVal = typeof maxX === 'number' ? maxX : maxX.getTime();
    const visible = data.filter(d => d.x instanceof Date && d.x.getTime() >= minVal && d.x.getTime() <= maxVal);
    if (!visible.length) return;
    const min = Math.min(...visible.map(d => d.low));
    const max = Math.max(...visible.map(d => d.high));
    if (this.chartComponent && this.chartComponent.primaryYAxis) {
      this.chartComponent.primaryYAxis.minimum = min;
      this.chartComponent.primaryYAxis.maximum = max;
    }
  }

  public onChartZoomComplete(event: any): void {
    if (event && event.axis && event.axis.visibleRange) {
      const minX = event.axis.visibleRange.min;
      const maxX = event.axis.visibleRange.max;
      this.autoscaleYAxisForRange(minX, maxX);
    } else {
      this.autoscaleYAxis();
    }
    setTimeout(() => {
      this.setPlotAreaDims();
      this.logRenderedCandlesVsRsBars();
    }, 0);
  }

  public onChartLoaded(): void {
    this.setPlotAreaDims();
    this.logRenderedCandlesVsRsBars();
    this.updateVisibleXAxisTicks();
  }

  public onAxisLabelRender(args: any): void {
    if (args.axis.name === 'primaryXAxis' && args.value instanceof Date) {
      const min = args.axis.visibleRange?.min;
      if (min !== undefined && args.value.getTime() === min) {
        args.text = `${args.value.getFullYear()} ${args.text}`;
      }
    }
  }

  public onTooltipRender(args: any): void {
    if (args && args.point && args.point.x instanceof Date) {
      const d = args.point.x;
      const dateStr = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
      args.text = `${dateStr}<br/>Open: ${args.point.open}<br/>High: ${args.point.high}<br/>Low: ${args.point.low}<br/>Close: ${args.point.close}`;
    }
  }

  public setPlotAreaDims(): void {
    if (!this.chartComponent) return;
    const chartEl = (this.chartComponent as any).element as HTMLElement;
    if (!chartEl) return;
    const svg = chartEl.querySelector('svg');
    if (!svg) {
      if (this._plotAreaRetryCount < 15) {
        this._plotAreaRetryCount++;
        setTimeout(() => this.setPlotAreaDims(), 75);
      }
      return;
    }
    const plotRectEl = svg.querySelector('#candlestick-chart-two_ChartAreaBorder') as SVGRectElement;
    if (!plotRectEl) {
      if (this._plotAreaRetryCount < 15) {
        this._plotAreaRetryCount++;
        setTimeout(() => this.setPlotAreaDims(), 75);
      }
      return;
    }
    const rawX = plotRectEl.getAttribute('x');
    const rawWidth = plotRectEl.getAttribute('width');
    const x = Number(rawX);
    const width = Number(rawWidth);
    if (isNaN(x) || isNaN(width) || !width || width === 0) {
      if (this._plotAreaRetryCount < 15) {
        this._plotAreaRetryCount++;
        setTimeout(() => this.setPlotAreaDims(), 75);
      }
      return;
    }
    this.plotAreaLeft = x;
    this.plotAreaWidth = width;
    this._plotAreaRetryCount = 0;
  }

  public firstVisibleYear(): number | null {
    const data = this.candleData();
    if (!data.length) return null;
    if (this.chartComponent && this.chartComponent.primaryXAxis && (this.chartComponent.primaryXAxis as any).visibleRange) {
      const min = (this.chartComponent.primaryXAxis as any).visibleRange.min;
      const first = data.find(d => d.x instanceof Date && d.x.getTime() >= min);
      return first?.x instanceof Date ? first.x.getFullYear() : null;
    }
    const total = data.length;
    const factor = this.zoomFactor;
    const position = this.zoomPosition;
    const startIdx = Math.floor(position * total);
    const visible = data.slice(startIdx);
    if (!visible.length) return null;
    const first = visible[0];
    return first.x instanceof Date ? first.x.getFullYear() : null;
  }

  public updateVisibleXAxisTicks(): void {
    const chart = this.chartComponent as any;
    if (!chart || !chart.primaryXAxis || !chart.primaryXAxis.visibleLabels) {
      this.visibleXAxisTicks.set([]);
      return;
    }
    const data = this.candleData();
    const total = data.length;
    const factor = this.zoomFactor;
    const position = this.zoomPosition;
    const startIdx = Math.floor(position * total);
    const endIdx = Math.min(total, Math.ceil(startIdx + factor * total));
    const visible = data.slice(startIdx, endIdx);
    const labelDates = chart.primaryXAxis.visibleLabels.map((lbl: any) => lbl.value);
    const ticks = visible
      .map((d, idx) => labelDates.includes(d.x.getTime()) ? startIdx + idx : -1)
      .filter(idx => idx !== -1);
    this.visibleXAxisTicks.set(ticks);
  }

  private logRenderedCandlesVsRsBars(): void {
    const chart = this.chartComponent as any;
    let visiblePoints: any[] = [];
    if (chart && chart.visibleSeries && chart.visibleSeries[0] && chart.visibleSeries[0].points) {
      visiblePoints = chart.visibleSeries[0].points.filter((pt: any) => pt.visible !== false);
    }
    // For debugging only: log visible candle and RS bar counts
    // console.log('Rendered Candles', { candleCount: visiblePoints.length, first: visiblePoints[0]?.x, last: visiblePoints[visiblePoints.length-1]?.x });
    // console.log('RS Pane Bars', { rsCount: this.visibleRsColors.length, first: this.visibleRsColors[0], last: this.visibleRsColors[this.visibleRsColors.length-1] });
  }

  public get visibleRsColors(): string[] {
    const data = this.candleData();
    if (!data.length) return [];
    if (this.chartComponent && this.chartComponent.primaryXAxis && (this.chartComponent.primaryXAxis as any).visibleRange) {
      const min: number = (this.chartComponent.primaryXAxis as any).visibleRange.min;
      const max: number = (this.chartComponent.primaryXAxis as any).visibleRange.max;
      const visible = data.filter(d => d.x instanceof Date && d.x.getTime() >= min && d.x.getTime() <= max);
      return visible.map((d: CandleWithRSColor) => d.rsColor || '#ddd');
    }
    const total = data.length;
    const factor = this.zoomFactor;
    const position = this.zoomPosition;
    const startIdx = Math.floor(position * total);
    const endIdx = Math.min(total, Math.ceil(startIdx + factor * total));
    const sliced = data.slice(startIdx, endIdx);
    return sliced.map((d: CandleWithRSColor) => d.rsColor || '#ddd');
  }



  /**
   * Loads both QQQ and MSFT CSVs, parses them, and runs RS comparison on page load.
   */
  private loadBothCSVsAndCompare(): void {
    const msftUrl = '/assets/data/BATS_MSFT, 1D_0d494.csv';
    const qqqUrl = '/assets/data/BATS_QQQ, 1D_862dd.csv';
    forkJoin({
      msftCsv: this.http.get(msftUrl, { responseType: 'text' }).pipe(catchError(() => of(null))),
      qqqCsv: this.http.get(qqqUrl, { responseType: 'text' }).pipe(catchError(() => of(null)))
    }).subscribe({
      next: ({ msftCsv, qqqCsv }) => {
        if (!msftCsv || !qqqCsv) {
          this.rsComparisonSummary.set('Error: Missing or empty CSV data');
          return;
        }
        // Parse MSFT using utility
        const msftOhlc = parseOhlcCsv(msftCsv);
        const qqqOhlc = parseOhlcCsv(qqqCsv);
        // Defensive: log and validate parsed data
        // eslint-disable-next-line no-console
        console.debug('[ChartView] Parsed msftOhlc:', msftOhlc);
        // eslint-disable-next-line no-console
        console.debug('[ChartView] Parsed qqqOhlc:', qqqOhlc);
        if (!Array.isArray(msftOhlc) || !Array.isArray(qqqOhlc)) {
          this.rsComparisonSummary.set('Error: Parsed CSV data invalid');
          // eslint-disable-next-line no-console
          console.error('[ChartView] Parsed CSV data invalid:', { msftOhlc, qqqOhlc });
          return;
        }
        /** Use subset toggle from signal (UI-driven) */
        const USE_CHART_DATA_SUBSET = this.useDataSubset();
        const CHART_DATA_SUBSET_SIZE = 100;
        // Slice both MSFT and QQQ to the subset first
        const msftOhlcToUse = USE_CHART_DATA_SUBSET ? msftOhlc.slice(-CHART_DATA_SUBSET_SIZE) : msftOhlc;
        const qqqOhlcToUse = USE_CHART_DATA_SUBSET ? qqqOhlc.slice(-CHART_DATA_SUBSET_SIZE) : qqqOhlc;
        // RS color assignment should use only the sliced MSFT data
        const msftCloses = msftOhlcToUse.map((d: CandleWithRSColor) => ({ [d.x.toISOString().slice(0,10)]: d.close }));
        const windowSize = 5;
        const heatmapColors = generateColorArray(11);
        const msftPct = generatePercentChangeData(msftCloses);
        // We want msftRsColors.length === msftOhlcToUse.length - windowSize
        const msftRsColors = msftPct.slice(windowSize).map((rsObj: any) => addColorToRank(rsObj, heatmapColors));
        // Build a date-to-color map from msftRsColors using the date property
        const rsColorMap: Record<string, string> = {};
        msftRsColors.forEach((rs: any) => {
          if (rs.date) {
            rsColorMap[rs.date] = rs.color;
          }
        });
        // Assign rsColor by date lookup for chart candles
        const msftColoredOhlcToUse = msftOhlcToUse.map((candle: CandleWithRSColor) => {
          const dateStr = candle.x.toISOString().slice(0, 10);
          return {
            ...candle,
            rsColor: rsColorMap[dateStr] ?? null
          };
        });
        // Set both msftData and candleData to the colored, sliced MSFT data
        this.msftData.set(msftColoredOhlcToUse);
        this.candleData.set(msftColoredOhlcToUse);
        this.qqqData.set(qqqOhlcToUse);
        this.runRsComparison();
      },
      error: () => {
        this.rsComparisonSummary.set('Error: Failed to load CSVs');
      }
    });
  }

  /**
   * Runs RS dataset comparison between QQQ and MSFT and stores a summary for the UI.
   */
  private runRsComparison(): void {
    const msft = this.msftData();
    const qqq = this.qqqData();
    if (!msft || !Array.isArray(msft) || !msft.length || !qqq || !Array.isArray(qqq) || !qqq.length) {
      this.rsComparisonSummary.set(`Error: MSFT or QQQ data missing (msft: ${msft ? msft.length : 'n/a'}, qqq: ${qqq ? qqq.length : 'n/a'})`);
      return;
    }
    const msftCloses = msft.map(d => ({ [d.x.toISOString().slice(0,10)]: d.close }));
    const qqqCloses = qqq.map(d => ({ [d.x.toISOString().slice(0,10)]: d.close }));
    const msftPct = generatePercentChangeData(msftCloses);
    const qqqPct = generatePercentChangeData(qqqCloses);
    const msftPctWindowed = msftPct.slice(5);
    const qqqPctWindowed = qqqPct.slice(5);
    const heatmapColors = generateColorArray(11);
    const result = compareRsDatasets(qqqPctWindowed, msftPctWindowed, heatmapColors);
    if (result.mismatches.length === 0) {
      this.rsComparisonSummary.set('All results match!');
    } else {
      this.rsComparisonSummary.set(`${result.mismatches.length} mismatches found`);
    }
  }

  /** Handler to toggle data subset usage and reload chart data */
  public toggleDataSubset(): void {
    this.useDataSubset.set(!this.useDataSubset());
    this.loadBothCSVsAndCompare();
  }
}
