import { ChangeDetectionStrategy, Component, effect, input, output, ViewChild } from '@angular/core';
import { ChartModule, ChartComponent as SfChartComponent, CandleSeriesService, LineSeriesService, ColumnSeriesService, DateTimeService, TooltipService, LegendService, ScrollBarService, ZoomService, CrosshairService, LogarithmicService, IZoomCompleteEventArgs, ChartComponent, VisibleRangeModel, IScrollEventArgs } from '@syncfusion/ej2-angular-charts';

import { CandleWithRSColor, OHLCDatum, RsPaneDatum } from '../../../common/interfaces-rs';
import { autoscaleYAxis, autoscaleYAxisForRange, getXExtents } from '../../chart-view/utils/chart.util';
import { RS_CHART_CONFIG } from '../../../common/constants-rs';

@Component({
  selector: 'rs-sync-chart-one',
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
  templateUrl: './sync-chart-one.component.html',
  styleUrl: './sync-chart-one.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SyncChartOneComponent {

    // Tried to use viewChild signal query but got error 'property set does not exist on type Signal<SfChartComponent>'
    @ViewChild('chartOne', { static: false }) chartOne?: SfChartComponent;
    zoomComplete = output<any>();

    // Candlestick chart
    chartData = input.required<CandleWithRSColor[]>();
    // compareData = input.required<OHLCDatum[]>();
    // rsData = input.required<RsPaneDatum[]>();
    compareData = input<OHLCDatum[]>();
    rsData = input<RsPaneDatum[]>();

    readonly CHART_CONFIG = RS_CHART_CONFIG;

    title = 'Relative Strength Heatmap';

    constructor() { 
        effect(() => {
            console.log('sCO ctor eff chartData: ', this.chartData());
        })
    }

    public autoscaleYAxis(): void {
        // console.log('------------- SCO AYA ------------------');
        if (this.chartOne && !!this.chartOne?.primaryXAxis) {
            this.chartOne = autoscaleYAxis(this.chartData(), this.chartOne);
        }
    }

    public autoscaleYAxisForRange(minX: number | Date, maxX: number | Date): void {
        // console.log('------------- SCO AYAFR ------------------');
        if (!!this.chartOne && !!this.chartOne.primaryXAxis) {
            this.chartOne = autoscaleYAxisForRange(this.chartData(), this.chartOne, minX, maxX);
        }
    }

    
    onChartLoaded(): void {
		// console.log('sCO oCL onChartLoaded called');
		this.chartOne?.dataBind();
		this.autoscaleYAxis();
	}

    onScrollComplete(event: IScrollEventArgs) {
        // console.log('sCO oSC event: ', event);
        if (!event.range) return;
        const {minX, maxX} = getXExtents(event.range);
        this.autoscaleYAxisForRange(minX, maxX);
    }

    onZoomComplete(event: IZoomCompleteEventArgs) {
        // console.log('sCO oZC event: ', event);
        if (event && event.axis && event.axis.name === 'primaryXAxis' && event.currentVisibleRange) {
            // console.log('sCO oZC primaryXAxis zoom complete event: ', event);
            const {minX, maxX} = getXExtents(event.currentVisibleRange);
            // console.log('sCO oZC minX/maxX: ', minX, maxX);
            if (!!minX && !!maxX) {
                this.autoscaleYAxisForRange(minX, maxX);
            }

        } else {
            // console.log('sCO oZC no event/axis/currentVisibleRange - do nothing');
        }
    }
}
