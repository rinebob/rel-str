import { AfterViewInit, OnInit, signal } from '@angular/core';
import { Component, ChangeDetectionStrategy, ViewChild, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ChartModule, ChartComponent as SfChartComponent, CandleSeriesService, LineSeriesService, ColumnSeriesService, DateTimeService, TooltipService, LegendService, ZoomService, CrosshairService, IZoomCompleteEventArgs, AxisModel } from '@syncfusion/ej2-angular-charts';
import { DataManager, JsonAdaptor, Query } from '@syncfusion/ej2-data';

import { RsPaneComponent } from './rs-pane/rs-pane.component';
import { ChartToolbarComponent } from './chart-toolbar/chart-toolbar.component';
import type { CandleWithRSColor, RsPaneDatum } from '../../common/interfaces-rs';
import { parseOhlcCsv } from './utils/csv-parse.util';
import { generatePercentChangeData, generateRelStrTableDataSet } from '../../utils/rs-calc-utils';
import { generateColorArray } from '../../utils/color-utils';
import { compareRsDatasets } from '../../utils/rs-calc-utils-compare';
import MSFT_WITH_COLORS from '../../../../../assets/data/MSFT_WITH_COLORS.json';
import { autoscaleYAxis, autoscaleYAxisForRange } from './utils/chart.util';
import { SyncChartOneComponent } from '../sync-chart-view/sync-chart-one/sync-chart-one.component';

/**
 * ChartViewComponent is the container for the chart route. It orchestrates state, data loading,
 * and layout for chart, RS pane, and controls.
 */
