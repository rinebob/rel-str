import { computed } from '@angular/core';
import { signalStore, withComputed, withState } from '@ngrx/signals';

export type UniverseSliceOption =
  | 'ALL'
  | 'TOP_10' | 'TOP_25' | 'TOP_50'
  | 'BOTTOM_10' | 'BOTTOM_25' | 'BOTTOM_50'
  | 'MIDDLE_25' | 'MIDDLE_50';

export type TimeRangeOption = '6M' | '1Y' | '2Y' | '5Y' | 'ALL';

export interface BaselineMeta {
  id: string;
  label: string;
  type: 'index' | 'sector';
}

export interface DashboardV3State {
  baselines: BaselineMeta[];
  selectedBaselineId: string | null;
  selectedSlice: UniverseSliceOption;
  selectedTimeRange: TimeRangeOption;
}

const initialState: DashboardV3State = {
  baselines: [
    { id: 'SPY', label: 'SPY – S&P 500', type: 'index' },
    { id: 'QQQ', label: 'QQQ – Nasdaq 100', type: 'index' },
    { id: 'XLF', label: 'XLF – Financials', type: 'sector' },
    { id: 'XLK', label: 'XLK – Technology', type: 'sector' },
  ],
  selectedBaselineId: 'SPY',
  selectedSlice: 'ALL',
  selectedTimeRange: '6M',
};

export const DashboardV3Store = signalStore(
  { providedIn: 'root' },
  withState<DashboardV3State>(initialState),
  withComputed((store) => ({
    selectedBaseline: computed(() =>
      store.baselines().find(b => b.id === store.selectedBaselineId()) ?? null,
    ),
  })),
);
