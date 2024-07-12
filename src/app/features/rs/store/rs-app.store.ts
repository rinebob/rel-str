import { signalStore, withState, withMethods, withComputed, patchState } from "@ngrx/signals";
import { withStockListFeature } from "./stock-list.feature";

type RsAppState = {
}

const initialState: RsAppState = {
}

export const RsAppStore = signalStore(
    { providedIn: 'root'},
    withState(initialState),
    withStockListFeature(),
    withComputed(() => ({})),
    withMethods((store) => ({
        

    })),
);