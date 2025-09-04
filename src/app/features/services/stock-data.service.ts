import { Injectable } from '@angular/core';
import { RAW_STOCK_DATA_BY_SYMBOL } from '../data/stocks';

@Injectable({
    providedIn: 'root'
})
export class StockDataService {

    constructor() { }

    getStockDataBySymbol(symbol: string) {
        // console.log('sDSvc gSDBS get data for symbol: ', symbol);
        if (Object.keys(RAW_STOCK_DATA_BY_SYMBOL).includes(symbol)) {
            // console.log('sDSvc gSDBS symbol exists. returning data');
            return RAW_STOCK_DATA_BY_SYMBOL[symbol];
        } else {
            // console.log('sDSvc gSDBS symbol doesnt exist. returning empty array');
            return [];
        }
    }
}
