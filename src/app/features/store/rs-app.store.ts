import { signalStore, withState, withMethods, withComputed, patchState } from "@ngrx/signals";
import { withStockListFeature } from "./stock-list.feature";
import { withStockListV2Feature } from "./stock-list-v2.feature";

type RsAppState = {
    selectedSymbol: string,
}

const initialState: RsAppState = {
    selectedSymbol: '',
}

export const RsAppStore = signalStore(
    { providedIn: 'root'},
    withState(initialState),
    withStockListFeature(),
    withStockListV2Feature(),
    withComputed(() => ({})),
    withMethods((store) => ({
        
        setSelectedSymbol(selectedSymbol: string) {
            // console.log('rASto sSS set selected symbol: ', selectedSymbol);
            patchState(store, {selectedSymbol});
        },

    })),
);