import { ChartComponent, VisibleRangeModel } from '@syncfusion/ej2-angular-charts';
import type { CandleWithRSColor, OHLCDatum } from '../../shared/types/rs.interfaces';

// Helper to convert Date/number to timestamp for safe comparison
export function toTimestamp(val: unknown): number {
    if (val instanceof Date) return val.getTime();
    if (typeof val === 'number') return val;
    return NaN;
}

// Returns min/max x extents from a Syncfusion VisibleRange
export function getXExtents(range: VisibleRangeModel): { minX: number; maxX: number } {
    const minX = range.min || 0;
    const maxX = range.max || 0;
    return { minX, maxX };
}

// Autoscale primary Y-axis to the visible X range on the chart
export function autoscaleYAxis(
    chartData: CandleWithRSColor[],
    baselineData: OHLCDatum[],
    chartComponent: ChartComponent
): ChartComponent | undefined {
    if (!chartData.length || !chartComponent || !chartComponent.primaryXAxis) return;

    const xAxis = chartComponent.primaryXAxis;
    const xRange = (xAxis as any).visibleRange;
    if (!xRange) return;

    const minX = xRange.min;
    const maxX = xRange.max;

    const filterVisible = <T extends OHLCDatum>(data: T[]): T[] =>
        data.filter((d) => {
            const xVal = d.x instanceof Date ? d.x.getTime() : d.x as number;
            return xVal >= minX && xVal <= maxX;
        });

    const visibleChartData = filterVisible(chartData);
    const visibleBaselineData = baselineData ? filterVisible(baselineData) : [];
    if (!visibleChartData.length && !visibleBaselineData.length) return;

    const allVisibleData = [...visibleChartData, ...visibleBaselineData];
    const min = Math.min(...allVisibleData.map((d) => d.low));
    const max = Math.max(...allVisibleData.map((d) => d.high));

    chartComponent.primaryYAxis.minimum = min;
    chartComponent.primaryYAxis.maximum = max;
    chartComponent.dataBind();
    return chartComponent;
}

// Autoscale primary Y-axis to a provided x-range (minX/maxX)
export function autoscaleYAxisForRange(
    chartData: CandleWithRSColor[],
    baselineData: OHLCDatum[],
    chartComponent: ChartComponent,
    minX: number | Date,
    maxX: number | Date
): ChartComponent | undefined {
    if (!chartData.length) return;

    const minVal = typeof minX === 'number' ? minX : minX.getTime();
    const maxVal = typeof maxX === 'number' ? maxX : maxX.getTime();

    const filterVisible = <T extends OHLCDatum>(data: T[]): T[] =>
        data.filter((d) => {
            const xVal = d.x instanceof Date ? d.x.getTime() : d.x as number;
            return xVal >= minVal && xVal <= maxVal;
        });

    const visibleChartData = filterVisible(chartData);
    const visibleBaselineData = baselineData ? filterVisible(baselineData) : [];
    if (!visibleChartData.length && !visibleBaselineData.length) return;

    const allVisibleData = [...visibleChartData, ...visibleBaselineData];
    const min = Math.min(...allVisibleData.map((d) => d.low));
    const max = Math.max(...allVisibleData.map((d) => d.high));

    if (chartComponent?.primaryYAxis) {
        chartComponent.primaryYAxis.minimum = min;
        chartComponent.primaryYAxis.maximum = max;
    }
    return chartComponent;
}