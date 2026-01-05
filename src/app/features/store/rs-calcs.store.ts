import { signalStore, withState, withMethods, withComputed, patchState } from "@ngrx/signals";
import { DataSet, RelStrTableData, RanksDataWithColors } from "../shared/types/rs.interfaces";

type RelStrCalcState = {
    allData: DataSet,
    relStrTableData: RelStrTableData,
    heatmapColors: string[],
    heatmapCache: Record<string, RanksDataWithColors>,
}

const initialState: RelStrCalcState = {
    allData: {},
    relStrTableData: {
		symbols: [],
		dates: [],
		data: [[]],
	},
    heatmapColors: [],
    heatmapCache: {},
}

export const RsCalcsStore = signalStore(
    { providedIn: 'root'},
    withState(initialState),
    withMethods((store) => ({
        setAllData(allData: DataSet){patchState(store, {allData})},
        setRelStrTableData(relStrTableData: RelStrTableData){patchState(store, {relStrTableData})},
        setHeatmapColors(heatmapColors: string[]){patchState(store, {heatmapColors})},
        setHeatmapCacheEntry(key: string, data: RanksDataWithColors){
            const current = store.heatmapCache();
            patchState(store, { heatmapCache: { ...current, [key]: { ...data } } });
        },
        getHeatmapCacheEntry(key: string): RanksDataWithColors | undefined {
            const current = store.heatmapCache();
            return current[key];
        },

    })),
    withComputed(() => ({})),
);