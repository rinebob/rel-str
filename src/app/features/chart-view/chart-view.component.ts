import { signal } from '@angular/core';
import { Component, ChangeDetectionStrategy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartModule, ChartComponent as SfChartComponent, CandleSeriesService, LineSeriesService, ColumnSeriesService, DateTimeService, TooltipService, LegendService, ZoomService, CrosshairService, AxisModel } from '@syncfusion/ej2-angular-charts';

import { RsPaneComponent } from './rs-pane/rs-pane.component';
// import { ChartToolbarComponent } from './chart-toolbar/chart-toolbar.component';
import type { CandleWithRSColor, RsPaneDatum } from '../common/interfaces-rs';
import MSFT_WITH_COLORS from '../../../assets/data/MSFT_WITH_COLORS.json';
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
export class ChartViewComponent {
    @ViewChild('msftChart', { static: false }) chartComponent?: SfChartComponent;
    
	public chartData = signal<CandleWithRSColor[]>((MSFT_WITH_COLORS as any[]).map((item) => ({
		...item,
		x: new Date(item.x),
	})));
    
	public rsData = signal<RsPaneDatum[]>([]);
    public baselineData = signal<CandleWithRSColor[]>([]);
    
    public msftData = signal<CandleWithRSColor[]>([]);
    public rsComparisonSummary = signal<string>('');
    public useDataSubset = signal<boolean>(false);

	public tooltipEnabled = true;
	public zoomFactor = 1;
    public zoomPosition = 0;
    public plotAreaLeft = 0;
	public plotAreaWidth = 0;

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


	ngOnInit(): void {}
	

	constructor() {
	}

	public useSubset(): void {
		this.toggleDataSubset();
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


	public firstVisibleYear(): number | null {
		const data = this.chartData();
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




	

	/** Handler to toggle data subset usage and reload chart data */
	public toggleDataSubset(): void {
		// this.useDataSubset.set(!this.useDataSubset());
		// this.loadBothCSVsAndCompare();
	}
}
