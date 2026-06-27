/**
 * RhAgentSymbolListStore
 *
 * Manages user-defined symbol lists for the RH Agent grouped review.
 * Responsibilities:
 * - Load symbol lists from Firestore
 * - Track active list filter
 * - Toggle/add/remove symbols in named lists
 *
 * The store owns the local reactive state; persistence is delegated to
 * RhAgentSymbolListService.
 */
import { inject } from '@angular/core';
import {
  signalStore,
  withState,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { Observable, forkJoin } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';

import { RhAgentSymbolListService } from '../services/rh-agent-symbol-list.service';
import { RhSymbolListName, ALL_SYMBOL_LIST_NAMES } from '../common/rh-agent.constants';

export interface RhAgentSymbolListState {
  /** User-defined symbol lists: listName -> symbols[]. */
  symbolLists: Record<string, string[]>;
  /** Loading state for symbol lists. */
  symbolListsLoading: boolean;
  /** Active list filter — 'ALL' shows everything. */
  activeListFilter: string | 'ALL';
}

const initialState: RhAgentSymbolListState = {
  symbolLists: {},
  symbolListsLoading: false,
  activeListFilter: 'ALL',
};

export const RhAgentSymbolListStore = signalStore(
  withState(initialState),
  withMethods((
    state,
    listService = inject(RhAgentSymbolListService),
    snackBar = inject(MatSnackBar),
  ) => ({
    /** Load all user-defined symbol lists from Firestore. */
    loadSymbolLists(): void {
      patchState(state, { symbolListsLoading: true });

      listService.loadAllLists().subscribe({
        next: (lists) => {
          const record: Record<string, string[]> = {};
          for (const list of lists) {
            record[list.name] = list.symbols.map((s) => s.toUpperCase());
          }
          patchState(state, { symbolLists: record, symbolListsLoading: false });
        },
        error: (err: any) => {
          console.error('[RhAgentSymbolListStore] Failed to load symbol lists:', err);
          patchState(state, { symbolListsLoading: false });
          snackBar.open('Failed to load symbol lists', 'Dismiss', { duration: 5000 });
        },
      });
    },

    /** Set the active list filter for the grouped review. */
    setActiveListFilter(filter: string | 'ALL'): void {
      patchState(state, { activeListFilter: filter });
    },

    /**
     * Toggle a symbol's membership in a named list.
     * List membership is exclusive: a symbol can only be in one list at a time.
     * Selecting a new list removes the symbol from every other list.
     */
    toggleSymbolInList(symbol: string, listName: string | RhSymbolListName): void {
      const normalized = symbol.toUpperCase();
      const current = { ...state.symbolLists() };
      const list = current[listName] ?? [];
      const isInList = list.includes(normalized);
      const previousLists = { ...current };

      if (isInList) {
        // Toggle off: remove from this list only
        current[listName] = list.filter((s) => s !== normalized);
      } else {
        // Toggle on: add to this list, remove from all other lists
        current[listName] = [...list, normalized];
        for (const otherName of ALL_SYMBOL_LIST_NAMES) {
          if (otherName !== listName) {
            const otherList = current[otherName] ?? [];
            if (otherList.includes(normalized)) {
              current[otherName] = otherList.filter((s) => s !== normalized);
            }
          }
        }
      }
      patchState(state, { symbolLists: current });

      // Persist the target list change
      const target$ = isInList
        ? listService.removeFromList(symbol, listName)
        : listService.addToList(symbol, listName);

      // Persist removals from other lists
      const removalObservables: Observable<void>[] = [];
      if (!isInList) {
        for (const otherName of ALL_SYMBOL_LIST_NAMES) {
          if (otherName !== listName) {
            const otherList = previousLists[otherName] ?? [];
            if (otherList.includes(normalized)) {
              removalObservables.push(listService.removeFromList(symbol, otherName));
            }
          }
        }
      }

      forkJoin([target$, ...removalObservables]).subscribe({
        error: (err: any) => {
          console.error(`[RhAgentSymbolListStore] Failed to toggle ${symbol} in ${listName}:`, err);
          snackBar.open(`Failed to save ${symbol} to ${listName}: ${err?.message ?? 'Unknown error'}`, 'Dismiss', {
            duration: 5000,
          });
          // Revert local change on failure
          patchState(state, { symbolLists: previousLists });
        },
      });
    },

    /** Add a symbol to a named list. */
    addSymbolToList(symbol: string, listName: string | RhSymbolListName): void {
      const normalized = symbol.toUpperCase();
      const current = { ...state.symbolLists() };
      const list = current[listName] ?? [];
      if (list.includes(normalized)) return;
      current[listName] = [...list, normalized];
      patchState(state, { symbolLists: current });

      listService.addToList(symbol, listName).subscribe({
        error: (err: any) => {
          console.error(`[RhAgentSymbolListStore] Failed to add ${symbol} to ${listName}:`, err);
          patchState(state, {
            symbolLists: {
              ...state.symbolLists(),
              [listName]: state.symbolLists()[listName]?.filter((s) => s !== normalized) ?? [],
            },
          });
        },
      });
    },

    /** Remove a symbol from a named list. */
    removeSymbolFromList(symbol: string, listName: string | RhSymbolListName): void {
      const normalized = symbol.toUpperCase();
      const current = { ...state.symbolLists() };
      const list = current[listName] ?? [];
      current[listName] = list.filter((s) => s !== normalized);
      patchState(state, { symbolLists: current });

      listService.removeFromList(symbol, listName).subscribe({
        error: (err: any) => {
          console.error(`[RhAgentSymbolListStore] Failed to remove ${symbol} from ${listName}:`, err);
          patchState(state, {
            symbolLists: {
              ...state.symbolLists(),
              [listName]: [...(state.symbolLists()[listName] ?? []), normalized],
            },
          });
        },
      });
    },
  })),
);
