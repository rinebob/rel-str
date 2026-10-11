/**
 * Portfolio Gallery UI Store (#926/#950)
 *
 * Page-local UI state for the portfolio-v2 gallery: chart interval +
 * resync tick, side filter, list filter, group dimension, and group
 * expansion. Mirrors GalleryUiStore's facet shape minus the signal-only
 * facets — a position has no signal timeframe, so there is no D/W signal
 * filter here; the D/W pill is chart context only.
 */
import {
  signalStore,
  withState,
  withMethods,
  patchState,
} from '@ngrx/signals';

import {
  CardChartTimeframe,
  DEFAULT_CARD_CHART_TIMEFRAME,
  SymbolListFilter,
} from '../../../savant-trader/common/constants';
import { PositionGroupDimension, PositionSide } from './utils/position-cards.util';

export interface PortfolioGalleryUiState {
  side: 'all' | PositionSide;
  listFilter: SymbolListFilter;
  /** Grouping dimension — allocation bucket first per PRD; default flat. */
  groupDimension: PositionGroupDimension;
  /** Chart interval for every card — D/W is chart context only, not a
   *  position filter (positions have no signal timeframe). */
  chartTimeframe: CardChartTimeframe;
  /** Reset tick — bumps on every header Chart click including the
   *  already-active pill so per-card overrides resync (#838 semantics). */
  chartTimeframeSeq: number;
  /** Per-group expansion state; absent key = collapsed. */
  expandedGroups: Partial<Record<string, boolean>>;
}

const initialState: PortfolioGalleryUiState = {
  side: 'all',
  listFilter: 'ALL',
  groupDimension: PositionGroupDimension.NONE,
  chartTimeframe: DEFAULT_CARD_CHART_TIMEFRAME,
  chartTimeframeSeq: 0,
  expandedGroups: {},
};

export const PortfolioGalleryUiStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withMethods((state) => ({
    setSide(side: 'all' | PositionSide): void {
      patchState(state, { side });
    },
    setListFilter(listFilter: SymbolListFilter): void {
      patchState(state, { listFilter });
    },
    setGroupDimension(dimension: PositionGroupDimension): void {
      patchState(state, { groupDimension: dimension });
    },
    setChartTimeframe(timeframe: CardChartTimeframe): void {
      patchState(state, {
        chartTimeframe: timeframe,
        chartTimeframeSeq: state.chartTimeframeSeq() + 1,
      });
    },
    setGroupExpanded(key: string, expanded: boolean): void {
      patchState(state, { expandedGroups: { ...state.expandedGroups(), [key]: expanded } });
    },
    setAllGroupsExpanded(keys: string[], expanded: boolean): void {
      const next = { ...state.expandedGroups() };
      for (const key of keys) next[key] = expanded;
      patchState(state, { expandedGroups: next });
    },
    /** Re-apply page-entry defaults (called on every page enter). */
    resetForPage(): void {
      patchState(state, initialState);
    },
  })),
);
