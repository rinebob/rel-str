import { Injectable } from '@angular/core';
import { BaselineTargetRankDatum, ListAction, RanksByDate, RelStrStockList, StockDatum } from '../common/interfaces-rs';
import { RANKS_WITH_COLORS_BY_SYMBOL, RAW_STOCK_DATA_BY_SYMBOL } from '../data/stocks';

@Injectable({
	providedIn: 'root',
})
export class RelStrDbService {
	constructor() {}

    // STOCK DATA
    // collection: stockData
    // key: symbol in upper case
    // value: StockDatum[]

    // get historical data for a symbol
    getDataForSymbol(symbol: string): StockDatum[] {
        if (Object.keys(RAW_STOCK_DATA_BY_SYMBOL).includes(symbol.toUpperCase())) {
            // console.log('rSdBSvc gSDBS symbol exists. returning data');
            return RAW_STOCK_DATA_BY_SYMBOL[symbol];
        } else {
            // console.log('rSdBSvc gSDBS symbol doesnt exist. returning empty array');
            return [];
        }
    }

    // save historical data for a symbol
    saveHistoricalData(symbol: string, data: StockDatum[]) {

    }

    // append todays data onto an existing symbol
    updateData(symbol: string, data: StockDatum) {

    }

    // gets a list of all the symbols currently in the db
    getSupportedSymbolsList(): string[] {

        const symbols = Object.keys(RAW_STOCK_DATA_BY_SYMBOL);
        // console.log('rSdBSvc gSSL symbols: ', symbols);
        return symbols;
    }

    // gets a list of all the symbols currently in the db
    getSupportedPairsList(): string[] {

        const pairs = Object.keys(RANKS_WITH_COLORS_BY_SYMBOL);
        // console.log('rSdBSvc gSSL symbols: ', symbols);
        return pairs;
    }

    updateSupportedSymbolsList(symbol: string, action: ListAction) {
        // make call to firestore db to update the list of supported symbols 
    }
    
    updateSupportedPairsList(pair: string, action: ListAction) {
        // make call to firestore db to update the list of supported baseline/target pairs 
    }

    savePairData(pair: string, data: BaselineTargetRankDatum[]) {
        // make a call to firestore db to save newly created baseline/target pair data for the given pair
    }


    // STOCK LISTS
    // collection: stockList
    // key: userId string
    // value: RelStrStockList array

    // return RelStrStockList array
    getListsForUser(userId: string): RelStrStockList[] {
        return []
    }

    // appends a new stock list to the array
    saveStockList(userId: string, list: RelStrStockList) {

    }

    deleteStockList(userId: string, listName: string) {

    }

    // RANKS DATA FOR SYMBOL/BASELINE PAIR
    getRanksData(pair: string) {

    }

    setRanksData(pair: string, data: RanksByDate) {

    }
}
