/**
 * Gallery UI Store
 *
 * Page-local UI state for the gallery view page (#743/#754/#783): timeframe /
 * direction / list filters, the group dimension, and group expansion.
 * Domain data (run, signals,
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

import { CardChartTimeframe, DEFAULT_CARD_CHART_TIMEFRAME, GroupDimension, SignalDirection, SignalTimeframe, SymbolListFilter } from '../common/constants';

export interface GalleryUiState {
  timeframe: SignalTimeframe;
  direction: SignalDirection;
  listFilter: SymbolListFilter;
  /** Grouping dimension for the expando layout (#783) — mirrors signal-review. */
  groupDimension: GroupDimension;
  /** Chart interval for every card — DAILY|WEEKLY only, decoupled from the
   *  `timeframe` signal filter so e.g. daily signals can be reviewed on
   *  weekly charts. Per-card chips override locally until this changes. */
  chartTimeframe: CardChartTimeframe;
  /** Reset tick — bumps on every header Chart click, including a click on
   *  the already-active pill. Two-state toggles need this: "D" clicked
   *  while already daily still means "sync all cards to daily", so cards
   *  watch the tick (not just the value) to drop per-card overrides. */
  chartTimeframeSeq: number;
  /** Per-group expansion state; absent key = collapsed (default closed). */
  expandedGroups: Partial<Record<string, boolean>>;
}

const initialState: GalleryUiState = {
  timeframe: SignalTimeframe.DAILY,
  direction: SignalDirection.LONG,
  listFilter: 'PRIMARY',
  groupDimension: GroupDimension.SECTOR,
  chartTimeframe: DEFAULT_CARD_CHART_TIMEFRAME,
  chartTimeframeSeq: 0,
  expandedGroups: {},
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
    setGroupDimension(dimension: GroupDimension): void {
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
    /** Re-apply page-entry defaults (called on every gallery enter). */
    resetForPage(): void {
      patchState(state, initialState);
    },
  })),
);
