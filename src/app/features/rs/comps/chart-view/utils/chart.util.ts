import { ChartComponent, VisibleRangeModel } from "@syncfusion/ej2-angular-charts";
import { CandleWithRSColor } from "../../../common/interfaces-rs";

export function getXExtents(range: VisibleRangeModel): {minX: number, maxX: number} {
    // console.log('------------- fn getXExtents ------------------');
    // console.log('fn gXE input range: ', range);
    const minX = range.min || 0;
    const maxX = range.max || 0;
    // console.log('fn gXE min/max: ', minX, maxX);
    return {minX, maxX};
}

export function autoscaleYAxis(data: CandleWithRSColor[], chartComponent: ChartComponent): ChartComponent | undefined {
    // console.log('------------- fn AYA autoscaleYAxis ------------------');
    // console.log('fn aYA input dataLength/data/component: ', data.length, data, chartComponent);
    if (!data.length || !chartComponent || !chartComponent.primaryXAxis) return;
    // Use Syncfusion's visible X range
    const xAxis = chartComponent.primaryXAxis;
    const xRange = (xAxis as any).visibleRange;
    // console.log('fn aYA xRange: ', xRange);
    if (!xRange) return;
    const minX = xRange.min;
    const maxX = xRange.max;
    // Log the visible X range
    // console.log('fn aYA Syncfusion visible X range:', minX, 'to', maxX);
    // Filter candles within visible X range
    const visible = data.filter((d) => {
        const xVal = d.x instanceof Date ? d.x.getTime() : d.x;
        return xVal >= minX && xVal <= maxX;
    });
    // console.log('fn aYA visible.length: ', visible.length);
    if (!visible.length) {
        // console.log('fn aYA No visible candles in current X range.');
        return;
    }
    const min = Math.min(...visible.map((d) => d.low));
    const max = Math.max(...visible.map((d) => d.high));
    // console.log('fn aYA min: ', min);
    // console.log('fn aYA max: ', max);
    const firstDate = visible[0]?.x;
    const lastDate = visible[visible.length - 1]?.x;
    // console.log('fn aYA Visible candle date range:', firstDate, 'to', lastDate);
    // console.log('fn aYA min/max in visible candles:', min, max);
    chartComponent.primaryYAxis.minimum = min;
    chartComponent.primaryYAxis.maximum = max;
    chartComponent.dataBind()
    // console.log('fn aYA Set chartComponent.primaryYAxis.maximum:', chartComponent.primaryYAxis.maximum);
    return chartComponent
}

export function autoscaleYAxisForRange(data: CandleWithRSColor[], chartComponent: ChartComponent, minX: number | Date, maxX: number | Date): ChartComponent | undefined {
    // console.log('------------- fn AYAFR autoscaleYAxisForRange ------------------');
    // console.log('fn aYAFR input dataLength/data/component: ', data.length, data, chartComponent);
    // console.log('fn aYAFR input min/max: ', data.length, data, chartComponent);
    if (!data.length) return;
    let minVal = typeof minX === 'number' ? minX : minX.getTime();
    let maxVal = typeof maxX === 'number' ? maxX : maxX.getTime();
    const visible = data.filter((d) => d.x instanceof Date && d.x.getTime() >= minVal && d.x.getTime() <= maxVal);
    if (!visible.length) return;
    const min = Math.min(...visible.map((d) => d.low));
    const max = Math.max(...visible.map((d) => d.high));
    const firstDate = visible[0]?.x;
    const lastDate = visible[visible.length - 1]?.x;
    // console.log('fn aYAFR Visible data range:', firstDate, 'to', lastDate);
    // console.log('fn aYAFR Highest high in visible data:', max);
    if (chartComponent && chartComponent.primaryYAxis) {
        chartComponent.primaryYAxis.minimum = min;
        chartComponent.primaryYAxis.maximum = max;
        // console.log('fn aYAFR Set chartComponent.primaryYAxis.maximum:', chartComponent.primaryYAxis.maximum);
    }
    return chartComponent;
}