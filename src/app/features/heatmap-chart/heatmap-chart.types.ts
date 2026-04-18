import { BarsInterval } from '../../core/models/partner.types';

export interface HeatmapChartQuery {
  baseline: string;
  symbol: string;
  interval: BarsInterval;
  listContext?: ListContext;
}

export interface ListContext {
  listId: string;
  pairIds: string[];
  currentIndex: number;
}

export interface HeatmapChartViewModel {
  query: HeatmapChartQuery;
  chartData: ChartDataset | null;
  heatmapData: HeatmapDataset | null;
  loading: boolean;
  error: string | null;
  colorScheme: HeatmapColorScheme;
}

export interface ChartDataset {
  baseline: string;
  symbol: string;
  interval: BarsInterval;
  bars: PriceBar[];
  dateRange: { from: string; to: string };
}

export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface HeatmapDataset {
  baseline: string;
  symbol: string;
  daily: HeatmapRow | null;
  weekly: HeatmapRow | null;
  monthly: HeatmapRow | null;
  dateRange: { from: string; to: string };
}

export interface HeatmapRow {
  interval: BarsInterval;
  cells: HeatmapCell[];
}

export interface HeatmapCell {
  date: string;
  rsValue: number;
  color: string;
  phase: 'pre' | 'post';
  spanDays?: number;
}

export interface HeatmapColorScheme {
  type: 'dynamic' | 'fixed';
  variation?: 'standard' | 'high-contrast' | 'colorblind';
  thresholds?: number[];
  colors?: string[];
}

export interface AlignmentMetrics {
  barWidth: number;
  totalBars: number;
  dateToIndex: Map<string, number>;
  indexToDate: Map<number, string>;
}

export interface CellAlignment {
  left: number;
  width: number;
  startIndex: number;
  endIndex: number;
}
