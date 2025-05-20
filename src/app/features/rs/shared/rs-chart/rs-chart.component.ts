import { ChangeDetectionStrategy, Component, effect, input, signal, ViewChild, computed } from '@angular/core';
import {
    ChartModule,
    ChartComponent as SfChartComponent,
    CandleSeriesService,
    ColumnSeriesService,
    CrosshairService,
    DateTimeService,
    ILoadedEventArgs,
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
import { Axis } from '@syncfusion/ej2-charts';
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
    zoomEnabled = input(true);

    // Chart configuration
    config = input.required<RsChartConfig>();
    
    constructor() {
        // Track input changes
        effect(() => {
            try {
                console.group('Chart Inputs Changed for: ', this.name());
                console.log('Chart Data Length:', this.chartData()?.length);
                console.log('Baseline Data Length:', this.baselineData()?.length);
                console.log('RS Data Length:', this.rsData()?.length);
                console.log('Config Available:', !!this.config());
                console.groupEnd();
            } catch (e) {
                console.error('Error logging inputs:', e);
            }
        });
    }
    
    // Get the date range from chart data
    private getDateRange(data: CandleWithRSColor[]): { min: Date; max: Date } {
        if (!data || data.length === 0) {
            const now = new Date();
            return { min: now, max: now };
        }

        const dates = data.map(d => d.x instanceof Date ? d.x : new Date(d.x));
        return {
            min: new Date(Math.min(...dates.map(d => d.getTime()))),
            max: new Date(Math.max(...dates.map(d => d.getTime())))
        };
    }

    // Chart configuration signal
    private chartConfigSignal = computed(() => {
        console.log('rSC chartConfigSignal called');
        try {
            const baseConfig = this.config()?.chartConfig || RS_CHART_CONFIG;
            const dataRange = this.getDateRange(this.chartData());

            // Ensure we have valid dates
            if (!(dataRange.min instanceof Date) || !(dataRange.max instanceof Date) ||
                isNaN(dataRange.min.getTime()) || isNaN(dataRange.max.getTime())) {
                console.error('Invalid date range in chart config', dataRange);
                return RS_CHART_CONFIG;
            }

            // Calculate initial visible range (last 3 months by default)
            const initialEnd = new Date(dataRange.max);
            const initialStart = new Date(initialEnd);
            initialStart.setMonth(initialEnd.getMonth() - 3);

            // Create base config with scrollbar settings in primaryXAxis
            return {
                ...baseConfig,
                // Zoom settings at the chart level
                zoomSettings: {
                    enableMouseWheelZooming: this.zoomEnabled(),
                    enablePinchZooming: this.zoomEnabled(),
                    enableSelectionZooming: this.zoomEnabled(),
                    enablePan: true,
                    mode: 'X',
                    enableScrollbar: true
                },
                // Scrollbar settings in primaryXAxis
                primaryXAxis: {
                    ...baseConfig.primaryXAxis,
                    enableAutoIntervalOnZooming: true,
                    scrollbarSettings: {
                        enable: true,
                        height: 12,
                        trackColor: '#f5f5f5',
                        scrollbarColor: '#d8d8d8',
                        scrollbarRadius: 5,
                        gripColor: '#a6a6a6',
                        range: {
                            minimum: dataRange.min,
                            maximum: dataRange.max
                        }
                    }
                }
            };
            
        } catch (error) {
            console.error('Error in chartConfig signal:', error);
            return RS_CHART_CONFIG;
        }
    });

    // Public readonly signal accessor
    public readonly chartConfig = this.chartConfigSignal;

    // Track the last visible range to prevent duplicate updates
    private lastRange = signal<{ min: number; max: number } | null>(null);
    
    // Track if initial visible range has been set
    private initialRangeSet = false;
    
    private loadStartTime = 0;
    
    onChartLoaded(): void {
        if (!this.chart) return;
        
        try {
            // Only set initial range on first load
            if (!this.initialRangeSet) {
                this.initialRangeSet = true;
                
                // Set initial visible range (last 3 months)
                const chartData = this.chartData();
                if (chartData && chartData.length > 0) {
                    const dataRange = this.getDateRange(chartData);
                    const initialEnd = new Date(dataRange.max);
                    const initialStart = new Date(initialEnd);
                    initialStart.setMonth(initialEnd.getMonth() - 3);
                    
                    // Set the primary X axis range
                    if (this.chart.primaryXAxis) {
                        (this.chart.primaryXAxis as any).visibleRange = {
                            min: initialStart.getTime(),
                            max: initialEnd.getTime()
                        };
                    }
                }
            }
            
            this.autoscaleYAxis();
        } catch (error) {
            console.error('Error in onChartLoaded:', error);
        } finally {
            // Reset load start time
            this.loadStartTime = 0;
        }
    }

    onScrollEnd(event: IScrollEventArgs): void {
        if (!this.chart) return;
        
        const axis = this.chart.primaryXAxis as Axis;
        const visibleRange = (axis as any).visibleRange as { min: number; max: number } | undefined;
        if (!visibleRange) return;
        
        const currentRange = {
            min: visibleRange.min,
            max: visibleRange.max
        };
        
        // Skip if range hasn't changed
        const lastRange = this.lastRange();
        if (lastRange?.min === currentRange.min && 
            lastRange?.max === currentRange.max) {
            return;
        }
        
        this.lastRange.set(currentRange);
        
        try {
            const { minX, maxX } = getXExtents(visibleRange);
            this.autoscaleYAxisForRange(minX, maxX);
        } catch (error) {
            console.error('Error in onScrollEnd:', error);
        }
    }

    onZoomComplete(event: IZoomCompleteEventArgs): void {
        const axis = event.axis as Axis;
        if (!axis || axis.name !== 'primaryXAxis' || !this.chart) {
            return;
        }
        
        const visibleRange = (axis as any).visibleRange as { min: number; max: number } | undefined;
        if (!visibleRange) return;
        
        const currentRange = {
            min: visibleRange.min,
            max: visibleRange.max
        };
        
        // Skip if range hasn't changed
        const lastRange = this.lastRange();
        if (lastRange?.min === currentRange.min && 
            lastRange?.max === currentRange.max) {
            return;
        }
        
        this.lastRange.set(currentRange);
        
        try {
            const { minX, maxX } = getXExtents(visibleRange);
            this.autoscaleYAxisForRange(minX, maxX);
        } catch (error) {
            console.error('Error in onZoomComplete:', error);
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
