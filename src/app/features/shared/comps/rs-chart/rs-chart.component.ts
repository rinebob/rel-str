import { ChangeDetectionStrategy, Component, effect, input, signal, ViewChild } from '@angular/core';
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

import { CandleWithRSColor, MaSeriesPoint, OHLCDatum, RsChartConfig, RsPaneDatum } from '../../../shared/types/rs.interfaces';
import { DEFAULT_MAIN_MA_CONFIGS, MAIN_CHART_INITIAL_DAYS, SMALL_CHART_INITIAL_DAYS } from '../../../shared/constants/rs.constants';
import { autoscaleYAxis } from '../../utils/chart.util';
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
    mainMaSeries = input<Record<string, MaSeriesPoint[]>>({});
    zoomEnabled = input(true);

    // Chart configuration
    config = input.required<RsChartConfig>();
    isMain = input(false);

    isInitialLoad = signal<boolean>(true);

    constructor() {}

    onChartLoaded2(): void {
        if (this.chart) {
            this.autoscaleYAxis();
        }
    }

    public readonly maColors: Record<string, string> = DEFAULT_MAIN_MA_CONFIGS
        .reduce<Record<string, string>>((acc, cfg) => {
            if (cfg?.id && cfg?.color) {
                acc[cfg.id] = cfg.color;
            }
            return acc;
        }, {});

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

        // Clamp the X-axis domain to the actual data window so the
        // scrollbar/zoom cannot move into regions without price+RS data.
        const firstX = data[0].x;
        const lastX = data[data.length - 1].x;
        if (chart.primaryXAxis) {
            const paddingMs = 3 * 24 * 60 * 60 * 1000;
            const paddedMax = new Date((lastX as Date).getTime() + paddingMs);
            chart.primaryXAxis.minimum = firstX as any;
            chart.primaryXAxis.maximum = paddedMax as any;
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
        }

        // For reused chart instances (e.g. moving between main and filmstrip),
        // still autoscale once when data is present.
        this.autoscaleYAxis();

        // Note: we previously attached custom mouseenter/mouseleave handlers
        // to the Syncfusion zoom toolbar here to toggle tooltip.enable and
        // call chart.dataBind(). That extra data binding could race with
        // Syncfusion's own async DOM updates and surface internal
        // querySelector null errors in their helper.js. We now rely on the
        // default Syncfusion behavior instead.
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
            // NOTE: we no longer force our own Y-axis autoscaling here and
            // let Syncfusion handle vertical scaling based on its internal
            // zoom/scroll state. The helpers autoscaleYAxis* remain
            // available if we decide to re-enable custom behavior later.
        }
        
    }

    onZoomComplete(event: IZoomCompleteEventArgs): void {
        // Update zoomFactor and zoomPosition to reflect the new visible range
        if (this.chart && this.chart.primaryXAxis && event.currentVisibleRange) {
            const data = this.chartData();
            const total = data.length;
            const min = toTimestamp(event.currentVisibleRange.min);
            const max = toTimestamp(event.currentVisibleRange.max);
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
                // console.log('rS oZC t.c.pXA.zF/zP: ', zoomFactor, zoomPosition);
            }
            
            // if (this.isMain()) {
            //     console.log('rS oSE min/max/startIdx/endIdx: ', min, max, startIdx, endIdx);
            //     console.log('rS oZC t.c.pXA.zF/zP: ', zoomFactor, zoomPosition);
            // }
        }
        // After zoom/pan/Reset we now rely on Syncfusion's native Y-axis
        // behavior instead of forcing our own autoscale. The helper
        // autoscaleYAxis remains for initial-load fitting only.
    }

    public autoscaleYAxis(): void {
        // console.log(`------------- RSC AYA ${this.name()} ------------------`);
        if (this.chart && !!this.chart?.primaryXAxis) {
            const baseline = this.config().showBaseline ? this.baselineData() : [];
            this.chart = autoscaleYAxis(this.chartData(), baseline, this.chart);
        }
    }
}
