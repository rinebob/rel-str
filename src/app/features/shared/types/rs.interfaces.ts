import { FormControl } from "@angular/forms";
import { AxisModel, CrosshairSettingsModel, LegendSettingsModel, TooltipSettingsModel, ZoomSettingsModel } from "@syncfusion/ej2-charts";

/**
 * Interface for stock data with date as key and closing price as value.
 */
export interface StockDatum {
    [key: string]: number;      // key = date, value = closing price
}

// Stronger typing for date keys used across stock data
export type StockDateKey = string; // could be branded/template-literal later if needed

// Alias for percent-change datum (keeps compatibility with existing code)
export type PercentChangeDatum = StringNumberObject;

/**
 * Helper: unwraps a single-key StockDatum into a typed date/value pair.
 */
export function getDateAndValue(d: StockDatum): { date: StockDateKey; value: number } {
    const date = Object.keys(d)[0] as StockDateKey;
    return { date, value: d[date] };
}

/**
 * Tuple type for a fixed-size RS rolling window of 5 numbers.
 */
export type RsWindow = [number, number, number, number, number];

/**
 * Builds a 5-length rolling window ending at endIndex from a series of {date, value}.
 * Returns null if not enough data.
 */
export function buildWindow(series: ReadonlyArray<PercentChangeDatum>, endIndex: number): RsWindow | null {
    if (endIndex < 4) return null;
    const w: RsWindow = [
        series[endIndex]?.value ?? 0,
        series[endIndex - 1]?.value ?? 0,
        series[endIndex - 2]?.value ?? 0,
        series[endIndex - 3]?.value ?? 0,
        series[endIndex - 4]?.value ?? 0,
    ];
    return w;
}

export interface CalculationData {
    date: string;
    close: number;
    percentChange: number;
    rank: number;
}

export interface StockData {
    symbol: string;
    row?: number;
    data: StockDatum[];
    results: CalculationData[];
    resultsByDate: CalculationResult;
    ranksByDate: RanksByDate;
}
export type StockResults = Pick<StockData, 'symbol' | 'resultsByDate'>;

export interface DataSet {
    [key: string]: StockData;        // key = symbol
}

export interface DatumWithColor {
    value: number;
    color: string;
    index?: number;
}

export interface RelStrTableData {
    symbols: string[];
    dates: string[];
    // data: number[][];
    data: DatumWithColor[][];
}

export interface Rank {
    rank: number;
}

export interface RanksByDate {
    [key: string]: Rank;        // key = date
}

export interface CalculationResult {
    [key: string]: CalculationData;        // key = date
}

export interface ResultsDataSet {
    [key: string]: StockResults;        // key = symbol
}

export interface StringNumberObject {
    date: string;
    value: number;
}

export const RsPhase = {
    PRE: 'pre',
    POST: 'post',
} as const;
export type RsPhase = typeof RsPhase[keyof typeof RsPhase];

/**
 * Canonical FE series point for RS values produced by archive/legacy readers.
 * UI color/index are applied later in the store; keep this minimal here.
 */
export interface RsSeriesPoint {
    date: string;
    value: number;
    norm?: number;
    phase?: RsPhase;
}

export interface BaselineTargetRankDatum {
    date: string;
    value: number;
    index: number;
    color: string;
    /** Phase that produced this value */
    phase?: RsPhase;
    /** True if this datum is a UI placeholder for a missing value */
    placeholder?: boolean;
}

export interface RanksDataWithColors {
    [key: string]: BaselineTargetRankDatum[]
}

export interface RelStrStockList {
    name: string;
    baseline: string;
    symbols: Company[];
    ranksData?: {[key: string]: StringNumberObject[]},
    ranksDataWithColors?: RanksDataWithColors;
}

export interface RelStrListForm {
    nameControl: FormControl;
    baselineControl: FormControl;
}

/**
 * Interface for Syncfusion chart axis config (robust, always complete).
 */
export interface RsSyncfusionChartConfig {
// tooltip, crosshair, zoomSettings, legend, primaryXAxis, primaryYAxis
    crosshair: CrosshairSettingsModel;
    legend: LegendSettingsModel;
    lineStyle?: Object;
    primaryXAxis: AxisModel;
    primaryYAxis: AxisModel;
    zoomSettings: ZoomSettingsModel;
    tooltip: TooltipSettingsModel;
}

export enum FormMode {
    CREATE = 'create',
    EDIT = 'edit'
}

export type StockListFormMode = FormMode.CREATE | FormMode.EDIT;

export interface Company {
    symbol: string;
    company: string;
}

export enum ListAction {
    ADD = 'add',
    REMOVE = 'remove',
}

export enum Timeframe {
    DAILY = 'daily',
    WEEKLY = 'weekly',
    MONTHLY = 'monthly'
}

export interface RsChartConfig {
    id: string;
    name: string;
    targetSymbol: string;
    baselineSymbol: string;
    timeframe: Timeframe;
    chartConfig: RsSyncfusionChartConfig;
    showRS?: boolean;
    showBaseline?: boolean;
    showVolume?: boolean;
    showTechnicalIndicators?: string[];
    height?: string;
    width?: string;
}

export interface OHLCDatum {
    x: Date;
    date?: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}

export interface CandleWithRSColor extends OHLCDatum {
    rsColor?: string;
    rank?: number;
}

export interface MockCandleWithRSColor {
    x: string;
    open: number;
    high: number;
    low: number;
    close: number;
    rsColor?: string;
    rank?: number;
}

export interface RsPaneDatum {
    date: Date;
    rank?: number;
    rsColor: string;
}

export interface ChartSignal {
    id: string;
    config: RsChartConfig;
    chartData: CandleWithRSColor[];
    rsData: RsPaneDatum[];
    baselineData: OHLCDatum[];
}

// Typed interface for RS Table rows
export interface RsTableRow {
    date: string;
    msftValue: number;
    qqqValue: number;
    msftPct: number | null;
    qqqPct: number | null;
    msftRs: number | null;
    msftRsColor: string | null;
}
