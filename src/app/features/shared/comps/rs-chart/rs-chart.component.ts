import { ChangeDetectionStrategy, Component, input, signal, ViewChild } from '@angular/core';
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

import { CandleWithRSColor, OHLCDatum, RsChartConfig, RsPaneDatum } from '../../../shared/types/rs.interfaces';
import { MAIN_CHART_INITIAL_DAYS, SMALL_CHART_INITIAL_DAYS } from '../../../shared/constants/rs.constants';
import { autoscaleYAxis, autoscaleYAxisForRange, getXExtents } from '../../utils/chart.util';
import { toTimestamp } from '../../utils/date.util';

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

    isInitialLoad = signal<boolean>(true);
    
    constructor() {
        // Lightweight debug logging to understand data presence when charts
        // move between main and filmstrip. Remove once RS rendering is stable.
        // eslint-disable-next-line no-console
        // effect(() => {
        //     try {
        //         console.log('[RsChartComponent] inputs', {
        //             id: this.id(),
        //             name: this.name(),
        //             isMain: this.isMain(),
        //             chartLen: this.chartData()?.length,
        //             baselineLen: this.baselineData()?.length,
        //             rsLen: this.rsData()?.length,
        //         });
        //     } catch (e) {
        //         console.error('[RsChartComponent] log error', e);
        //     }
        // });
    }

    onChartLoaded2(): void {
        if (this.chart) {
            this.autoscaleYAxis();
        }
    }

    onChartLoaded(): void {
        // console.log(`---------- RSC oCL onChartLoaded ${this.id()} ----------`);
        const chart = this.chart;
        if (!chart) {
            return;
        }

        const data = this.chartData();
        if (!data || !data.length) {
            return;
        }

        const daysToShow = this.isMain() ? MAIN_CHART_INITIAL_DAYS : SMALL_CHART_INITIAL_DAYS;

        // Initial zoom window for newly created chart instances
        if (this.isInitialLoad() && data.length > daysToShow) {
            const zoomFactor = daysToShow / data.length;
            const zoomPosition = (data.length - daysToShow) / data.length;

            if (chart.primaryXAxis) {
                chart.primaryXAxis.zoomFactor = zoomFactor;
                chart.primaryXAxis.zoomPosition = zoomPosition;
            }

            this.autoscaleYAxis();
            this.isInitialLoad.set(false);
            return;
        }

        // For reused chart instances (e.g. moving between main and filmstrip),
        // still autoscale once when data is present.
        this.autoscaleYAxis();
    }

    onScrollEnd(event: IScrollEventArgs): void {
        // console.log(`----- RSC oSE onScrollEnd ${this.id()} ---------`);
        // console.log('rS oSE event: ', event);
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
            
            let zoomFactor = 0;
            let zoomPosition = 0;
           
            if (total > 0 && startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                const visible = endIdx - startIdx + 1;
                zoomFactor = visible / total;
                zoomPosition = startIdx / total;
                this.chart.primaryXAxis.zoomFactor = zoomFactor;
                this.chart.primaryXAxis.zoomPosition = zoomPosition;
                
            } else {
                // console.log('rs oSE scroll end bypassing axis zoom settings calcs')
            }
            const { minX, maxX } = getXExtents(event.range);
            this.autoscaleYAxisForRange(minX, maxX);
            // if (this.isMain()) {
            //     console.log('rS oSE min/max/startIdx/endIdx: ', min, max, startIdx, endIdx);
            //     console.log('rS oZC t.c.pXA.zF/zP: ', zoomFactor, zoomPosition);
            //     console.log('rS oZC minX/maxX: ', minX, maxX);
    
            // }
        }
        
    }

    onZoomComplete(event: IZoomCompleteEventArgs): void {
        // console.log(`----- RSC oZC onZoomComplete ${this.id()} -------`);
        // console.log('rS oZC event: ', event);
        // Update zoomFactor and zoomPosition to reflect the new visible range
        if (this.chart && this.chart.primaryXAxis && event.currentVisibleRange) {
            const data = this.chartData();
            const total = data.length;
            const min = toTimestamp(event.currentVisibleRange.min);
            const max = toTimestamp(event.currentVisibleRange.max);
            const startIdx = data.findIndex(d => toTimestamp(d.x) >= min);
            const endIdx = data.findIndex(d => toTimestamp(d.x) >= max);
            console.log('rS oZC startIdx/endIdx: ', startIdx, endIdx);
            console.log('rS oZC min/max: ', min, max);
            let zoomFactor = 0;
            let zoomPosition = 0;
            if (total > 0 && startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                const visible = endIdx - startIdx + 1;
                zoomFactor = visible / total;
                zoomPosition = startIdx / total;

                this.chart.primaryXAxis.zoomFactor = zoomFactor;
                this.chart.primaryXAxis.zoomPosition = zoomPosition;
                // console.log('rS oZC t.c.pXA.zF/zP: ', zoomFactor, zoomPosition);
            }
            
            // if (this.isMain()) {
            //     console.log('rS oSE min/max/startIdx/endIdx: ', min, max, startIdx, endIdx);
            //     console.log('rS oZC t.c.pXA.zF/zP: ', zoomFactor, zoomPosition);
            // }
        }
        if (event?.axis?.name === 'primaryXAxis' && event.currentVisibleRange) {
            const { minX, maxX } = getXExtents(event.currentVisibleRange);
            // if (this.isMain()) {
            //     console.log('rS oZC minX/maxX: ', minX, maxX);
            // }
            this.autoscaleYAxisForRange(minX, maxX);
        }
    }

    public autoscaleYAxis(): void {
        // console.log(`------------- RSC AYA ${this.name()} ------------------`);
        if (this.chart && !!this.chart?.primaryXAxis) {
            const baseline = this.config().showBaseline ? this.baselineData() : [];
            this.chart = autoscaleYAxis(this.chartData(), baseline, this.chart);
        }
    }

    public autoscaleYAxisForRange(minX: number | Date, maxX: number | Date): void {
        // console.log(`------------- RSC AYAFR ${this.name()} ------------------`);
        if (!!this.chart && !!this.chart.primaryXAxis) {
            const baseline = this.config().showBaseline ? this.baselineData() : [];
            this.chart = autoscaleYAxisForRange(this.chartData(), baseline, this.chart, minX, maxX);
        }
    }
}
