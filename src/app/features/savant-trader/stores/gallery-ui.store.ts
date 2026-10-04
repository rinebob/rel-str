/**
 * Gallery UI Store
 *
 * Page-local UI state for the gallery view page (#743/#754): timeframe /
 * direction / list filters and the active sort. Domain data (run, signals,
 * lists, tickets) stays in the existing domain stores — see GalleryFacade.
 * The list filter is gallery-local (unlike signal-review, which shares
 * SymbolListStore.activeListFilter) so it defaults to 'ALL' without
 * disturbing other surfaces.
 */
import {
  signalStore,
  withState,
  withMethods,
  patchState,
} from '@ngrx/signals';

import { SignalDirection, SignalTimeframe, SymbolListFilter } from '../common/constants';
import { GallerySortKey } from '../utils/gallery-cards.util';

export interface GalleryUiState {
  timeframe: SignalTimeframe;
  direction: SignalDirection;
  listFilter: SymbolListFilter;
  sort: GallerySortKey;
}

const initialState: GalleryUiState = {
  timeframe: SignalTimeframe.ALL,
  direction: SignalDirection.ALL,
  listFilter: 'ALL',
  sort: 'sector',
};

export const GalleryUiStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withMethods((state) => ({
    setTimeframe(timeframe: SignalTimeframe): void {
      patchState(state, { timeframe });
    },
    setDirection(direction: SignalDirection): void {
      patchState(state, { direction });
    },
    setListFilter(listFilter: SymbolListFilter): void {
      patchState(state, { listFilter });
    },
    setSort(sort: GallerySortKey): void {
      patchState(state, { sort });
    },
    /** Re-apply page-entry defaults (called on every gallery enter). */
    resetForPage(): void {
      patchState(state, initialState);
    },
  })),
);
