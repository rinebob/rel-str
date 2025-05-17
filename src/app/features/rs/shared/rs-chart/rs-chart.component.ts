import { ChangeDetectionStrategy, Component, effect, input, ViewChild } from '@angular/core';
import {
    ChartModule,
    ChartComponent as SfChartComponent,
    CandleSeriesService,
    LineSeriesService,
    ColumnSeriesService,
    DateTimeService,
    TooltipService,
    LegendService,
    ScrollBarService,
    ZoomService,
    CrosshairService,
    LogarithmicService,
    IZoomCompleteEventArgs,
    IScrollEventArgs
} from '@syncfusion/ej2-angular-charts';

import { CandleWithRSColor, OHLCDatum, RsPaneDatum } from '../../common/interfaces-rs';
import { autoscaleYAxis, autoscaleYAxisForRange, getXExtents } from '../../comps/chart-view/utils/chart.util';
import { RS_CHART_CONFIG } from '../../common/constants-rs';

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
    // baselineData = input<OHLCDatum[]>();
    // rsData = input<RsPaneDatum[]>();

    // Chart configuration
    readonly CHART_CONFIG = RS_CHART_CONFIG;

    // title = 'Relative Strength Heatmap';

    constructor() {
        // effect(() => {
        //     console.log('rSC ctor eff chartData: ', this.name(), this.chartData());
        //     console.log('rSC ctor eff baselineData: ', this.name(), this.baselineData());
        //     console.log('rSC ctor eff rsData: ', this.name(), this.rsData());
        // })
    }

    /**
     * Automatically rescales the y-axis to fit the visible OHLC data range.
     * Called after zoom/pan or data load.
     */
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


    onChartLoaded(): void {
        // console.log('sCO oCL onChartLoaded called for: ', this.name());
        this.chart?.dataBind();
        this.autoscaleYAxis();
    }

    onScrollComplete(event: IScrollEventArgs) {
        // console.log('sCO oSC event: ', event);
        if (!event.range) return;
        const { minX, maxX } = getXExtents(event.range);
        this.autoscaleYAxisForRange(minX, maxX);
    }

    onZoomComplete(event: IZoomCompleteEventArgs) {
        // console.log('sCO oZC event: ', event);
        if (event && event.axis && event.axis.name === 'primaryXAxis' && event.currentVisibleRange) {
            // console.log('sCO oZC primaryXAxis zoom complete event: ', event);
            const { minX, maxX } = getXExtents(event.currentVisibleRange);
            // console.log('sCO oZC minX/maxX: ', minX, maxX);
            if (!!minX && !!maxX) {
                this.autoscaleYAxisForRange(minX, maxX);
            }

        } else {
            // console.log('sCO oZC no event/axis/currentVisibleRange - do nothing');        }
        }
    }
}
