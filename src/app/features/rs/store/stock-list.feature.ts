import { patchState, signalStoreFeature, withComputed, withMethods, withState } from "@ngrx/signals"
import { BaselineTargetRankDatum, FormMode, ListAction, RanksByDate, RanksDataWithColors, RelStrStockList, StockDatum, StockListFormMode } from "../common/interfaces-rs"
import { StockDataService } from "../services/stock-data.service"
import { inject } from "@angular/core"
import { RelStrDbService } from "../services/rel-str-db.service"
import { generatePairData, getPairsForList } from "../utils/rs-calc-utils"
import { RANKS_WITH_COLORS_BY_SYMBOL } from "../data/stocks"
import { RsCalcsStore } from "./rs-calcs.store"


export type StockListState = {
    allStockLists: RelStrStockList[],
    selectedStockList: RelStrStockList,

    // list of all stock symbols currently in the database
    supportedSymbolsList: string[],

    // list of all baseline/target pairs for which ranks data exists in the db
    supportedPairsList: string[],

    formMode: StockListFormMode,
    showForm: boolean,
    formData: RelStrStockList,

}

export const initialState: StockListState = {
    allStockLists: [],
    selectedStockList: {name: '', baseline: '', symbols: []},
    supportedSymbolsList: [],
    supportedPairsList: [],

    formMode: FormMode.CREATE,
    showForm: false,
    formData: {name: '', baseline: '', symbols: []}
}

