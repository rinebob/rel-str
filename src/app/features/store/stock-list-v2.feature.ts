import { patchState, signalStoreFeature, withComputed, withMethods, withState } from "@ngrx/signals"
import { BaselineTargetRankDatum, FormMode, RanksByDate, RanksDataWithColors, RelStrStockList, StockDatum, StockListFormMode } from "../shared/types/rs.interfaces"
import { StockDataService } from "../services/stock-data.service"
import { inject } from "@angular/core"
import { RelStrDbV2Service } from "../services/rel-str-db-v2.service"
import { generatePairData, getPairsForList } from "../utils/rs-calc-utils-v2"
import { RsCalcsStore } from "./rs-calcs.store"
import { firstValueFrom, Subscription } from 'rxjs'

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
        withMethods((
            store,
            relStrDbService = inject(RelStrDbV2Service),
            stockDataService = inject(StockDataService),
        ) => ({

            // STOCK DATA
            async getHistoricalDataForSymbolV2(symbol: string): Promise<StockDatum[]> {
                try { return await stockDataService.getStockDataBySymbol(symbol); } catch { return []; }
            },

            async getSupportedSymbolsListV2() {
                const companies = await firstValueFrom(relStrDbService.getTrackedSymbols$());
                const supportedSymbolsListV2 = companies.map(c => c.symbol);
                // console.log('[StockListV2] supportedSymbolsListV2', supportedSymbolsListV2);
                patchState(store, {supportedSymbolsListV2});
            },

            // BASELINE/TARGET RANKS DATA (PAIRS DATA)
            async getSupportedPairsListV2() {
                const supportedPairsListV2 = await firstValueFrom(relStrDbService.getSupportedPairsList$());
                // console.log('[StockListV2] supportedPairsListV2', supportedPairsListV2);
                patchState(store, { supportedPairsListV2 });
            },

        })),

        // STOCK LISTS
        withMethods((
            store,
            rsCalcsStore = inject(RsCalcsStore),
            relStrDbService = inject(RelStrDbV2Service),
        ) => {
            const liveSubs = new Map<string, Subscription>();

            const sortListsV2 = (targetList: RelStrStockList, allStockListsV2: RelStrStockList[]) => {
                const lists: RelStrStockList[] = [];
                for (const list of allStockListsV2) {
                    lists.push(list.name !== targetList.name ? list : targetList);
                }
                return lists;
            };

            const generateHeatmapDataV2 = async (pair: string): Promise<BaselineTargetRankDatum[]> => {
                // Source of truth: pairs-data/{PAIR}. Map series to colored heatmap rows.
                const series = await firstValueFrom(relStrDbService.getPairSeriesLive$(pair));
                // DEBUG: surface what we received from Firestore
                // eslint-disable-next-line no-console
                console.debug('[V2] pair series', pair, 'len=', series?.length ?? 0, 'first=', series?.[0]);
                if (!Array.isArray(series) || series.length === 0) {
                    // eslint-disable-next-line no-console
                    console.debug('[V2] no series data for pair; check doc path pairs-data/', pair);
                    return [];
                }
                const colors = rsCalcsStore.heatmapColors();
                return series.map(d => {
                    const idx = Math.floor(d.value * (colors.length - 1));
                    const color = colors[Math.max(0, Math.min(colors.length - 1, idx))];
                    return { date: d.date, value: d.value, index: idx, color, phase: d.phase, placeholder: false } as BaselineTargetRankDatum;
                });
            };

            const getHeatmapDataV2 = async (pairs: string[]): Promise<RanksDataWithColors> => {
                const out: RanksDataWithColors = {};
                // First pass: fetch per-pair arrays and build union of dates
                const perPair: Record<string, BaselineTargetRankDatum[]> = {};
                const dateSet = new Set<string>();
                for (const pair of pairs) {
                    const arr = await generateHeatmapDataV2(pair);
                    perPair[pair] = arr;
                    for (const d of arr) dateSet.add(d.date);
                }
                const allDates = Array.from(dateSet.values()).sort((a, b) => a.localeCompare(b));

                // Second pass: align each pair to the union-of-dates, inserting placeholders where missing
                const colors = rsCalcsStore.heatmapColors();
                const placeholderColor = '#cccccc';
                for (const pair of pairs) {
                    const byDate = new Map<string, BaselineTargetRankDatum>();
                    (perPair[pair] || []).forEach(d => byDate.set(d.date, d));
                    const aligned: BaselineTargetRankDatum[] = allDates.map(date => {
                        const hit = byDate.get(date);
                        if (hit) return hit;
                        // Placeholder datum for missing cell
                        return {
                            date,
                            value: 0,
                            index: 0,
                            color: placeholderColor,
                            placeholder: true,
                        } as BaselineTargetRankDatum;
                    });
                    out[pair] = aligned;
                }
                return out;
            };

            const resolveExistingRanksDataV2 = async (list: RelStrStockList): Promise<RelStrStockList> => {
                const pairs = getPairsForList(list);
                const existingPairs = !!list.ranksDataWithColors ? Object.keys(list.ranksDataWithColors) : [];
                const pairsToFetch: string[] = [];
                for (const pair of pairs) if (!existingPairs.includes(pair)) pairsToFetch.push(pair);
                if (list.ranksDataWithColors === undefined || pairsToFetch.length) {
                    const ranksData = await getHeatmapDataV2(pairsToFetch);
                    const updatedRanksData = list.ranksDataWithColors !== undefined
                        ? { ...list.ranksDataWithColors, ...ranksData }
                        : { ...ranksData };
                    list.ranksDataWithColors = { ...updatedRanksData };
                }
                return list;
            };

            const stopLivePairSubscriptions = () => {
                for (const sub of liveSubs.values()) { try { sub.unsubscribe(); } catch {} }
                liveSubs.clear();
            };

            const startLivePairSubscriptionsForList = (list: RelStrStockList) => {
                stopLivePairSubscriptions();
                const pairs = getPairsForList(list);
                for (const pairId of pairs) {
                    const sub = relStrDbService.getPairSeriesLive$(pairId).subscribe(series => {
                        const colors = rsCalcsStore.heatmapColors();
                        const mapped: BaselineTargetRankDatum[] = series.map(d => {
                            const idx = Math.floor(d.value * (colors.length - 1));
                            const color = colors[idx];
                            return { date: d.date, value: d.value, index: idx, color, phase: d.phase, placeholder: false } as BaselineTargetRankDatum;
                        });

                        const current = store.selectedStockListV2();
                        const isSameList = current?.name === list.name;
                        const baseList = isSameList ? { ...current } : { ...list };
                        const existing = baseList.ranksDataWithColors ?? {} as RanksDataWithColors;
                        const updated: RanksDataWithColors = { ...existing, [pairId]: mapped };
                        baseList.ranksDataWithColors = updated;

                        const others = store.allStockListsV2().filter(l => l.name !== baseList.name);
                        const allStockListsV2 = sortListsV2(baseList, [...others, baseList]);
                        patchState(store, { selectedStockListV2: baseList, allStockListsV2 });
                    });
                    liveSubs.set(pairId, sub);
                }
            };

            return {
                // LISTS
                async getListsForUserV2(userId: string) {
                    const allStockListsV2 = await relStrDbService.getListsForUser(userId);
                    patchState(store, { allStockListsV2 });
                },

                async saveStockListForUserV2(userId: string, list: RelStrStockList) {
                    await relStrDbService.saveStockList(userId, list);
                    const existing = store.allStockListsV2().some(l => l.name === list.name);
                    const base = existing ? [...store.allStockListsV2()] : [...store.allStockListsV2(), list];
                    const allStockListsV2 = sortListsV2(list, base);
                    patchState(store, { allStockListsV2, selectedStockListV2: list });
                    try { await relStrDbService.registerPairs(list); } catch (e) { console.error('[StockListFeatureV2] registerPairs failed', e); }
                },

                async deleteStockListForUserV2(userId: string, listName: string) {
                    const listObj = store.allStockListsV2().find(l => l.name === listName);
                    if (listObj) { try { await relStrDbService.unregisterPairs(listObj); } catch {} }
                    await relStrDbService.deleteStockList(userId, listName);
                    const stockLists = store.allStockListsV2().filter(l => l.name !== listName);
                    patchState(store, { allStockListsV2: stockLists });
                },

                async renameStockListForUserV2(userId: string, oldName: string, newList: RelStrStockList) {
                    await relStrDbService.renameStockList(userId, oldName, newList);
                    const others = store.allStockListsV2().filter(l => l.name !== oldName);
                    const allStockListsV2 = sortListsV2(newList, [...others, newList]);
                    patchState(store, { allStockListsV2, selectedStockListV2: newList });
                    try { await relStrDbService.registerPairs(newList); } catch (e) { console.error('[StockListFeatureV2] registerPairs (rename) failed', e); }
                },

                setAllStockListsV2(allStockListsV2: RelStrStockList[]) { patchState(store, { allStockListsV2 }); },
                setSelectedStockListV2(selectedStockListV2: RelStrStockList){ patchState(store, { selectedStockListV2 }) },
                updateStockListV2(list: RelStrStockList) {
                    const allStockListsV2 = store.allStockListsV2().filter(l => l.name !== list.name);
                    allStockListsV2.push({ ...list });
                    patchState(store, { allStockListsV2, selectedStockListV2: { ...list } })
                },

                async generateHeatmapDataV2(pair: string): Promise<BaselineTargetRankDatum[]> { return generateHeatmapDataV2(pair); },
                async getHeatmapDataV2(pairs: string[]): Promise<RanksDataWithColors> { return getHeatmapDataV2(pairs); },
                async resolveExistingRanksDataV2(list: RelStrStockList): Promise<RelStrStockList> { return resolveExistingRanksDataV2(list); },
                sortListsV2(targetList: RelStrStockList, allStockListsV2: RelStrStockList[]) { return sortListsV2(targetList, allStockListsV2); },

                async initializeListV2(list: RelStrStockList) {
                    patchState(store, { selectedStockListV2: { ...list } });
                    try {
                        const resolved = await resolveExistingRanksDataV2({ ...list });
                        const allStockListsV2 = sortListsV2(resolved, [...store.allStockListsV2()]);
                        patchState(store, { allStockListsV2, selectedStockListV2: resolved });
                        // Live subscriptions temporarily disabled during stabilization
                    } catch (e) {
                        console.error('[StockListFeatureV2] initializeListV2 resolution failed', e);
                    }
                },

                async saveListV2(list: RelStrStockList) {
                    console.log('[StockListFeatureV2] saveList called', { mode: store.formModeV2(), list });
                    let allStockListsV2 = [...store.allStockListsV2()];
                    list = await resolveExistingRanksDataV2(list);
                    if (store.formModeV2() === FormMode.EDIT) {
                        allStockListsV2 = sortListsV2(list, allStockListsV2);
                    } else {
                        allStockListsV2 = [...store.allStockListsV2(), list];
                    }
                    console.log('[StockListFeatureV2] patching state with new list count', { count: allStockListsV2.length });
                    patchState(store, { allStockListsV2, selectedStockListV2: list });
                },

                async deleteStockListV2(listOrName: string | RelStrStockList) {
                    const name = typeof listOrName === 'string' ? listOrName : listOrName.name;
                    const stockLists = store.allStockListsV2().filter(l => l.name !== name);
                    patchState(store, { allStockListsV2: stockLists });
                    const listObj = typeof listOrName === 'string' ? store.allStockListsV2().find(l => l.name === name) : listOrName;
                    if (listObj) { try { await relStrDbService.unregisterPairs(listObj); } catch {} }
                },

                // RANKS DATA
                getRanksDataForPairV2(pair: string) { return relStrDbService.getRanksData(pair); },
                saveRanksDataV2(pair: string, data: RanksByDate) { relStrDbService.setRanksData(pair, data); },
            };
        }),

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