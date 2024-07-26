import { inject, Injectable } from '@angular/core';
import { BaselineTargetRankDatum, ListAction, RanksByDate, RelStrStockList, StockDatum } from '../common/interfaces-rs';
import { RANKS_WITH_COLORS_BY_SYMBOL, RAW_STOCK_DATA_BY_SYMBOL } from '../data/stocks';
import { addDoc, collection, collectionData, doc, DocumentData, Firestore, getDoc, setDoc } from  "@angular/fire/firestore";import { Observable } from 'rxjs';
;

interface SymbolMetadata {
    supported: boolean;
    baseline: boolean;
}

interface SymbolSupport {
    [key: string]: SymbolMetadata       // key is stock symbol in uppercase
}

interface SupportedSymbolsList {
    supportedSymbolsList: string[];
}

@Injectable({
	providedIn: 'root',
})
export class RelStrDbService {

    firestore: Firestore = inject(Firestore)

	constructor() {}


    // Two ways to get historical stock data:
    // 1) maintain an internal db of historical stock data.  This reduces the number of calls to the external data service (eg alpha vantage)
    // 2) just make a call to the external data service each time and don't worry about the number of calls

    // Internal db implementation
    // STOCK DATA
    // collection: stockData
    // key: symbol in upper case
    // value: StockDatum[]

    // get historical data for a symbol
    getDataForSymbol(symbol: string): StockDatum[] {

        /////// ACTUAL IMPLEMENTATION ///////
        // is the symbol in the list of supported symbols?
        // if yes 

        // fetch data from source (internal or external) and return it



        // if no

            // will the symbol be supported?  (how is this determined?)

            // if yes

                // add the symbol to the list of supported symbols
                // make the call to the db and return the data

            // if no

                // display some sort of error message to user

        ////////// PROTOTYPE SHIM /////////

        if (Object.keys(RAW_STOCK_DATA_BY_SYMBOL).includes(symbol.toUpperCase())) {
            // console.log('rSdBSvc gSDBS symbol exists. returning data');


            // use hard-coded mock data if it exists in the mock data set


            return RAW_STOCK_DATA_BY_SYMBOL[symbol];
        } else {
            // console.log('rSdBSvc gSDBS symbol doesnt exist. returning empty array');

            // call to stock data service or directly to external api to retrieve price data for one symbol



            return [];
        }
    }


    // Only used if we maintain an internal db of historical stock data
    // save historical data for a symbol
    saveHistoricalData(symbol: string, data: StockDatum[]) {

    }

    // Only used if we maintain an internal db of historical stock data
    // append todays data onto an existing symbol
    updateData(symbol: string, data: StockDatum) {

    }

    

    // gets a list of all the symbols with their support status and whether they can be used as a baseline symbol
    getSymbolSupportStatus(symbol: string) {
        
        // collection: admin
        // doc: symbol-support-status
        // data type is SymbolSupport (see above)
    }

    setSymbolSupportStatus(symbol: string) {
        
        // collection: admin
        // doc: symbol-support-status
        // data type is SymbolSupport
    }



    //
    getSupportedSymbolsList(): string[] {

        // const symbols = Object.keys(RAW_STOCK_DATA_BY_SYMBOL);
        // // console.log('rSdBSvc gSSL symbols: ', symbols);
        // return symbols;

        // collection: admin
        // doc: supported-symbols
        // data type: array of Symbol objects

        let list$: Observable<DocumentData>;

        const collectionRef = collection(this.firestore, 'admin');
        const docRef = doc(collectionRef, 'supportedSymbolsList');
        

        // console.log('rDBSVC cSSL docRef: ', docRef);
        // console.log('rDBSVC cSSL docRef id: ', docRef.id);

        list$ = collectionData(collectionRef);
        console.log('rDBSVC gSSL symbols list obs: ', list$);

        // list$.pipe().subscribe(list => {
        //     console.log('rDBSVC gSSL symbols list: ', list);
        // });

        // const doc = getDoc(docRef)

        const otherDocRef = doc(collectionRef, 'doofus');
        const data = {id: '', dude: 'hey now'}

        data.id = otherDocRef.id

        setDoc(otherDocRef, data);

        const dude$ = collectionData(collectionRef);

        // dude$.pipe().subscribe(list => {
        //     console.log('rDBSVC gSSL symbols list: ', list);
        // });


        return []


    }

