import { ChangeDetectionStrategy, Component, effect, ElementRef, input, signal, viewChild } from '@angular/core';
import {
    ChartModule,
    ChartComponent as SfChartComponent,
    CandleSeriesService,
    ColumnSeriesService,
    CrosshairService,
    DateTimeService,
    IScrollEventArgs,
    ITooltipRenderEventArgs,
    IZoomCompleteEventArgs,
    LegendService,
    LineSeriesService,
    LogarithmicService,
    ScrollBarService,
    TooltipService,
    ZoomService,
} from '@syncfusion/ej2-angular-charts';
import { MatTooltip, MatTooltipModule } from '@angular/material/tooltip';

import { CandleWithRSColor, MaSeriesPoint, MainMaId, OHLCDatum, RsChartConfig, RsPaneDatum, Timeframe } from '../../../shared/types/rs.interfaces';
import { DEFAULT_MAIN_MA_CONFIGS, MAIN_CHART_INITIAL_DAYS, SMALL_CHART_INITIAL_DAYS } from '../../../shared/constants/rs.constants';
import { autoscaleYAxis, autoscaleYAxisForRange } from '../../utils/chart.util';
import { isSameDay, toDate, toTimestamp } from '../../utils/date.util';

@Component({
    selector: 'rs-chart',
    imports: [ChartModule, MatTooltipModule],
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
    chart = viewChild<SfChartComponent>('chart');
    container = viewChild<ElementRef<HTMLDivElement>>('container');
    mainTooltip = viewChild<MatTooltip>('mainTooltip');

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

    public readonly MainMaId = MainMaId;
    
    // Custom main-chart tooltip state
    mainTooltipText = signal<string | null>(null);
    mainTooltipX = signal<number | null>(null);
    mainTooltipY = signal<number | null>(null);

    isInitialLoad = signal<boolean>(true);

    private lastTimeframe?: Timeframe;

    constructor() {
        // Reset initial-load zoom behavior whenever the timeframe changes so
        // switching D/W/M recalculates zoomFactor/position and scrollbar.
        effect(() => {
            const cfg = this.config();
            const timeframe = cfg.timeframe as Timeframe | undefined;
            if (this.lastTimeframe !== timeframe) {
                this.lastTimeframe = timeframe;
                this.isInitialLoad.set(true);
            }
        });

        effect(() => {
            const shouldInit = this.isInitialLoad();
            const data = this.chartData();
            const chart = this.chart();

            console.log('rC eff chartData: ', data);
            // console.log('rC eff rsData: ', this.rsData());
            if (!shouldInit || !chart || !data || !data.length) {
                return;
            }
            const cfg = this.config();
            const timeframe = cfg.timeframe as Timeframe | undefined;
            this.applyInitialZoom(data, timeframe);
            this.isInitialLoad.set(false);
        });
    }

    public readonly maColors: Record<string, string> = DEFAULT_MAIN_MA_CONFIGS
        .reduce<Record<string, string>>((acc, cfg) => {
            if (cfg?.id && cfg?.color) {
                acc[cfg.id] = cfg.color;
            }
            return acc;
        }, {});

    onChartLoaded(): void {
        try {
            // eslint-disable-next-line no-console
            console.log('[RsChartComponent] onChartLoaded', {
                id: this.id(),
                name: this.name(),
                isMain: this.isMain(),
            });
        } catch {
            // ignore logging errors
        }

        // Syncfusion may fire loaded multiple times; only act on the first.
        if (!this.isInitialLoad()) {
            return;
        }

        const chart = this.chart();
        if (!chart) {
            return;
        }

        const data = this.chartData();
        if (!data || !data.length) {
            // this.isInitialLoad.set(false);
            return;
        }

        const cfg = this.config();
        const timeframe = cfg.timeframe as Timeframe | undefined;
        this.applyInitialZoom(data, timeframe);

        this.isInitialLoad.set(false);
    }

    onScrollEnd(event: IScrollEventArgs): void {
        // console.log(`----- RSC oSE onScrollEnd ${this.id()} ---------`);
        // console.log('rS oSE event: ', event);
        if (!event.range) {
            return;
        }
        
        const chart = this.chart();
        if (!chart || !chart.primaryXAxis) {
            return;
        }

        // Update zoomFactor and zoomPosition to reflect the new visible range
        if (event.range) {
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
                chart.primaryXAxis.zoomFactor = zoomFactor;
                chart.primaryXAxis.zoomPosition = zoomPosition;
                
            } else {
                // console.log('rs oSE scroll end bypassing axis zoom settings calcs')
            }
            // Syncfusion's native behavior with ZoomMode='X' scales Y based on the entire dataset.
            // We manually rescale here to fit the Y-axis to the currently visible data points.
            // Pass empty array for baseline so Y-axis scales only to the target symbol's price
            autoscaleYAxisForRange(this.chartData(), [], chart, min, max, true);
        }
        
    }

    onZoomComplete(event: IZoomCompleteEventArgs): void {
        const chart = this.chart();
        if (!chart || !chart.primaryXAxis) {
            return;
        }

        // Update zoomFactor and zoomPosition to reflect the new visible range
        if (event.currentVisibleRange) {
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

                chart.primaryXAxis.zoomFactor = zoomFactor;
                chart.primaryXAxis.zoomPosition = zoomPosition;
                // console.log('rS oZC t.c.pXA.zF/zP: ', zoomFactor, zoomPosition);
            }
            
            // Pass empty array for baseline so Y-axis scales only to the target symbol's price
            autoscaleYAxisForRange(this.chartData(), [], chart, min, max, true);
        }
    }

    public autoscaleYAxis(): void {
        // console.log(`------------- RSC AYA ${this.name()} ------------------`);
        const chart = this.chart();
        if (chart && !!chart.primaryXAxis) {
            // Pass empty array for baseline so Y-axis scales only to the target symbol's price
            autoscaleYAxis(this.chartData(), [], chart);
        }
    }

    private applyInitialZoom(data: CandleWithRSColor[], timeframe: Timeframe | undefined): void {
        const chart = this.chart();
        if (!chart || !data || !data.length) {
            return;
        }

        // Clamp the X-axis domain to the actual data window so the
        // scrollbar/zoom cannot move into regions without price+RS data.
        const firstX = data[0].x;
        const lastX = data[data.length - 1].x;
        if (chart.primaryXAxis) {
            const paddingMs = 3 * 24 * 60 * 60 * 1000; //3 days
            const paddedMax = new Date((lastX as Date).getTime() + paddingMs);
            chart.primaryXAxis.minimum = firstX as any;
            chart.primaryXAxis.maximum = paddedMax as any;
        }

        const daysToShow = this.isMain()
            ? this.getInitialVisibleCount(timeframe)
            : SMALL_CHART_INITIAL_DAYS;

        // Initial zoom window for newly created chart instances. To ensure the
        // scrollbar and zoom-out/reset controls are always available (even when
        // the total number of points is small), we force a visible window that
        // is strictly smaller than the full data length whenever there are at
        // least two points. This keeps zoomFactor < 1, which in turn keeps the
        // scrollbar and toolbar active across all timeframes.
        let minX: Date;
        let maxX: Date;

        if (chart.primaryXAxis && data.length > 1) {
            const maxVisibleCount = daysToShow;

            // Ensure we always leave at least one bar outside the initial
            // window when possible so zoomFactor stays < 1.
            const capped = Math.min(maxVisibleCount, data.length - 1);
            const visibleCount = Math.max(1, capped);

            const zoomFactor = visibleCount / data.length;
            const zoomPosition = (data.length - visibleCount) / data.length;

            chart.primaryXAxis.zoomFactor = zoomFactor;
            chart.primaryXAxis.zoomPosition = zoomPosition;

            // Calculate explicit range for Y-axis scaling based on the
            // currently visible window.
            minX = data[data.length - visibleCount].x as Date;
            maxX = data[data.length - 1].x as Date;
        } else {
            minX = data[0].x as Date;
            maxX = data[data.length - 1].x as Date;
        }

        // Perform a one-time Y-axis autoscale for the initial visible
        // window on both main and small/car charts so price action fits
        // the clamped/zoomed X-range. Follow‑up scroll/zoom interactions
        // continue to rely on Syncfusion's native behavior.
        // Pass empty array for baseline so Y-axis scales only to the target symbol's price
        autoscaleYAxisForRange(this.chartData(), [], chart, minX, maxX, true);
    }

    public zoomShowAll(): void {
        const chart = this.chart();
        const data = this.chartData();
        if (!chart || !chart.primaryXAxis || !data || !data.length) {
            return;
        }

        chart.primaryXAxis.zoomFactor = 1;
        chart.primaryXAxis.zoomPosition = 0;

        const minX = data[0].x as Date;
        const maxX = data[data.length - 1].x as Date;
        autoscaleYAxisForRange(this.chartData(), [], chart, minX, maxX, true);
    }

    public zoomToEnd(): void {
        const chart = this.chart();
        const data = this.chartData();
        if (!chart || !chart.primaryXAxis || !data || data.length === 0) {
            return;
        }
        const cfg = this.config();
        const timeframe = cfg.timeframe as Timeframe | undefined;
        const daysToShow = this.getInitialVisibleCount(timeframe);

        let minX: Date;
        let maxX: Date;

        if (data.length > daysToShow) {
            const zoomFactor = daysToShow / data.length;
            const zoomPosition = (data.length - daysToShow) / data.length;

            chart.primaryXAxis.zoomFactor = zoomFactor;
            chart.primaryXAxis.zoomPosition = zoomPosition;

            minX = data[data.length - daysToShow].x as Date;
            maxX = data[data.length - 1].x as Date;
        } else {
            chart.primaryXAxis.zoomFactor = 1;
            chart.primaryXAxis.zoomPosition = 0;
            minX = data[0].x as Date;
            maxX = data[data.length - 1].x as Date;
        }

        autoscaleYAxisForRange(this.chartData(), [], chart, minX, maxX, true);
    }

    // For the MAIN chart, decode the hovered X position into a Date and update
    // the custom Material tooltip text/position based on the NEAREST price
    // bar. This keeps the tooltip stable even when the cursor is not directly
    // over a specific candlestick.
    public onChartMouseMove(event: any): void {
        if (!this.isMain()) {
            return;
        }

        const axisValue = event?.axisData?.primaryXAxis;
        if (typeof axisValue !== 'number') {
            // Keep showing the last tooltip; do not clear on noisy moves.
            return;
        }

        const hoveredDate = new Date(axisValue);
        if (!(hoveredDate instanceof Date) || Number.isNaN(hoveredDate.getTime())) {
            return;
        }

        const priceBars = this.chartData();
        if (!priceBars || !priceBars.length) {
            return;
        }

        // Snap to the nearest price bar by time so the tooltip does not
        // disappear when the cursor is between bars.
        let nearestIndex = 0;
        let nearest = priceBars[0];
        let nearestDiff = Math.abs((nearest.x as Date).getTime() - hoveredDate.getTime());
        for (let i = 1; i < priceBars.length; i += 1) {
            const candidate = priceBars[i];
            const diff = Math.abs((candidate.x as Date).getTime() - hoveredDate.getTime());
            if (diff < nearestDiff) {
                nearest = candidate;
                nearestDiff = diff;
                nearestIndex = i;
            }
        }

        const bar = nearest;

        // Always use the snapped bar's X value as the canonical date for
        // display and MA lookups so weekly/monthly charts only show real bar
        // dates and never interpolated intra-bar dates.
        const barDate = bar.x as Date;

        const rsRaw = typeof (bar as any).rsRaw === 'number' ? (bar as any).rsRaw as number : undefined;

        // Previous-bar RS for this timeframe (e.g. previous day / week /
        // month / 2-day bar). This is derived purely from the current
        // chartData series so it always matches the active timeframe.
        const prevBar = nearestIndex > 0 ? priceBars[nearestIndex - 1] : undefined;
        const prevRsRaw = typeof (prevBar as any)?.rsRaw === 'number'
            ? (prevBar as any).rsRaw as number
            : undefined;

        const weekdayShortNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        // Use UTC components so the displayed date matches the canonical
        // yyyy-mm-dd string coming from the backend (which is interpreted as
        // UTC midnight). This avoids local-timezone shifts that can show the
        // previous calendar day for month-end bars.
        const year = barDate.getUTCFullYear();
        const month = barDate.getUTCMonth() + 1;
        const day = barDate.getUTCDate();
        const weekdayIndex = barDate.getUTCDay();
        const weekday = weekdayShortNames[weekdayIndex] ?? '';

        const yyyy = String(year);
        const mm = month < 10 ? `0${month}` : String(month);
        const dd = day < 10 ? `0${day}` : String(day);
        const isoLike = `${yyyy}-${mm}-${dd}`;

        const rsText = typeof rsRaw === 'number' ? rsRaw.toFixed(5) : '(no data)';
        const prevRsText = typeof prevRsRaw === 'number' ? prevRsRaw.toFixed(5) : null;

        const open = bar.open;
        const high = bar.high;
        const low = bar.low;
        const close = bar.close;

        const maSeries = this.mainMaSeries();
        const ma1Point = maSeries[MainMaId.MA1]?.find((p) => isSameDay(p.x, barDate));
        const ma2Point = maSeries[MainMaId.MA2]?.find((p) => isSameDay(p.x, barDate));
        const ma3Point = maSeries[MainMaId.MA3]?.find((p) => isSameDay(p.x, barDate));

        const lines: string[] = [];
        lines.push(`${isoLike} (${weekday})`);
        lines.push(`Open: ${open}`);
        lines.push(`High: ${high}`);
        lines.push(`Low: ${low}`);
        lines.push(`Close: ${close}`);
        if (typeof ma1Point?.y === 'number') {
            lines.push(`MA 1: ${ma1Point.y}`);
        }
        if (typeof ma2Point?.y === 'number') {
            lines.push(`MA 2: ${ma2Point.y}`);
        }
        if (typeof ma3Point?.y === 'number') {
            lines.push(`MA 3: ${ma3Point.y}`);
        }
        if (prevRsText !== null) {
            lines.push(`Prev RS: ${prevRsText}`);
        }
        lines.push(`RS: ${rsText}`);

        const tooltip = lines.join('\n');

        this.mainTooltipText.set(tooltip);

        const containerEl = this.container()?.nativeElement;
        if (containerEl && typeof event.x === 'number' && typeof event.y === 'number') {
            const rect = containerEl.getBoundingClientRect();
            // Offset so the tooltip appears to the right and slightly above
            // the cursor, reducing overlap between pointer and tooltip.
            this.mainTooltipX.set(event.x - rect.left + 24);
            this.mainTooltipY.set(event.y - rect.top - 24);
        } else {
            this.mainTooltipX.set(null);
            this.mainTooltipY.set(null);
        }

        const tooltipRef = this.mainTooltip();
        if (tooltipRef) {
            tooltipRef.message = tooltip;
            tooltipRef.show();
        }
    }

    // Hide the custom main-chart tooltip when the mouse leaves the chart
    // surface entirely.
    public onChartMouseLeave(): void {
        if (!this.isMain()) {
            return;
        }
        this.clearMainTooltip();
    }

    private clearMainTooltip(): void {
        this.mainTooltipText.set(null);
        this.mainTooltipX.set(null);
        this.mainTooltipY.set(null);

        const tooltipRef = this.mainTooltip();
        if (tooltipRef) {
            tooltipRef.hide();
        }
    }

    public onTooltipRender(args: ITooltipRenderEventArgs): void {
        // Minimal experiment: log when tooltipRender fires and prepend a dummy
        // test line to ANY tooltip. If this never logs for the main chart,
        // then Syncfusion is bypassing this handler for that instance.
        try {
            // eslint-disable-next-line no-console
            console.log('[RsChartComponent] tooltipRender', {
                id: this.id(),
                name: this.name(),
                isMain: this.isMain(),
                seriesName: args.series?.name,
                originalText: args.text,
            });
        } catch {
            // ignore logging errors
        }

        const existing = args.text ?? '';
        const testPrefix = 'TEST TOOLTIP LINE';

        args.text = existing ? `${testPrefix}\n${existing}` : testPrefix;

        // Only customize the RS series line; leave price/MA lines as-is.
        if (args.series?.name !== 'RS') {
            return;
        }

        const rawX = args.point?.x as Date | number | string | null | undefined;
        const date = toDate(rawX);

        if (!date) {
            return;
        }

        const weekdayShortNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        const weekdayIndex = date.getDay();
        const weekday = weekdayShortNames[weekdayIndex] ?? '';

        const yyyy = String(year);
        const mm = month < 10 ? `0${month}` : String(month);
        const dd = day < 10 ? `0${day}` : String(day);
        const isoLike = `${yyyy}-${mm}-${dd}`;

        const rsValue = args.point?.y as number | null | undefined;
        const rsText = typeof rsValue === 'number' ? String(rsValue) : '';

        // Replace the RS line text with full date + raw RS value.
        args.text = rsText ? `${isoLike} (${weekday})\nRS: ${rsText}` : `${isoLike} (${weekday})`;
    }

    private getInitialVisibleCount(timeframe: Timeframe | undefined): number {
        switch (timeframe) {
            case Timeframe.WEEKLY:
                // Show roughly 2 years of weekly bars by default.
                return 104;
            case Timeframe.MONTHLY:
                // Show roughly 3 years of monthly bars by default.
                return 36;
            case Timeframe.TWO_DAY:
            case Timeframe.DAILY:
            default:
                // Keep existing daily/2D behavior (~1 year window).
                return MAIN_CHART_INITIAL_DAYS;
        }
    }
}
