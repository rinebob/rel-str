import { patchState, signalStoreFeature, withComputed, withMethods, withState } from "@ngrx/signals"
import { BaselineTargetRankDatum, FormMode, ListAction, RanksByDate, RanksDataWithColors, RelStrStockList, StockDatum, StockListFormMode } from "../shared/types/rs.interfaces"
import { StockDataService } from "../services/stock-data.service"
import { inject } from "@angular/core"
import { RelStrDbV2Service } from "../services/rel-str-db-v2.service"
import { generatePairData, getPairsForList } from "../utils/rs-calc-utils-v2"
import { RANKS_WITH_COLORS_BY_SYMBOL } from "../data/stocks"
import { RsCalcsStore } from "./rs-calcs.store"
import { firstValueFrom } from 'rxjs'

export type StockListV2State = {
    allStockListsV2: RelStrStockList[],
    selectedStockListV2: RelStrStockList,
    supportedSymbolsListV2: string[],
    supportedPairsListV2: string[],
    formModeV2: StockListFormMode,
    showFormV2: boolean,
    formDataV2: RelStrStockList,
}

export const initialV2State: StockListV2State = {
    allStockListsV2: [],
    selectedStockListV2: {name: '', baseline: '', symbols: []},
    supportedSymbolsListV2: [],
    supportedPairsListV2: [],
    formModeV2: FormMode.CREATE,
    showFormV2: false,
    formDataV2: {name: '', baseline: '', symbols: []}
}

