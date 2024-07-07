import { FormControl } from "@angular/forms";


export interface StockDatum {
    [key: string]: number;
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

export interface RelStrStockList {
    name: string;
    baseline: string;
    symbols?: string[];
}

export interface RelStrListForm {
    nameControl: FormControl;
    baselineControl: FormControl;
}

export enum FormMode {
    CREATE = 'create',
    EDIT = 'edit'
}

export type StockListFormMode = FormMode.CREATE | FormMode.EDIT;