export function withStockListFeature() {
    return signalStoreFeature(
        withState<StockListState>(initialState),

        withComputed((state) => ({

        })),

        withMethods((
            store,
            relStrDbService = inject(RelStrDbService),
            stockDataService = inject(StockDataService),
        ) => ({

            // STOCK DATA
            getHistoricalDataForSymbol(symbol: string) {
                // console.log('sLFeat gDFS get data for symbol: ', symbol);

                const symbols: string[] = relStrDbService.getSupportedSymbolsList();

                // if the data already exists in RS db, fetch from there
                if (symbols.includes(symbol)) {
                    return relStrDbService.getDataForSymbol(symbol);
                } else {
                    // else make a call to fetch historical data for a new symbol
                    return stockDataService.getStockDataBySymbol(symbol);
                }
            },

            saveHistoricalData(symbol: string, data: StockDatum[]) {
                relStrDbService.saveHistoricalData(symbol, data);
            },

            updateData(symbol: string, data: StockDatum) {
                relStrDbService.updateData(symbol, data);
            },

            getSupportedSymbolsList() {
                const supportedSymbolsList = relStrDbService.getSupportedSymbolsList();
                // console.log('sLFeat gSSL supportedSymbolsList: ', supportedSymbolsList)
                patchState(store, {supportedSymbolsList});
            },

            updateSupportedSymbolsList(symbol: string, action: ListAction) {
                relStrDbService.updateSupportedSymbolsList(symbol, action);
            },

            // BASELINE/TARGET RANKS DATA (PAIRS DATA)

            getSupportedPairsList() {
                const supportedPairsList = relStrDbService.getSupportedPairsList();
                // console.log('sLFeat gSSL supportedPairsList: ', supportedPairsList)
                patchState(store, {supportedPairsList});
            },

            updateSupportedPairsList(pair: string, action: ListAction) {
                relStrDbService.updateSupportedPairsList(pair, action);
            },

            savePairData(pair: string, data: BaselineTargetRankDatum[]) {
                relStrDbService.savePairData(pair, data);
            }

           
        })),

        // STOCK LISTS
        withMethods((
            store,
            rsCalcsStore = inject(RsCalcsStore),
            relStrDbService = inject(RelStrDbService),
        ) => ({

            // LISTS
            getListsForUser(userId: string) {
                const allStockLists = relStrDbService.getListsForUser(userId);
                patchState(store, {allStockLists});
            },

            saveStockListForUser(userId: string, list: RelStrStockList) {
                relStrDbService.saveStockList(userId, list);
            },

            deleteStockListForUser(userId: string, listName: string) {
                relStrDbService.deleteStockList(userId, listName);
            },

            setAllStockLists(allStockLists: RelStrStockList[]) {
                // console.log('wSLFeat sASL set all stock lists: ', allStockLists);
                patchState(store, {allStockLists});
            },
            
            setSelectedStockList(selectedStockList: RelStrStockList){
                // console.log('wSLFeat sASL set selected stock list: ', selectedStockList);
                patchState(store, {selectedStockList})
            },

            updateStockList(list: RelStrStockList) {
                const allStockLists = store.allStockLists().filter(l => l.name !== list.name)
                allStockLists.push({...list});
                patchState(store, {allStockLists, selectedStockList: {...list}})
            },

            generateHeatmapData(pair: string) {
                // console.log('sLFeat gHD generate heatmap data for pair: ', pair);
                const symbols = pair.split('_');
                const baseline = symbols[0];
                const target = symbols[1];
        
                // console.log('sLFeat gHD pair not in list. creating data set. baseline/target: ', baseline, target);
                const baselineData = store.getHistoricalDataForSymbol(baseline);
                const targetData = store.getHistoricalDataForSymbol(target);
                
                const pairData = generatePairData(baselineData, targetData, rsCalcsStore.heatmapColors());
                // console.log('sLFeat gHD final pairData: ', pairData);
        
                return pairData;
            },

            getHeatmapData(pairs: string[]) {
                let ranksDataWithColors: RanksDataWithColors = {}

                for (const pair of pairs) {
                    // console.log('sLFeat gHD pair: ', pair);
                    let pairData = [];
                    if (store.supportedPairsList().includes(pair)) {
                        // console.log('sLFeat gHD pair in list.  getting data from firebase db');
                        pairData = RANKS_WITH_COLORS_BY_SYMBOL[pair];
                    } else {
                        // console.log('sLFeat gHD pair not in list.  generating pairData and saving to firebase db');
                        pairData = this.generateHeatmapData(pair);
                        store.savePairData(pair, pairData);
                    }
                    ranksDataWithColors[pair] = pairData;
                }

                // console.log('sLFeat gHD final ranksDataWithColors: ', ranksDataWithColors);

                return ranksDataWithColors;
            },

            resolveExistingRanksData(list: RelStrStockList) {
                // console.log('-----------------');
                // const list = store.selectedStockList()
                // console.log('sLFeat rERD selected stock list sub: ', {...list});
                const pairs = getPairsForList(list);
                // console.log('sLFeat rERD pairs: ', pairs);
                const existingPairs = !!list.ranksDataWithColors ? Object.keys(list.ranksDataWithColors) : [];
                // console.log('sLFeat rERD existingPairs: ', existingPairs);
                const pairsToFetch = [];

                for (const pair of pairs) {
                    // console.log('sLFeat rERD pair: ', pair);
                    if (!existingPairs.includes(pair)) {
                        pairsToFetch.push(pair);
                        // console.log('sLFeat rERD existing pairs not include pair');
                    } else {
                        // console.log('sLFeat rERD existing pairs includes pair');
                    }
                }

                // console.log('sLFeat rERD pairsToFetch: ', pairsToFetch);
                // let ranksDataWithColors = {}
                if (list.ranksDataWithColors === undefined || pairsToFetch.length) {
                    // console.log('sLFeat rERD no list ranks with colors or pairs to fetch not empty');
                    const ranksData = this.getHeatmapData(pairsToFetch);
                    // console.log('sLFeat rERD ranksData: ', ranksData);
                    // console.log('sLFeat rERD O.e(ranksData): ', Object.entries(ranksData));
                    
                    const updatedRanksData = list.ranksDataWithColors !== undefined ? {...list.ranksDataWithColors, ...ranksData} : {...ranksData};
                    // console.log('sLFeat rERD updatedRanksData: ', updatedRanksData);

                    list.ranksDataWithColors = {...updatedRanksData};
                } else {
                    // console.log('sLFeat rERD no pairs to fetch');
                }

                return list;
            },

            saveList(list: RelStrStockList) {
                let allStockLists = [...store.allStockLists()];
                // console.log('wSLFeat sL save list. input list: ', {...list});
                if (store.formMode() === FormMode.EDIT) {
                    list = this.resolveExistingRanksData(list)
                    allStockLists = store.allStockLists().filter(l => l.name !== store.selectedStockList()?.name);
                    allStockLists = [...allStockLists, list];
                } else {
                    allStockLists = [...store.allStockLists(), list];
                }
                patchState(store, {allStockLists, selectedStockList: list});
                // console.log('wSLFeat sL final allStockLists: ', store.allStockLists());
            },

            deleteStockList(name: string) {
                // console.log('wSLFeat dSL delete stock list: ', name);
                const stockLists = store.allStockLists().filter(list => list.name !== name);
                patchState(store, {allStockLists: stockLists});
            },

            // RANKS DATA
            getRanksDataForPair(pair: string) {
                return relStrDbService.getRanksData(pair);
            },

            saveRanksData(pair: string, data: RanksByDate) {
                relStrDbService.setRanksData(pair, data);
            },
        })),

        // STOCK LIST FORM STATE
        withMethods((store) => ({
            setFormMode(formMode: FormMode) {patchState(store, {formMode})},

            setShowForm(showForm: boolean) {patchState(store, {showForm})},

            setFormData(formData: RelStrStockList) {
                // console.log('wSLFeat sFD input form data: ', formData);
                patchState(store, {formData})
            },
        })),
    )
}