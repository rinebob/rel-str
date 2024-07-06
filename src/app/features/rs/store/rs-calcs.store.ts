import { signalStore, withState, withMethods, withComputed, patchState } from "@ngrx/signals";
import { DataSet, RelStrTableData } from "../common/interfaces-rs";

type RelStrCalcState = {
    allData: DataSet,
    relStrTableData: RelStrTableData,
    heatmapColors: string[],
}

const initialState: RelStrCalcState = {
    allData: {},
    relStrTableData: {
		symbols: [],
		dates: [],
		data: [[]],
	},
    heatmapColors: [],
}

export const RsCalcsStore = signalStore(
    { providedIn: 'root'},
    withState(initialState),
    withMethods((store) => ({
        setAllData(allData: DataSet){patchState(store, {allData})},
        setRelStrTableData(relStrTableData: RelStrTableData){patchState(store, {relStrTableData})},
        setHeatmapColors(heatmapColors: string[]){patchState(store, {heatmapColors})},

    })),
    withComputed(() => ({})),
);