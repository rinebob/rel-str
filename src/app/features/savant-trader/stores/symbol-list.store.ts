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
import { computed, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { MatSnackBar } from '@angular/material/snack-bar';

import { SymbolListService } from '../services/symbol-list.service';
import { RelStrDbV2Service } from '../../services/rel-str-db-v2.service';
import { SymbolListName, ALL_SYMBOL_LIST_NAMES, type SymbolListFilter } from '../common/constants';
import { isUnlisted, normalizeTrackedSymbols } from '../utils/utils';

export interface SymbolListState {
  /** User-defined symbol lists: listName -> symbols[]. */
  symbolLists: Record<string, string[]>;
  /** Loading state for symbol lists. */
  symbolListsLoading: boolean;
  /** Active list filter â€” 'ALL' shows everything. */
  activeListFilter: SymbolListFilter;
  /** Tracked-symbols universe — the complement base for "No memberships". Lazy. */
  trackedSymbols: string[];
}

const initialState: SymbolListState = {
  symbolLists: {},
  symbolListsLoading: false,
  activeListFilter: SymbolListName.PRIMARY,
  trackedSymbols: [],
};

export const SymbolListStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed((state) => ({
    /** Tracked symbols that belong to no list — the "No memberships" view. */
    unlistedSymbols: computed(() => {
      const membership = state.symbolLists();
      return state.trackedSymbols().filter((s) => isUnlisted(s, membership));
    }),
  })),
  withMethods((
    state,
    listService = inject(SymbolListService),
    relStrDbV2 = inject(RelStrDbV2Service),
    snackBar = inject(MatSnackBar),
    destroyRef = inject(DestroyRef),
  ) => {
    /** Dedupes concurrent tracked-universe loads — one callable round-trip. */
    let trackedInFlight: Promise<string[]> | null = null;

    return {
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
    setActiveListFilter(filter: SymbolListFilter): void {
      patchState(state, { activeListFilter: filter });
    },

    /**
     * Load the tracked-symbols universe once — needed to compute the
     * "No memberships" complement (a symbol is unlisted only if it's
     * tracked AND in zero lists). TTL-cached upstream; the list doesn't
     * change intra-session. Resolves to the loaded (or cached) symbols so
     * callers can await availability.
     */
    loadTrackedSymbols(): Promise<string[]> {
      if (state.trackedSymbols().length > 0) {
        return Promise.resolve(state.trackedSymbols());
      }
      trackedInFlight ??= new Promise<string[]>((resolve) => {
        relStrDbV2
          .getTrackedSymbols$()
          .pipe(takeUntilDestroyed(destroyRef))
          .subscribe({
            next: (companies) => {
              const symbols = normalizeTrackedSymbols(companies);
              patchState(state, { trackedSymbols: symbols });
              resolve(symbols);
            },
            error: (err: unknown) => {
              console.error('[SymbolListStore] getTrackedSymbols$ failed', err);
              resolve([]);
            },
          });
      });
      return trackedInFlight;
    },

    /**
     * Toggle a symbol's membership in a named list.
     * List membership is exclusive: a symbol can only be in one list at a time.
     * Uses an atomic Firestore batch write to guarantee consistency.
     */
    toggleSymbolInList(symbol: string, listName: string | SymbolListName): void {
      // MONITOR is non-exclusive — route it through the membership toggle
      // rather than an exclusive move.
      if (listName === SymbolListName.MONITOR) {
        this.toggleMonitor(symbol);
        return;
      }
      const normalized = symbol.toUpperCase();
      const previousLists = state.symbolLists();
      const isInList = (previousLists[listName] ?? []).includes(normalized);

      // Build the next state immutably: every list gets a fresh array.
      // MONITOR membership is untouched — it coexists with any triage list.
      const nextLists: Record<string, string[]> = {};
      for (const name of Object.keys(previousLists)) {
        const sourceList = previousLists[name] ?? [];
        if (name === listName) {
          nextLists[name] = isInList
            ? sourceList.filter((s) => s !== normalized)
            : [...sourceList, normalized];
        } else if (!isInList && name !== SymbolListName.MONITOR) {
          nextLists[name] = sourceList.filter((s) => s !== normalized);
        } else {
          nextLists[name] = [...sourceList];
        }
      }
      if (!isInList && !(listName in nextLists)) {
        nextLists[listName] = [normalized];
      }
      patchState(state, { symbolLists: nextLists });

      // Atomic persist: add to target list and remove from all other EXCLUSIVE
      // lists in one batch. If toggling OFF (isInList=true), targetList is null
      // (remove from all exclusive lists). MONITOR is never touched.
      const targetList = isInList ? null : (listName as string);
      const exclusiveListNames = ALL_SYMBOL_LIST_NAMES.filter(
        (n) => n !== SymbolListName.MONITOR,
      );
      listService.moveToList(symbol, targetList, exclusiveListNames).subscribe({
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

    /**
     * Toggle the symbol's MONITOR membership — membership-driven (add when
     * absent, remove when present). MONITOR is the non-exclusive list, so
     * this uses add/remove rather than moveToList.
     */
    toggleMonitor(symbol: string): void {
      const inMonitor = (state.symbolLists()[SymbolListName.MONITOR] ?? []).includes(
        symbol.toUpperCase(),
      );
      if (inMonitor) {
        this.removeSymbolFromList(symbol, SymbolListName.MONITOR);
      } else {
        this.addSymbolToList(symbol, SymbolListName.MONITOR);
      }
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
    };
  }),
);
