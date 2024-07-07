import { signalStore, withState, withMethods, withComputed, patchState } from "@ngrx/signals";
import { withStockListFeature } from "./stock-list.feature";

type RsAppState = {
    // allStockLists: RelStrStockList[],
    // stockList: RelStrStockList | undefined,
}

const initialState: RsAppState = {
    // allStockLists: [],
    // stockList: undefined,
}

export const RsAppStore = signalStore(
    { providedIn: 'root'},
    withState(initialState),
    withStockListFeature(),
    withComputed(() => ({})),
    withMethods((store) => ({
        

    })),
);