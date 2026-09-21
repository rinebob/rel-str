/**
 * Symbol-nav feature slice for SwingAnalysisStore — prev/next navigation
 * across the tracked-symbols universe, optionally narrowed to a watchlist.
 * State fragments (`trackedSymbols`, `navFilter`) live on the main store;
 * this file owns the nav computeds and methods so the store file stays
 * under the size guideline.
 *
 * The store spreads `symbolNavComputedBlock(state, listStore)` into a
 * `withComputed` and `symbolNavMethods(store, deps)` into a `withMethods`
 * — each appended AFTER the main blocks so `store` here already carries
 * `setSymbol` and the state signals.
 */
import { computed } from '@angular/core';
import { patchState, WritableStateSource } from '@ngrx/signals';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { DestroyRef } from '@angular/core';

import type { RelStrDbV2Service } from '../../services/rel-str-db-v2.service';
import { SymbolListName } from '../common/constants';
import type { SwingAnalysisState } from './swing-analysis.store';

/** Nav filter: all tracked symbols, or one Symbol List name. */
export type NavFilter = 'ALL' | SymbolListName;

/** Minimal view of the store's signals the nav computeds read. */
export interface SymbolNavComputedInput {
  symbol(): string;
  trackedSymbols(): string[];
  navFilter(): NavFilter;
}

/** Minimal view of SymbolListStore the nav sequence reads. */
export interface SymbolNavListsInput {
  symbolLists(): Record<string, string[]>;
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
  relStrDbV2: RelStrDbV2Service;
  destroyRef: DestroyRef;
}

/** Computeds to spread into a `withComputed` block. */
export function symbolNavComputedBlock(
  state: SymbolNavComputedInput,
  lists: SymbolNavListsInput,
) {
  /**
   * Ordered nav sequence — alphabetical tracked symbols for ALL, or the
   * watchlist's stored order filtered to tracked symbols (drops stale
   * list entries that are no longer tracked).
   */
  const navSequence = computed((): string[] => {
    const tracked = state.trackedSymbols();
    const filter = state.navFilter();
    if (filter === 'ALL') return tracked;
    const trackedSet = new Set(tracked);
    return (lists.symbolLists()[filter] ?? []).filter((s) => trackedSet.has(s));
  });
  /** Index of the current symbol in the sequence — -1 when outside it. */
  const navIndex = computed(() => navSequence().indexOf(state.symbol()));

  return {
    navSequence,
    navIndex,
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
     * Load the tracked-symbols universe once (guarded — the callable is
     * TTL-cached and the list doesn't change intra-session). Symbols are
     * normalized to uppercase, deduped, and sorted for the ALL sequence.
     */
    loadTrackedSymbols(): void {
      if (store.trackedSymbols().length > 0) return;
      deps.relStrDbV2
        .getTrackedSymbols$()
        .pipe(takeUntilDestroyed(deps.destroyRef))
        .subscribe({
          next: (companies) => {
            const symbols = [
              ...new Set(
                companies
                  .map((c) => String(c.symbol || '').trim().toUpperCase())
                  .filter(Boolean),
              ),
            ].sort();
            patchState(store, { trackedSymbols: symbols });
          },
          // getTrackedSymbols$ already logs and maps errors to [] — this
          // path is a belt for mocks/subscriber-level failures only.
          error: (err: unknown) => {
            console.error('[SwingAnalysisStore] getTrackedSymbols$ failed', err);
          },
        });
    },

    /** Narrow the nav sequence to a Symbol List (or 'ALL'). */
    setNavFilter(filter: NavFilter): void {
      patchState(store, { navFilter: filter });
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
