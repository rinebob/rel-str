/**
 * Symbol-nav feature slice for SwingAnalysisStore — prev/next navigation
 * across the tracked-symbols universe, optionally narrowed to a watchlist.
 * State fragments (`navFilter`) live on the main store; the tracked-symbols
 * universe is owned by SymbolListStore and read through the `lists` input —
 * one canonical universe for nav, chart-review browse, and export.
 * This file owns the nav computeds and methods so the store file stays
 * under the size guideline.
 *
 * The store spreads `symbolNavComputedBlock(state, listStore)` into a
 * `withComputed` and `symbolNavMethods(store, deps)` into a `withMethods`
 * — each appended AFTER the main blocks so `store` here already carries
 * `setSymbol` and the state signals.
 */
import { computed } from '@angular/core';
import { patchState, WritableStateSource } from '@ngrx/signals';

import { NO_MEMBERSHIP, SymbolListFilter } from '../common/constants';
import type { SwingAnalysisState } from './swing-analysis.store';

/** Nav filter: all tracked symbols, one Symbol List name, or NO_MEMBERSHIP. */
export type NavFilter = SymbolListFilter;

/** Minimal view of the store's signals the nav computeds read. */
export interface SymbolNavComputedInput {
  symbol(): string;
  navFilter(): NavFilter;
}

/** Minimal view of SymbolListStore the nav sequence reads. */
export interface SymbolNavListsInput {
  symbolLists(): Record<string, string[]>;
  trackedSymbols(): string[];
  unlistedSymbols(): string[];
}

/** Store API the nav methods need — state + the nav computeds + setSymbol. */
export interface SymbolNavStoreApi
  extends WritableStateSource<SwingAnalysisState>,
    SymbolNavComputedInput {
  navSequence(): string[];
  navIndex(): number;
  setSymbol(symbol: string): void;
}

export interface SymbolNavDeps {
  lists: SymbolNavListsInput & { loadTrackedSymbols(): Promise<string[]> };
}

/** Computeds to spread into a `withComputed` block. */
export function symbolNavComputedBlock(
  state: SymbolNavComputedInput,
  lists: SymbolNavListsInput,
) {
  /**
   * Ordered nav sequence — alphabetical tracked symbols for ALL, the
   * watchlist's stored order filtered to tracked symbols (drops stale
   * list entries that are no longer tracked), or the canonical unlisted
   * set for NO_MEMBERSHIP.
   */
  const navSequence = computed((): string[] => {
    const tracked = lists.trackedSymbols();
    const filter = state.navFilter();
    if (filter === 'ALL') return tracked;
    if (filter === NO_MEMBERSHIP) return lists.unlistedSymbols();
    const trackedSet = new Set(tracked);
    return (lists.symbolLists()[filter] ?? []).filter((s) => trackedSet.has(s));
  });
  /** Index of the current symbol in the sequence — -1 when outside it. */
  const navIndex = computed(() => navSequence().indexOf(state.symbol()));

  return {
    navSequence,
    navIndex,
    /** Passthrough to the canonical tracked-symbols universe. */
    trackedSymbols: lists.trackedSymbols,
    /** Position label — "N of M" in sequence, "— of M" outside it. */
    navPosition: computed(() => {
      const i = navIndex();
      const m = navSequence().length;
      return i >= 0 ? `${i + 1} of ${m}` : `— of ${m}`;
    }),
    /** Whether prev/next have anywhere to go. */
    navEnabled: computed(() => navSequence().length > 0),
  };
}

/** Methods to spread into the store's `withMethods` block. */
export function symbolNavMethods(store: SymbolNavStoreApi, deps: SymbolNavDeps) {
  /** Step to the adjacent symbol in the sequence — wraps at both ends. */
  function stepSymbol(direction: 1 | -1): void {
    const seq = store.navSequence();
    if (seq.length === 0) return;
    const i = store.navIndex();
    const target =
      i < 0
        ? direction > 0
          ? 0
          : seq.length - 1
        : (i + direction + seq.length) % seq.length;
    store.setSymbol(seq[target]);
  }

  return {
    /**
     * Load the tracked-symbols universe (delegates to SymbolListStore,
     * the canonical owner — TTL-cached upstream, guarded there).
     */
    loadTrackedSymbols(): Promise<string[]> {
      return deps.lists.loadTrackedSymbols();
    },

    /**
     * Narrow the nav sequence to a Symbol List (or 'ALL'). Jumps to the
     * new sequence's first symbol so position reads "1 of N" — without
     * this the stale symbol sits outside the list and shows "— of N".
     */
    setNavFilter(filter: NavFilter): void {
      patchState(store, { navFilter: filter });
      const seq = store.navSequence();
      if (seq.length > 0 && store.symbol() !== seq[0]) {
        store.setSymbol(seq[0]);
      }
    },

    /** Advance to the next symbol in the sequence — wraps to first. */
    nextSymbol(): void {
      stepSymbol(1);
    },

    /** Step to the previous symbol in the sequence — wraps to last. */
    prevSymbol(): void {
      stepSymbol(-1);
    },
  };
}
