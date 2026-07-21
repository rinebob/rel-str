/**
 * Backtest UI Store
 *
 * NgRx SignalStore for the backtest run list UI: filters, sorting, selection,
 * and the filtered/sorted view of runs from BacktestRunStore.
 */
import { inject, computed } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';

import { BacktestRunStore } from './backtest-run.store';
import type {
  BacktestDateFilter,
  BacktestSortBy,
  BacktestSortDirection,
  BacktestStatusFilter,
  BacktestRunUi,
} from '../common/backtest.types';
import { toBacktestPtDate } from '../utils/backtest.utils';
import { todayDate, daysAgoPt } from '../../utils/rh-agent.utils';

export interface BacktestUiState {
  statusFilter: BacktestStatusFilter;
  dateFilter: BacktestDateFilter;
  strategyFilter: string;
  symbolSearch: string;
  configSearch: string;
  sortBy: BacktestSortBy;
  sortDirection: BacktestSortDirection;
  includeArchived: boolean;
}

const initialState: BacktestUiState = {
  statusFilter: 'all',
  dateFilter: 'all',
  strategyFilter: 'all',
  symbolSearch: '',
  configSearch: '',
  sortBy: 'createdAt',
  sortDirection: 'desc',
  includeArchived: false,
};

export const BacktestUiStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withComputed((state, dataStore = inject(BacktestRunStore)) => ({
    /** Runs filtered by status, date, strategy, symbol/config search, and archived. */
    filteredRuns: computed((): BacktestRunUi[] => {
      const runs = dataStore.runs();
      const status = state.statusFilter();
      const date = state.dateFilter();
      const strategy = state.strategyFilter();
      const symbolSearch = state.symbolSearch().trim().toUpperCase();
      const configSearch = state.configSearch().trim().toLowerCase();
      const includeArchived = state.includeArchived();
      const sortBy = state.sortBy();
      const sortDirection = state.sortDirection();

      const filtered = runs.filter((run) => {
        if (!includeArchived && run.archived) return false;
        if (status !== 'all' && run.status !== status) return false;

        if (date !== 'all') {
          const runDate = toBacktestPtDate(run.createdAtIso);
          if (!runDate) return false;
          if (date === 'today') {
            if (runDate !== todayDate()) return false;
          } else if (date === '7d') {
            if (runDate < daysAgoPt(7)) return false;
          } else if (date === '30d') {
            if (runDate < daysAgoPt(30)) return false;
          }
        }

        if (strategy !== 'all' && run.strategyId !== strategy) return false;

        if (symbolSearch) {
          const matchesSymbol = run.symbols.some((s) => s.includes(symbolSearch));
          const matchesId = run.runId.toUpperCase().includes(symbolSearch);
          if (!matchesSymbol && !matchesId) return false;
        }

        if (configSearch) {
          const haystack = JSON.stringify(run.config ?? {}).toLowerCase();
          if (!haystack.includes(configSearch)) return false;
        }

        return true;
      });

      return [...filtered].sort((a, b) => {
        let cmp = 0;
        if (sortBy === 'createdAt') {
          cmp = new Date(a.createdAtIso).getTime() - new Date(b.createdAtIso).getTime();
        } else if (sortBy === 'status') {
          cmp = a.status.localeCompare(b.status);
        }
        return sortDirection === 'asc' ? cmp : -cmp;
      });
    }),

    /** True when any non-default filter is active. */
    hasActiveFilters: computed(() => {
      return (
        state.statusFilter() !== 'all' ||
        state.dateFilter() !== 'all' ||
        state.strategyFilter() !== 'all' ||
        state.symbolSearch().trim().length > 0 ||
        state.configSearch().trim().length > 0 ||
        state.includeArchived()
      );
    }),
  })),

  withMethods((state, dataStore = inject(BacktestRunStore)) => ({
    setStatusFilter(filter: BacktestStatusFilter): void {
      patchState(state, { statusFilter: filter });
    },
    setDateFilter(filter: BacktestDateFilter): void {
      patchState(state, { dateFilter: filter });
    },
    setStrategyFilter(filter: string): void {
      patchState(state, { strategyFilter: filter });
    },
    setSymbolSearch(search: string): void {
      patchState(state, { symbolSearch: search });
    },
    setConfigSearch(search: string): void {
      patchState(state, { configSearch: search });
    },
    setSortBy(sortBy: BacktestSortBy): void {
      patchState(state, { sortBy });
    },
    setSortDirection(direction: BacktestSortDirection): void {
      patchState(state, { sortDirection: direction });
    },
    toggleSortDirection(): void {
      patchState(state, { sortDirection: state.sortDirection() === 'asc' ? 'desc' : 'asc' });
    },
    setIncludeArchived(include: boolean): void {
      patchState(state, { includeArchived: include });
    },
    resetFilters(): void {
      patchState(state, {
        statusFilter: 'all',
        dateFilter: 'all',
        strategyFilter: 'all',
        symbolSearch: '',
        configSearch: '',
        includeArchived: false,
      });
    },
  }))
);
