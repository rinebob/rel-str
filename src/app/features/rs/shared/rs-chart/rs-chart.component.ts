import { ChangeDetectionStrategy, Component, effect, input, ViewChild } from '@angular/core';
import {
    ChartModule,
    ChartComponent as SfChartComponent,
    CandleSeriesService,
    ColumnSeriesService,
    CrosshairService,
    DateTimeService,
    IScrollEventArgs,
    IZoomCompleteEventArgs,
    LegendService,
    LineSeriesService,
    LogarithmicService,
    ScrollBarService,
    TooltipService,
    ZoomService,
} from '@syncfusion/ej2-angular-charts';

import { CandleWithRSColor, OHLCDatum, RsChartConfig, RsPaneDatum } from '../../common/interfaces-rs';
import { autoscaleYAxis, autoscaleYAxisForRange, getXExtents } from '../../comps/chart-view/utils/chart.util';
import { MAIN_CHART_INITIAL_DAYS, SMALL_CHART_INITIAL_DAYS } from '../../common/constants-rs';
import { toTimestamp } from '../utils/shared.util';

@Component({
    selector: 'rs-chart',
    imports: [ChartModule],
    providers: [
        CandleSeriesService,
        ColumnSeriesService,
        CrosshairService,
        DateTimeService,
        LegendService,
        LineSeriesService,
        LogarithmicService,
        ScrollBarService,
        TooltipService,
        ZoomService,
    ],
    templateUrl: './rs-chart.component.html',
    styleUrls: ['./rs-chart.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class RsChartComponent {
    @ViewChild('chart', { static: false }) public chart?: SfChartComponent;

    // Signal inputs with default values
    id = input(`chart-${Math.random().toString(36).substr(2, 9)}`);
    name = input.required<string>();

    // Chart data inputs
    chartData = input.required<CandleWithRSColor[]>();
    baselineData = input.required<OHLCDatum[]>();
    rsData = input.required<RsPaneDatum[]>();
    zoomEnabled = input(true);

    // Chart configuration
    config = input.required<RsChartConfig>();
    isMain = input(false);
    
    constructor() {
        // effect(() => {
        //     try {
        //         console.group('Chart Inputs Changed for id/name: ', this.id(), this.name());
        //         console.log('Chart Data Length:', this.chartData()?.length);
        //         console.log('Chart Data:', this.chartData());
        //         console.log('Baseline Data Length:', this.baselineData()?.length);
        //         console.log('RS Data Length:', this.rsData()?.length);
        //         console.log('Config Available:', !!this.config());
        //         console.log('Config :', this.config());
        //         console.log('zoomEnabled :', this.zoomEnabled());
        //         console.groupEnd();
        //     } catch (e) {
        //         console.error('Error logging inputs:', e);
        //     }
        // });
    }

    onChartLoaded2(): void {
        if (this.chart) {
            this.autoscaleYAxis();
        }
    }

    onChartLoaded(): void {
        if (!this.chart) return;
        this.chart.dataBind();
        const data = this.chartData();
        const daysToShow = this.isMain() ? MAIN_CHART_INITIAL_DAYS : SMALL_CHART_INITIAL_DAYS;
        if (data.length > daysToShow) {
            const zoomFactor = daysToShow / data.length;
            const zoomPosition = (data.length - daysToShow) / data.length;
            
            // Update the primary X-axis zoom settings
            this.chart.primaryXAxis.zoomFactor = zoomFactor;
            this.chart.primaryXAxis.zoomPosition = zoomPosition;
            
            // Autoscale Y-axis to the visible range       
            this.autoscaleYAxis();
        }
    }

    onScrollEnd(event: IScrollEventArgs): void {
        if (!event.range) {
            return;
        }
        // Update zoomFactor and zoomPosition to reflect the new visible range
        if (this.chart && this.chart.primaryXAxis && event.range) {
            const data = this.chartData();
            const total = data.length;
            const min = toTimestamp(event.range.min);
            const max = toTimestamp(event.range.max);
            const startIdx = data.findIndex(d => toTimestamp(d.x) >= min);
            const endIdx = data.findIndex(d => toTimestamp(d.x) >= max);
            if (total > 0 && startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                const visible = endIdx - startIdx + 1;
                this.chart.primaryXAxis.zoomFactor = visible / total;
                this.chart.primaryXAxis.zoomPosition = startIdx / total;
            }
        }
        const { minX, maxX } = getXExtents(event.range);
        this.autoscaleYAxisForRange(minX, maxX);
    }

    onZoomComplete(event: IZoomCompleteEventArgs): void {
        // console.log(`------------- RSC oZC onZoomComplete ${this.id()} ------------------`);
        // console.log('rS oZC event: ', event);
        // Update zoomFactor and zoomPosition to reflect the new visible range
        if (this.chart && this.chart.primaryXAxis && event.currentVisibleRange) {
            const data = this.chartData();
            const total = data.length;
            const min = toTimestamp(event.currentVisibleRange.min);
            const max = toTimestamp(event.currentVisibleRange.max);
            const startIdx = data.findIndex(d => toTimestamp(d.x) >= min);
            const endIdx = data.findIndex(d => toTimestamp(d.x) >= max);
            if (total > 0 && startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                const visible = endIdx - startIdx + 1;
                this.chart.primaryXAxis.zoomFactor = visible / total;
                this.chart.primaryXAxis.zoomPosition = startIdx / total;
            }
        }
        if (event?.axis?.name === 'primaryXAxis' && event.currentVisibleRange) {
            const { minX, maxX } = getXExtents(event.currentVisibleRange);
            this.autoscaleYAxisForRange(minX, maxX);
        }
    }

    public autoscaleYAxis(): void {
        // console.log(`------------- RSC AYA ${this.name()} ------------------`);
        if (this.chart && !!this.chart?.primaryXAxis) {
            this.chart = autoscaleYAxis(this.chartData(), this.baselineData(), this.chart);
        }
    }

    public autoscaleYAxisForRange(minX: number | Date, maxX: number | Date): void {
        // console.log(`------------- RSC AYAFR ${this.name()} ------------------`);
        if (!!this.chart && !!this.chart.primaryXAxis) {
            this.chart = autoscaleYAxisForRange(this.chartData(), this.baselineData(), this.chart, minX, maxX);
        }
    }
}
