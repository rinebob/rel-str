import { signalStore, withState, withMethods, withComputed, patchState } from "@ngrx/signals";
import { DataSet, RelStrTableData } from "../common/interfaces-rs";

type RelStrCalcState = {
    allData: DataSet,
    relStrTableData: RelStrTableData,
}

const initialState: RelStrCalcState = {
    allData: {},
    relStrTableData: {
		symbols: [],
		dates: [],
		data: [[]],
	},
}

export const RsCalcsStore = signalStore(
    { providedIn: 'root'},
    withState(initialState),
    withMethods((store) => ({
        setAllData(allData: DataSet){patchState(store, {allData})},
        setRelStrTableData(relStrTableData: RelStrTableData){patchState(store, {relStrTableData})},
    })),
    withComputed(() => ({})),
);