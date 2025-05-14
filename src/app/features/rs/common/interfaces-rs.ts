import { FormControl } from "@angular/forms";


export interface StockDatum {
    [key: string]: number;      // key = date, value = closing price
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

export interface BaselineTargetRankDatum {
    date: string;
    value: number;
    index: number;
    color: string;
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
export interface ChartAxisConfig {
  valueType: 'DateTime' | 'Category' | 'Double';
  title: string;
  zoomFactor: number;
  zoomPosition: number;
  plotOffset: number;
  labelFormat?: string;
  intervalType?: string;
  edgeLabelPlacement?: string;
  majorGridLines?: { width: number };
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

export interface CandleWithRSColor {
    x: Date;
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
