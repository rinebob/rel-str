/**
 * Signal Review UI Store
 *
 * Page-local UI state for the grouped signal review page.
 * Owns filters and expansion state.
 * Domain data (symbols, groups, selected symbol, quick chart, showAllSymbols) stays in
 * RhAgentGroupStore.
 */
import { computed } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';

import {
  SignalFilter,
  SIGNAL_FILTER_ALL,
  SignalTimeframe,
  SignalDirection,
} from '../common/rh-agent.constants';

export interface SignalReviewUiState {
  /** Active timeframe + direction filter for the signal review page. */
  signalFilter: SignalFilter;
  /** Per-group expansion state. */
  expandedGroups: Partial<Record<string, boolean>>;
}

const initialState: SignalReviewUiState = {
  signalFilter: SIGNAL_FILTER_ALL,
  expandedGroups: {},
};

export const SignalReviewUiStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withComputed((state) => ({
    /** True when every known group is expanded. */
    allExpanded: computed(() => {
      const groups = state.expandedGroups();
      const keys = Object.keys(groups);
      return keys.length > 0 && keys.every((key) => groups[key] === true);
    }),
  })),

  withMethods((state) => ({
    /** Update the timeframe portion of the active signal filter. */
    setTimeframeFilter(timeframe: SignalTimeframe): void {
      patchState(state, (s) => ({
        signalFilter: { ...s.signalFilter, timeframe },
      }));
    },

    /** Update the direction portion of the active signal filter. */
    setDirectionFilter(direction: SignalDirection): void {
      patchState(state, (s) => ({
        signalFilter: { ...s.signalFilter, direction },
      }));
    },

    /** Set expansion state for a single group. */
    setGroupExpanded(groupKey: string, expand: boolean): void {
      patchState(state, (s) => ({
        expandedGroups: { ...s.expandedGroups, [groupKey]: expand },
      }));
    },

    /** Expand or collapse all groups at once. */
    setAllExpanded(expand: boolean, groupKeys: string[]): void {
      const record: Record<string, boolean> = {};
      for (const key of groupKeys) {
        record[key] = expand;
      }
      patchState(state, { expandedGroups: record });
    },

    /** Toggle the global expand-all state for the given group keys. */
    toggleExpandAll(groupKeys: string[]): void {
      const next = !state.allExpanded();
      this.setAllExpanded(next, groupKeys);
    },
  }))
);
