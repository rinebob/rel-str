import { signalStore, withState, withMethods, withComputed, patchState } from "@ngrx/signals";
import { RelStrStockList } from "../common/interfaces-rs";

type RsAppState = {
    allStockLists: RelStrStockList[],
    stockList: RelStrStockList | undefined,
}

const initialState: RsAppState = {
    allStockLists: [],
    stockList: undefined,
}

export const RsAppStore = signalStore(
    { providedIn: 'root'},
    withState(initialState),
    withComputed(() => ({})),
    withMethods((store) => ({
        setAllStockLists(allStockLists: RelStrStockList[]) {
            // console.log('rSSto sASL set all stock lists: ', allStockLists);
            patchState(store, {allStockLists})
        },
        
        setStockList(stockList: RelStrStockList){
            // console.log('rSSto sASL set stock list: ', stockList);
            patchState(store, {stockList})
        },
        
        deleteStockList(name: string) {
            // console.log('rSSto dSL delete stock list: ', name);
            const stockLists = store.allStockLists().filter(list => list.name !== name);
            patchState(store, {allStockLists: stockLists});
        },


    })),
);