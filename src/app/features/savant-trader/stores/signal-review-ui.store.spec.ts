import { TestBed } from '@angular/core/testing';
import { SignalReviewUiStore } from './signal-review-ui.store';
import { SIGNAL_FILTER_ALL, SignalTimeframe, SignalDirection } from '../common/constants';

describe('SignalReviewUiStore', () => {
  let store: InstanceType<typeof SignalReviewUiStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SignalReviewUiStore],
    });
    store = TestBed.inject(SignalReviewUiStore);
  });

  it('initializes with the ALL filter and no expansion', () => {
    expect(store.signalFilter()).toEqual(SIGNAL_FILTER_ALL);
    expect(store.expandedGroups()).toEqual({});
    expect(store.allExpanded()).toBe(false);
  });

  it('updates the timeframe filter', () => {
    store.setTimeframeFilter(SignalTimeframe.DAILY);
    expect(store.signalFilter()).toEqual({
      timeframe: SignalTimeframe.DAILY,
      direction: SignalDirection.ALL,
    });
  });

  it('updates the direction filter while preserving timeframe', () => {
    store.setTimeframeFilter(SignalTimeframe.WEEKLY);
    store.setDirectionFilter(SignalDirection.LONG);
    expect(store.signalFilter()).toEqual({
      timeframe: SignalTimeframe.WEEKLY,
      direction: SignalDirection.LONG,
    });
  });

  it('tracks expansion for a single group', () => {
    store.setGroupExpanded('Technology', true);
    expect(store.expandedGroups()['Technology']).toBe(true);

    store.setGroupExpanded('Technology', false);
    expect(store.expandedGroups()['Technology']).toBe(false);
  });

  it('expands all groups and sets allExpanded', () => {
    store.setAllExpanded(true, ['Technology', 'Energy']);
    expect(store.allExpanded()).toBe(true);
    expect(store.expandedGroups()).toEqual({
      Technology: true,
      Energy: true,
    });
  });

  it('collapses all groups and clears allExpanded', () => {
    store.setAllExpanded(true, ['Technology']);
    store.setAllExpanded(false, ['Technology']);
    expect(store.allExpanded()).toBe(false);
    expect(store.expandedGroups()).toEqual({ Technology: false });
  });

  it('toggles expand-all from the current state', () => {
    store.toggleExpandAll(['Technology', 'Energy']);
    expect(store.allExpanded()).toBe(true);

    store.toggleExpandAll(['Technology', 'Energy']);
    expect(store.allExpanded()).toBe(false);
  });
});
