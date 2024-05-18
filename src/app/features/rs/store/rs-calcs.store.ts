import { signalStore, withState, withMethods, withComputed } from "@ngrx/signals";

type RelStrCalcState = {

}

const initialState: RelStrCalcState = {

}

export const RsCalcsStore = signalStore(
    { providedIn: 'root'},
    withState(initialState),
    withMethods((store) => ({})),
    withComputed(() => ({})),
);