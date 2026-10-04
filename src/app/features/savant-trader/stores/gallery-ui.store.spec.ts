/**
 * GalleryUiStore unit tests (#754/#783) — page-local filter/group state.
 */
import { TestBed } from '@angular/core/testing';
import { GalleryUiStore } from './gallery-ui.store';
import { GroupDimension, SignalDirection, SignalTimeframe } from '../common/constants';

describe('GalleryUiStore', () => {
  let store: InstanceType<typeof GalleryUiStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(GalleryUiStore);
  });

  it('defaults to daily longs on PRIMARY grouped by sector (#783)', () => {
    expect(store.timeframe()).toBe(SignalTimeframe.DAILY);
    expect(store.direction()).toBe(SignalDirection.LONG);
    expect(store.listFilter()).toBe('PRIMARY');
    expect(store.groupDimension()).toBe(GroupDimension.SECTOR);
    expect(store.expandedGroups()).toEqual({});
  });

  it('setters update individual filter parts', () => {
    store.setTimeframe(SignalTimeframe.WEEKLY);
    store.setDirection(SignalDirection.SHORT);
    store.setListFilter('MONITOR');

    expect(store.timeframe()).toBe(SignalTimeframe.WEEKLY);
    expect(store.direction()).toBe(SignalDirection.SHORT);
    expect(store.listFilter()).toBe('MONITOR');
  });

  it('resetForPage restores page-entry defaults', () => {
    store.setTimeframe(SignalTimeframe.ALL);
    store.setListFilter('ALL');
    store.setDirection(SignalDirection.ALL);
    store.setGroupDimension(GroupDimension.MARKET_CAP_TIER);
    store.resetForPage();

    expect(store.timeframe()).toBe(SignalTimeframe.DAILY);
    expect(store.direction()).toBe(SignalDirection.LONG);
    expect(store.listFilter()).toBe('PRIMARY');
    expect(store.groupDimension()).toBe(GroupDimension.SECTOR);
  });

  // #783 — grouped expando layout state
  it('setGroupDimension switches the grouping dimension', () => {
    store.setGroupDimension(GroupDimension.MARKET_CAP_TIER);
    expect(store.groupDimension()).toBe(GroupDimension.MARKET_CAP_TIER);
  });

  it('setGroupExpanded records per-group expansion', () => {
    store.setGroupExpanded('sector:Tech', false);
    store.setGroupExpanded('sector:Energy', true);
    expect(store.expandedGroups()).toEqual({ 'sector:Tech': false, 'sector:Energy': true });
  });

  it('setAllGroupsExpanded collapses or expands every group at once', () => {
    store.setAllGroupsExpanded(['sector:Tech', 'sector:Energy'], false);
    expect(store.expandedGroups()).toEqual({ 'sector:Tech': false, 'sector:Energy': false });
    store.setAllGroupsExpanded(['sector:Tech'], true);
    expect(store.expandedGroups()['sector:Tech']).toBe(true);
  });

  it('resetForPage clears expansion overrides', () => {
    store.setGroupDimension(GroupDimension.MARKET_CAP_TIER);
    store.setGroupExpanded('sector:Tech', false);
    store.resetForPage();
    expect(store.groupDimension()).toBe(GroupDimension.SECTOR);
    expect(store.expandedGroups()).toEqual({});
  });
});
