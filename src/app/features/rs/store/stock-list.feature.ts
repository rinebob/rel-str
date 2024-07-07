import { patchState, signalStoreFeature, withComputed, withMethods, withState } from "@ngrx/signals"
import { FormMode, RelStrStockList, StockListFormMode } from "../common/interfaces-rs"


export type StockListState = {
    allStockLists: RelStrStockList[],
    selectedStockList: RelStrStockList,

    formMode: StockListFormMode,
    showForm: boolean,
    formData: RelStrStockList,

}

export const initialState: StockListState = {
    allStockLists: [],
    selectedStockList: {name: '', baseline: '', symbols: []},

    formMode: FormMode.CREATE,
    showForm: false,
    formData: {name: '', baseline: '', symbols: []}
}

export function withStockListFeature() {
    return signalStoreFeature(
        withState<StockListState>(initialState),

        withComputed((state) => ({

        })),

        withMethods((store) => ({

            setAllStockLists(allStockLists: RelStrStockList[]) {
                // console.log('wSLFeat sASL set all stock lists: ', allStockLists);
                patchState(store, {allStockLists})
            },
            
            setSelectedStockList(selectedStockList: RelStrStockList){
                // console.log('wSLFeat sASL set selected stock list: ', selectedStockList);
                patchState(store, {selectedStockList})
            },

            deleteStockList(name: string) {
                // console.log('wSLFeat dSL delete stock list: ', name);
                const stockLists = store.allStockLists().filter(list => list.name !== name);
                patchState(store, {allStockLists: stockLists});
            },

            setFormMode(formMode: FormMode) {patchState(store, {formMode})},
            setShowForm(showForm: boolean) {patchState(store, {showForm})},
            setFormData(formData: RelStrStockList) {
                // console.log('wSLFeat sFD input form data: ', formData);
                patchState(store, {formData})
            },

            saveList() {
                const formData = store.formData();
                let allStockLists = [...store.allStockLists()];
                // console.log('wSLFeat sL save list. input form data: ', formData);
                if (store.formMode() === FormMode.EDIT) {
                    
                    allStockLists = store.allStockLists().filter(l => l.name !== store.selectedStockList()?.name);
                    allStockLists = [...allStockLists, formData];
                    
                } else {
                    allStockLists = [...store.allStockLists(), formData];
                    
                }

                patchState(store, {allStockLists});
                // console.log('wSLFeat sL final allStockLists: ', store.allStockLists());
            },

        })),
    )
}