import { inject, Injectable } from '@angular/core';
import { BaselineTargetRankDatum, ListAction, RanksByDate, RelStrStockList, StockDatum, Company } from '../shared/types/rs.interfaces';
// V2: no static data imports
import { collection, collectionData, doc, docData, DocumentData, Firestore, setDoc, query, where, orderBy, limit, deleteDoc, getDocs, getDoc } from  "@angular/fire/firestore";
import { Observable, map, from, tap, catchError, firstValueFrom } from 'rxjs';
import { of } from 'rxjs';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { concatMap } from 'rxjs/operators';

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

	constructor() {}

    // New: Fetch tracked symbols via RS backend callable (SavantAPI behind it)
    getTrackedSymbols$(ttlSeconds = 600): Observable<Company[]> {
        console.log('[RelStrDbService] getTrackedSymbols$ start', { ttlSeconds });
        return from(httpsCallable<{ ttlSeconds?: number }, { items: Array<{ symbol: string; name?: string }>; cached: boolean; updatedAt?: number }>(this.functions, 'getTrackedSymbols')({ ttlSeconds })).pipe(
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
    // get historical data for a symbol (V2 placeholder – no static mock fallback)
    getDataForSymbol(symbol: string): StockDatum[] {
        // V2 must not use hard-coded data. Wire this to RsDataService or backend provider.
        // Returning an empty array makes any accidental calls obvious in UI/logs.
        return [];
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
        const colRef = collection(this.firestore, 'tracked-symbols');
        const q = query(colRef, where('supported', '==', true), orderBy('symbol'));
        return collectionData(q).pipe(
            map((rows: any[]) => rows.map((data: any) => ({
                symbol: String(data?.symbol || '').toUpperCase(),
                company: String(data?.name || data?.company || data?.symbol || '').trim(),
            }) as Company)),
            catchError(err => {
                console.error('[RelStrDbService] getSupportedSymbolsList$ error', err);
                return of([] as Company[]);
            })
        );
    }

    // V2 dynamic: supported pairs list comes from Firestore 'pairs' collection (doc IDs hyphenated BASELINE-TARGET)
    getSupportedPairsList$(): Observable<string[]> {
        const colRef = collection(this.firestore, 'pairs');
        return collectionData(colRef, { idField: 'id' }).pipe(
            map((rows: any[]) => rows.map(r => String(r?.id))),
            catchError(err => {
                console.error('[RelStrDbService] getSupportedPairsList$ error', err);
                return of([] as string[]);
            })
        );
    }

    async getSupportedPairsListDynamic(): Promise<string[]> {
        try { return await firstValueFrom(this.getSupportedPairsList$()); } catch { return []; }
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

    getListsForUser$(userId: string): Observable<RelStrStockList[]> {
        const uid = String(userId || '').trim();
        const colRef = collection(this.firestore, `users/${uid}/lists`);
        const qRef = query(colRef, orderBy('updatedAt', 'desc'));
        // Pure read: do not write in the read path to avoid rules violations
        return from(getDocs(qRef)).pipe(
            map(snap => snap.docs.map(d => ({
                name: String((d.data() as any)?.name || d.id || '').trim(),
                baseline: String((d.data() as any)?.baseline || '').toUpperCase(),
                symbols: Array.isArray((d.data() as any)?.symbols) ? (d.data() as any).symbols.map((s: any) => ({ symbol: String(s?.symbol || '').toUpperCase(), company: String(s?.company || s?.symbol || '').trim() })) : [],
                ranksDataWithColors: (d.data() as any)?.ranksDataWithColors ?? undefined,
            }) as RelStrStockList)),
            catchError(err => {
                console.error('[RelStrDbService] getListsForUser$ error', err);
                return of([] as RelStrStockList[]);
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
        const uid = String(userId || '').trim();
        const docId = String(list?.name || '').trim();
        if (!uid) throw new Error('[RelStrDbV2Service] saveStockList: missing userId');
        if (!docId) throw new Error('[RelStrDbV2Service] saveStockList: missing list.name');
        const colRef = collection(this.firestore, `users/${uid}/lists`);
        const docRef = doc(colRef, docId);
        const payload = {
            name: docId,
            baseline: String(list.baseline || '').toUpperCase(),
            symbols: Array.isArray(list.symbols) ? list.symbols.map(s => ({ symbol: String(s.symbol || '').toUpperCase(), company: String(s.company || s.symbol || '').trim() })) : [],
            ranksDataWithColors: list.ranksDataWithColors ?? null,
            updatedAt: Date.now(),
        };
        await setDoc(docRef, payload, { merge: true });
    }

    async deleteStockList(userId: string, listName: string): Promise<void> {
        const uid = String(userId || '').trim();
        const docId = String(listName || '').trim();
        if (!uid) throw new Error('[RelStrDbV2Service] deleteStockList: missing userId');
        if (!docId) throw new Error('[RelStrDbV2Service] deleteStockList: missing listName');
        const colRef = collection(this.firestore, `users/${uid}/lists`);
        const docRef = doc(colRef, docId);
        await deleteDoc(docRef);
    }

    async renameStockList(userId: string, oldName: string, newList: RelStrStockList): Promise<void> {
        const uid = String(userId || '').trim();
        const srcId = String(oldName || '').trim();
        const destId = String(newList?.name || '').trim();
        if (!uid || !srcId || !destId) return;
        if (srcId === destId) {
            // No-op rename; just persist any field updates
            await this.saveStockList(userId, newList);
            return;
        }
        // Prevent overwriting if a list with the target name already exists
        const colRef = collection(this.firestore, `users/${uid}/lists`);
        const newDocRef = doc(colRef, destId);
        const exists = await getDoc(newDocRef).then(snap => snap.exists());
        if (exists) {
            console.warn('[RelStrDbService] renameStockList aborted: target name already exists', { userId: uid, oldName: srcId, newName: destId });
            return;
        }
        // Write new doc id first
        await this.saveStockList(userId, newList);
        // Then delete the old doc id
        await this.deleteStockList(userId, srcId);
    }

    // RANKS DATA FOR SYMBOL/BASELINE PAIR
    getRanksData(pair: string) {

    }

    setRanksData(pair: string, data: RanksByDate) {

    }

    // Live series for a pair doc (hyphenated ID), unified series entries with { pre?, post? }
    // Returns simplified { date, value } array where value = post.rank if present else pre.rank
    getPairSeriesLive$(pairId: string): Observable<Array<{ date: string; value: number }>> {
        const ref = doc(this.firestore, `pairs/${pairId}`);
        return docData(ref).pipe(
            map((doc: any) => {
                const series: any[] = Array.isArray(doc?.series) ? doc.series : [];
                const mapped = series.map((row: any) => {
                    const day = String(row?.day ?? row?.date ?? '');
                    const postRank = Number(row?.post?.rank ?? NaN);
                    const preRank = Number(row?.pre?.rank ?? NaN);
                    const value = Number.isFinite(postRank) ? postRank : (Number.isFinite(preRank) ? preRank : 0);
                    return { date: day, value };
                });
                return mapped;
            }),
            catchError(err => {
                console.error('[RelStrDbV2Service] getPairSeriesLive$ error', { pairId, err });
                return of([] as Array<{ date: string; value: number }>);
            })
        );
    }

    // Pair Registry (backend callables)
    async registerPairs(list: RelStrStockList): Promise<string[]> {
        try {
            // Backend now validates and registers in one step. Execute inside injection context.
            const symbols = Array.isArray(list.symbols) ? list.symbols.map(s => s.symbol) : [];
            const res = await httpsCallable<
                { listId: string; baseline: string; symbols: string[] },
                { registered: string[]; rejected?: Array<{ symbol: string; reason: string }>; baselineHint?: { nonStandard?: boolean } }
            >(this.functions, 'validateAndRegisterPairs')({ listId: list.name, baseline: list.baseline, symbols });
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
            const res = await httpsCallable<
                { listId: string; baseline: string; symbols: string[] },
                { unregistered: string[] }
            >(this.functions, 'unregisterPairs')({ listId: list.name, baseline: list.baseline, symbols });
            const payload = (res?.data as any) || {};
            return Array.isArray(payload.unregistered) ? payload.unregistered : [];
        } catch (e) {
            console.error('unregisterPairs callable failed', e);
            return [];
        }
    }
}
