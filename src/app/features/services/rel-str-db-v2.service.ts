import { inject, Injectable, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { BaselineTargetRankDatum, ListAction, RanksByDate, RelStrStockList, StockDatum, Company } from '../shared/types/rs.interfaces';
import { RANKS_WITH_COLORS_BY_SYMBOL, RAW_STOCK_DATA_BY_SYMBOL } from '../data/stocks';
import { collection, collectionData, doc, DocumentData, Firestore, setDoc, query, where, orderBy, limit, deleteDoc, getDocs, getDoc } from  "@angular/fire/firestore";
import { Observable, map, from, tap, catchError, firstValueFrom, defer } from 'rxjs';
import { of } from 'rxjs';
import { Functions, httpsCallable } from '@angular/fire/functions';

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
export class RelStrDbV2Service {

    firestore: Firestore = inject(Firestore)
    functions = inject(Functions);
    private readonly envInjector = inject(EnvironmentInjector);

	constructor() {}

    // New: Fetch tracked symbols via RS backend callable (SavantAPI behind it)
    getTrackedSymbols$(ttlSeconds = 600): Observable<Company[]> {
        console.log('[RelStrDbService] getTrackedSymbols$ start', { ttlSeconds });
        return defer(() =>
            runInInjectionContext(this.envInjector, () => {
                const callable = httpsCallable<{ ttlSeconds?: number }, { items: Array<{ symbol: string; name?: string }>; cached: boolean; updatedAt?: number }>(this.functions, 'getTrackedSymbols');
                return from(callable({ ttlSeconds }));
            })
        ).pipe(
            tap(res => console.log('[RelStrDbService] getTrackedSymbols$ response meta', {
                cached: (res as any)?.data?.cached,
                updatedAt: (res as any)?.data?.updatedAt,
                itemsLen: Array.isArray((res as any)?.data?.items) ? (res as any).data.items.length : undefined,
            })),
            map(res => Array.isArray(res?.data?.items) ? res.data.items : []),
            tap(items => console.log('[RelStrDbService] getTrackedSymbols$ items mapped length', items.length)),
            map(items => items.map(it => ({ symbol: String(it.symbol || '').toUpperCase(), company: String(it.name || it.symbol || '').trim() }) as Company)),
            tap(companies => console.log('[RelStrDbService] getTrackedSymbols$ companies length', companies.length)),
            catchError(err => {
                console.error('[RelStrDbService] getTrackedSymbols$ error', err);
                return of([] as Company[]);
            })
        );
    }

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



    // gets a list of all the symbols currently in the db
    getSupportedSymbolsList$(): Observable<Company[]> {
        // Firestore tracked symbols is the source of truth; only show supported symbols
        // IMPORTANT: Activate injection context at SUBSCRIBE time
        return defer(() =>
            runInInjectionContext(this.envInjector, () => {
                const colRef = collection(this.firestore, 'tracked-symbols');
                const q = query(colRef, where('supported', '==', true), orderBy('symbol'));
                return collectionData(q, { idField: 'id' });
            })
        ).pipe(
            map((rows: any[]) => rows.map(r => ({ symbol: String(r.symbol || r.id || '').toUpperCase(), company: String(r.name || r.company || r.symbol || '').trim() }) as Company)),
            catchError(err => {
                console.error('[RelStrDbService] getSupportedSymbolsList$ error', err);
                return of([] as Company[]);
            })
        );
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

    getListsForUser$(userId: string): Observable<RelStrStockList[]> {
        // IMPORTANT: Activate injection context at SUBSCRIBE time
        return defer(() =>
            runInInjectionContext(this.envInjector, () => {
                const colRef = collection(this.firestore, `users/${userId}/lists`);
                const q = query(colRef, orderBy('updatedAt', 'desc'));
                return collectionData(q, { idField: 'id' });
            })
        ).pipe(
            map((rows: any[]) => rows.map(r => ({
                name: String(r?.name || r?.id || '').trim(),
                baseline: String(r?.baseline || '').toUpperCase(),
                symbols: Array.isArray(r?.symbols) ? r.symbols.map((s: any) => ({ symbol: String(s?.symbol || '').toUpperCase(), company: String(s?.company || s?.symbol || '').trim() })) : [],
                ranksDataWithColors: r?.ranksDataWithColors ?? undefined,
            }) as RelStrStockList)),
            catchError(err => {
                console.warn('[RelStrDbService] getListsForUser$ collectionData failed, falling back to getDocs()', err);
                return defer(() =>
                    runInInjectionContext(this.envInjector, () => {
                        const colRef = collection(this.firestore, `users/${userId}/lists`);
                        const q = query(colRef, orderBy('updatedAt', 'desc'));
                        return from(getDocs(q));
                    })
                ).pipe(
                    map(snap => snap.docs.map(d => ({
                        name: String((d.data() as any)?.name || d.id || '').trim(),
                        baseline: String((d.data() as any)?.baseline || '').toUpperCase(),
                        symbols: Array.isArray((d.data() as any)?.symbols) ? (d.data() as any).symbols.map((s: any) => ({ symbol: String(s?.symbol || '').toUpperCase(), company: String(s?.company || s?.symbol || '').trim() })) : [],
                        ranksDataWithColors: (d.data() as any)?.ranksDataWithColors ?? undefined,
                    }) as RelStrStockList))
                );
            })
        );
    }

    async getListsForUser(userId: string): Promise<RelStrStockList[]> {
        try {
            return await firstValueFrom(this.getListsForUser$(userId));
        } catch (e) {
            console.error('getListsForUser failed', e);
            return [];
        }
    }

    async saveStockList(userId: string, list: RelStrStockList): Promise<void> {
        const colRef = collection(this.firestore, `users/${userId}/lists`);
        const docRef = doc(colRef, list.name);
        const payload = {
            name: list.name,
            baseline: String(list.baseline || '').toUpperCase(),
            symbols: Array.isArray(list.symbols) ? list.symbols.map(s => ({ symbol: String(s.symbol || '').toUpperCase(), company: String(s.company || s.symbol || '').trim() })) : [],
            ranksDataWithColors: list.ranksDataWithColors ?? null,
            updatedAt: Date.now(),
        };
        await setDoc(docRef, payload, { merge: true });
    }

    async deleteStockList(userId: string, listName: string): Promise<void> {
        const colRef = collection(this.firestore, `users/${userId}/lists`);
        const docRef = doc(colRef, listName);
        await deleteDoc(docRef);
    }

    async renameStockList(userId: string, oldName: string, newList: RelStrStockList): Promise<void> {
        // console.log('[RelStrDbService] renameStockList called', { oldName, newName: newList?.name });
        if (!oldName || !newList?.name) return;
        if (oldName === newList.name) {
            // No-op rename; just persist any field updates
            await this.saveStockList(userId, newList);
            return;
        }
        // Prevent overwriting if a list with the target name already exists
        const colRef = collection(this.firestore, `users/${userId}/lists`);
        const newDocRef = doc(colRef, newList.name);
        const exists = await runInInjectionContext(this.envInjector, async () => {
            const snap = await getDoc(newDocRef);
            return snap.exists();
        });
        if (exists) {
            console.warn('[RelStrDbService] renameStockList aborted: target name already exists', { userId, oldName, newName: newList.name });
            return;
        }
        // Write new doc id first
        await this.saveStockList(userId, newList);
        // Then delete the old doc id
        await this.deleteStockList(userId, oldName);
    }

    // RANKS DATA FOR SYMBOL/BASELINE PAIR
    getRanksData(pair: string) {

    }

    setRanksData(pair: string, data: RanksByDate) {

    }

    // Pair Registry (backend callables)
    async registerPairs(list: RelStrStockList): Promise<string[]> {
        try {
            // Backend now validates and registers in one step. Execute inside injection context.
            const symbols = Array.isArray(list.symbols) ? list.symbols.map(s => s.symbol) : [];
            const res = await runInInjectionContext(this.envInjector, async () => {
                const callable = httpsCallable<
                    { listId: string; baseline: string; symbols: string[] },
                    { registered: string[]; rejected?: Array<{ symbol: string; reason: string }>; baselineHint?: { nonStandard?: boolean } }
                >(this.functions, 'validateAndRegisterPairs');
                return callable({ listId: list.name, baseline: list.baseline, symbols });
            });
            const payload = res?.data || {} as any;
            return Array.isArray(payload.registered) ? payload.registered : [];
        } catch (e) {
            console.error('registerPairs callable failed', e);
            return [];
        }
    }

    async unregisterPairs(list: RelStrStockList): Promise<string[]> {
        try {
            const symbols = Array.isArray(list.symbols) ? list.symbols.map(s => s.symbol) : [];
            const res = await runInInjectionContext(this.envInjector, async () => {
                const callable = httpsCallable<
                    { listId: string; baseline: string; symbols: string[] },
                    { unregistered: string[] }
                >(this.functions, 'unregisterPairs');
                return callable({ listId: list.name, baseline: list.baseline, symbols });
            });
            const payload = (res?.data as any) || {};
            return Array.isArray(payload.unregistered) ? payload.unregistered : [];
        } catch (e) {
            console.error('unregisterPairs callable failed', e);
            return [];
        }
    }
}
