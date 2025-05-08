import { signalStore, withState, withMethods } from '@ngrx/signals';

interface RsDataState {
  // TODO: define state shape for fetched RS data
}

const initialState: RsDataState = {
  // TODO: add initial state properties
};

export const RsDataStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store) => ({
    // TODO: add methods
  }))
);

