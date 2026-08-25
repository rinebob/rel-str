/**
 * Savant Trader Chart Indicators — Callable indicator data conversion
 *
 * Converts backend indicator data (zones, trend-strength, trend-bands) into
 * the chart-ready shapes expected by the flex-chart indicator configs.
 */
import type { IndicatorConfig, PriceBar } from '../../../../features/shared/components/flex-chart/flex-chart.types';
import { StIndicator } from '../../../../features/shared/components/flex-chart/flex-chart.types';
import type { BandSeriesData } from '../../../../features/shared/components/flex-chart/indicators/st-trend-bands.indicator';
import type { IntervalData, TrendBandsPoint, TrendStrengthPoint, ZoneV1Point, ZoneV2Point } from '../../common/indicator.types';
import { toDatePt } from '../../utils/utils';
import type { ChartScatterPoint } from './base-indicators';

function toDate(d: string): Date {
  return toDatePt(d);
}

function zoneColor(zone: number): string {
  const ZONE_COLORS: Record<number, string> = {
    4: '#0d47a1',
    3: '#2196f3',
    2: '#4caf50',
    1: '#81c784',
    0: '#9e9e9e',
    [-1]: '#e57373',
    [-2]: '#f44336',
    [-3]: '#e91e63',
    [-4]: '#b71c1c',
  };
  return ZONE_COLORS[zone] || '#9e9e9e';
}

function zoneToChartData(
  points: ZoneV1Point[] | ZoneV2Point[],
): ChartScatterPoint[] {
  return points
    .filter(p => p.zone !== null && Number.isFinite(p.zone))
    .map(p => {
      const zone = p.zone as number;
      return { x: toDate(p.d), y: zone, color: zoneColor(zone) };
    });
}

function trendStrengthToChartData(
  points: TrendStrengthPoint[],
): { x: Date; y: number; y2: number; y3: number; color: string }[] {
  return points
    .filter(p => p.diPlus !== null && p.diMinus !== null && p.diHist !== null)
    .map(p => {
      const diHist = p.diHist as number;
      return {
        x: toDate(p.d),
        y: diHist,
        y2: p.diPlus as number,
        y3: p.diMinus as number,
        color: diHist >= 0 ? '#2196f3' : '#ffeb3b',
      };
    });
}

function trendBandsToChartData(
  points: TrendBandsPoint[],
  bars: PriceBar[],
): BandSeriesData[] {
  if (points.length === 0 || bars.length === 0) return [];

  const dateToIndex = new Map<string, number>();
  for (let i = 0; i < bars.length; i++) {
    const d = (bars[i] as any).date ?? bars[i].x;
    const dateStr = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
    dateToIndex.set(dateStr, i);
  }

  const bandMap = new Map<number, { bandIndex: number; bullColor: string; bearColor: string; data: { index: number; open: number; high: number; low: number; close: number }[] }>();

  for (const p of points) {
    const index = dateToIndex.get(p.d);
    if (index === undefined) continue;
    for (const b of p.bands) {
      if (b.open === null || b.high === null || b.low === null || b.close === null) continue;
      const idx = b.bandIndex;
      if (!bandMap.has(idx)) {
        bandMap.set(idx, {
          bandIndex: idx,
          bullColor: b.bullColor,
          bearColor: b.bearColor,
          data: [],
        });
      }
      bandMap.get(idx)!.data.push({ index, open: b.open, high: b.high, low: b.low, close: b.close });
    }
  }

  return Array.from(bandMap.values()).sort((a, b) => a.bandIndex - b.bandIndex);
}

/** Convert one interval of the callable response into chart-ready data. */
export function convertIntervalIndicators(
  intervalData: IntervalData | undefined,
  bars: PriceBar[],
): {
  zoneV1: ChartScatterPoint[];
  zoneV2: ChartScatterPoint[];
  trendStrength: { x: Date; y: number; y2: number; y3: number; color: string }[];
  trendBands: BandSeriesData[];
} {
  const zoneV1 = intervalData?.indicators?.zoneV1 ?? [];
  const zoneV2 = intervalData?.indicators?.zoneV2 ?? [];
  const trendStrength = intervalData?.indicators?.trendStrength ?? [];
  const trendBands = intervalData?.indicators?.trendBands ?? [];
  return {
    zoneV1: zoneToChartData(zoneV1),
    zoneV2: zoneToChartData(zoneV2),
    trendStrength: trendStrengthToChartData(trendStrength),
    trendBands: trendBandsToChartData(trendBands, bars),
  };
}

/**
 * Inject callable indicator data into the base indicator configs for a single interval.
 * Always overwrites the config data with the backend response, even when empty, so the
 * flex chart never silently falls back to its inline calculator. If backend data is missing
 * the chart will show an empty series and the gap is visible.
 */
export function injectCallableIndicatorData(
  indicators: IndicatorConfig[],
  intervalData: IntervalData | undefined,
  bars: PriceBar[],
): IndicatorConfig[] {
  const converted = convertIntervalIndicators(intervalData, bars);
  return indicators.map(cfg => {
    switch (cfg.type) {
      case StIndicator.ZONE:
        return { ...cfg, data: converted.zoneV1 };
      case StIndicator.ZONE_V2:
        return { ...cfg, data: converted.zoneV2 };
      case StIndicator.TREND_STRENGTH:
        return { ...cfg, data: converted.trendStrength };
      case StIndicator.TREND_BANDS:
        return { ...cfg, bandData: converted.trendBands };
      default:
        return cfg;
    }
  });
}
