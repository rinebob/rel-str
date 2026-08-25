/**
 * SymbolListStore
 *
 * Manages user-defined symbol lists for the Savant Trader grouped review.
 * Responsibilities:
 * - Load symbol lists from Firestore
 * - Track active list filter
 * - Toggle/add/remove symbols in named lists
 *
 * The store owns the local reactive state; persistence is delegated to
 * SymbolListService.
 */
import { inject } from '@angular/core';
import {
  signalStore,
  withState,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { MatSnackBar } from '@angular/material/snack-bar';

import { SymbolListService } from '../services/symbol-list.service';
import { SymbolListName, ALL_SYMBOL_LIST_NAMES } from '../common/constants';

export interface SymbolListState {
  /** User-defined symbol lists: listName -> symbols[]. */
  symbolLists: Record<string, string[]>;
  /** Loading state for symbol lists. */
  symbolListsLoading: boolean;
  /** Active list filter â€” 'ALL' shows everything. */
  activeListFilter: SymbolListName | 'ALL';
}

const initialState: SymbolListState = {
  symbolLists: {},
  symbolListsLoading: false,
  activeListFilter: 'ALL',
};

export const SymbolListStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((
    state,
    listService = inject(SymbolListService),
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
        error: (err: unknown) => {
          console.error('[SymbolListStore] Failed to load symbol lists:', err);
          patchState(state, { symbolListsLoading: false });
          snackBar.open('Failed to load symbol lists', 'Dismiss', { duration: 5000 });
        },
      });
    },

    /** Set the active list filter for the grouped review. */
    setActiveListFilter(filter: SymbolListName | 'ALL'): void {
      patchState(state, { activeListFilter: filter });
    },

    /**
     * Toggle a symbol's membership in a named list.
     * List membership is exclusive: a symbol can only be in one list at a time.
     * Uses an atomic Firestore batch write to guarantee consistency.
     */
    toggleSymbolInList(symbol: string, listName: string | SymbolListName): void {
      const normalized = symbol.toUpperCase();
      const previousLists = state.symbolLists();
      const isInList = (previousLists[listName] ?? []).includes(normalized);

      // Build the next state immutably: every list gets a fresh array.
      const nextLists: Record<string, string[]> = {};
      for (const name of Object.keys(previousLists)) {
        const sourceList = previousLists[name] ?? [];
        if (name === listName) {
          nextLists[name] = isInList
            ? sourceList.filter((s) => s !== normalized)
            : [...sourceList, normalized];
        } else if (!isInList) {
          nextLists[name] = sourceList.filter((s) => s !== normalized);
        } else {
          nextLists[name] = [...sourceList];
        }
      }
      if (!isInList && !(listName in nextLists)) {
        nextLists[listName] = [normalized];
      }
      patchState(state, { symbolLists: nextLists });

      // Atomic persist: add to target list and remove from all others in one batch.
      // If toggling OFF (isInList=true), targetList is null (remove from all).
      const targetList = isInList ? null : (listName as string);
      listService.moveToList(symbol, targetList, ALL_SYMBOL_LIST_NAMES.map(n => n as string)).subscribe({
        error: (err: unknown) => {
          const message = err instanceof Error ? err.message : 'Unknown error';
          console.error(`[SymbolListStore] Failed to toggle ${symbol} in ${listName}:`, err);
          snackBar.open(`Failed to save ${symbol} to ${listName}: ${message}`, 'Dismiss', {
            duration: 5000,
          });
          // Revert local change on failure
          patchState(state, { symbolLists: previousLists });
        },
      });
    },

    /** Add a symbol to a named list. */
    addSymbolToList(symbol: string, listName: string | SymbolListName): void {
      const normalized = symbol.toUpperCase();
      const current = { ...state.symbolLists() };
      const list = current[listName] ?? [];
      if (list.includes(normalized)) return;
      current[listName] = [...list, normalized];
      patchState(state, { symbolLists: current });

      listService.addToList(symbol, listName).subscribe({
        error: (err: unknown) => {
          console.error(`[SymbolListStore] Failed to add ${symbol} to ${listName}:`, err);
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
    removeSymbolFromList(symbol: string, listName: string | SymbolListName): void {
      const normalized = symbol.toUpperCase();
      const current = { ...state.symbolLists() };
      const list = current[listName] ?? [];
      current[listName] = list.filter((s) => s !== normalized);
      patchState(state, { symbolLists: current });

      listService.removeFromList(symbol, listName).subscribe({
        error: (err: unknown) => {
          console.error(`[SymbolListStore] Failed to remove ${symbol} from ${listName}:`, err);
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