    // gets a list of all the symbols currently in the db
    getSupportedPairsList(): string[] {

        const pairs = Object.keys(RANKS_WITH_COLORS_BY_SYMBOL);
        // console.log('rSdBSvc gSSL symbols: ', symbols);
        return pairs;

        // collection: admin
        // doc: supported-pairs
        // data type: array of strings in the form 'BASELINE_TARGET'
        // ex: 'QQQ_AAPL' or 'SPY_XON'


    }

    async createSupportedSymbolsListDoc() {
        // console.log('rDBSVC cSSL  create supported symbols list called')
        const collectionRef = collection(this.firestore, 'admin');
        const dataToCreate = {supportedSymbolsList: []};
        // console.log('rDBSVC cSSL data to create: ', dataToCreate);
        const newDoc = await setDoc(doc(collectionRef, 'supportedSymbolsList'), dataToCreate).then((d) => d);
        // console.log('rDBSVC cSSL new doc: ', newDoc);
    }

    updateSupportedSymbolsList(symbol: string, action: ListAction) {
        // make call to firestore db to update the list of supported symbols 

        // collection: admin
        // doc: supported-symbols
        // data type: array of strings each string is a NYSE/NASDAQ etc. ticker symbol
        // task: add or remove a symbol object from the list based on the specified ListAction param



    }
    
    updateSupportedPairsList(pair: string, action: ListAction) {
        // make call to firestore db to update the list of supported baseline/target pairs 

        // collection: admin
        // doc: supported-pairs
        // data type: array of strings in the form 'BASELINE_TARGET'
        // task: add or remove a symbol object from the list based on the specified ListAction param
    }

    savePairData(pair: string, data: BaselineTargetRankDatum[]) {
        // make a call to firestore db to save newly created baseline/target pair data for the given pair
        // this data is a single row in the RS Heatmap

        // collection: pair-data
        // doc: pairDataObject
        // doc id: string in the form 'BASELINE_TARGET'
        // data type: BaselineTargetRankDatum[]
        // export interface BaselineTargetRankDatum {
        //     date: string;
        //     value: number;
        //     index: number;
        //     color: string;
        // }
    }

    // SEEDING THE FIRESTORE DATABASE BEFORE THERE ARE USERS ON THE SITE

    // This is the process of populating the database manually before there are users

    // GENERATE PAIR DATA
    // Generate a hard-coded list of symbols that will be supported as target symbols
    // Generate an initial hard-coded list of symbols that will be used as baseline symbols
    // Save these to db

    // BASELINE SYMBOLS
    // QQQ

    // TARGET SYMBOLS LIST:
    // AAPL AMAT MSFT NVDA TSLA QQQ

    // Generate list of pairs based on all combinations of baseline and target symbols
    // save this to db

    // create an in-memory cache for historical stock data
    // for each pair:
        // check whether the historical data for a symbol is present in the cache
            // yes - use that data
            // no - fetch the data from historical db and save it to the cache
        // generate ranksDataWithColors data for the pair
        // save this to the pair-data db
            

    // CREATE STOCK LISTS
    // These are hard-coded stock lists that will be present in the system when users first arrive so they don't have 
    // to create lists manually to get started
    // Data type is RelStrStockList
    // A stock list can only have one baseline symbol
    // Can have as many target symbols as desired

    // export interface RelStrStockList {
    //     name: string;
    //     baseline: string;
    //     symbols: Company[];
    //     ranksData?: {[key: string]: StringNumberObject[]},
    //     ranksDataWithColors?: RanksDataWithColors;
    // }

    // export interface Company {
    //     symbol: string;
    //     company: string;
    // }

    // Baseline symbols:
    // SPY QQQ DIA
    // SECTOR ETFS

    // Target symbols:
    // Constituents of the above baseline ETFs
    // For SPY, only use the OEX stocks (top 100 market cap)

    // Combinations
    // Each ETF vs its constituents
    // SPY/QQQ/DIA vs sector ETFs
    // SPY/QQQ/DIA vs constituents filtered by some query (ex: highest market cap)
    
    // save each list to db with a username of 'public' or similar
    // these lists are available to all users



    // WHEN A USER SELECTS A STOCK LIST TO SHOW IN UI
    // 







    //////////////////////////////////////////


    // STOCK LISTS
    // collection: stockList
    // key: userId string
    // value: RelStrStockList array

    // New Stock List process
    // this is when a user creates a stock list 
    // need to:
    // check whether each symbol is in the list of supported symbols (getSupportedSymbolsList)
    // or check the 'supported' status for the symbol (getSymbolSupportStatus)
    // add each symbol to the list of supported symbols
    // generate a list of baseline/target pairs for the list
    // get historical stock data for each symbol in the list
    // generate
    // 

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
