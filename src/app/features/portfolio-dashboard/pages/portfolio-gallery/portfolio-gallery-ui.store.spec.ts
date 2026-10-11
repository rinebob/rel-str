/**
 * Specs for PortfolioGalleryUiStore (#926/#950) — page-local facets for the
 * position gallery: chart interval + resync tick, side filter, list filter,
 * group dimension (Bucket first per PRD), and group expansion. No signal
 * timeframe — a position has none.
 */
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { PortfolioGalleryUiStore } from './portfolio-gallery-ui.store';
import { PositionGroupDimension } from './utils/position-cards.util';
import { SignalTimeframe } from '../../../savant-trader/common/constants';

describe('PortfolioGalleryUiStore', () => {
  let store: InstanceType<typeof PortfolioGalleryUiStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), PortfolioGalleryUiStore],
    });
    store = TestBed.inject(PortfolioGalleryUiStore);
  });

  it('defaults: daily chart, all sides, ALL list, flat grouping', () => {
    expect(store.chartTimeframe()).toBe(SignalTimeframe.DAILY);
    expect(store.chartTimeframeSeq()).toBe(0);
    expect(store.side()).toBe('all');
    expect(store.listFilter()).toBe('ALL');
    expect(store.groupDimension()).toBe(PositionGroupDimension.NONE);
    expect(store.expandedGroups()).toEqual({});
  });

  it('setChartTimeframe sets the interval and bumps the resync tick', () => {
    store.setChartTimeframe(SignalTimeframe.WEEKLY);
    expect(store.chartTimeframe()).toBe(SignalTimeframe.WEEKLY);
    expect(store.chartTimeframeSeq()).toBe(1);
    // Clicking the already-active pill still bumps — "sync all cards" (#838 semantics).
    store.setChartTimeframe(SignalTimeframe.WEEKLY);
    expect(store.chartTimeframeSeq()).toBe(2);
  });

  it('setSide / setListFilter / setGroupDimension update facets', () => {
    store.setSide('short');
    store.setListFilter('PRIMARY');
    store.setGroupDimension(PositionGroupDimension.BUCKET);
    expect(store.side()).toBe('short');
    expect(store.listFilter()).toBe('PRIMARY');
    expect(store.groupDimension()).toBe(PositionGroupDimension.BUCKET);
  });

  it('tracks group expansion per key and in bulk', () => {
    store.setGroupExpanded('Technology', true);
    expect(store.expandedGroups()['Technology']).toBe(true);
    store.setAllGroupsExpanded(['Technology', 'Growth'], false);
    expect(store.expandedGroups()['Technology']).toBe(false);
    expect(store.expandedGroups()['Growth']).toBe(false);
  });

  it('resetForPage restores entry defaults', () => {
    store.setSide('short');
    store.setListFilter('PRIMARY');
    store.setChartTimeframe(SignalTimeframe.WEEKLY);
    store.setGroupExpanded('X', true);
    store.resetForPage();
    expect(store.side()).toBe('all');
    expect(store.listFilter()).toBe('ALL');
    expect(store.chartTimeframe()).toBe(SignalTimeframe.DAILY);
    expect(store.chartTimeframeSeq()).toBe(0);
    expect(store.expandedGroups()).toEqual({});
  });
});