@Component({
	selector: 'rs-chart-view',
	standalone: true,
	imports: [CommonModule, ChartModule, RsPaneComponent, SyncChartOneComponent],
	providers: [CandleSeriesService, LineSeriesService, ColumnSeriesService, DateTimeService, TooltipService, ZoomService, LegendService, CrosshairService],
	templateUrl: './chart-view.component.html',
	styleUrls: ['./chart-view.component.scss'],
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartViewComponent implements OnInit {
	public candleData = signal<CandleWithRSColor[]>((MSFT_WITH_COLORS as any[]).map((item) => ({
		...item,
		x: new Date(item.x),
	})));
    
	@ViewChild('msftChart', { static: false }) chartComponent?: SfChartComponent;
	public rsPaneData = signal<RsPaneDatum[]>([]);
    public msftData = signal<CandleWithRSColor[]>([]);
    public qqqData = signal<CandleWithRSColor[]>([]);
    public rsComparisonSummary = signal<string>('');
    public useDataSubset = signal<boolean>(false);
    public visibleXAxisTicks = signal<number[]>([]);

	public tooltipEnabled = true;
	public zoomFactor = 1;
    public zoomPosition = 0;
    public plotAreaLeft = 0;
	public plotAreaWidth = 0;
	private _plotAreaRetryCount = 0;

    
    title = 'Relative Strength Heatmap';

    width = '100%';

    lineStyle: any;
    majorGridLines: any;

    primaryXAxis: AxisModel = {
        valueType: 'DateTime',
        title: 'Date',
        zoomFactor: 1,
        zoomPosition: 0,
        plotOffset: 0,
        labelFormat: 'MM-dd',
        intervalType: 'Days',
        edgeLabelPlacement: 'Shift',
        majorGridLines: { width: 0 },
        rangePadding: 'Round',
        crosshairTooltip: { enable: true },
		
	}

    primaryYAxis: Object = { 
        title: 'Price (USD)',
        // valueType: 'Logarithmic',
    };

    legend: Object = {
        visible: true,
    }

    zoomSettings: Object = {
        enableAutoIntervalOnZooming: true,
        enableScrollbar: true,
        enableSelectionZooming: true,
        enableMouseWheelZooming: true,
        enablePinchZooming: true,
        enablePan: true,
        // NOTE: enableAnimation disables chart Y axis autoresize on zoom!!! do not enable!!
        // enableAnimation: true,
        mode: 'X',
        showToolbar: true,
        toolbarItems: ['Zoom','ZoomIn', 'ZoomOut', 'Pan', 'Reset'],
        toolbarPosition: {
            draggable: true,
            horizontalAlignment: 'Near',
            verticalAlignment: 'Top',
        }
    }

    crosshair = { 
        enable: true,
        snapToData: true,
    };

    tooltip = {
        enable: true
    }


	ngOnInit(): void {
	}

	/**
	 * Updates the visible candle data window based on zoom and data.
	 */
	// private updateVisibleCandleData(): void {
	// 	const data = this.candleData();
	// 	if (!Array.isArray(data) || !data.length) {
	// 		this.visibleCandleData.set([]);
	// 		return;
	// 	}
	// 	const total = data.length;
	// 	const factor = this.zoomFactor;
	// 	const position = this.zoomPosition;
	// 	const startIdx = Math.floor(position * total);
	// 	const endIdx = Math.min(total, Math.ceil(startIdx + factor * total));
	// 	let visible = data.slice(startIdx, endIdx);
	// 	// Only set real candles for chart
	// 	this.visibleCandleData.set(visible);
	// 	// console.log('cV gRPD candleData 0-50: ', visible.slice(0, 50));
	// 	this.generateRsPaneData();
	// }

	// generateRsPaneData() {
	// 	const visibleData = this.visibleCandleData();

	// 	const rsData: RsPaneDatum[] = visibleData.map((d: CandleWithRSColor) => ({
	// 		date: d.x instanceof Date ? d.x : new Date(d.x),
	// 		rank: d.rank,
	// 		rsColor: d.rsColor || '#ddd',
	// 	}));
	// 	// console.log('cV gRPD rsPaneData 0-50: ', rsData.slice(0, 50));
	// 	this.rsPaneData.set(rsData);
	// }

	/**
	 * Returns visible candles plus a dummy for RS pane alignment.
	 */
	// public visibleCandleDataWithDummy(): CandleWithRSColor[] {
	// 	const visible: CandleWithRSColor[] = this.visibleCandleData();
	// 	if (!visible.length) return [];
	// 	const last = visible[visible.length - 1];
	// 	const lastDate = last.x instanceof Date ? last.x : new Date(last.x);
	// 	const nextDate = new Date(lastDate.getTime());
	// 	nextDate.setDate(lastDate.getDate() + 1);
	// 	return [
	// 		...visible,
	// 		{
	// 			x: nextDate,
	// 			open: 0,
	// 			high: 0,
	// 			low: 0,
	// 			close: 0,
	// 			rsColor: undefined,
	// 		},
	// 	];
	// }

	/**
	 * Getter for the current value of candleData signal (full array).
	 */
	public candleDataFn(): CandleWithRSColor[] {
		return this.candleData();
	}

	/**
	 * Returns true if candleData is a non-empty array.
	 * Used for safe chart rendering in the template.
	 */
	public get hasCandleData(): boolean {
		const data = this.candleDataFn();
		return Array.isArray(data) && data.length > 0;
	}
	// /**
	//  * User-supplied or dynamic x-axis config (merged with default in getter).
	//  */
	// public primaryXAxis?: Partial<ChartAxisConfig>;

	/**
	 * Always-defined, reactive x-axis config for Syncfusion chart.
	 */
	// public get chartPrimaryXAxis(): ChartAxisConfig {
	// 	const defaultConfig: ChartAxisConfig = {
	// 		valueType: 'DateTime',
	// 		title: 'Date',
	// 		zoomFactor: 1,
	// 		zoomPosition: 0,
	// 		plotOffset: 0,
	// 		labelFormat: 'MM-dd',
	// 		intervalType: 'Days',
	// 		edgeLabelPlacement: 'Shift',
	// 		majorGridLines: { width: 0 },
	// 	};
	// 	const axis = this.primaryXAxis ? { ...defaultConfig, ...this.primaryXAxis } : defaultConfig;
	// 	// eslint-disable-next-line no-console
	// 	console.debug('[ChartView] Providing chartPrimaryXAxis:', axis);
	// 	return axis;
	// }

	constructor() {
		// this.loadBothCSVsAndCompare();
	}

	// Toolbar actions
	// public zoomIn(): void {
	// 	this.setZoom(Math.max(0.01, this.zoomFactor * 0.7), this.zoomPosition);
	// 	// Chart will update and zoomComplete will handle Y autoscale
	// }
	// public zoomOut(): void {
	// 	this.setZoom(Math.min(1, this.zoomFactor / 0.7), this.zoomPosition);
	// 	// Chart will update and zoomComplete will handle Y autoscale
	// }

	// /** Go to chart start */
	// public goToStart(): void {
	// 	this.setZoom(this.zoomFactor, 0);
	// }
	// /** Go to chart end */
	// public goToEnd(): void {
	// 	this.setZoom(this.zoomFactor, 1 - this.zoomFactor);
	// }
	// public resetZoom(): void {
	// 	// Reload the data according to the useDataSubset flag
	// 	// this.loadBothCSVsAndCompare();
	// 	// Reset zoom to default (full extent)
	// 	// this.setZoom(1, 0);
	// 	// Always update the chart visuals
	// 	if (this.chartComponent) {
	// 		// this.autoscaleYAxis();
	// 		this.chartComponent.dataBind();
	// 		// this.setPlotAreaDims();
	// 	}
	// }
	public useSubset(): void {
		this.toggleDataSubset();
	}

	// public setZoom(factor: number, position: number): void {
	// 	this.zoomFactor = factor;
	// 	this.zoomPosition = Math.max(0, Math.min(position, 1 - factor));
	// 	// this.updateVisibleCandleData();
	// 	// Always update primaryXAxis config reactively
	// 	if (this.primaryXAxis) {
	// 		this.primaryXAxis.zoomFactor = this.zoomFactor;
	// 		this.primaryXAxis.zoomPosition = this.zoomPosition;
	// 	}
	// 	if (this.chartComponent) {
	// 		this.chartComponent.dataBind();
	// 	}
	// 	// Do not autoscale here; let zoomComplete event handle it
	// }

    // export function autoscaleYAxis(data: CandleWithRSColor[], chartComponent: ChartComponent): ChartComponent | void {
    public autoscaleYAxis(): void {
        console.log('------------- CV AYA ------------------');
        if (!!this.chartComponent && !!this.chartComponent.primaryXAxis) {
            this.chartComponent = autoscaleYAxis(this.candleData(), this.chartComponent);

        }
        
    }

	public autoscaleYAxis2(): void {
		console.log('------------- CV AYA ------------------');
		console.log('cV aYA autoscaleYAxis called');
		const data = this.candleData();
		console.log('cV aYA data.length: ', data.length);
		console.log('cV aYA !this.chartComponent: ', !this.chartComponent);
		if (!data.length || !this.chartComponent || !this.chartComponent.primaryXAxis) return;
		// Use Syncfusion's visible X range
		const xAxis = this.chartComponent.primaryXAxis;
		const xRange = (xAxis as any).visibleRange;
		console.log('cV aYA xRange: ', xRange);
		if (!xRange) return;
		const minX = xRange.min;
		const maxX = xRange.max;
		// Log the visible X range
		// console.log('[Y-Axis Autoscale] Syncfusion visible X range:', minX, 'to', maxX);
		// Filter candles within visible X range
		const visible = data.filter((d) => {
			const xVal = d.x instanceof Date ? d.x.getTime() : d.x;
			return xVal >= minX && xVal <= maxX;
		});
		console.log('cV aYA visible.length: ', visible.length);
		if (!visible.length) {
			console.log('[Y-Axis Autoscale] No visible candles in current X range.');
			return;
		}
		const min = Math.min(...visible.map((d) => d.low));
		const max = Math.max(...visible.map((d) => d.high));
		console.log('cV aYA min: ', min);
		console.log('cV aYA max: ', max);
		// const firstDate = visible[0]?.x;
		// const lastDate = visible[visible.length - 1]?.x;
		// console.log('[Y-Axis Autoscale] Visible candle date range:', firstDate, 'to', lastDate);
		// console.log('[Y-Axis Autoscale] Highest high in visible candles:', max);
		this.chartComponent.primaryYAxis.minimum = min;
		this.chartComponent.primaryYAxis.maximum = max;
		this.chartComponent.dataBind()
		// console.log('[Y-Axis Autoscale] Set chartComponent.primaryYAxis.maximum:', this.chartComponent.primaryYAxis.maximum);
	}

    // export function autoscaleYAxisForRange(data: CandleWithRSColor[], chartComponent: ChartComponent, minX: number | Date, maxX: number | Date): ChartComponent | void {
    public autoscaleYAxisForRange(minX: number | Date, maxX: number | Date): void {
        console.log('------------- CV AYAFR ------------------');
        if (!!this.chartComponent && !!this.chartComponent.primaryXAxis) {
            this.chartComponent = autoscaleYAxisForRange(this.candleData(), this.chartComponent, minX, maxX);

        }
        
    }

	public autoscaleYAxisForRange2(minX: number | Date, maxX: number | Date): void {
		const data = this.candleData();
		if (!data.length) return;
		let minVal = typeof minX === 'number' ? minX : minX.getTime();
		let maxVal = typeof maxX === 'number' ? maxX : maxX.getTime();
		const visible = data.filter((d) => d.x instanceof Date && d.x.getTime() >= minVal && d.x.getTime() <= maxVal);
		if (!visible.length) return;
		const min = Math.min(...visible.map((d) => d.low));
		const max = Math.max(...visible.map((d) => d.high));
		const firstDate = visible[0]?.x;
		const lastDate = visible[visible.length - 1]?.x;
		console.log('[Y-Axis Autoscale] Visible data range:', firstDate, 'to', lastDate);
		console.log('[Y-Axis Autoscale] Highest high in visible data:', max);
		if (this.chartComponent && this.chartComponent.primaryYAxis) {
			this.chartComponent.primaryYAxis.minimum = min;
			this.chartComponent.primaryYAxis.maximum = max;
			console.log('[Y-Axis Autoscale] Set chartComponent.primaryYAxis.maximum:', this.chartComponent.primaryYAxis.maximum);
		}
	}

	public onChartZoomComplete(event: IZoomCompleteEventArgs): void {
        console.log('------------- CV oCZC ------------------');
        console.log('cv oCZC event: ', event);
		this.chartComponent?.dataBind();
		if (event && event.currentVisibleRange) {
			const minX = event.currentVisibleRange.min;
			const maxX = event.currentVisibleRange.max;
            if (minX && maxX) {
                this.autoscaleYAxisForRange(minX, maxX);
            }
		} else {
			this.autoscaleYAxis();
		}
	}

	/** Called when the Syncfusion chart has fully loaded (data and visuals) */
	public onChartLoaded(): void {
		console.log('cV oCL onChartLoaded called');
		// this.setPlotAreaDims();
		// this.logRenderedCandlesVsRsBars();
		// this.updateVisibleXAxisTicks();
		this.chartComponent?.dataBind();
		this.autoscaleYAxis();
	}

	public onAxisLabelRender(args: any): void {
		if (args.axis.name === 'primaryYAxis') {
			args.text = '$' + Math.round(args.value).toLocaleString();
		} else if (args.axis.name === 'primaryXAxis' && args.value instanceof Date) {
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

	// public setPlotAreaDims(): void {
	// 	if (!this.chartComponent) return;
	// 	const chartEl = (this.chartComponent as any).element as HTMLElement;
	// 	if (!chartEl) return;
	// 	const svg = chartEl.querySelector('svg');
	// 	if (!svg) {
	// 		if (this._plotAreaRetryCount < 15) {
	// 			this._plotAreaRetryCount++;
	// 			setTimeout(() => this.setPlotAreaDims(), 75);
	// 		}
	// 		return;
	// 	}
	// 	const plotRectEl = svg.querySelector('#candlestick-chart-two_ChartAreaBorder') as SVGRectElement;
	// 	if (!plotRectEl) {
	// 		if (this._plotAreaRetryCount < 15) {
	// 			this._plotAreaRetryCount++;
	// 			setTimeout(() => this.setPlotAreaDims(), 75);
	// 		}
	// 		return;
	// 	}
	// 	const rawX = plotRectEl.getAttribute('x');
	// 	const rawWidth = plotRectEl.getAttribute('width');
	// 	const x = Number(rawX);
	// 	const width = Number(rawWidth);
	// 	if (isNaN(x) || isNaN(width) || !width || width === 0) {
	// 		if (this._plotAreaRetryCount < 15) {
	// 			this._plotAreaRetryCount++;
	// 			setTimeout(() => this.setPlotAreaDims(), 75);
	// 		}
	// 		return;
	// 	}
	// 	this.plotAreaLeft = x;
	// 	this.plotAreaWidth = width;
	// 	this._plotAreaRetryCount = 0;
	// }

	public firstVisibleYear(): number | null {
		const data = this.candleData();
		if (!data.length) return null;
		if (this.chartComponent && this.chartComponent.primaryXAxis && (this.chartComponent.primaryXAxis as any).visibleRange) {
			const min = (this.chartComponent.primaryXAxis as any).visibleRange.min;
			const first = data.find((d) => d.x instanceof Date && d.x.getTime() >= min);
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

	// public updateVisibleXAxisTicks(): void {
	// 	const chart = this.chartComponent as any;
	// 	if (!chart || !chart.primaryXAxis || !chart.primaryXAxis.visibleLabels) {
	// 		this.visibleXAxisTicks.set([]);
	// 		return;
	// 	}
	// 	const data = this.candleData();
	// 	const total = data.length;
	// 	const factor = this.zoomFactor;
	// 	const position = this.zoomPosition;
	// 	const startIdx = Math.floor(position * total);
	// 	const endIdx = Math.min(total, Math.ceil(startIdx + factor * total));
	// 	const visible = data.slice(startIdx, endIdx);
	// 	const labelDates = chart.primaryXAxis.visibleLabels.map((lbl: any) => lbl.value);
	// 	const ticks = visible.map((d, idx) => (labelDates.includes(d.x.getTime()) ? startIdx + idx : -1)).filter((idx) => idx !== -1);
	// 	this.visibleXAxisTicks.set(ticks);
	// }

	// private logRenderedCandlesVsRsBars(): void {
	// 	const chart = this.chartComponent as any;
	// 	let visiblePoints: any[] = [];
	// 	if (chart && chart.visibleSeries && chart.visibleSeries[0] && chart.visibleSeries[0].points) {
	// 		visiblePoints = chart.visibleSeries[0].points.filter((pt: any) => pt.visible !== false);
	// 	}
	// 	// For debugging only: log visible candle and RS bar counts
	// 	// console.log('Rendered Candles', { candleCount: visiblePoints.length, first: visiblePoints[0]?.x, last: visiblePoints[visiblePoints.length-1]?.x });
	// 	// console.log('RS Pane Bars', { rsCount: this.visibleRsColors.length, first: this.visibleRsColors[0], last: this.visibleRsColors[this.visibleRsColors.length-1] });
	// }

	// public get visibleRsColors(): string[] {
	// 	const data = this.candleData();
	// 	if (!data.length) return [];
	// 	if (this.chartComponent && this.chartComponent.primaryXAxis && (this.chartComponent.primaryXAxis as any).visibleRange) {
	// 		const min: number = (this.chartComponent.primaryXAxis as any).visibleRange.min;
	// 		const max: number = (this.chartComponent.primaryXAxis as any).visibleRange.max;
	// 		const visible = data.filter((d) => d.x instanceof Date && d.x.getTime() >= min && d.x.getTime() <= max);
	// 		return visible.map((d: CandleWithRSColor) => d.rsColor || '#ddd');
	// 	}
	// 	const total = data.length;
	// 	const factor = this.zoomFactor;
	// 	const position = this.zoomPosition;
	// 	const startIdx = Math.floor(position * total);
	// 	const endIdx = Math.min(total, Math.ceil(startIdx + factor * total));
	// 	const sliced = data.slice(startIdx, endIdx);
	// 	return sliced.map((d: CandleWithRSColor) => d.rsColor || '#ddd');
	// }

	/**
	 * Loads both QQQ and MSFT CSVs, parses them, and runs RS comparison on page load.
	 */
	// private loadBothCSVsAndCompare(): void {
	// 	const msftUrl = '/assets/data/BATS_MSFT, 1D_0d494.csv';
	// 	const qqqUrl = '/assets/data/BATS_QQQ, 1D_862dd.csv';
	// 	forkJoin({
	// 		msftCsv: this.http.get(msftUrl, { responseType: 'text' }).pipe(catchError(() => of(null))),
	// 		qqqCsv: this.http.get(qqqUrl, { responseType: 'text' }).pipe(catchError(() => of(null))),
	// 	}).subscribe({
	// 		next: ({ msftCsv, qqqCsv }) => {
	// 			if (!msftCsv || !qqqCsv) {
	// 				this.rsComparisonSummary.set('Error: Missing or empty CSV data');
	// 				return;
	// 			}
	// 			// Parse MSFT using utility
	// 			const msftOhlc = parseOhlcCsv(msftCsv);
	// 			const qqqOhlc = parseOhlcCsv(qqqCsv);
	// 			// Defensive: log and validate parsed data
	// 			// eslint-disable-next-line no-console
	// 			console.debug('[ChartView] Parsed msftOhlc:', msftOhlc);
	// 			// eslint-disable-next-line no-console
	// 			console.debug('[ChartView] Parsed qqqOhlc:', qqqOhlc);
	// 			if (!Array.isArray(msftOhlc) || !Array.isArray(qqqOhlc)) {
	// 				this.rsComparisonSummary.set('Error: Parsed CSV data invalid');
	// 				// eslint-disable-next-line no-console
	// 				console.error('[ChartView] Parsed CSV data invalid:', { msftOhlc, qqqOhlc });
	// 				return;
	// 			}
	// 			/** Use subset toggle from signal (UI-driven) */
	// 			const USE_CHART_DATA_SUBSET = this.useDataSubset();
	// 			const CHART_DATA_SUBSET_SIZE = 100;
	// 			// Slice both MSFT and QQQ to the subset first
	// 			const msftOhlcToUse = USE_CHART_DATA_SUBSET ? msftOhlc.slice(-CHART_DATA_SUBSET_SIZE) : msftOhlc;
	// 			const qqqOhlcToUse = USE_CHART_DATA_SUBSET ? qqqOhlc.slice(-CHART_DATA_SUBSET_SIZE) : qqqOhlc;
	// 			// --- Refactored RS color assignment to match Heatmap logic ---
	// 			const heatmapColors = generateColorArray(11);
	// 			// Build StockData[] from parsed CSVs for MSFT and QQQ
	// 			// Convert parsed candles to StockDatum[] (date string -> close price)
	// 			const msftStockData = {
	// 				symbol: 'MSFT',
	// 				data: msftOhlcToUse.map((candle) => ({ [candle.x.toISOString().slice(0, 10)]: candle.close })),
	// 				results: [],
	// 				resultsByDate: {},
	// 				ranksByDate: {},
	// 			};
	// 			const qqqStockData = {
	// 				symbol: 'QQQ',
	// 				data: qqqOhlcToUse.map((candle) => ({ [candle.x.toISOString().slice(0, 10)]: candle.close })),
	// 				results: [],
	// 				resultsByDate: {},
	// 				ranksByDate: {},
	// 			};

	// 			const csvStockDataArr = [msftStockData, qqqStockData];
	// 			// Generate RS dataset using only CSV data, baseline QQQ
	// 			const { allData } = generateRelStrTableDataSet(csvStockDataArr, 'QQQ', heatmapColors);
	// 			const msftSymbol = 'MSFT';
	// 			const msftRanksByDate = allData[msftSymbol]?.ranksByDate || {};

	// 			// Assign rsColor to each candle in the sliced MSFT data
	// 			const msftColoredOhlcToUse = msftOhlcToUse.map((candle: CandleWithRSColor) => {
	// 				const dateStr = candle.x.toISOString().slice(0, 10);
	// 				const rankEntry = msftRanksByDate[dateStr];
	// 				let rsColor: string | undefined;
	// 				if (rankEntry && typeof rankEntry.rank === 'number') {
	// 					const colorIdx = Math.round(rankEntry.rank * (heatmapColors.length - 1));
	// 					rsColor = heatmapColors[colorIdx];
	// 				}
	// 				return {
	// 					...candle,
	// 					rsColor,
	// 					rank: rankEntry ? rankEntry.rank : undefined,
	// 				};
	// 			});
	// 			// Set both msftData and candleData to the colored, sliced MSFT data
	// 			this.msftData.set(msftColoredOhlcToUse);
	// 			this.candleData.set(msftColoredOhlcToUse);

	// 			// console.log('cV lBCAC candleData 0-50: ', this.candleData().slice(0, 50));
	// 			// console.log('cV lBCAC candleData: ', this.candleData());

	// 			this.updateVisibleCandleData();
	// 			this.qqqData.set(qqqOhlcToUse);
	// 			this.runRsComparison();

	// 			// console.log('cV lBCAC qqqData: ', this.qqqData());
	// 		},
	// 		error: () => {
	// 			this.rsComparisonSummary.set('Error: Failed to load CSVs');
	// 		},
	// 	});
	// }

	/**
	 * Runs RS dataset comparison between QQQ and MSFT and stores a summary for the UI.
	 */
	// private runRsComparison(): void {
	// 	const msft = this.msftData();
	// 	const qqq = this.qqqData();
	// 	if (!msft || !Array.isArray(msft) || !msft.length || !qqq || !Array.isArray(qqq) || !qqq.length) {
	// 		this.rsComparisonSummary.set(`Error: MSFT or QQQ data missing (msft: ${msft ? msft.length : 'n/a'}, qqq: ${qqq ? qqq.length : 'n/a'})`);
	// 		return;
	// 	}
	// 	const msftCloses = msft.map((d) => ({ [d.x.toISOString().slice(0, 10)]: d.close }));
	// 	const qqqCloses = qqq.map((d) => ({ [d.x.toISOString().slice(0, 10)]: d.close }));
	// 	const msftPct = generatePercentChangeData(msftCloses);
	// 	const qqqPct = generatePercentChangeData(qqqCloses);
	// 	const msftPctWindowed = msftPct.slice(5);
	// 	const qqqPctWindowed = qqqPct.slice(5);
	// 	const heatmapColors = generateColorArray(11);
	// 	const result = compareRsDatasets(qqqPctWindowed, msftPctWindowed, heatmapColors);
	// 	if (result.mismatches.length === 0) {
	// 		this.rsComparisonSummary.set('All results match!');
	// 	} else {
	// 		this.rsComparisonSummary.set(`${result.mismatches.length} mismatches found`);
	// 	}
	// }

	/** Handler to toggle data subset usage and reload chart data */
	public toggleDataSubset(): void {
		// this.useDataSubset.set(!this.useDataSubset());
		// this.loadBothCSVsAndCompare();
	}
}
