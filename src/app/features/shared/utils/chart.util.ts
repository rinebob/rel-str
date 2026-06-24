import { ChartComponent, VisibleRangeModel } from '@syncfusion/ej2-angular-charts';
import type { CandleWithRSColor, OHLCDatum } from '../types/rs.interfaces';

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
  chartComponent: ChartComponent,
  refresh = false
): ChartComponent | undefined {
  if (!chartData.length || !chartComponent || !chartComponent.primaryXAxis) return;

  const xAxis = chartComponent.primaryXAxis;
  const xRange = (xAxis as any).visibleRange;
  if (!xRange) return;

  const minX = xRange.min;
  const maxX = xRange.max;

  const filterVisible = <T extends OHLCDatum>(data: T[]): T[] =>
    data.filter((d) => {
      const xVal = d.x instanceof Date ? d.x.getTime() : (d.x as number);
      return xVal >= minX && xVal <= maxX;
    });

  const visibleChartData = filterVisible(chartData);
  const visibleBaselineData = baselineData ? filterVisible(baselineData) : [];
  if (!visibleChartData.length && !visibleBaselineData.length) return;

  const allVisibleData = [...visibleChartData, ...visibleBaselineData];
  const lows = allVisibleData.map((d) => d.low).filter((v) => Number.isFinite(v));
  const highs = allVisibleData.map((d) => d.high).filter((v) => Number.isFinite(v));
  if (!lows.length || !highs.length) return;

  const min = Math.min(...lows);
  const max = Math.max(...highs);

  if (chartComponent.primaryYAxis) {
    chartComponent.primaryYAxis.minimum = min;
    chartComponent.primaryYAxis.maximum = max;
  }
  
  if (refresh) {
      chartComponent.dataBind();
  }

  return chartComponent;
}

// Autoscale primary Y-axis to a provided x-range (minX/maxX)
export function autoscaleYAxisForRange(
  chartData: CandleWithRSColor[],
  baselineData: OHLCDatum[],
  chartComponent: ChartComponent,
  minX: number | Date,
  maxX: number | Date,
  refresh = false
): ChartComponent | undefined {
  if (!chartData.length) return;

  const minVal = typeof minX === 'number' ? minX : minX.getTime();
  const maxVal = typeof maxX === 'number' ? maxX : maxX.getTime();

  const filterVisible = <T extends OHLCDatum>(data: T[]): T[] =>
    data.filter((d) => {
      const xVal = d.x instanceof Date ? d.x.getTime() : (d.x as number);
      return xVal >= minVal && xVal <= maxVal;
    });

  const visibleChartData = filterVisible(chartData);
  const visibleBaselineData = baselineData ? filterVisible(baselineData) : [];
  if (!visibleChartData.length && !visibleBaselineData.length) return;

  const allVisibleData = [...visibleChartData, ...visibleBaselineData];
  const rawMin = Math.min(...allVisibleData.map((d) => d.low));
  const rawMax = Math.max(...allVisibleData.map((d) => d.high));
  const pad = (rawMax - rawMin) * 0.03;
  const min = rawMin - pad;
  const max = rawMax + pad;

  if (chartComponent?.primaryYAxis) {
    // Prevent infinite loops and unnecessary re-renders:
    // If the axis range is already set to these values, do nothing.
    if (chartComponent.primaryYAxis.minimum === min && chartComponent.primaryYAxis.maximum === max) {
        return chartComponent;
    }

    chartComponent.primaryYAxis.minimum = min;
    chartComponent.primaryYAxis.maximum = max;
  }
  
  if (refresh) {
      chartComponent.dataBind();
  }

  return chartComponent;
}