export function withStockListV2Feature() {
    return signalStoreFeature(
        withState<StockListV2State>(initialV2State),

        withComputed((state) => ({

        })),

        withMethods((
            store,
            relStrDbService = inject(RelStrDbV2Service),
            stockDataService = inject(StockDataService),
        ) => ({

            // STOCK DATA
            // Prefer using state-cached supportedSymbolsListV2 to avoid re-opening Firestore on every switch
            async getHistoricalDataForSymbolV2(symbol: string): Promise<StockDatum[]> {
                let symbols = store.supportedSymbolsListV2();
                try {
                    if (!symbols || symbols.length === 0) {
                        const companies = await firstValueFrom(relStrDbService.getSupportedSymbolsList$());
                        symbols = companies.map(c => c.symbol);
                        // console.log('[StockListV2] loaded supported symbols from DB (cold path)', { count: symbols.length });
                    }
                } catch {
                    // If Firestore path fails, continue without it
                    symbols = symbols ?? [];
                }

                // if the data already exists in RS db, fetch from there
                if (symbols.includes(symbol)) {
                    try { return relStrDbService.getDataForSymbol(symbol); } catch { return []; }
                } else {
                    // else make a call to fetch historical data for a new symbol
                    try { return await stockDataService.getStockDataBySymbol(symbol); } catch { return []; }
                }
            },

            saveHistoricalDataV2(symbol: string, data: StockDatum[]) {
                relStrDbService.saveHistoricalData(symbol, data);
            },

            updateDataV2(symbol: string, data: StockDatum) {
                relStrDbService.updateData(symbol, data);
            },

            addSupportedSymbolsListV2() {
                // console.log('[StockListV2] addSupportedSymbolsListV2 called');
                relStrDbService.createSupportedSymbolsListDoc();
            },

            async getSupportedSymbolsListV2() {
                const companies = await firstValueFrom(relStrDbService.getSupportedSymbolsList$());
                const supportedSymbolsListV2 = companies.map(c => c.symbol);
                // console.log('[StockListV2] supportedSymbolsListV2', supportedSymbolsListV2);
                patchState(store, {supportedSymbolsListV2});
            },

            updateSupportedSymbolsListV2(symbol: string, action: ListAction) {
                relStrDbService.updateSupportedSymbolsList(symbol, action);
            },

            // BASELINE/TARGET RANKS DATA (PAIRS DATA)
            getSupportedPairsListV2() {
                const supportedPairsListV2 = relStrDbService.getSupportedPairsList();
                // console.log('[StockListV2] supportedPairsListV2', supportedPairsListV2);
                patchState(store, {supportedPairsListV2});
            },

            updateSupportedPairsListV2(pair: string, action: ListAction) {
                relStrDbService.updateSupportedPairsList(pair, action);
            },

            savePairDataV2(pair: string, data: BaselineTargetRankDatum[]) {
                relStrDbService.savePairData(pair, data);
            }

           
        })),

        // STOCK LISTS
        withMethods((
            store,
            rsCalcsStore = inject(RsCalcsStore),
            relStrDbService = inject(RelStrDbV2Service),
        ) => ({

            // LISTS
            async getListsForUserV2(userId: string) {
                const allStockListsV2 = await relStrDbService.getListsForUser(userId);
                patchState(store, { allStockListsV2 });
            },

            async saveStockListForUserV2(userId: string, list: RelStrStockList) {
                // Persist to Firestore
                await relStrDbService.saveStockList(userId, list);
                // Update local state immediately
                const existing = store.allStockListsV2().some(l => l.name === list.name);
                const base = existing ? [...store.allStockListsV2()] : [...store.allStockListsV2(), list];
                const allStockListsV2 = this.sortListsV2(list, base);
                patchState(store, { allStockListsV2, selectedStockListV2: list });
                // Register pairs in backend
                try { await relStrDbService.registerPairs(list); } catch (e) { console.error('[StockListFeatureV2] registerPairs failed', e); }
            },

            async deleteStockListForUserV2(userId: string, listName: string) {
                // Find list object for unregistering pairs
                const listObj = store.allStockListsV2().find(l => l.name === listName);
                if (listObj) {
                    try { await relStrDbService.unregisterPairs(listObj); } catch {}
                }
                // Persist deletion
                await relStrDbService.deleteStockList(userId, listName);
                // Update local state
                const stockLists = store.allStockListsV2().filter(l => l.name !== listName);
                patchState(store, { allStockListsV2: stockLists });
            },

            async renameStockListForUserV2(userId: string, oldName: string, newList: RelStrStockList) {
                await relStrDbService.renameStockList(userId, oldName, newList);
                const others = store.allStockListsV2().filter(l => l.name !== oldName);
                const allStockListsV2 = this.sortListsV2(newList, [...others, newList]);
                patchState(store, { allStockListsV2, selectedStockListV2: newList });
                // Update backend pair registry for new list id
                try { await relStrDbService.registerPairs(newList); } catch (e) { console.error('[StockListFeatureV2] registerPairs (rename) failed', e); }
            },

            setAllStockListsV2(allStockListsV2: RelStrStockList[]) {
                // console.log('wSLFeatV2 sASL set all stock lists: ', allStockListsV2);
                patchState(store, {allStockListsV2});
            },
            
            setSelectedStockListV2(selectedStockListV2: RelStrStockList){
                // console.log('wSLFeatV2 sASL set selected stock list: ', selectedStockListV2);
                patchState(store, {selectedStockListV2})
            },

            updateStockListV2(list: RelStrStockList) {
                const allStockListsV2 = store.allStockListsV2().filter(l => l.name !== list.name)
                allStockListsV2.push({...list});
                patchState(store, {allStockListsV2, selectedStockListV2: {...list}})
            },

            async generateHeatmapDataV2(pair: string): Promise<BaselineTargetRankDatum[]> {
                // console.log('sLFeatV2 gHD generate heatmap data for pair: ', pair);
                const symbols = pair.split('_');
                const baseline = symbols[0];
                const target = symbols[1];
        
                // console.log('sLFeatV2 gHD pair not in list. creating data set. baseline/target: ', baseline, target);
                const baselineData = await store.getHistoricalDataForSymbolV2(baseline);
                const targetData = await store.getHistoricalDataForSymbolV2(target);
                
                const pairData = generatePairData(baselineData, targetData, rsCalcsStore.heatmapColors());
                // console.log('sLFeatV2 gHD final pairData: ', pairData);
        
                return pairData;
            },

            async getHeatmapDataV2(pairs: string[]): Promise<RanksDataWithColors> {
                let ranksDataWithColors: RanksDataWithColors = {}

                for (const pair of pairs) {
                    // console.log('sLFeatV2 gHD pair: ', pair);
                    let pairData: BaselineTargetRankDatum[] = [];
                    if (store.supportedPairsListV2().includes(pair)) {
                        // console.log('sLFeatV2 gHD pair in list.  getting data from firebase db');
                        pairData = RANKS_WITH_COLORS_BY_SYMBOL[pair];
                    } else {
                        // console.log('sLFeatV2 gHD pair not in list.  generating pairData and saving to firebase db');
                        pairData = await this.generateHeatmapDataV2(pair);
                        store.savePairDataV2(pair, pairData);
                    }
                    ranksDataWithColors[pair] = pairData;
                }

                // console.log('sLFeatV2 gHD final ranksDataWithColors: ', ranksDataWithColors);

                return ranksDataWithColors;
            },

            async resolveExistingRanksDataV2(list: RelStrStockList): Promise<RelStrStockList> {
                // console.log('-----------------');
                // console.log('sLFeatV2 rERD input list: ', {...list});
                const pairs = getPairsForList(list);
                // console.log('sLFeatV2 rERD pairs: ', pairs);
                const existingPairs = !!list.ranksDataWithColors ? Object.keys(list.ranksDataWithColors) : [];
                // console.log('sLFeatV2 rERD existingPairs: ', existingPairs);
                const pairsToFetch = [];

                for (const pair of pairs) {
                    // console.log('sLFeatV2 rERD pair: ', pair);
                    if (!existingPairs.includes(pair)) {
                        pairsToFetch.push(pair);
                        // console.log('sLFeatV2 rERD existing pairs not include pair');
                    } else {
                        // console.log('sLFeatV2 rERD existing pairs includes pair');
                    }
                }

                // console.log('sLFeatV2 rERD pairsToFetch: ', pairsToFetch);
                if (list.ranksDataWithColors === undefined || pairsToFetch.length) {
                    // console.log('sLFeatV2 rERD no list ranks with colors or pairs to fetch not empty');
                    const ranksData = await this.getHeatmapDataV2(pairsToFetch);
                    // console.log('sLFeatV2 rERD ranksData: ', ranksData);
                    
                    const updatedRanksData = list.ranksDataWithColors !== undefined ? {...list.ranksDataWithColors, ...ranksData} : {...ranksData};
                    // console.log('sLFeatV2 rERD updatedRanksData: ', updatedRanksData);

                    list.ranksDataWithColors = {...updatedRanksData};
                } else {
                    // console.log('sLFeatV2 rERD no pairs to fetch');
                }

                return list;
            },

            async initializeListV2(list: RelStrStockList) {
                // Optimistically select immediately so UI highlights even if data resolution fails
                patchState(store, { selectedStockListV2: { ...list } });

                try {
                    const resolved = await this.resolveExistingRanksDataV2({ ...list });
                    const allStockListsV2 = this.sortListsV2(resolved, [...store.allStockListsV2()]);
                    patchState(store, { allStockListsV2, selectedStockListV2: resolved });
                } catch (e) {
                    console.error('[StockListFeatureV2] initializeListV2 resolution failed', e);
                    // Keep optimistic selection; do not throw to avoid breaking click handling
                }
            },

            async saveListV2(list: RelStrStockList) {
                console.log('[StockListFeatureV2] saveList called', { mode: store.formModeV2(), list });
                let allStockListsV2 = [...store.allStockListsV2()];
                 // console.log('wSLFeatV2 sL save list. input formMode/list: ', store.formModeV2(), {...list});
                 list = await this.resolveExistingRanksDataV2(list);
                 if (store.formModeV2() === FormMode.EDIT) {
                     // console.log('wSLFeatV2 sL allStockListsV2 post filter pre save: ', allStockListsV2);
                     allStockListsV2 = this.sortListsV2(list, allStockListsV2);
                 } else {
                     allStockListsV2 = [...store.allStockListsV2(), list];
                 }
                 // console.log('wSLFeatV2 sL list with ranks data: ', {...list});
                 console.log('[StockListFeatureV2] patching state with new list count', { count: allStockListsV2.length });
                 patchState(store, {allStockListsV2, selectedStockListV2: list});
                 // Attempt to register pairs in backend registry (fire-and-forget semantics acceptable)
                 try {
                     const registered = await relStrDbService.registerPairs(list);
                     console.log('[StockListFeatureV2] registerPairs result', { registeredCount: registered?.length });
                 } catch (e) {
                     console.error('[StockListFeatureV2] registerPairs failed', e);
                 }
             },

            sortListsV2(targetList: RelStrStockList, allStockListsV2: RelStrStockList[]) {
                let lists: RelStrStockList[] = [];
                for (const list of allStockListsV2) {
                    if (list.name !== targetList.name) {
                        lists.push(list);
                    } else {
                        lists.push(targetList);
                    }
                }

                return lists;
            },

            async deleteStockListV2(listOrName: string | RelStrStockList) {
                const name = typeof listOrName === 'string' ? listOrName : listOrName.name;
                // console.log('wSLFeatV2 dSL delete stock list: ', name);
                const stockLists = store.allStockListsV2().filter(l => l.name !== name);
                patchState(store, { allStockListsV2: stockLists });

                // If we have the full list, unregister pairs. If only a name was provided, try to resolve it.
                const listObj = typeof listOrName === 'string'
                    ? store.allStockListsV2().find(l => l.name === name)
                    : listOrName;
                if (listObj) {
                    try { await relStrDbService.unregisterPairs(listObj); } catch {}
                }
            },

            // RANKS DATA
            getRanksDataForPairV2(pair: string) {
                return relStrDbService.getRanksData(pair);
            },

            saveRanksDataV2(pair: string, data: RanksByDate) {
                relStrDbService.setRanksData(pair, data);
            },
        })),

        // STOCK LIST FORM STATE
        withMethods((store) => ({
            setFormModeV2(formModeV2: FormMode) {patchState(store, {formModeV2})},

            setShowFormV2(showFormV2: boolean) {patchState(store, {showFormV2})},

            setFormDataV2(formDataV2: RelStrStockList) {
                // console.log('wSLFeatV2 sFD input form data: ', formDataV2);
                patchState(store, {formDataV2})
            },
        })),
    )
}